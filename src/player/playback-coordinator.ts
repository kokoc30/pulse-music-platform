import { getAudioEngine } from './audio-engine'
import { usePlayerStore } from './player-store'
import { hasYouTubeEngine, getYouTubeEngine } from './youtube-engine'
import { useYouTubeStore } from './youtube-store'

/**
 * The one place that knows both engines exist.
 *
 * Phase 3 added a second, entirely different playback engine. The invariant it
 * has to preserve is simple and absolute: **exactly one engine is active at a
 * time** (agents/24 → "Architecture"). Two engines playing at once would mean a
 * YouTube video and an Audius track over the top of each other, and — worse for
 * policy — it would mean YouTube audio continuing while the visitor's attention
 * is on something else.
 *
 * This module is deliberately tiny and owns no state beyond the active kind. The
 * audio actions call `activateAudio()`, the YouTube actions call
 * `activateYouTube()`, and neither has to know about the other.
 *
 * It touches both stores for one reason only: a paused engine whose store still
 * says `playing` is a lie the UI acts on. The bottom bar would show a pause
 * icon over a silent audio element, and the next press would "pause" something
 * already paused instead of resuming it. So whichever engine loses the claim
 * has its status corrected here, at the moment it loses it. Both stores are
 * plain state modules with no imports back into this one, so there is no cycle.
 */

export type EngineKind = 'none' | 'audio' | 'youtube'

let active: EngineKind = 'none'

export function activeEngine(): EngineKind {
  return active
}

/**
 * Observers of the active engine.
 *
 * Phase 6 added exactly one: the Media Session controller, which must be cleared
 * the moment YouTube takes the engine and restored when audio takes it back
 * (agents/31). Making that an explicit notification keeps this module the single
 * authority on which engine is live — the alternative, having the session infer
 * it from two stores, would be a second source of truth for the one fact this
 * file exists to own.
 *
 * Listeners are notified after the switch has completed, and the dependency runs
 * one way: the session imports the coordinator, never the reverse.
 */
type EngineListener = (kind: EngineKind) => void

const listeners = new Set<EngineListener>()

export function onEngineChange(listener: EngineListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function announce(kind: EngineKind): void {
  for (const listener of listeners) listener(kind)
}

/**
 * Claims playback for the audio engine, pausing YouTube first.
 *
 * `pause` rather than `stop`: the visitor may be switching to a track for a
 * moment and the cued video should survive it. The surface stays open and
 * visible, which is exactly what a paused embedded player is allowed to do.
 */
export function activateAudio(): void {
  if (active === 'youtube' && hasYouTubeEngine()) {
    getYouTubeEngine().pause()
    const youtube = useYouTubeStore.getState()
    if (youtube.status === 'playing' || youtube.status === 'loading') youtube.setStatus('paused')
  }
  const changed = active !== 'audio'
  active = 'audio'
  if (changed) announce(active)
}

/**
 * Claims playback for YouTube, pausing the audio element first.
 *
 * The audio element is paused, never unloaded: the current track, its position
 * and the queue all survive, so YouTube → Audius resumes rather than restarts.
 */
export function activateYouTube(): void {
  if (active === 'audio') {
    getAudioEngine().pause()
    const player = usePlayerStore.getState()
    if (player.status === 'playing' || player.status === 'loading') player.setStatus('paused')
  }
  const changed = active !== 'youtube'
  active = 'youtube'
  if (changed) announce(active)
}

/** Nothing is playing — after a queue ends, or when the surface is closed. */
export function releasePlayback(kind: EngineKind): void {
  if (active !== kind) return
  active = 'none'
  announce(active)
}

/** Test seam. */
export function resetPlaybackCoordinator(): void {
  active = 'none'
  listeners.clear()
}
