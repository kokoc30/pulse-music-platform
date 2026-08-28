import { create } from 'zustand'
import type { Track } from '@/music/types'

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

export interface QueueContext {
  /** Stable id of the list the queue was built from, e.g. `search:drake`. */
  id: string
  label: string
}

export interface PlayerState {
  status: PlayerStatus
  currentTrack: Track | null
  queue: Track[]
  currentIndex: number
  queueContext: QueueContext | null
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  /** Play similar music when the queue runs out. */
  autoplaySimilar: boolean
  error: string | null
  /** Monotonic token guarding against stale stream loads. */
  loadToken: number
}

export interface PlayerActions {
  setStatus: (status: PlayerStatus) => void
  setQueue: (queue: Track[], index: number, context: QueueContext | null) => void
  setCurrentIndex: (index: number) => void
  setCurrentTrack: (track: Track | null) => void
  setCurrentTime: (currentTime: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  setAutoplaySimilar: (enabled: boolean) => void
  setError: (error: string | null) => void
  nextLoadToken: () => number
  enqueueNext: (track: Track) => void
  reset: () => void
}

export const VOLUME_STORAGE_KEY = 'pulse:volume'
/**
 * Autoplay is a playback preference, not a personalization signal.
 *
 * It lives beside volume and mute — local-only playback UX state under its own
 * key — precisely so it stays independent of personalization consent. Autoplay
 * works with consent denied; it simply cannot read the stored profile then
 * (agents/32).
 */
export const AUTOPLAY_STORAGE_KEY = 'pulse:autoplay'
/** Recommended default: on. A queue that stops dead is the worse surprise. */
export const DEFAULT_AUTOPLAY = true
export const MUTED_STORAGE_KEY = 'pulse:muted'
export const DEFAULT_VOLUME = 0.8

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME
  return Math.min(Math.max(value, 0), 1)
}

/**
 * Volume and mute are the only things persisted, and only because
 * agents/01_PROJECT_CONTRACT.md allows local-only playback UX state. Stored
 * values are validated; a corrupt entry falls back to the default.
 */
export function readPersistedVolume(storage: Storage | undefined = safeStorage()): {
  volume: number
  muted: boolean
} {
  if (!storage) return { volume: DEFAULT_VOLUME, muted: false }
  try {
    const rawVolume = storage.getItem(VOLUME_STORAGE_KEY)
    const parsed = rawVolume === null ? Number.NaN : Number.parseFloat(rawVolume)
    return {
      volume: Number.isFinite(parsed) ? clampVolume(parsed) : DEFAULT_VOLUME,
      muted: storage.getItem(MUTED_STORAGE_KEY) === 'true',
    }
  } catch {
    return { volume: DEFAULT_VOLUME, muted: false }
  }
}

/** Autoplay reads and writes its own key, so it survives a volume change. */
export function readPersistedAutoplay(storage: Storage | undefined = safeStorage()): boolean {
  if (!storage) return DEFAULT_AUTOPLAY
  try {
    const raw = storage.getItem(AUTOPLAY_STORAGE_KEY)
    // Only an explicit refusal turns it off; anything unreadable falls back to
    // the recommended default rather than silently disabling the feature.
    if (raw === null) return DEFAULT_AUTOPLAY
    return raw !== 'false'
  } catch {
    return DEFAULT_AUTOPLAY
  }
}

export function persistAutoplay(enabled: boolean, storage = safeStorage()): void {
  if (!storage) return
  try {
    storage.setItem(AUTOPLAY_STORAGE_KEY, String(enabled))
  } catch {
    // Private mode / disabled storage — playback must keep working.
  }
}

export function persistVolume(volume: number, muted: boolean, storage = safeStorage()): void {
  if (!storage) return
  try {
    storage.setItem(VOLUME_STORAGE_KEY, String(clampVolume(volume)))
    storage.setItem(MUTED_STORAGE_KEY, String(muted))
  } catch {
    // Private mode / disabled storage — playback must keep working.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

const persisted = readPersistedVolume()
const persistedAutoplay = readPersistedAutoplay()

export const initialPlayerState: PlayerState = {
  status: 'idle',
  currentTrack: null,
  queue: [],
  currentIndex: -1,
  queueContext: null,
  currentTime: 0,
  duration: 0,
  volume: persisted.volume,
  muted: persisted.muted,
  autoplaySimilar: persistedAutoplay,
  error: null,
  loadToken: 0,
}

export const usePlayerStore = create<PlayerState & PlayerActions>((set, get) => ({
  ...initialPlayerState,

  setStatus: (status) => set({ status }),

  setQueue: (queue, index, context) =>
    set({
      queue,
      currentIndex: index,
      queueContext: context,
      currentTrack: queue[index] ?? null,
    }),

  setCurrentIndex: (index) =>
    set((state) => ({
      currentIndex: index,
      currentTrack: state.queue[index] ?? state.currentTrack,
    })),

  setCurrentTrack: (track) => set({ currentTrack: track }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration: Number.isFinite(duration) ? duration : 0 }),

  setVolume: (volume) => {
    const next = clampVolume(volume)
    // Nudging the slider off zero should also lift mute — the reference has a
    // single visual rail, so the two must stay coherent.
    const muted = next === 0 ? get().muted : false
    set({ volume: next, muted })
    persistVolume(next, muted)
  },

  setMuted: (muted) => {
    set({ muted })
    persistVolume(get().volume, muted)
  },

  setAutoplaySimilar: (autoplaySimilar) => {
    set({ autoplaySimilar })
    persistAutoplay(autoplaySimilar)
  },

  setError: (error) => set({ error }),

  nextLoadToken: () => {
    const loadToken = get().loadToken + 1
    set({ loadToken })
    return loadToken
  },

  enqueueNext: (track) =>
    set((state) => {
      if (state.queue.some((queued) => queued.id === track.id)) return state
      const queue = [...state.queue]
      const insertAt = state.currentIndex >= 0 ? state.currentIndex + 1 : queue.length
      queue.splice(insertAt, 0, track)
      return { queue }
    }),

  reset: () =>
    set({
      ...initialPlayerState,
      volume: get().volume,
      muted: get().muted,
      // A preference, not session state: resetting the player must not silently
      // re-enable something the visitor turned off.
      autoplaySimilar: get().autoplaySimilar,
    }),
}))
