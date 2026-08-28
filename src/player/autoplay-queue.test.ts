import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@/music/types'
import { setMusicProvider } from '@/music/provider'
import { createAudiusProvider } from '@/music/audius/adapter'
import { resetPersonalizationForTests } from '@/personalization'
import { setAudioEngine } from './audio-engine'
import { createFakeAudioEngine } from './fake-audio-engine'
import type { FakeAudioEngine } from './fake-audio-engine'
import { clearAutoplayBuffer, clearSessionPool, rememberTracks } from './autoplay'
import { MAX_AUTOPLAY_ATTEMPTS, playNext, playPrevious, resetMediaRetries } from './player-actions'
import { initialPlayerState, usePlayerStore } from './player-store'
import { resetPlaybackCoordinator } from './playback-coordinator'

/**
 * Queue precedence and the end-of-queue flow, through the real player actions.
 *
 * These are the rules a listener actually feels: what plays next, and whether
 * anything the app generated can ever push in front of something they chose.
 */

let engine: FakeAudioEngine
let counter = 0

function track(overrides: Partial<Track> = {}): Track {
  counter += 1
  const providerId = overrides.providerId ?? `t${counter}`
  return {
    id: `jamendo:${providerId}`,
    mediaKind: 'audio',
    provider: 'jamendo',
    providerId,
    title: `Track ${providerId}`,
    artistName: `Artist ${counter}`,
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    genre: 'Electronic',
    // Jamendo tracks resolve their stream from the track itself, so playback
    // needs no provider round-trip in these tests.
    streamUrl: 'https://prod.jamendo.test/stream.mp3',
    ...overrides,
    ...(overrides.id ? { id: overrides.id } : {}),
  }
}

/** Puts a track on screen as the current one, with the given queue. */
function seatPlayer(current: Track, queue: Track[] = [current]) {
  const state = usePlayerStore.getState()
  state.setQueue(queue, queue.findIndex((t) => t.id === current.id), null)
  state.setStatus('playing')
}

beforeEach(() => {
  counter = 0
  setMusicProvider(createAudiusProvider())
  engine = createFakeAudioEngine()
  setAudioEngine(engine)
  usePlayerStore.setState({ ...initialPlayerState, autoplaySimilar: true })
  resetMediaRetries()
  resetPlaybackCoordinator()
  resetPersonalizationForTests()
  clearAutoplayBuffer()
  clearSessionPool()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the explicit queue always wins', () => {
  it('plays the next queued track rather than anything generated', async () => {
    const current = track({ providerId: 'current' })
    const queued = track({ providerId: 'queued' })
    // A far more "similar" candidate is available, and must still be ignored.
    rememberTracks([track({ providerId: 'similar', genre: 'Electronic' })])
    seatPlayer(current, [current, queued])

    await playNext()

    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('queued')
  })

  it('consumes the whole explicit queue before generating anything', async () => {
    const one = track({ providerId: 'one' })
    const two = track({ providerId: 'two' })
    const three = track({ providerId: 'three' })
    rememberTracks([track({ providerId: 'generated' })])
    seatPlayer(one, [one, two, three])

    await playNext()
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('two')
    await playNext()
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('three')
  })
})

