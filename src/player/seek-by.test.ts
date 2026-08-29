import { beforeEach, describe, expect, it } from 'vitest'
import type { Track } from '@/music/types'
import { setAudioEngine } from './audio-engine'
import { createFakeAudioEngine } from './fake-audio-engine'
import type { FakeAudioEngine } from './fake-audio-engine'
import { SEEK_STEP_SECONDS, seek, seekBy } from './player-actions'
import { initialPlayerState, usePlayerStore } from './player-store'

/**
 * Relative seeking — the arithmetic behind the ±10 controls and the lock
 * screen's own skip buttons, which now share this one path.
 */

let engine: FakeAudioEngine

const track: Track = {
  id: 'jamendo:t1',
  mediaKind: 'audio',
  provider: 'jamendo',
  providerId: 't1',
  title: 'A Track',
  artistName: 'An Artist',
  artwork: {},
  durationSeconds: 200,
  isStreamable: true,
}

function seat(currentTime: number, duration = 200) {
  const state = usePlayerStore.getState()
  state.setQueue([track], 0, null)
  state.setDuration(duration)
  state.setCurrentTime(currentTime)
  // The engine needs its own duration before it will honour a seek, exactly as
  // a real audio element does once metadata has loaded.
  engine.emitDuration(duration)
}

beforeEach(() => {
  engine = createFakeAudioEngine()
  setAudioEngine(engine)
  usePlayerStore.setState({ ...initialPlayerState })
})

const position = () => usePlayerStore.getState().currentTime

describe('the step matches the platform convention', () => {
  it('is ten seconds, the same value the OS media controls default to', () => {
    expect(SEEK_STEP_SECONDS).toBe(10)
  })
})

describe('moving the playhead relatively', () => {
  it('goes back ten seconds', () => {
    seat(100)
    seekBy(-10)
    expect(position()).toBe(90)
  })

  it('goes forward ten seconds', () => {
    seat(100)
    seekBy(10)
    expect(position()).toBe(110)
  })

  it('reaches the real audio element, not just the store', () => {
    seat(100)
    seekBy(10)
    expect(engine.getCurrentTime()).toBe(110)
  })
})

describe('clamping', () => {
  it('never goes negative', () => {
    seat(4)
    seekBy(-10)
    expect(position()).toBe(0)
  })

  it('never passes the duration', () => {
    seat(197, 200)
    seekBy(10)
    expect(position()).toBe(200)
    expect(position()).toBeLessThanOrEqual(200)
  })

  it('sits exactly on the boundaries rather than near them', () => {
    seat(0)
    seekBy(-10)
    expect(position()).toBe(0)

    seat(200, 200)
    seekBy(10)
    expect(position()).toBe(200)
  })
})

describe('refusing what it cannot do', () => {
  it('does nothing when the duration is unknown', () => {
    seat(0, 0)
    usePlayerStore.getState().setCurrentTime(5)
    seekBy(10)
    expect(position()).toBe(5)
    expect(engine.getCurrentTime()).toBe(0)
  })

  it('does nothing for a non-finite delta', () => {
    seat(100)
    seekBy(Number.NaN)
    seekBy(Number.POSITIVE_INFINITY)
    expect(position()).toBe(100)
  })

  it('produces no NaN or Infinity, whatever it is given', () => {
    seat(100)
    for (const delta of [-1e9, 1e9, -0, 0]) {
      seekBy(delta)
      expect(Number.isFinite(position())).toBe(true)
      expect(position()).toBeGreaterThanOrEqual(0)
      expect(position()).toBeLessThanOrEqual(200)
    }
  })
})

describe('it is the same path as absolute seeking', () => {
  it('clamps identically to `seek`', () => {
    seat(100)
    seek(-50)
    const afterAbsolute = position()

    seat(100)
    seekBy(-150)
    expect(position()).toBe(afterAbsolute)
  })
})
