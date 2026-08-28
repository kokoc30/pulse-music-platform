import { getMusicProvider } from '@/music/provider'
import type { MusicProvider } from '@/music/provider'
import { MusicError } from '@/music/types'
import type { Artist, Track } from '@/music/types'
import { hasAnyAlias } from './aliases'
import { expandQuery, selectVariantsForBudget } from './expand'
import type { QueryVariant } from './expand'
import {
  MIN_STRONG_COVERAGE,
  STRONG_ARTIST_RELEVANCE,
  STRONG_RELEVANCE,
  bestScoreAcross,
  isStrongMatch,
  scoreArtist,
} from './relevance'
import type { RelevanceBreakdown, ScoredTrack } from './relevance'
import { normalizeText } from './text'
import type { NormalizedText } from './text'

/**
 * The smart-search layer.
 *
 * Audius' relevance is substring-driven, which produces two distinct failures:
 * unrelated results presented confidently (`sara al swas` → `djwashiwasha`), and
 * real releases missed because the uploader spelled them differently
 * (`kassandra` / `кассандра` → the track is titled `Kosandra`).
 *
 * This module fixes both without touching the UI or the provider abstraction:
 * expand → search → merge → dedupe → rank → threshold.
 *
 * **Request discipline.** Expansion is escalated, not eager. The original query
 * is searched first; variants are only paid for when that result is weak, and
 * the whole operation is hard-capped at `MAX_PROVIDER_REQUESTS`.
 */

/** Hard ceiling on provider round-trips for a single search. */
export const MAX_PROVIDER_REQUESTS = 4
/** Variant searches are capped below the request ceiling to leave room for artist lookup. */
export const MAX_VARIANT_REQUESTS = 2

export const DEFAULT_RESULT_LIMIT = 20

export type SearchOutcome =
  /** At least one result cleared the relevance threshold. */
  | 'results'
  /** The provider answered, but nothing was relevant enough to show. */
  | 'no-strong-match'
  /** The provider returned nothing at all. */
  | 'empty'

export interface SmartSearchResult {
  query: string
  outcome: SearchOutcome
  tracks: Track[]
  /** The best artist match, when one was confident enough to act on. */
  artist: Artist | null
  /**
   * Every candidate that cleared the threshold, carrying the relevance that put
   * it there. The multi-provider aggregator re-ranks Audius and Jamendo results
   * together in one pass and needs the scores to do it
   * (agents/15_MULTI_PROVIDER_SEARCH.md → "Global Ranking").
   */
  scored: ScoredTrack[]
  /**
   * The normalized query variants actually searched. A second provider's
   * results are scored against exactly this set, so neither provider is judged
   * against a different question.
   */
  searchedQueries: NormalizedText[]
  /** Rows the provider returned before thresholding, for the `empty` vs `no-strong-match` distinction. */
  rawResultCount: number
  /** Diagnostics — surfaced in tests, never rendered. */
  diagnostics: {
    variants: string[]
    providerRequests: number
    /** Candidates seen before thresholding. */
    candidates: number
    /** Highest relevance seen, even if it was rejected. */
    topScore: number
    scores: Array<{ trackId: string; score: number; matchedQuery: string }>
  }
}

interface Candidate {
  track: Track
  relevance: RelevanceBreakdown
  matchedQuery: string
  /** Set for tracks pulled from a strongly-matched artist's catalogue. */
  fromArtist: boolean
}

export interface SmartSearchOptions {
  signal?: AbortSignal
  limit?: number
  provider?: MusicProvider
}

function isAbort(error: unknown): boolean {
  return error instanceof MusicError && error.code === 'ABORTED'
}

/** Merges by provider track id; the highest-scoring occurrence wins. */
function mergeCandidates(existing: Map<string, Candidate>, incoming: Candidate): void {
  const current = existing.get(incoming.track.id)
  if (!current) {
    existing.set(incoming.track.id, incoming)
    return
  }
  if (incoming.relevance.score > current.relevance.score) {
    existing.set(incoming.track.id, { ...incoming, fromArtist: current.fromArtist || incoming.fromArtist })
  } else if (incoming.fromArtist && !current.fromArtist) {
    existing.set(incoming.track.id, { ...current, fromArtist: true })
  }
}

/**
 * Runs one relevance-ranked search across a bounded set of query variants.
 */