describe('when the explicit queue is exhausted', () => {
  it('plays a generated similar track', async () => {
    const current = track({ providerId: 'current' })
    const similar = track({ providerId: 'similar', genre: 'Electronic' })
    rememberTracks([similar])
    seatPlayer(current)

    await playNext()

    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('similar')
    expect(engine.playing).toBe(true)
  })

  it('appends the generated track to the queue, like any other item', async () => {
    const current = track({ providerId: 'current' })
    rememberTracks([track({ providerId: 'similar' })])
    seatPlayer(current)

    await playNext()

    const state = usePlayerStore.getState()
    expect(state.queue).toHaveLength(2)
    expect(state.currentIndex).toBe(1)
    // Which is what makes Previous work normally afterwards.
    expect(state.queue[0].providerId).toBe('current')
  })

  it('stops when autoplay is switched off', async () => {
    const current = track({ providerId: 'current' })
    rememberTracks([track({ providerId: 'similar' })])
    usePlayerStore.setState({ autoplaySimilar: false })
    seatPlayer(current)

    await playNext()

    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('current')
    expect(usePlayerStore.getState().status).toBe('paused')
  })

  it('stops when nothing similar is available', async () => {
    const current = track({ providerId: 'current' })
    seatPlayer(current)

    await playNext()

    expect(usePlayerStore.getState().status).toBe('paused')
    expect(usePlayerStore.getState().currentTime).toBe(0)
  })

  it('never generates the track that just played', async () => {
    const current = track({ providerId: 'current' })
    rememberTracks([current])
    seatPlayer(current)

    await playNext()

    expect(usePlayerStore.getState().status).toBe('paused')
  })
})

describe('candidate failure is bounded', () => {
  it('tries alternates, then stops rather than looping', async () => {
    const current = track({ providerId: 'current' })
    // Every candidate is unplayable, so each attempt fails the same way.
    const broken = Array.from({ length: 10 }, (_, i) =>
      track({ providerId: `broken${i}`, isStreamable: false }),
    )
    rememberTracks(broken)
    seatPlayer(current)

    await playNext()

    // It gave up. The important property is that it terminated at all.
    const state = usePlayerStore.getState()
    expect(state.queue.length).toBeLessThanOrEqual(1 + MAX_AUTOPLAY_ATTEMPTS)
  })

  it('settles on a playable alternate when one exists', async () => {
    const current = track({ providerId: 'current' })
    rememberTracks([
      track({ providerId: 'broken', isStreamable: false, genre: 'Electronic' }),
      track({ providerId: 'good', genre: 'Electronic' }),
    ])
    seatPlayer(current)

    await playNext()

    expect(usePlayerStore.getState().status).not.toBe('error')
  })
})

describe('manual Next follows the same rules', () => {
  it('takes the queued track when there is one', async () => {
    const current = track({ providerId: 'current' })
    const queued = track({ providerId: 'queued' })
    rememberTracks([track({ providerId: 'generated' })])
    seatPlayer(current, [current, queued])

    await playNext()
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('queued')
  })

  it('consumes a generated track when the queue is empty', async () => {
    const current = track({ providerId: 'current' })
    rememberTracks([track({ providerId: 'generated' })])
    seatPlayer(current)

    await playNext()
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('generated')
  })
})

describe('Previous still uses playback history only', () => {
  it('steps back through the queue, never into generated candidates', async () => {
    const first = track({ providerId: 'first' })
    const second = track({ providerId: 'second' })
    rememberTracks([track({ providerId: 'generated' })])
    seatPlayer(second, [first, second])
    usePlayerStore.getState().setCurrentTime(0)

    await playPrevious()

    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('first')
  })

  it('restarts the track when the listener is already into it', async () => {
    const first = track({ providerId: 'first' })
    const second = track({ providerId: 'second' })
    seatPlayer(second, [first, second])
    usePlayerStore.getState().setDuration(200)
    usePlayerStore.getState().setCurrentTime(30)

    await playPrevious()

    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('second')
    expect(usePlayerStore.getState().currentTime).toBe(0)
  })
})

describe('the autoplay preference', () => {
  it('defaults to on', () => {
    expect(initialPlayerState.autoplaySimilar).toBe(true)
  })

  it('persists under its own key, separate from personalization', () => {
    usePlayerStore.getState().setAutoplaySimilar(false)
    expect(localStorage.getItem('pulse:autoplay')).toBe('false')
    // Personalization storage is untouched: the two are independent settings.
    expect(localStorage.getItem('pulse.personalization.v1')).toBeNull()
  })

  it('survives a player reset', () => {
    usePlayerStore.getState().setAutoplaySimilar(false)
    usePlayerStore.getState().reset()
    expect(usePlayerStore.getState().autoplaySimilar).toBe(false)
  })
})
