import { searchJamendoTracks } from '@/music/jamendo/client'
import type { JamendoSearchOptions, JamendoSearchResult, JamendoStatus } from '@/music/jamendo/client'
import { expandQuery } from '@/music/search/expand'
import { STRONG_RELEVANCE, bestScoreAcross, isStrongMatch } from '@/music/search/relevance'
import type { ScoredTrack } from '@/music/search/relevance'
import { smartSearchTracks } from '@/music/search/smart-search'
import type { SearchOutcome, SmartSearchOptions, SmartSearchResult } from '@/music/search/smart-search'
import { normalizeText } from '@/music/search/text'
import type { NormalizedText } from '@/music/search/text'
import { MusicError } from '@/music/types'
import type { Artist, ProviderId, Track } from '@/music/types'
import { dedupeAcrossProviders } from './cross-provider-dedupe'
import { MAX_JAMENDO_REQUESTS, selectJamendoFallback, shouldSpendJamendoFallback } from './provider-budget'

/**
 * One search, two catalogues, one ranked list.
 *
 * This layer sits *above* the existing Audius smart search rather than
 * replacing it: expansion, alias handling, artist lookup, the request ceiling
 * and the international ranking fixes all still run exactly as they did in
 * Phase 1. What is new is that Jamendo runs alongside, both result sets are
 * scored against the same query variants, and one global ranking pass decides
 * the order (agents/15_MULTI_PROVIDER_SEARCH.md).
 *
 * The visitor never sees which provider answered: no tabs, no sections, one list.
 */

export interface ProviderOutcome {
  provider: ProviderId
  status: 'success' | 'unavailable' | 'error'
  /** Rows this provider contributed after thresholding. */
  trackCount: number
  /** Round-trips actually spent. */
  requests: number
}

export interface MultiProviderSearchResult {
  query: string
  outcome: SearchOutcome
  tracks: Track[]
  artist: Artist | null
  /**
   * Whether either open catalogue produced a result the app is willing to stand
   * behind — relevance *and* token coverage, not merely "a provider answered".
   *
   * The distinction is the whole point. Audius and Jamendo happily return rows
   * that share one generic word with the query; promoting one of those to Top
   * Result tells the visitor their artist was found when it was not, and it
   * demotes the YouTube fallback to its subtle variant exactly when the
   * prominent one is needed most.
   */
  hasStrongOpenCatalogMatch: boolean
  providers: ProviderOutcome[]
  diagnostics: {
    audius: SmartSearchResult['diagnostics'] | null
    jamendoRequests: number
    /** Cross-provider duplicates collapsed. */
    mergedDuplicates: number
    topScore: number
    variants: string[]
  }
}

export interface MultiProviderSearchOptions extends SmartSearchOptions {
  /** Test seam: replaces the Jamendo client. */
  searchJamendo?: (query: string, options: JamendoSearchOptions) => Promise<JamendoSearchResult>
}

function isAbort(error: unknown): boolean {
  return error instanceof MusicError && error.code === 'ABORTED'
}

/** Scores one provider's tracks against every query variant that was searched. */
function scoreAgainst(queries: readonly NormalizedText[], tracks: readonly Track[]): ScoredTrack[] {
  return tracks.map((track) => {
    const { relevance, matchedQuery } = bestScoreAcross(queries, track)
    return { track, relevance, matchedQuery }
  })
}

/** Exact whole-field equality, in either the spaced or the whitespace-free form. */
function matchesExactly(query: NormalizedText, value: string): boolean {
  if (!query.folded) return false
  const field = normalizeText(value)
  return field.folded === query.folded || (field.compact.length > 0 && field.compact === query.compact)
}

/**
 * The top of the ranking priority list from agents/15_MULTI_PROVIDER_SEARCH.md
 * → "Global Ranking": exact title, then exact artist, then everything else.
 *
 * The Phase 1 scorer deliberately caps every text score at `1 - MAX_POPULARITY_
 * BONUS` so popularity always has headroom to separate two textually identical
 * matches. Within one provider that is exactly right. Across two providers it is
 * not: Audius rows carry a play count and Jamendo rows carry none, so *every*
 * exact tie would resolve to Audius on popularity alone — a systematic provider
 * bias, not a relevance judgement. Ranking on exactness first removes it without
 * touching the Phase 1 scorer that the international regression tests pin down.
 */
