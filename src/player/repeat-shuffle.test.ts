import { beforeEach, describe, expect, it } from 'vitest'
import { createAudiusProvider } from '@/music/audius/adapter'
import { setMusicProvider } from '@/music/provider'
import type { Track } from '@/music/types'
import { resetPersonalizationForTests } from '@/personalization'
import { setAudioEngine } from './audio-engine'
import { clearAutoplayBuffer, clearSessionPool, rememberTracks } from './autoplay'
import { createFakeAudioEngine } from './fake-audio-engine'
import type { FakeAudioEngine } from './fake-audio-engine'
import { resetPlaybackCoordinator } from './playback-coordinator'
import { playNext, playPrevious, resetMediaRetries } from './player-actions'
import { initialPlayerState, usePlayerStore, REPEAT_STORAGE_KEY } from './player-store'
import { shuffledOrder } from './queue-order'

/**
 * Repeat, shuffle and the precedence between them, through the real actions.
 *
 * The rule under test is the one a listener feels: **anything they set outranks
 * anything the app generated**. Autoplay is consulted last, unconditionally last
 * (agents/45 → "Priority at track end").
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
    streamUrl: 'https://prod.jamendo.test/stream.mp3',
    ...overrides,
    ...(overrides.id ? { id: overrides.id } : {}),
  }
}

const queueOf = (size: number) =>
  Array.from({ length: size }, (_, index) => track({ providerId: `q${index}` }))

function seat(queue: Track[], index: number) {
  const state = usePlayerStore.getState()
  state.setQueue(queue, index, { id: 'playlist:test', label: 'Test' })
  state.setStatus('playing')
}

const currentId = () => usePlayerStore.getState().currentTrack?.id

beforeEach(() => {
  counter = 0
  localStorage.clear()
  setMusicProvider(createAudiusProvider())
  engine = createFakeAudioEngine()
  setAudioEngine(engine)
  usePlayerStore.setState({ ...initialPlayerState, autoplaySimilar: false, repeatMode: 'off' })
  resetMediaRetries()
  resetPlaybackCoordinator()
  resetPersonalizationForTests()
  clearAutoplayBuffer()
  clearSessionPool()
})

describe('repeat one', () => {
  it('replays the current track instead of advancing', async () => {
    const queue = queueOf(3)
    seat(queue, 0)
    usePlayerStore.getState().setRepeatMode('one')

    await playNext()
    expect(currentId()).toBe(queue[0].id)
  })

  it('outranks a queued item — the visitor asked for this track', async () => {
    const queue = queueOf(3)
    seat(queue, 1)
    usePlayerStore.getState().setRepeatMode('one')

    await playNext()
    expect(currentId()).toBe(queue[1].id)
    expect(currentId()).not.toBe(queue[2].id)
  })

  it('does not apply to Previous, which is a request to move', async () => {
    const queue = queueOf(3)
    seat(queue, 2)
    usePlayerStore.getState().setRepeatMode('one')
    usePlayerStore.getState().setCurrentTime(0)

    await playPrevious()
    expect(currentId()).toBe(queue[1].id)
  })
})

describe('repeat playlist', () => {
  it('wraps to the first item at the end', async () => {
    const queue = queueOf(3)
    seat(queue, 2)
    usePlayerStore.getState().setRepeatMode('all')

    await playNext()
    expect(currentId()).toBe(queue[0].id)
  })

  it('wraps backwards too', async () => {
    const queue = queueOf(3)
    seat(queue, 0)
    usePlayerStore.getState().setRepeatMode('all')
    usePlayerStore.getState().setCurrentTime(0)

    await playPrevious()
    expect(currentId()).toBe(queue[2].id)
  })

  it('does not wrap when repeat is off', async () => {
    const queue = queueOf(3)
    seat(queue, 2)

    await playNext()
    expect(usePlayerStore.getState().status).toBe('paused')
    expect(currentId()).toBe(queue[2].id)
  })
})

describe('precedence at the end of a track', () => {
  it('prefers the explicit queue over autoplay', async () => {
    const queue = queueOf(3)
    seat(queue, 0)
    usePlayerStore.setState({ autoplaySimilar: true })
    rememberTracks([track({ providerId: 'generated' })])

    await playNext()
    expect(currentId()).toBe(queue[1].id)
  })

  it('prefers repeat playlist over autoplay at the end of the list', async () => {
    const queue = queueOf(3)
    seat(queue, 2)
    usePlayerStore.setState({ autoplaySimilar: true, repeatMode: 'all' })
    rememberTracks([track({ providerId: 'generated' })])

    await playNext()
    expect(currentId()).toBe(queue[0].id)
  })

  it('prefers repeat one over everything', async () => {
    const queue = queueOf(3)
    seat(queue, 0)
    usePlayerStore.setState({ autoplaySimilar: true, repeatMode: 'one' })
    rememberTracks([track({ providerId: 'generated' })])

    await playNext()
    expect(currentId()).toBe(queue[0].id)
  })

  it('reaches autoplay only once the list is genuinely exhausted', async () => {
    const queue = queueOf(2)
    const generated = track({ providerId: 'generated', genre: 'Electronic' })
    seat(queue, 1)
    usePlayerStore.setState({ autoplaySimilar: true, repeatMode: 'off' })
    rememberTracks([generated])

    await playNext()
    expect(currentId()).toBe(generated.id)
  })

  it('stops rather than looping when nothing is left and autoplay is off', async () => {
    seat(queueOf(2), 1)
    await playNext()
    expect(usePlayerStore.getState().status).toBe('paused')
  })
})

describe('shuffle', () => {
  it('does not rearrange the queue itself', () => {
    const queue = queueOf(6)
    seat(queue, 0)
    usePlayerStore.getState().setShuffle(true)

    expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(queue.map((t) => t.id))
  })

  it('plays in the shuffled order, not the queue order', async () => {
    const queue = queueOf(6)
    seat(queue, 0)
    usePlayerStore.getState().setShuffle(true)

    const { shuffleOrder } = usePlayerStore.getState()
    await playNext()
    expect(currentId()).toBe(queue[shuffleOrder[1]].id)
  })

  it('keeps one stable running order for the session', async () => {
    const queue = queueOf(8)
    seat(queue, 0)
    usePlayerStore.getState().setShuffle(true)
    const order = [...usePlayerStore.getState().shuffleOrder]

    await playNext()
    await playNext()
    // Advancing must not redraw the order underneath the listener.
    expect(usePlayerStore.getState().shuffleOrder).toEqual(order)
    expect(currentId()).toBe(queue[order[2]].id)
  })

  it('is deterministic for a seed, so Next and Previous are predictable', async () => {
    const queue = queueOf(8)
    seat(queue, 0)
    usePlayerStore.setState({ shuffleSeed: 41 })
    usePlayerStore.getState().setShuffle(true)

    expect(usePlayerStore.getState().shuffleOrder).toEqual(shuffledOrder(8, 0, 42))

    await playNext()
    usePlayerStore.getState().setCurrentTime(0)
    await playPrevious()
    expect(currentId()).toBe(queue[0].id)
  })

  it('never jumps straight back to the track that is playing', () => {
    const queue = queueOf(10)
    seat(queue, 4)
    usePlayerStore.getState().setShuffle(true)

    const { shuffleOrder } = usePlayerStore.getState()
    expect(shuffleOrder[0]).toBe(4)
    expect(shuffleOrder[1]).not.toBe(4)
  })

  it('restores the original sequence when switched off', async () => {
    const queue = queueOf(6)
    seat(queue, 0)
    usePlayerStore.getState().setShuffle(true)
    usePlayerStore.getState().setShuffle(false)

    expect(usePlayerStore.getState().shuffleOrder).toEqual([])
    await playNext()
    expect(currentId()).toBe(queue[1].id)
  })

  it('draws a new order for a genuinely different list', () => {
    const first = queueOf(6)
    seat(first, 0)
    usePlayerStore.getState().setShuffle(true)
    const firstOrder = [...usePlayerStore.getState().shuffleOrder]

    const second = queueOf(6)
    seat(second, 0)
    const secondOrder = usePlayerStore.getState().shuffleOrder
    expect(secondOrder).toHaveLength(6)
    expect(secondOrder[0]).toBe(0)
    expect(firstOrder).toHaveLength(6)
  })

  it('keeps the running order when the same list is merely advanced', async () => {
    const queue = queueOf(6)
    seat(queue, 0)
    usePlayerStore.getState().setShuffle(true)
    const order = [...usePlayerStore.getState().shuffleOrder]

    await playNext()
    expect(usePlayerStore.getState().shuffleOrder).toEqual(order)
  })

  it('combines with repeat playlist to loop the shuffled order', async () => {
    const queue = queueOf(4)
    seat(queue, 0)
    usePlayerStore.setState({ repeatMode: 'all' })
    usePlayerStore.getState().setShuffle(true)
    const order = [...usePlayerStore.getState().shuffleOrder]

    for (let step = 0; step < 3; step += 1) await playNext()
    expect(currentId()).toBe(queue[order[3]].id)

    await playNext()
    expect(currentId()).toBe(queue[order[0]].id)
  })
})

describe('what persists', () => {
  it('remembers repeat, because it is a preference like volume', () => {
    usePlayerStore.getState().setRepeatMode('all')
    expect(localStorage.getItem(REPEAT_STORAGE_KEY)).toBe('all')
  })

  it('does not persist shuffle, because its running order is session-only', () => {
    usePlayerStore.getState().setShuffle(true)
    expect(localStorage.getItem('pulse:shuffle')).toBeNull()
  })

  it('survives a player reset, which must not silently change a preference', () => {
    usePlayerStore.getState().setRepeatMode('one')
    usePlayerStore.getState().reset()
    expect(usePlayerStore.getState().repeatMode).toBe('one')
  })
})
