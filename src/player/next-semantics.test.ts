import { beforeEach, describe, expect, it } from 'vitest'
import { createAudiusProvider } from '@/music/audius/adapter'
import { setMusicProvider } from '@/music/provider'
import type { Track } from '@/music/types'
import { resetPersonalizationForTests } from '@/personalization'
import { useUiStore } from '@/app/ui-store'
import { setAudioEngine } from './audio-engine'
import { clearAutoplayBuffer, clearSessionPool, rememberTracks } from './autoplay'
import { createFakeAudioEngine } from './fake-audio-engine'
import type { FakeAudioEngine } from './fake-audio-engine'
import { resetPlaybackCoordinator } from './playback-coordinator'
import { handleTrackEnded, resetMediaRetries, skipToNext } from './player-actions'
import { selectCanSkipNext } from './player-selectors'
import { initialPlayerState, usePlayerStore } from './player-store'

/**
 * Pressing Next, versus a track running out.
 *
 * These were the same code path, and the reported symptoms were the direct
 * consequence: Next sat **disabled** on a one-track search seed even though
 * autoplay could answer it, and enabling Repeat to wake the button up then made
 * it replay the very song the visitor was trying to leave.
 *
 * The two intentions are different and are now answered differently, so this
 * file pins both halves — including the cases where they must still agree.
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

/** No genre-scoped fallback, for the cases that must genuinely run out. */
function withNoGenreCandidates() {
  setMusicProvider({ ...createAudiusProvider(), getTrendingTracks: () => Promise.resolve([]) })
}

function seat(current: Track, queue: Track[] = [current]) {
  const state = usePlayerStore.getState()
  state.setQueue(
    queue,
    queue.findIndex((item) => item.id === current.id),
    null,
  )
  state.setStatus('playing')
}

const currentId = () => usePlayerStore.getState().currentTrack?.providerId

beforeEach(() => {
  counter = 0
  setMusicProvider(createAudiusProvider())
  engine = createFakeAudioEngine()
  setAudioEngine(engine)
  usePlayerStore.setState({ ...initialPlayerState, autoplaySimilar: true })
  useUiStore.setState({ notice: null, noticeAction: null })
  resetMediaRetries()
  resetPlaybackCoordinator()
  resetPersonalizationForTests()
  clearSessionPool()
  clearAutoplayBuffer()
})

describe('the Next button is enabled when Next can do something', () => {
  it('is enabled for a one-track search seed with autoplay on', () => {
    // The exact reported state: play one search result, nothing queued behind
    // it, no repeat. `nextQueueIndex` is null here — which is precisely why the
    // old selector said no.
    seat(track({ providerId: 'kosandra' }))
    expect(usePlayerStore.getState().repeatMode).toBe('off')
    expect(usePlayerStore.getState().autoplaySimilar).toBe(true)
    expect(usePlayerStore.getState().queue).toHaveLength(1)

    expect(usePlayerStore.getState().currentTrack).not.toBeNull()
    expect(selectCanSkipNext(usePlayerStore.getState())).toBe(true)
  })

  it('does not need Repeat switched on to become enabled', () => {
    seat(track({ providerId: 'kosandra' }))
    const withRepeatOff = selectCanSkipNext(usePlayerStore.getState())
    usePlayerStore.getState().cycleRepeatMode()
    expect(withRepeatOff).toBe(true)
  })

  it('is disabled when autoplay is off and the queue is exhausted', () => {
    usePlayerStore.setState({ autoplaySimilar: false })
    seat(track({ providerId: 'alone' }))
    expect(selectCanSkipNext(usePlayerStore.getState())).toBe(false)
  })

  it('is not enabled by Repeat one alone, because Next refuses to replay', () => {
    // Repeat one can always replay the current track, but `skipToNext` will not
    // — so counting it would light the button up for something that then does
    // nothing.
    usePlayerStore.setState({ autoplaySimilar: false })
    seat(track({ providerId: 'alone' }))
    usePlayerStore.setState({ repeatMode: 'one' })
    expect(selectCanSkipNext(usePlayerStore.getState())).toBe(false)
  })

  it('is not enabled by a single-track Repeat all, which wraps onto itself', () => {
    usePlayerStore.setState({ autoplaySimilar: false })
    seat(track({ providerId: 'alone' }))
    usePlayerStore.setState({ repeatMode: 'all' })
    expect(selectCanSkipNext(usePlayerStore.getState())).toBe(false)
  })

  it('is enabled by a real queued track even with autoplay off', () => {
    usePlayerStore.setState({ autoplaySimilar: false })
    const a = track({ providerId: 'a' })
    const b = track({ providerId: 'b' })
    seat(a, [a, b])
    expect(selectCanSkipNext(usePlayerStore.getState())).toBe(true)
  })

  it('is enabled by a multi-track Repeat all wrap, which lands somewhere else', () => {
    usePlayerStore.setState({ autoplaySimilar: false })
    const a = track({ providerId: 'a' })
    const b = track({ providerId: 'b' })
    seat(b, [a, b])
    usePlayerStore.setState({ repeatMode: 'all' })
    expect(selectCanSkipNext(usePlayerStore.getState())).toBe(true)
  })
})

