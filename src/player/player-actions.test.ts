import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MusicError } from '@/music/types'
import type { Track } from '@/music/types'
import type { MusicProvider } from '@/music/provider'
import { resetMusicProvider, setMusicProvider } from '@/music/provider'
import { setAudioEngine } from './audio-engine'
import { createFakeAudioEngine } from './fake-audio-engine'
import type { FakeAudioEngine } from './fake-audio-engine'
import {
  MAX_MEDIA_RETRIES,
  PREVIOUS_RESTART_THRESHOLD_SECONDS,
  addToQueue,
  handleMediaError,
  handleTrackEnded,
  pause,
  playNext,
  playPrevious,
  playQueueIndex,
  playTrack,
  resetMediaRetries,
  seek,
  setVolume,
  toggleMute,
  togglePlay,
} from './player-actions'
import { initialPlayerState, usePlayerStore } from './player-store'

const makeTrack = (id: string, overrides: Partial<Track> = {}): Track => ({
  id: `audius:${id}`,
  mediaKind: 'audio',
  provider: 'audius',
  providerId: id,
  title: `Track ${id}`,
  artistName: `Artist ${id}`,
  artwork: {},
  durationSeconds: 200,
  isStreamable: true,
  ...overrides,
})

let engine: FakeAudioEngine
let provider: MusicProvider
let streamDelays: Record<string, number>

function makeProvider(): MusicProvider {
  return {
    id: 'fake',
    searchTracks: vi.fn(() => Promise.resolve([])),
    searchCatalog: vi.fn(() => Promise.resolve({ tracks: [], artists: [] })),
    getArtistTracks: vi.fn(() => Promise.resolve([])),
    getTrendingTracks: vi.fn(() => Promise.resolve([])),
    getUndergroundTrendingTracks: vi.fn(() => Promise.resolve([])),
    getTopArtists: vi.fn(() => Promise.resolve([])),
    getTrack: vi.fn(() => Promise.resolve(null)),
    reportStreamFailure: vi.fn(),
    getStreamSource: vi.fn(async (track: Track) => {
      const delay = streamDelays[track.providerId] ?? 0
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      if (!track.isStreamable) {
        throw new MusicError('NOT_STREAMABLE', "This track isn't available to stream.")
      }
      return `https://cdn.audius.test/${track.providerId}.mp3`
    }),
  }
}

beforeEach(() => {
  usePlayerStore.setState({ ...initialPlayerState, volume: 0.8, muted: false })
  engine = createFakeAudioEngine()
  setAudioEngine(engine)
  streamDelays = {}
  provider = makeProvider()
  setMusicProvider(provider)
  resetMediaRetries()
})

