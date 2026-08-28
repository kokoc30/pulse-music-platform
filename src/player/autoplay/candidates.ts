import { fetchSimilarJamendoTracks } from '@/music/jamendo'
import type { Track } from '@/music/types'
import type { Candidate } from './types'

/**
 * Where autoplay candidates come from, and — more importantly — where they do
 * not.
 *
 * The whole module is built around one budget: **at most one provider request
 * per refill**, and only for Jamendo, which is the only provider with a real
 * similar-tracks endpoint. Audius has no such endpoint, so inventing one by
 * fanning out searches is exactly what agents/32 forbids; Audius similarity is
 * computed from metadata on tracks the session already loaded.
 *
 * YouTube appears nowhere in this file. Not as a source, not as a fallback, not
 * as an enrichment. Autoplay must never search or queue it (agents/33).
 */

/** Hard ceiling on provider requests one refill may make. */
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