export async function smartSearchTracks(
  rawQuery: string,
  options: SmartSearchOptions = {},
): Promise<SmartSearchResult> {
  const provider = options.provider ?? getMusicProvider()
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT
  const signal = options.signal

  const variants = expandQuery(rawQuery)
  const primary = variants[0]

  const empty: SmartSearchResult = {
    query: rawQuery,
    outcome: 'empty',
    tracks: [],
    artist: null,
    scored: [],
    searchedQueries: [],
    rawResultCount: 0,
    diagnostics: { variants: [], providerRequests: 0, candidates: 0, topScore: 0, scores: [] },
  }
  if (!primary) return empty

  const searchedQueries: NormalizedText[] = []
  const candidates = new Map<string, Candidate>()
  let providerRequests = 0
  let rawResultCount = 0

  const runVariant = async (variant: QueryVariant): Promise<Artist[]> => {
    providerRequests += 1
    const result = await provider.searchCatalog(variant.query, { limit, ...(signal ? { signal } : {}) })
    rawResultCount += result.tracks.length
    searchedQueries.push(normalizeText(variant.query))

    for (const track of result.tracks) {
      const { relevance, matchedQuery } = bestScoreAcross(searchedQueries, track)
      mergeCandidates(candidates, { track, relevance, matchedQuery, fromArtist: false })
    }
    return result.artists
  }

  // --- 1. The original query, always. -------------------------------------
  const primaryArtists = await runVariant(primary)

  const bestScore = () =>
    [...candidates.values()].reduce((max, candidate) => Math.max(max, candidate.relevance.score), 0)

  // --- 2. A confident artist match earns their catalogue. -----------------
  const normalizedPrimary = normalizeText(primary.query)
  let matchedArtist: Artist | null = null
  let bestArtistScore = 0
  for (const artist of primaryArtists) {
    const score = scoreArtist(normalizedPrimary, artist)
    if (score > bestArtistScore) {
      bestArtistScore = score
      matchedArtist = artist
    }
  }

  if (
    matchedArtist &&
    bestArtistScore >= STRONG_ARTIST_RELEVANCE &&
    (matchedArtist.trackCount ?? 0) > 0 &&
    providerRequests < MAX_PROVIDER_REQUESTS
  ) {
    providerRequests += 1
    try {
      const artistTracks = await provider.getArtistTracks(matchedArtist.id, {
        ...(signal ? { signal } : {}),
      })
      rawResultCount += artistTracks.length
      for (const track of artistTracks) {
        const { relevance, matchedQuery } = bestScoreAcross(searchedQueries, track)
        // The artist is a confirmed match, so their own catalogue inherits that
        // confidence even when an individual title shares nothing with the query.
        //
        // Coverage inherits it too, and for the same reason: clearing
        // `STRONG_ARTIST_RELEVANCE` means the query substantially matched this
        // artist's *name* — `Aram` alone scores 0.375 against `aram asatryan`
        // and never gets here — so their own releases are covered by definition.
        const boosted: RelevanceBreakdown = {
          ...relevance,
          artist: Math.max(relevance.artist, bestArtistScore),
          coverage: Math.max(relevance.coverage, MIN_STRONG_COVERAGE),
          score: Math.max(relevance.score, bestArtistScore * 0.9 + relevance.popularity),
        }
        mergeCandidates(candidates, {
          track,
          relevance: boosted,
          matchedQuery: matchedQuery || primary.query,
          fromArtist: true,
        })
      }
    } catch (error) {
      if (isAbort(error)) throw error
      // Failing to enrich must never fail the search itself.
    }
  } else {
    matchedArtist = null
  }

  // --- 3. Spend requests on variants only when it is worth it. -----------
  //
  // Two triggers. A weak answer obviously needs help. But a *curated alias*
  // also does, even when the first answer looked strong: searching "kassandra"
  // returns a fuzzy "Cassandra" match that scores well and is still the wrong
  // record — the alias exists precisely because the provider's index cannot
  // bridge that gap on its own.
  // A curated alias always earns its requests. The alias exists precisely
  // because the same release is indexed under several spellings, so an exact
  // hit on one of them is no evidence that the best match is not under another:
  // "kassandra" matches a track literally titled "Kassandra" while the record
  // the visitor wants is titled "Kosandra". Merging and ranking then decide.
  const curatedAlias = hasAnyAlias(normalizedPrimary.normalized, normalizedPrimary.tokens)

  if (curatedAlias || bestScore() < STRONG_RELEVANCE) {
    const extras = selectVariantsForBudget(
      variants,
      Math.min(MAX_VARIANT_REQUESTS, MAX_PROVIDER_REQUESTS - providerRequests),
    )

    const settled = await Promise.allSettled(extras.map((variant) => runVariant(variant)))
    for (const outcome of settled) {
      if (outcome.status === 'rejected' && isAbort(outcome.reason)) throw outcome.reason
    }

    // Variants searched later must also re-score everything found earlier, so a
    // track discovered by the original query still benefits from an alias hit.
    for (const candidate of candidates.values()) {
      const { relevance, matchedQuery } = bestScoreAcross(searchedQueries, candidate.track)
      if (relevance.score > candidate.relevance.score) {
        candidates.set(candidate.track.id, { ...candidate, relevance, matchedQuery })
      }
    }
  }

  // --- 4. Rank, threshold, truncate. --------------------------------------
  const ranked = [...candidates.values()].sort((a, b) => {
    if (b.relevance.score !== a.relevance.score) return b.relevance.score - a.relevance.score
    return (b.track.playCount ?? 0) - (a.track.playCount ?? 0)
  })

  // Relevance *and* coverage. A row that scores well on one generic shared
  // token is not an answer to a two-token question, and presenting it as one is
  // how "aram asatryan" came back as "Eternos Rivales - Fil d'aram".
  const relevant = ranked.filter((candidate) => isStrongMatch(candidate.relevance))
  const topScore = ranked[0]?.relevance.score ?? 0

  const diagnostics: SmartSearchResult['diagnostics'] = {
    variants: searchedQueries.map((entry) => entry.provider),
    providerRequests,
    candidates: rawResultCount,
    topScore,
    scores: ranked.slice(0, 10).map((candidate) => ({
      trackId: candidate.track.id,
      score: Number(candidate.relevance.score.toFixed(4)),
      matchedQuery: candidate.matchedQuery,
    })),
  }

  if (relevant.length === 0) {
    return {
      query: rawQuery,
      // A provider that returned rows we rejected is a different, truthful
      // story from a provider that returned nothing.
      outcome: rawResultCount > 0 ? 'no-strong-match' : 'empty',
      tracks: [],
      artist: null,
      scored: [],
      searchedQueries,
      rawResultCount,
      diagnostics,
    }
  }

  return {
    query: rawQuery,
    outcome: 'results',
    tracks: relevant.slice(0, limit).map((candidate) => candidate.track),
    artist: matchedArtist,
    scored: relevant.map((candidate) => ({
      track: candidate.track,
      relevance: candidate.relevance,
      matchedQuery: candidate.matchedQuery,
    })),
    searchedQueries,
    rawResultCount,
    diagnostics,
  }
}