describe('playTrack', () => {
  it('sets the current track, resolves a real stream and starts playing', async () => {
    const track = makeTrack('a')
    await playTrack(track)

    const state = usePlayerStore.getState()
    expect(state.currentTrack).toEqual(track)
    expect(state.status).toBe('playing')
    expect(engine.src).toBe('https://cdn.audius.test/a.mp3')
    expect(engine.playing).toBe(true)
  })

  it('uses the supplied list as the queue and the clicked track as the index', async () => {
    const queue = [makeTrack('a'), makeTrack('b'), makeTrack('c')]
    await playTrack(queue[1], { queue, index: 1, context: { id: 'search:x', label: 'x' } })

    const state = usePlayerStore.getState()
    expect(state.queue).toHaveLength(3)
    expect(state.currentIndex).toBe(1)
    expect(state.queueContext).toEqual({ id: 'search:x', label: 'x' })
  })

  it('recovers when the supplied index does not match the track', async () => {
    const queue = [makeTrack('a'), makeTrack('b')]
    await playTrack(queue[1], { queue, index: 0 })
    expect(usePlayerStore.getState().currentIndex).toBe(1)
  })

  it('prepends a track that is not in the supplied queue', async () => {
    const queue = [makeTrack('a')]
    const orphan = makeTrack('z')
    await playTrack(orphan, { queue, index: 5 })
    const state = usePlayerStore.getState()
    expect(state.currentIndex).toBe(0)
    expect(state.queue.map((t) => t.providerId)).toEqual(['z', 'a'])
  })

  it('resets progress and clears a previous error on track change', async () => {
    usePlayerStore.setState({ currentTime: 90, error: 'old failure' })
    await playTrack(makeTrack('a'))
    expect(usePlayerStore.getState().currentTime).toBe(0)
    expect(usePlayerStore.getState().error).toBeNull()
  })

  it('shows metadata immediately, before any audio bytes arrive', async () => {
    streamDelays.slow = 30
    const track = makeTrack('slow', { durationSeconds: 321 })
    const pending = playTrack(track)
    expect(usePlayerStore.getState().currentTrack?.title).toBe('Track slow')
    expect(usePlayerStore.getState().duration).toBe(321)
    expect(usePlayerStore.getState().status).toBe('loading')
    await pending
  })

  it('refuses a non-streamable track without loading audio', async () => {
    await playTrack(makeTrack('gated', { isStreamable: false }))
    const state = usePlayerStore.getState()
    expect(state.status).toBe('error')
    expect(state.error).toBe("This track isn't available to stream.")
    expect(engine.src).toBeNull()
    expect(provider.getStreamSource).not.toHaveBeenCalled()
  })

  it('leaves loading state when stream resolution fails', async () => {
    vi.mocked(provider.getStreamSource).mockRejectedValueOnce(
      new MusicError('NETWORK', 'Could not reach the music service.'),
    )
    await playTrack(makeTrack('a'))
    const state = usePlayerStore.getState()
    expect(state.status).toBe('error')
    expect(state.error).toBe('Could not reach the music service.')
  })

  it('treats a blocked autoplay promise as paused, not as an error', async () => {
    engine.failNextPlayWith('NotAllowedError')
    await playTrack(makeTrack('a'))
    expect(usePlayerStore.getState().status).toBe('paused')
    expect(usePlayerStore.getState().error).toBeNull()
  })

  it('treats an interrupted play() as paused, not as an error', async () => {
    engine.failNextPlayWith('AbortError')
    await playTrack(makeTrack('a'))
    expect(usePlayerStore.getState().status).toBe('paused')
    expect(usePlayerStore.getState().error).toBeNull()
  })

  it('surfaces any other play() rejection as an error', async () => {
    engine.failNextPlayWith('SomethingElseError')
    await playTrack(makeTrack('a'))
    expect(usePlayerStore.getState().status).toBe('error')
  })

  describe('race safety', () => {
    it('discards a slow stream that resolves after a newer track was chosen', async () => {
      streamDelays.slow = 40
      const slow = playTrack(makeTrack('slow'))
      await new Promise((resolve) => setTimeout(resolve, 5))
      await playTrack(makeTrack('fast'))
      await slow

      const state = usePlayerStore.getState()
      expect(state.currentTrack?.providerId).toBe('fast')
      expect(engine.src).toBe('https://cdn.audius.test/fast.mp3')
      expect(state.status).toBe('playing')
    })

    it('does not let a stale failure overwrite the newer track state', async () => {
      streamDelays.slow = 40
      vi.mocked(provider.getStreamSource).mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40))
        throw new MusicError('PROVIDER', 'stale failure')
      })
      const slow = playTrack(makeTrack('slow'))
      await new Promise((resolve) => setTimeout(resolve, 5))
      await playTrack(makeTrack('fast'))
      await slow

      expect(usePlayerStore.getState().status).toBe('playing')
      expect(usePlayerStore.getState().error).toBeNull()
    })

    it('only ever loads one source per completed request', async () => {
      await playTrack(makeTrack('a'))
      expect(engine.loadCount).toBe(1)
    })
  })
})

describe('togglePlay / pause', () => {
  it('pauses a playing track and resumes it', async () => {
    await playTrack(makeTrack('a'))
    await togglePlay()
    expect(usePlayerStore.getState().status).toBe('paused')
    expect(engine.playing).toBe(false)

    await togglePlay()
    expect(usePlayerStore.getState().status).toBe('playing')
    expect(engine.playing).toBe(true)
  })

  it('does nothing without a current track', async () => {
    await togglePlay()
    expect(usePlayerStore.getState().status).toBe('idle')
    pause()
    expect(usePlayerStore.getState().status).toBe('idle')
  })

  it('re-resolves the stream when recovering from an error', async () => {
    vi.mocked(provider.getStreamSource).mockRejectedValueOnce(new MusicError('NETWORK', 'nope'))
    await playTrack(makeTrack('a'))
    expect(usePlayerStore.getState().status).toBe('error')

    await togglePlay()
    expect(usePlayerStore.getState().status).toBe('playing')
    expect(provider.getStreamSource).toHaveBeenCalledTimes(2)
  })
})

