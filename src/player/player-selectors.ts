import type { Track } from '@/music/types'
import { usePlayerStore } from './player-store'
import type { PlayerState } from './player-store'
import { nextQueueIndex, previousQueueIndex } from './queue-order'
import type { RepeatMode } from './queue-order'

/**
 * Narrow selectors so a `timeupdate` tick only re-renders the progress readout,
 * not the whole application (agents/03_ARCHITECTURE.md → "Performance").
 */

export const useCurrentTrack = (): Track | null => usePlayerStore((s) => s.currentTrack)
export const usePlayerStatus = (): PlayerState['status'] => usePlayerStore((s) => s.status)
export const useIsPlaying = (): boolean => usePlayerStore((s) => s.status === 'playing')
export const useIsLoading = (): boolean => usePlayerStore((s) => s.status === 'loading')
export const usePlayerError = (): string | null => usePlayerStore((s) => s.error)
export const useCurrentTime = (): number => usePlayerStore((s) => s.currentTime)
export const useDuration = (): number => usePlayerStore((s) => s.duration)
export const useVolume = (): number => usePlayerStore((s) => s.volume)
export const useMuted = (): boolean => usePlayerStore((s) => s.muted)
export const useQueue = (): Track[] => usePlayerStore((s) => s.queue)
export const useQueueIndex = (): number => usePlayerStore((s) => s.currentIndex)
export const useQueueContextLabel = (): string | null =>
  usePlayerStore((s) => s.queueContext?.label ?? null)

/**
 * Whether the listener can ask Pulse to move forward — the question the Next
 * button is actually asking.
 *
 * The selector this replaces answered a narrower one: "does the *queue* have
 * another position?" That was the whole of Next before autoplay existed, and it
 * stopped being the whole of it in Phase 6 without anyone noticing. The consequence was
 * exact and reported from a real device: playing one song from a search seeds a
 * queue of one, `nextQueueIndex` returns `null`, and Next appeared **disabled**
 * — while `playNext` sitting behind that same button was perfectly capable of
 * generating a similar track. The control and the action disagreed.
 *
 * Three ways forward, and each is deliberately a *distinct destination*:
 *
 * · a further position in the explicit queue;
 * · a Repeat-playlist wrap that lands somewhere else — a single-track queue
 *   wrapping onto itself is not somewhere else;
 * · autoplay, when the visitor left it on and there is a track to seed from.
 *
 * What is deliberately **not** here is Repeat one. It can always replay the
 * current track, so including it would light up Next on a one-track queue with
 * autoplay off — and pressing it would then do the one thing a press of Next
 * must never do (`skipToNext`). Enabling a control by promising something the
 * action refuses to deliver is worse than disabling it.
 */
export function selectCanSkipNext(s: PlayerState): boolean {
  const index = nextQueueIndex({
    queueLength: s.queue.length,
    currentIndex: s.currentIndex,
    shuffle: s.shuffle,
    shuffleOrder: s.shuffleOrder,
    repeatMode: s.repeatMode,
  })
  if (index !== null && index !== s.currentIndex) return true
  return s.autoplaySimilar && s.currentTrack !== null
}

export const useCanSkipNext = (): boolean => usePlayerStore(selectCanSkipNext)

/**
 * Whether Previous would do anything — either restart this track, or step back.
 *
 * Exported as a pure predicate, not left inline in the hook, so the unified
 * snapshot can reuse it rather than restating it. A duplicated transport
 * predicate is exactly what put `useHasNext` and `playNext` out of step.
 */
export function selectHasPrevious(s: PlayerState): boolean {
  return (
    s.currentTime > 0 ||
    previousQueueIndex({
      queueLength: s.queue.length,
      currentIndex: s.currentIndex,
      shuffle: s.shuffle,
      shuffleOrder: s.shuffleOrder,
      repeatMode: s.repeatMode,
    }) !== null
  )
}

export const useHasPrevious = (): boolean => usePlayerStore(selectHasPrevious)

export const useRepeatMode = (): RepeatMode => usePlayerStore((s) => s.repeatMode)
export const useShuffle = (): boolean => usePlayerStore((s) => s.shuffle)

/*
 * `useVideoSurfaceOpen` was deleted here rather than left beside its
 * replacement. It existed so the audio sheet could stand down while the floating
 * video player was on screen — a question that no longer has a meaning, because
 * there is one player and it renders both. A dead selector with a plausible name
 * is what let `useHasNext` and `playNext` disagree for a whole phase.
 */

/** True while this exact track is the loaded one — drives row highlighting. */
export const useIsCurrentTrack = (trackId: string): boolean =>
  usePlayerStore((s) => s.currentTrack?.id === trackId)

export function selectProgressRatio(state: PlayerState): number {
  if (state.duration <= 0) return 0
  return Math.min(Math.max(state.currentTime / state.duration, 0), 1)
}

export const useProgressRatio = (): number => usePlayerStore(selectProgressRatio)
