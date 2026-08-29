import { fetchSimilarJamendoTracks } from '@/music/jamendo'
import { getMusicProvider } from '@/music/provider'
import type { Track } from '@/music/types'
import type { Candidate } from './types'

/**
 * Where autoplay candidates come from, and — more importantly — where they do
 * not.
 *
 * The whole module is built around one budget, and it is **at most one provider
 * request per refill, per seed** — the same ceiling this file has always had.
 *
 * The two providers reach it differently, because they offer different things:
 *
 * · **Jamendo** has a real `/tracks/similar`, so a Jamendo seed spends that one
 *   request and takes the provider's own opinion as the answer — including when
 *   the answer is "nothing". It is never followed by a second request of any
 *   kind.
 * · **Audius** has no similar-tracks endpoint, and fanning out searches to fake
 *   one is exactly what agents/32 forbids. So an Audius seed is answered for free
 *   from tracks the session already loaded, and only if *that* yields nothing
 *   playable may it spend its single request on a genre-scoped list
 *   (`collectFallbackCandidates`).
 *
 * Neither path can spend two. The free Audius pass and the bounded Audius
 * fallback are the same one-request allowance, claimed at different moments.
 *
 * YouTube appears nowhere in this file. Not as a source, not as a fallback, not
 * as an enrichment. Autoplay must never search or queue it (agents/33).
 */

/** Hard ceiling on provider requests one refill may make, for either seed. */
export const MAX_REQUESTS_PER_REFILL = 1

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
}

/** Rows the genre fallback asks for. Enough to plan from, small enough to score. */
export const GENRE_FALLBACK_LIMIT = 30

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
