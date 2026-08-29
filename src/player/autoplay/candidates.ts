import { fetchSimilarJamendoTracks } from '@/music/jamendo'
import { getMusicProvider } from '@/music/provider'
import type { Track } from '@/music/types'
import { fetchRelated, describeSeed } from '../related-fetcher'
import type { FetchRelatedOptions, RelatedItem } from '../related-fetcher'
import type { Candidate } from './types'

/**
 * Where autoplay candidates come from, and — more importantly — where they do
 * not.
 *
 * The module is built around one budget, and the budget answers to one rule
 * that outranks it: **playback never stops on its own.** A queue that runs dry
 * has to be refilled, so "spend nothing" stopped being an acceptable answer the
 * moment silence became a bug rather than an ending.
 *
 * Three passes, in order of what they cost and what they know:
 *
 * 1. **Free.** A Jamendo seed spends its `/tracks/similar` call — a real
 *    editorial judgement nothing local can match — and an Audius seed, which has
 *    no such endpoint, is answered from tracks the session already loaded.
 * 2. **One catalogue search**, built from the seed's own tags, genre and
 *    language: `russian pop`, not the seed's title. Spent when pass 1 cannot
 *    keep `MIN_QUEUE_DEPTH` playable items ahead of the listener, which is the
 *    situation that used to end in silence. Both providers may spend it — a
 *    targeted tag search is not the generic popularity list Jamendo was
 *    previously, and correctly, protected from.
 * 3. **One genre-scoped Audius request**, unchanged and still Audius-only
 *    (`collectFallbackCandidates`).
 *
 * So a refill costs at most two requests, and only ever reaches the second when
 * the alternative is stopping. This is a deliberate revision of the
 * one-request ceiling agents/32 set: that ceiling was written when a dry queue
 * was allowed to end the session, and it is what made the reported bug possible.
 *
 * YouTube appears nowhere in this file. Not as a source, not as a fallback, not
 * as an enrichment. Audio autoplay must never search or queue it (agents/33);
 * the video engine keeps its own continuation, in `youtube-actions.ts`.
 */

/** Hard ceiling on provider requests one refill may make, for either seed. */
export const MAX_REQUESTS_PER_REFILL = 2

/** Session tracks considered per refill. Bounds the scoring work, not the network. */
export const MAX_SESSION_CANDIDATES = 120

export interface CandidateSources {
  /**
   * Tracks the session already has: discovery shelves, the current queue,
   * recent search results. Free — they are in memory already.
   */
  session: readonly Track[]
  signal?: AbortSignal
  /** Test seam. */
  fetchSimilar?: typeof fetchSimilarJamendoTracks
  /** Test seam for the genre fallback below. */
  fetchByGenre?: (genre: string, signal?: AbortSignal) => Promise<Track[]>
  /** Test seam for the tag/language search below. */
  fetchRelatedTracks?: typeof fetchRelated
}

/** Rows the genre fallback asks for. Enough to plan from, small enough to score. */
export const GENRE_FALLBACK_LIMIT = 30

/** Rows the tag/language search asks for. Same reasoning, same size. */
export const RELATED_SEARCH_LIMIT = 20

/**
 * One catalogue search, described by what the seed *is* rather than what it is
 * called.
 *
 * This is the pass the reported bug was missing. Everything before it can only
 * offer what the app already happens to hold: a Jamendo similarity answer that
 * may be empty, or the results of whatever search the listener last ran. When a
 * listener plays one Russian pop song out of a page of Russian pop songs and
 * that page is exhausted, there was previously nothing left to play — so the
 * queue ended, and a repeat mode or a re-upload filled the silence.
 *
 * The query comes from `relatedQuery`, which builds it out of the seed's tags,
 * genre and detected language and **never** out of its title. Searching the
 * title returns the song that just played and its re-uploads, which is the one
 * answer a continuation must not give.
 *
 * Both providers may spend this, unlike the genre fallback below. A tag search
 * is a targeted question about the kind of music, not the generic popularity
 * list Jamendo's own similarity judgement deserved protection from.
 *
 * Never throws — `fetchRelated` returns an empty array on every failure path —
 * and never retried here: the delayed retry belongs to the caller that knows
 * whether anything is still playing.
 */
export async function collectRelatedCandidates(
  seed: Track,
  sources: CandidateSources,
): Promise<CandidatePool> {
  const search = sources.fetchRelatedTracks ?? fetchRelated
  const options: FetchRelatedOptions = {
    limit: RELATED_SEARCH_LIMIT,
    ...(sources.signal ? { signal: sources.signal } : {}),
  }

  const found = await search(describeSeed(seed), options)
  const candidates: Candidate[] = []
  for (const item of found) {
    // A `RelatedItem` is a union, and the video half has no business here. This
    // is the runtime half of the compile-time rule that autoplay never queues
    // YouTube (agents/33) — the planner's own filter cannot see it, because a
    // `Candidate` is typed as carrying a `Track`.
    if (!isAudioTrack(item)) continue
    if (item.id === seed.id) continue
    candidates.push({ track: item, source: 'related-search' })
  }
  return { candidates, requests: 1 }
}

