import { beforeEach, describe, expect, it } from 'vitest'
import type { Track } from '@/music/types'
import {
  DEFAULT_VOLUME,
  MUTED_STORAGE_KEY,
  VOLUME_STORAGE_KEY,
  clampVolume,
  initialPlayerState,
  persistVolume,
  readPersistedVolume,
  usePlayerStore,
} from './player-store'

const makeTrack = (id: string): Track => ({
  id: `audius:${id}`,
  mediaKind: 'audio',
  provider: 'audius',
  providerId: id,
  title: `Track ${id}`,
  artistName: 'Artist',
  artwork: {},
  durationSeconds: 100,
  isStreamable: true,
})

beforeEach(() => {
  usePlayerStore.setState({ ...initialPlayerState, volume: DEFAULT_VOLUME, muted: false })
})

describe('clampVolume', () => {
  it('constrains to 0..1 and falls back on garbage', () => {
    expect(clampVolume(0.5)).toBe(0.5)
    expect(clampVolume(-3)).toBe(0)
    expect(clampVolume(7)).toBe(1)
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_VOLUME)
  })
})

describe('persisted volume', () => {
  it('round-trips through localStorage', () => {
    persistVolume(0.33, true)
    expect(readPersistedVolume()).toEqual({ volume: 0.33, muted: true })
  })

  it('validates a corrupt stored value instead of trusting it', () => {
    localStorage.setItem(VOLUME_STORAGE_KEY, 'not-a-number')
    localStorage.setItem(MUTED_STORAGE_KEY, 'maybe')
    expect(readPersistedVolume()).toEqual({ volume: DEFAULT_VOLUME, muted: false })
  })

  it('clamps an out-of-range stored value', () => {
    localStorage.setItem(VOLUME_STORAGE_KEY, '9')
    expect(readPersistedVolume().volume).toBe(1)
  })

  it('degrades cleanly when storage is unavailable', () => {
    expect(readPersistedVolume(undefined)).toEqual({ volume: DEFAULT_VOLUME, muted: false })
    expect(() => persistVolume(0.5, false, undefined)).not.toThrow()
  })
})

describe('queue state', () => {
  it('setQueue derives the current track from the index', () => {
    const queue = [makeTrack('a'), makeTrack('b')]
    usePlayerStore.getState().setQueue(queue, 1, { id: 'ctx', label: 'Ctx' })
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('b')
  })

  it('setCurrentIndex keeps the previous track when the index is out of range', () => {
    const queue = [makeTrack('a')]
    usePlayerStore.getState().setQueue(queue, 0, null)
    usePlayerStore.getState().setCurrentIndex(9)
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('a')
  })

  it('enqueueNext inserts directly after the current track', () => {
    usePlayerStore.getState().setQueue([makeTrack('a'), makeTrack('b')], 0, null)
    usePlayerStore.getState().enqueueNext(makeTrack('x'))
    expect(usePlayerStore.getState().queue.map((t) => t.providerId)).toEqual(['a', 'x', 'b'])
  })

  it('enqueueNext appends when nothing is playing', () => {
    usePlayerStore.getState().enqueueNext(makeTrack('x'))
    expect(usePlayerStore.getState().queue.map((t) => t.providerId)).toEqual(['x'])
  })

  it('enqueueNext is a no-op for a track already queued', () => {
    usePlayerStore.getState().setQueue([makeTrack('a')], 0, null)
    usePlayerStore.getState().enqueueNext(makeTrack('a'))
    expect(usePlayerStore.getState().queue).toHaveLength(1)
  })
})

describe('load token', () => {
  it('increases monotonically', () => {
    const first = usePlayerStore.getState().nextLoadToken()
    const second = usePlayerStore.getState().nextLoadToken()
    expect(second).toBe(first + 1)
  })
})

describe('duration', () => {
  it('rejects a non-finite duration', () => {
    usePlayerStore.getState().setDuration(Number.POSITIVE_INFINITY)
    expect(usePlayerStore.getState().duration).toBe(0)
  })
})

describe('reset', () => {
  it('clears playback but keeps the listener volume preference', () => {
    usePlayerStore.getState().setVolume(0.25)
    usePlayerStore.getState().setQueue([makeTrack('a')], 0, null)
    usePlayerStore.getState().setStatus('playing')

    usePlayerStore.getState().reset()

    const state = usePlayerStore.getState()
    expect(state.status).toBe('idle')
    expect(state.currentTrack).toBeNull()
    expect(state.queue).toEqual([])
    expect(state.volume).toBe(0.25)
  })
})
