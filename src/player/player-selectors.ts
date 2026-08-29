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
 * Whether Next has anywhere to go.
 *
 * Reads the same `nextQueueIndex` the action does, so the control's enabled
 * state and what the control actually does can never disagree — a wrapped
 * repeat-playlist queue or a shuffled running order enables Next on the last
 * *sequential* track exactly when pressing it would work.
 */
export const useHasNext = (): boolean =>
  usePlayerStore(
    (s) =>
      s.repeatMode === 'one' ||
      nextQueueIndex({
        queueLength: s.queue.length,
        currentIndex: s.currentIndex,
        shuffle: s.shuffle,
        shuffleOrder: s.shuffleOrder,
        repeatMode: s.repeatMode,
      }) !== null,
  )

export const useHasPrevious = (): boolean =>
  usePlayerStore(
    (s) =>
      s.currentTime > 0 ||
      previousQueueIndex({
        queueLength: s.queue.length,
        currentIndex: s.currentIndex,
        shuffle: s.shuffle,
        shuffleOrder: s.shuffleOrder,
        repeatMode: s.repeatMode,
      }) !== null,
  )

export const useRepeatMode = (): RepeatMode => usePlayerStore((s) => s.repeatMode)
export const useShuffle = (): boolean => usePlayerStore((s) => s.shuffle)

/** True while this exact track is the loaded one — drives row highlighting. */
export const useIsCurrentTrack = (trackId: string): boolean =>
  usePlayerStore((s) => s.currentTrack?.id === trackId)

export function selectProgressRatio(state: PlayerState): number {
  if (state.duration <= 0) return 0
  return Math.min(Math.max(state.currentTime / state.duration, 0), 1)
}

export const useProgressRatio = (): number => usePlayerStore(selectProgressRatio)