describe('a press of Next means leave this song', () => {
  it('escapes Repeat one and takes an autoplay candidate instead', async () => {
    const a = track({ providerId: 'a' })
    rememberTracks([track({ providerId: 'b' })])
    seat(a)
    usePlayerStore.setState({ repeatMode: 'one' })

    await skipToNext()

    expect(currentId()).toBe('b')
  })

  it('does not wrap a single-track Repeat all onto itself', async () => {
    const a = track({ providerId: 'a' })
    rememberTracks([track({ providerId: 'b' })])
    seat(a)
    usePlayerStore.setState({ repeatMode: 'all' })

    await skipToNext()

    expect(currentId()).toBe('b')
  })

  it('still wraps a multi-track Repeat all, because that is a different track', async () => {
    const a = track({ providerId: 'a' })
    const b = track({ providerId: 'b' })
    const c = track({ providerId: 'c' })
    seat(c, [a, b, c])
    usePlayerStore.setState({ repeatMode: 'all' })

    await skipToNext()

    expect(currentId()).toBe('a')
  })

  it('takes a genuinely queued track before anything generated', async () => {
    const a = track({ providerId: 'a' })
    const b = track({ providerId: 'b' })
    rememberTracks([track({ providerId: 'generated' })])
    seat(a, [a, b])

    await skipToNext()

    // User intent wins, and nothing generated was consulted.
    expect(currentId()).toBe('b')
    expect(usePlayerStore.getState().queue).toHaveLength(2)
  })

  it('says so, once, when there is genuinely nowhere to go', async () => {
    withNoGenreCandidates()
    seat(track({ providerId: 'alone' }))

    await skipToNext()

    expect(usePlayerStore.getState().status).toBe('paused')
    expect(usePlayerStore.getState().currentTime).toBe(0)
    expect(useUiStore.getState().notice).toBe('No similar track available right now.')
  })

  it('never silently replays the current song', async () => {
    withNoGenreCandidates()
    seat(track({ providerId: 'alone' }))
    usePlayerStore.setState({ repeatMode: 'one' })

    await skipToNext()

    expect(currentId()).toBe('alone')
    expect(usePlayerStore.getState().status).toBe('paused')
    expect(engine.playing).toBe(false)
  })
})

describe('a track running out is not a press of Next', () => {
  it('honours Repeat one, which is the whole point of Repeat one', async () => {
    const a = track({ providerId: 'a' })
    rememberTracks([track({ providerId: 'b' })])
    seat(a)
    usePlayerStore.setState({ repeatMode: 'one' })

    await handleTrackEnded()

    expect(currentId()).toBe('a')
    expect(engine.playing).toBe(true)
  })

  it('wraps a single-track Repeat all onto itself, which is what was asked for', async () => {
    const a = track({ providerId: 'a' })
    rememberTracks([track({ providerId: 'b' })])
    seat(a)
    usePlayerStore.setState({ repeatMode: 'all' })

    await handleTrackEnded()

    expect(currentId()).toBe('a')
  })

  it('reaches autoplay from a one-track seed with repeat off', async () => {
    const a = track({ providerId: 'kosandra' })
    rememberTracks([track({ providerId: 'similar' })])
    seat(a)

    await handleTrackEnded()

    expect(currentId()).toBe('similar')
    expect(engine.playing).toBe(true)
  })

  it('stays quiet when it runs out — no toast on an ordinary ending', async () => {
    withNoGenreCandidates()
    seat(track({ providerId: 'alone' }))

    await handleTrackEnded()

    expect(usePlayerStore.getState().status).toBe('paused')
    expect(useUiStore.getState().notice).toBeNull()
  })
})
