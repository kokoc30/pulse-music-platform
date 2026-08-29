import { useSyncExternalStore } from 'react'
import { activeEngine, onEngineChange } from './playback-coordinator'
import type { EngineKind } from './playback-coordinator'

/**
 * Which engine owns playback right now, as React state.
 *
 * **The coordinator stays the single source of truth.** This mirrors it; it does
 * not duplicate it. There is no second `activeEngine` in Zustand, nothing writes
 * this value, and nothing can disagree with the module that actually pauses one
 * engine to start the other — `useSyncExternalStore` subscribes to the exact
 * notification the coordinator already emitted for the Media Session, and reads
 * the same getter.
 *
 * It exists because the global bar had no way to ask. `GlobalPlayer` read the
 * audio store's `currentTrack` and nothing else, so when YouTube took over — and
 * `activateYouTube` deliberately *preserved* the audio track so it could be
 * resumed — the bar went on announcing a track that was no longer playing. The
 * fix is presentational: keep both engine states intact, and let the bar ask
 * whose turn it is.
 */
export function useActiveEngine(): EngineKind {
  return useSyncExternalStore(onEngineChange, activeEngine, getServerSnapshot)
}

/** Nothing is playing during SSR or a static render. */
function getServerSnapshot(): EngineKind {
  return 'none'
}
