import type { QueueContext } from '@/player/player-store'
import type { ListenContext } from './types'

/**
 * Interprets the queue context the player already carries.
 *
 * Every shelf, card, row and chart in the app already stamps the queue with an
 * id like `shelf:trending` or `search:kosandra` so the player bar can say where
 * playback came from. Phase 4 reads that same string rather than threading a new
 * parameter through every call site, so a listen recorded from anywhere in the
 * app knows its own provenance for free.
 */

export const CONTEXT_IDS = {
  recommended: 'shelf:recommended',
  recent: 'shelf:recent',
  because: 'shelf:because',
  artists: 'shelf:artists',
} as const

export function listenContextFor(context: QueueContext | null): ListenContext {
  const id = context?.id
  if (!id) return 'other'
  if (id.startsWith('search:')) return 'search'
  if (id === CONTEXT_IDS.recommended || id === CONTEXT_IDS.because) return 'recommendation'
  if (id === CONTEXT_IDS.recent) return 'recent'
  if (id === CONTEXT_IDS.artists) return 'artist'
  if (id.startsWith('shelf:') || id.startsWith('station:') || id.startsWith('chart:')) {
    return 'trending'
  }
  if (id.startsWith('queue')) return 'queue'
  return 'other'
}

/** The submitted query a listen was discovered through, when there was one. */
export function searchQueryFor(context: QueueContext | null): string | undefined {
  const id = context?.id
  if (!id?.startsWith('search:')) return undefined
  const query = id.slice('search:'.length).trim()
  return query || undefined
}