describe('queue navigation', () => {
  const queue = () => [makeTrack('a'), makeTrack('b'), makeTrack('c')]

  it('next advances through the queue', async () => {
    const list = queue()
    await playTrack(list[0], { queue: list, index: 0 })
    await playNext()
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('b')
    expect(usePlayerStore.getState().currentIndex).toBe(1)
  })

  it('next at the end stops instead of looping or crashing', async () => {
    const list = queue()
    await playTrack(list[2], { queue: list, index: 2 })
    await playNext()
    const state = usePlayerStore.getState()
    expect(state.currentTrack?.providerId).toBe('c')
    expect(state.status).toBe('paused')
    expect(state.currentTime).toBe(0)
  })

  it('previous steps back when barely into the track', async () => {
    const list = queue()
    await playTrack(list[1], { queue: list, index: 1 })
    usePlayerStore.getState().setCurrentTime(1)
    await playPrevious()
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('a')
  })

  it('previous restarts the track when past the threshold', async () => {
    const list = queue()
    await playTrack(list[1], { queue: list, index: 1 })
    engine.emitDuration(200)
    usePlayerStore.getState().setDuration(200)
    usePlayerStore.getState().setCurrentTime(PREVIOUS_RESTART_THRESHOLD_SECONDS + 1)
    await playPrevious()
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('b')
    expect(usePlayerStore.getState().currentTime).toBe(0)
  })

  it('previous on the first track restarts it', async () => {
    const list = queue()
    await playTrack(list[0], { queue: list, index: 0 })
    engine.emitDuration(200)
    usePlayerStore.getState().setDuration(200)
    usePlayerStore.getState().setCurrentTime(1)
    await playPrevious()
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('a')
    expect(usePlayerStore.getState().currentTime).toBe(0)
  })

  it('ended advances to the next track', async () => {
    const list = queue()
    await playTrack(list[0], { queue: list, index: 0 })
    await handleTrackEnded()
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('b')
  })

  it('ended on the last track does not loop', async () => {
    const list = queue()
    await playTrack(list[2], { queue: list, index: 2 })
    await handleTrackEnded()
    expect(usePlayerStore.getState().status).toBe('paused')
    expect(usePlayerStore.getState().currentIndex).toBe(2)
  })

  it('playQueueIndex jumps to an arbitrary queue position', async () => {
    const list = queue()
    await playTrack(list[0], { queue: list, index: 0 })
    await playQueueIndex(2)
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('c')
  })

  it('playQueueIndex ignores an out-of-range index', async () => {
    const list = queue()
    await playTrack(list[0], { queue: list, index: 0 })
    await playQueueIndex(99)
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('a')
  })

  it('addToQueue inserts after the current track and refuses duplicates', async () => {
    const list = queue()
    await playTrack(list[0], { queue: list, index: 0 })
    addToQueue(makeTrack('x'))
    expect(usePlayerStore.getState().queue.map((t) => t.providerId)).toEqual(['a', 'x', 'b', 'c'])
    addToQueue(makeTrack('x'))
    expect(usePlayerStore.getState().queue).toHaveLength(4)
  })
})

