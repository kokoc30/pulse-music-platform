import type { Track } from '@/music/types'

/**
 * The tracks this session has already seen.
 *
 * Autoplay's Audius strategy rests on this: Audius publishes no similar-tracks
 * endpoint, so rather than inventing one by fanning out searches, the planner
 * ranks tracks the app already loaded — discovery shelves, search results,
 * anything that entered a queue — using the metadata Audius attached to them.
 *
 * It is deliberately in-memory only. Nothing here is persisted: no new storage
 * key, no schema change, and no stream URL ever written down. A reload starts
 * the pool empty and it refills from the first shelf that renders.
 *
 * Bounded and most-recent-first, so a long session cannot grow it without limit
 * and fresh material outranks stale.
 */

/** Tracks retained. Enough for a varied pool, small enough to score instantly. */
export const SESSION_POOL_LIMIT = 300

let pool: Track[] = []

/**
 * Adds tracks, newest first, ignoring anything unplayable.
 *
 * Called wherever the app already receives a batch of tracks, so the pool costs
 * no requests of its own — it is a by-product of browsing.
 */
export function rememberTracks(tracks: readonly Track[]): void {
  if (!tracks.length) return
  const incoming = tracks.filter((track) => track.isStreamable)
  if (!incoming.length) return

  const seen = new Set(incoming.map((track) => track.id))
  pool = [...incoming, ...pool.filter((track) => !seen.has(track.id))].slice(0, SESSION_POOL_LIMIT)
}

/** Everything the session knows, most recently seen first. */
export function sessionTracks(): readonly Track[] {
  return pool
}

/** Test seam, and the reset a fresh app instance performs. */
export function clearSessionPool(): void {
  pool = []
}