function exactnessTier(queries: readonly NormalizedText[], track: Track): number {
  let tier = 0
  for (const query of queries) {
    if (matchesExactly(query, track.title)) return 2
    if (matchesExactly(query, track.artistName)) tier = Math.max(tier, 1)
  }
  return tier
}

const EMPTY_AUDIUS_STATE = {
  result: null as SmartSearchResult | null,
  status: 'error' as ProviderOutcome['status'],
  error: null as unknown,
}

export async function multiProviderSearch(
  rawQuery: string,
  options: MultiProviderSearchOptions = {},
): Promise<MultiProviderSearchResult> {
  const limit = options.limit ?? 20
  const signal = options.signal
  const jamendoSearch = options.searchJamendo ?? searchJamendoTracks

  const variants = expandQuery(rawQuery)
  const primary = variants[0]

  const empty: MultiProviderSearchResult = {
    query: rawQuery,
    outcome: 'empty',
    tracks: [],
    artist: null,
    hasStrongOpenCatalogMatch: false,
    providers: [],
    diagnostics: { audius: null, jamendoRequests: 0, mergedDuplicates: 0, topScore: 0, variants: [] },
  }
  if (!primary) return empty

  const jamendoOptions = (): JamendoSearchOptions => ({
    limit,
    ...(signal ? { signal } : {}),
  })

  // --- 1. Both providers concurrently. -------------------------------------
  //
  // Neither waits for the other, and neither can fail the other: a rejected
  // provider becomes a status, not an exception (agents/15 → "Provider Failure
  // Tolerance"). A caller abort is the one thing that still propagates.
  const [audiusSettled, jamendoSettled] = await Promise.allSettled([
    smartSearchTracks(rawQuery, options),
    jamendoSearch(primary.query, jamendoOptions()),
  ])

  if (audiusSettled.status === 'rejected' && isAbort(audiusSettled.reason)) throw audiusSettled.reason
  if (jamendoSettled.status === 'rejected' && isAbort(jamendoSettled.reason)) throw jamendoSettled.reason

  const audius = { ...EMPTY_AUDIUS_STATE }
  if (audiusSettled.status === 'fulfilled') {
    audius.result = audiusSettled.value
    audius.status = 'success'
  } else {
    audius.error = audiusSettled.reason
  }

  let jamendoStatus: JamendoStatus = 'error'
  let jamendoTracks: Track[] = []
  let jamendoRequests = 1
  if (jamendoSettled.status === 'fulfilled') {
    jamendoStatus = jamendoSettled.value.status
    jamendoTracks = jamendoSettled.value.tracks
  }

  // The scoring vocabulary is whatever Audius actually searched, so both
  // providers are judged against the same set of questions. If Audius failed,
  // fall back to the original query alone.
  const searchedQueries: NormalizedText[] = audius.result?.searchedQueries.length
    ? audius.result.searchedQueries
    : [normalizeText(primary.query)]

  let jamendoScored = scoreAgainst(searchedQueries, jamendoTracks)

  // --- 2. One conditional Jamendo fallback, never more. --------------------
  const fallback = selectJamendoFallback(variants)
  const bestJamendoScore = jamendoScored.reduce((max, item) => Math.max(max, item.relevance.score), 0)

  if (
    shouldSpendJamendoFallback({
      status: jamendoStatus,
      bestJamendoScore,
      strongThreshold: STRONG_RELEVANCE,
      hasFallbackVariant: Boolean(fallback),
    }) &&
    fallback &&
    jamendoRequests < MAX_JAMENDO_REQUESTS
  ) {
    jamendoRequests += 1
    try {
      const extra = await jamendoSearch(fallback.query, jamendoOptions())
      if (extra.status === 'success' && extra.tracks.length) {
        const fallbackQueries = [...searchedQueries, normalizeText(fallback.query)]
        // Everything is re-scored against the widened set so a track found by
        // the original query still benefits from the alias hit, exactly as the
        // Audius path already does.
        jamendoScored = scoreAgainst(fallbackQueries, dedupeById([...jamendoTracks, ...extra.tracks]))
      }
    } catch (error) {
      if (isAbort(error)) throw error
      // A failed fallback leaves the first answer standing.
    }
  }

  // --- 3. Merge and rank globally. -----------------------------------------
  //
  // Audius candidates keep the relevance smart-search computed for them,
  // including its confirmed-artist boost; Jamendo candidates are scored with
  // the same function over the same queries. Text relevance therefore decides
  // the order across providers, and popularity stays the capped tie-breaker it
  // has always been (agents/15 → "Global Ranking").
  const audiusScored = audius.result?.scored ?? []
  // Relevance *and* coverage, applied identically to both catalogues. Audius
  // candidates were already gated by `smartSearchTracks`; Jamendo's are gated
  // here, so neither provider can smuggle a one-token coincidence into the list.
  const relevant = [...audiusScored, ...jamendoScored].filter((candidate) =>
    isStrongMatch(candidate.relevance),
  )

  const tiers = new Map<string, number>()
  for (const candidate of relevant) {
    tiers.set(candidate.track.id, exactnessTier(searchedQueries, candidate.track))
  }

  const ranked = [...relevant].sort((a, b) => {
    // 1. Exact title, then exact artist.
    const tier = (tiers.get(b.track.id) ?? 0) - (tiers.get(a.track.id) ?? 0)
    if (tier !== 0) return tier
    // 2. Textual relevance, with the popularity component removed so a catalogue
    //    that reports play counts cannot outrank one that does not.
    const textA = a.relevance.score - a.relevance.popularity
    const textB = b.relevance.score - b.relevance.popularity
    if (textB !== textA) return textB - textA
    // 3. Only now the capped popularity tie-breaker, exactly as Phase 1 uses it.
    if (b.relevance.popularity !== a.relevance.popularity) {
      return b.relevance.popularity - a.relevance.popularity
    }
    const plays = (b.track.playCount ?? 0) - (a.track.playCount ?? 0)
    if (plays !== 0) return plays
    // 4. Deterministic final order regardless of which provider answered first.
    return a.track.id < b.track.id ? -1 : a.track.id > b.track.id ? 1 : 0
  })

  const { tracks: deduped, merged } = dedupeAcrossProviders(ranked)
  const finalTracks = deduped.slice(0, limit).map((candidate) => candidate.track)

  const providers: ProviderOutcome[] = [
    {
      provider: 'audius',
      status: audius.status,
      trackCount: audiusScored.length,
      requests: audius.result?.diagnostics.providerRequests ?? 0,
    },
    {
      provider: 'jamendo',
      status: jamendoStatus,
      trackCount: jamendoScored.length,
      requests: jamendoRequests,
    },
  ]

  // --- 4. Outcome. ---------------------------------------------------------
  //
  // Partial success means *showing the results you actually have*. When a
  // provider is down and the survivors produced nothing to show, there is no
  // partial success to report: saying "no matching music" would blame the
  // visitor's query for an outage. So the error state is raised whenever a
  // provider failed and the merged list is empty.
  if (audius.status === 'error' && finalTracks.length === 0) {
    throw audius.error instanceof MusicError
      ? audius.error
      : new MusicError('PROVIDER', 'Search is unavailable right now. Please try again.', {
          ...(audius.error !== null ? { cause: audius.error } : {}),
        })
  }

  const sawRows = (audius.result?.rawResultCount ?? 0) > 0 || jamendoTracks.length > 0
  const outcome: SearchOutcome =
    finalTracks.length > 0 ? 'results' : sawRows ? 'no-strong-match' : 'empty'

  return {
    query: rawQuery,
    outcome,
    tracks: finalTracks,
    hasStrongOpenCatalogMatch: finalTracks.length > 0,
    // The artist shelf is an Audius-only concept in Phase 2; Jamendo's read API
    // is queried for tracks only.
    artist: outcome === 'results' ? (audius.result?.artist ?? null) : null,
    providers,
    diagnostics: {
      audius: audius.result?.diagnostics ?? null,
      jamendoRequests,
      mergedDuplicates: merged,
      topScore: ranked[0]?.relevance.score ?? 0,
      variants: searchedQueries.map((entry) => entry.provider),
    },
  }
}

function dedupeById(tracks: readonly Track[]): Track[] {
  const seen = new Set<string>()
  const out: Track[] = []
  for (const track of tracks) {
    if (seen.has(track.id)) continue
    seen.add(track.id)
    out.push(track)
  }
  return out
}