describe('seek', () => {
  it('clamps into 0..duration and moves the engine', async () => {
    await playTrack(makeTrack('a'))
    // The store learns the real duration from the engine's durationchange event,
    // which PlayerEngineHost forwards in the app; mirror both here.
    engine.emitDuration(120)
    usePlayerStore.getState().setDuration(120)

    seek(60)
    expect(usePlayerStore.getState().currentTime).toBe(60)
    expect(engine.getCurrentTime()).toBe(60)

    seek(-10)
    expect(usePlayerStore.getState().currentTime).toBe(0)

    seek(9999)
    expect(usePlayerStore.getState().currentTime).toBe(120)
  })

  it('is ignored before a valid duration exists', async () => {
    await playTrack(makeTrack('a', { durationSeconds: 0 }))
    usePlayerStore.getState().setDuration(0)
    seek(30)
    expect(usePlayerStore.getState().currentTime).toBe(0)
  })

  it('ignores a non-finite target', async () => {
    await playTrack(makeTrack('a'))
    engine.emitDuration(120)
    usePlayerStore.getState().setDuration(120)
    seek(30)
    seek(Number.NaN)
    expect(usePlayerStore.getState().currentTime).toBe(30)
  })
})

describe('volume and mute', () => {
  it('clamps volume and pushes it to the engine', () => {
    setVolume(0.5)
    expect(usePlayerStore.getState().volume).toBe(0.5)
    expect(engine.volume).toBe(0.5)

    setVolume(4)
    expect(usePlayerStore.getState().volume).toBe(1)

    setVolume(-1)
    expect(usePlayerStore.getState().volume).toBe(0)
  })

  it('persists volume and mute to localStorage', () => {
    setVolume(0.42)
    expect(localStorage.getItem('pulse:volume')).toBe('0.42')
    toggleMute()
    expect(localStorage.getItem('pulse:muted')).toBe('true')
  })

  it('mute keeps the stored volume so unmuting restores it', () => {
    setVolume(0.42)
    toggleMute()
    expect(usePlayerStore.getState().muted).toBe(true)
    expect(usePlayerStore.getState().volume).toBe(0.42)
    expect(engine.muted).toBe(true)

    toggleMute()
    expect(usePlayerStore.getState().muted).toBe(false)
    expect(engine.volume).toBe(0.42)
  })

  it('moving the slider off zero lifts mute', () => {
    toggleMute()
    setVolume(0.3)
    expect(usePlayerStore.getState().muted).toBe(false)
  })
})

describe('handleMediaError', () => {
  it('retries the track once, asking the provider for a fresh content node', async () => {
    await playTrack(makeTrack('a'))
    expect(provider.getStreamSource).toHaveBeenCalledTimes(1)

    handleMediaError('The audio stream was interrupted by a network problem.')
    await vi.waitFor(() => expect(usePlayerStore.getState().status).toBe('playing'))
    expect(provider.getStreamSource).toHaveBeenCalledTimes(2)
    expect(usePlayerStore.getState().error).toBeNull()
  })

  it('leaves loading state and records a safe message once the retries are spent', async () => {
    await playTrack(makeTrack('a'))
    for (let attempt = 0; attempt < MAX_MEDIA_RETRIES; attempt += 1) {
      handleMediaError('transient node failure')
      await vi.waitFor(() =>
        expect(provider.getStreamSource).toHaveBeenCalledTimes(attempt + 2),
      )
    }

    usePlayerStore.getState().setStatus('loading')
    handleMediaError('The audio stream was interrupted by a network problem.')

    const state = usePlayerStore.getState()
    expect(state.status).toBe('error')
    expect(state.error).toBe('The audio stream was interrupted by a network problem.')
    expect(state.currentTrack).not.toBeNull()
    expect(provider.getStreamSource).toHaveBeenCalledTimes(MAX_MEDIA_RETRIES + 1)
  })

  it('gives a newly selected track a fresh retry budget', async () => {
    await playTrack(makeTrack('a'))
    for (let attempt = 0; attempt < MAX_MEDIA_RETRIES; attempt += 1) {
      handleMediaError('boom')
      await vi.waitFor(() =>
        expect(provider.getStreamSource).toHaveBeenCalledTimes(attempt + 2),
      )
    }
    handleMediaError('boom again')
    expect(usePlayerStore.getState().status).toBe('error')

    await playTrack(makeTrack('b'))
    handleMediaError('boom')
    await vi.waitFor(() => expect(usePlayerStore.getState().status).toBe('playing'))
    expect(usePlayerStore.getState().currentTrack?.providerId).toBe('b')
  })

  it('ignores an error with no current track', () => {
    handleMediaError('boom')
    expect(usePlayerStore.getState().status).toBe('idle')
  })
})

afterEach(() => {
  resetMusicProvider()
})
