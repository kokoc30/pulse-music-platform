import { create } from 'zustand'
import type { YouTubeVideoItem } from '@/music/types'

/**
 * State for the YouTube surface.
 *
 * Kept apart from `player-store` on purpose. The audio store's vocabulary —
 * queue, seek position, volume, stream errors — belongs to something the app
 * controls; a YouTube embed is a player the app may only ask politely to start
 * and stop, whose volume and scrubbing are the visitor's business through
 * YouTube's own native controls. Merging the two would invite exactly the kind
 * of code that treats a video like a track.
 */

export type YouTubeStatus = 'idle' | 'loading' | 'cued' | 'playing' | 'paused' | 'ended' | 'error'

export interface YouTubePlaybackState {
  /** The item the surface is showing. Null means the surface is closed. */
  item: YouTubeVideoItem | null
  status: YouTubeStatus
  /** True while the visible surface is mounted and displayed. */
  surfaceOpen: boolean
  /**
   * Set when a scripted transition cued an item that may not auto-play, so the
   * UI can ask for an explicit press instead of starting on its own.
   */
  awaitingUserPlay: boolean
  currentTime: number
  duration: number
  error: string | null
}

export interface YouTubePlaybackActions {
  openWith: (item: YouTubeVideoItem, status: YouTubeStatus) => void
  setStatus: (status: YouTubeStatus) => void
  setAwaitingUserPlay: (awaiting: boolean) => void
  setProgress: (currentTime: number, duration: number) => void
  setError: (error: string | null) => void
  close: () => void
}

export const initialYouTubeState: YouTubePlaybackState = {
  item: null,
  status: 'idle',
  surfaceOpen: false,
  awaitingUserPlay: false,
  currentTime: 0,
  duration: 0,
  error: null,
}

export const useYouTubeStore = create<YouTubePlaybackState & YouTubePlaybackActions>((set) => ({
  ...initialYouTubeState,

  openWith: (item, status) =>
    set({
      item,
      status,
      surfaceOpen: true,
      awaitingUserPlay: status === 'cued',
      currentTime: 0,
      duration: item.durationSeconds ?? 0,
      error: null,
    }),

  setStatus: (status) =>
    set((state) => ({
      status,
      // Any real playing state clears the "press play" prompt.
      awaitingUserPlay: status === 'playing' ? false : state.awaitingUserPlay,
      error: status === 'error' ? state.error : null,
    })),

  setAwaitingUserPlay: (awaitingUserPlay) => set({ awaitingUserPlay }),

  setProgress: (currentTime, duration) =>
    set({
      currentTime: Number.isFinite(currentTime) ? currentTime : 0,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    }),

  setError: (error) => set({ error, status: error ? 'error' : 'idle' }),

  close: () => set({ ...initialYouTubeState }),
}))