function isAudioTrack(item: RelatedItem): item is Track {
  return item.mediaKind === 'audio'
}

/**
 * One genre-scoped request, for when the free path came back empty-handed.
 *
 * **What this is not.** Audius publishes no "tracks similar to this track"
 * endpoint. `/tracks/recommended` looks like one and is not: it accepts no seed
 * track, and with a `genre` it returns the same rows as `/tracks/trending` for
 * that genre — verified against the live API rather than assumed. Treating it as
 * a similarity source would be inventing a meaning the provider never gave it,
 * so this uses the provider method the app already has, and calls the result
 * what it is: other tracks in the same genre.
 *
 * It is a weak signal, which is why it is last. A search like *Kosandra* returns
 * a page of re-uploads of one song and nothing else, so once the same-song rule
 * has removed them there is genuinely nothing in memory to play next — and one
 * genre-scoped request is a far better answer than silence.
 *
 * Never throws, and never retried: a failure means fewer candidates.
 */
async function fetchGenreCandidates(
  genre: string,
  signal: AbortSignal | undefined,
  fetchByGenre: CandidateSources['fetchByGenre'],
): Promise<Track[]> {
  try {
    if (fetchByGenre) return await fetchByGenre(genre, signal)
    return await getMusicProvider().getTrendingTracks({
      genre,
      limit: GENRE_FALLBACK_LIMIT,
      ...(signal ? { signal } : {}),
    })
  } catch {
    return []
  }
}

/**
 * The bounded second pass, spent only when the free one yielded nothing usable.
 *
 * **Audius seeds only, and that restriction is the point.** Audius publishes no
 * similar-tracks endpoint, so an exhausted Audius refill has spent nothing and
 * has nowhere else to look; one genre-scoped request is the difference between a
 * continuation and silence. Jamendo is not in that position. It has a real
 * `/tracks/similar`, and when the provider's own answer to "what is like this
 * track" is empty, following it with a generic same-genre list would be
 * substituting a weaker signal for a provider judgement that already came back —
 * and would quietly turn Jamendo's documented one-request budget into two.
 *
 * So a Jamendo seed spends its one similarity request and stops cleanly. There
 * is no second Jamendo request either; this is not a matter of which provider is
 * asked, but of a provider that has already answered not being second-guessed.
 *
 * Beyond that: exactly one request, and only when the seed carries a genre to
 * scope it by — an unscoped call would be a generic popularity list, which is
 * not a continuation of anything.
 */
export async function collectFallbackCandidates(
  seed: Track,
  sources: CandidateSources,
): Promise<CandidatePool> {
  if (seed.provider !== 'audius') return { candidates: [], requests: 0 }
  if (!seed.genre) return { candidates: [], requests: 0 }

  const tracks = await fetchGenreCandidates(seed.genre, sources.signal, sources.fetchByGenre)
  const candidates: Candidate[] = []
  for (const track of tracks) {
    if (track.id === seed.id) continue
    candidates.push({ track, source: 'genre-fallback' })
  }
  return { candidates, requests: 1 }
}

export interface CandidatePool {
  candidates: Candidate[]
  /** Provider requests actually spent. Asserted by the budget tests. */
  requests: number
}

/**
 * Gathers candidates for one seed.
 *
 * A Jamendo seed gets one `/tracks/similar` call — the provider's own opinion,
 * which nothing local can match. An Audius seed gets none: its similarity is
 * computed from the genre, mood, tags, BPM and key Audius already published on
 * tracks the session holds.
 *
 * Never throws. A failed lookup yields fewer candidates, and the planner simply
 * has less to choose from.
 */
export async function collectCandidates(
  seed: Track,
  sources: CandidateSources,
): Promise<CandidatePool> {
  const candidates: Candidate[] = []
  const seen = new Set<string>([seed.id])
  let requests = 0

  if (seed.provider === 'jamendo') {
    const fetchSimilar = sources.fetchSimilar ?? fetchSimilarJamendoTracks
    requests += 1
    try {
      const result = await fetchSimilar(seed.providerId, {
        ...(sources.signal ? { signal: sources.signal } : {}),
      })
      // The provider returned these in its own order, and that order is the
      // signal — index 0 is Jamendo's closest match.
      result.tracks.forEach((track, index) => {
        if (seen.has(track.id)) return
        seen.add(track.id)
        candidates.push({ track, source: 'jamendo-similar', providerRank: index })
      })
    } catch {
      // Including a caller abort: autoplay is a convenience, and a cancelled
      // refill is not an error anyone needs to see.
    }
  }

  for (const track of sources.session.slice(0, MAX_SESSION_CANDIDATES)) {
    if (seen.has(track.id)) continue
    seen.add(track.id)
    candidates.push({ track, source: 'session' })
  }

  return { candidates, requests }
}
