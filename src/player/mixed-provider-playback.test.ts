import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MusicProvider } from '@/music/provider'
import { resetMusicProvider, setMusicProvider } from '@/music/provider'
import { MusicError } from '@/music/types'
import type { Track } from '@/music/types'
import { setAudioEngine } from './audio-engine'
import { createFakeAudioEngine } from './fake-audio-engine'
import type { FakeAudioEngine } from './fake-audio-engine'
import { handleMediaError, handleTrackEnded, playNext, playPrevious, playTrack, resetMediaRetries, seek, setVolume, toggleMute, togglePlay } from './player-actions'
import { initialPlayerState, usePlayerStore } from './player-store'

/**
 * A queue that mixes providers must play through the *one* global audio engine,
 * swapping only its source (agents/07_PLAYER_BEHAVIOR.md → "Single Audio
 * Engine"; agents/19 → "Player"). There is no Jamendo player and no second
 * `<audio>`: these tests assert every transition against a single fake engine.
 */

const AUDIUS_STREAM = 'https://cn1.audius.test/stream/a1.mp3'

function audius(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id: `audius:${id}`,
    mediaKind: 'audio',
    provider: 'audius',
    providerId: id,
    title: `Audius ${id}`,
    artistName: 'Nova Sound',
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    ...overrides,
  }
}

function jamendo(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id: `jamendo:${id}`,
    mediaKind: 'audio',
    provider: 'jamendo',
    providerId: id,
    title: `Jamendo ${id}`,
    artistName: 'Lumen Field',
    artwork: {},
    durationSeconds: 180,
    isStreamable: true,
    attributionRequired: true,
    sourceUrl: `https://www.jamendo.com/track/${id}`,
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
    streamUrl: `https://prod-1.storage.jamendo.com/?trackid=${id}&format=mp32`,
    ...overrides,
  }
}

let engine: FakeAudioEngine
let provider: MusicProvider

function makeProvider(): MusicProvider {
  return {
    id: 'audius',
    searchTracks: vi.fn(() => Promise.resolve([])),
    searchCatalog: vi.fn(() => Promise.resolve({ tracks: [], artists: [] })),
    getArtistTracks: vi.fn(() => Promise.resolve([])),
    getTrendingTracks: vi.fn(() => Promise.resolve([])),
    getUndergroundTrendingTracks: vi.fn(() => Promise.resolve([])),
    getTopArtists: vi.fn(() => Promise.resolve([])),
    getTrack: vi.fn(() => Promise.resolve(null)),
    reportStreamFailure: vi.fn(),
    getStreamSource: vi.fn(() => Promise.resolve(AUDIUS_STREAM)),
  }
}

beforeEach(() => {
  usePlayerStore.setState({ ...initialPlayerState, volume: 0.8, muted: false })
  engine = createFakeAudioEngine()
  setAudioEngine(engine)
  resetMediaRetries()
  provider = makeProvider()
  setMusicProvider(provider)
})

afterEach(() => {
  setAudioEngine(null)
  resetMusicProvider()
})

describe('one engine, two providers', () => {
  it('plays a Jamendo track from the URL the provider already handed us', async () => {
    await playTrack(jamendo('j1'))
    expect(engine.src).toBe('https://prod-1.storage.jamendo.com/?trackid=j1&format=mp32')
    expect(usePlayerStore.getState().status).toBe('playing')
    // No Audius round-trip happens for a Jamendo track.
    expect(provider.getStreamSource).not.toHaveBeenCalled()
  })

  it('still resolves an Audius stream lazily through the SDK', async () => {
    await playTrack(audius('a1'))
    expect(engine.src).toBe(AUDIUS_STREAM)
    expect(provider.getStreamSource).toHaveBeenCalledTimes(1)
  })

  it('moves Audius -> Jamendo on the same engine', async () => {
    const queue = [audius('a1'), jamendo('j1')]
    await playTrack(queue[0], { queue, index: 0 })
    expect(engine.src).toBe(AUDIUS_STREAM)

    await playNext()
    expect(usePlayerStore.getState().currentTrack?.id).toBe('jamendo:j1')
    expect(engine.src).toContain('storage.jamendo.com')
    expect(usePlayerStore.getState().status).toBe('playing')
  })

  it('moves Jamendo -> Audius on the same engine', async () => {
    const queue = [jamendo('j1'), audius('a1')]
    await playTrack(queue[0], { queue, index: 0 })
    expect(engine.src).toContain('storage.jamendo.com')

    await playNext()
    expect(usePlayerStore.getState().currentTrack?.id).toBe('audius:a1')
    expect(engine.src).toBe(AUDIUS_STREAM)
  })

  it('moves Jamendo -> Jamendo on the same engine', async () => {
    const queue = [jamendo('j1'), jamendo('j2')]
    await playTrack(queue[0], { queue, index: 0 })
    await playNext()
    expect(usePlayerStore.getState().currentTrack?.id).toBe('jamendo:j2')
    expect(engine.src).toContain('trackid=j2')
  })

  it('steps backwards across a provider boundary too', async () => {
    const queue = [audius('a1'), jamendo('j1')]
    await playTrack(queue[1], { queue, index: 1 })
    usePlayerStore.getState().setCurrentTime(0)

    await playPrevious()
    expect(usePlayerStore.getState().currentTrack?.id).toBe('audius:a1')
    expect(engine.src).toBe(AUDIUS_STREAM)
  })

  it('advances across providers when a track ends', async () => {
    const queue = [jamendo('j1'), audius('a1')]
    await playTrack(queue[0], { queue, index: 0 })
    await handleTrackEnded()
    expect(usePlayerStore.getState().currentTrack?.id).toBe('audius:a1')
  })

  it('keeps seek, volume and mute working on a Jamendo track', async () => {
    await playTrack(jamendo('j1'))
    engine.emitDuration(180)
    usePlayerStore.getState().setDuration(180)

    seek(60)
    expect(engine.getCurrentTime()).toBe(60)

    setVolume(0.25)
    expect(engine.volume).toBeCloseTo(0.25)

    toggleMute()
    expect(engine.muted).toBe(true)
    expect(usePlayerStore.getState().muted).toBe(true)
  })

  it('pauses and resumes a Jamendo track without re-resolving anything', async () => {
    await playTrack(jamendo('j1'))
    await togglePlay()
    expect(usePlayerStore.getState().status).toBe('paused')
    await togglePlay()
    expect(usePlayerStore.getState().status).toBe('playing')
    expect(engine.src).toContain('trackid=j1')
  })
})

describe('mixed-queue race safety', () => {
  it('lets the newest choice win when providers are switched rapidly', async () => {
    // The Audius leg is slow; the Jamendo leg is immediate. The listener's last
    // click must be what plays, whichever provider resolves first.
    let release: (() => void) | undefined
    provider.getStreamSource = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve(AUDIUS_STREAM)
        }),
    )

    const queue = [audius('a1'), jamendo('j1')]
    const slow = playTrack(queue[0], { queue, index: 0 })
    await playTrack(queue[1], { queue, index: 1 })
    release?.()
    await slow

    expect(usePlayerStore.getState().currentTrack?.id).toBe('jamendo:j1')
    expect(engine.src).toContain('storage.jamendo.com')
    expect(usePlayerStore.getState().status).toBe('playing')
  })

  it('does not let a superseded Jamendo load overwrite a newer Audius one', async () => {
    const queue = [jamendo('j1'), audius('a1')]
    const first = playTrack(queue[0], { queue, index: 0 })
    const second = playTrack(queue[1], { queue, index: 1 })
    await Promise.all([first, second])

    expect(usePlayerStore.getState().currentTrack?.id).toBe('audius:a1')
    expect(engine.src).toBe(AUDIUS_STREAM)
  })
})

describe('mixed-queue error handling', () => {
  it('refuses a Jamendo track that carries no stream URL', async () => {
    await playTrack(jamendo('j1', { isStreamable: false, streamUrl: undefined }))
    expect(usePlayerStore.getState().status).toBe('error')
    expect(usePlayerStore.getState().error).toContain("isn't available to stream")
  })

  it('reports a Jamendo track whose URL is not HTTPS rather than loading it', async () => {
    // `isStreamable` says yes but the URL is unusable: the router is the last
    // line of defence before the audio element sees it.
    await playTrack(jamendo('j1', { streamUrl: 'http://insecure.example/a.mp3' }))
    expect(usePlayerStore.getState().status).toBe('error')
    // Nothing was handed to the audio element at all.
    expect(engine.src).toBeNull()
  })

  it('never asks Audius to route around a failed Jamendo host', async () => {
    await playTrack(jamendo('j1'))
    handleMediaError('The audio stream was interrupted by a network problem.')
    // Jamendo serves one storage origin; re-requesting would return the same
    // URL, and telling the Audius provider about it would be meaningless.
    expect(provider.reportStreamFailure).not.toHaveBeenCalled()
  })

  it('still retries a failed Jamendo track once before giving up', async () => {
    await playTrack(jamendo('j1'))
    handleMediaError('boom')
    expect(usePlayerStore.getState().status).toBe('loading')
  })

  it('recovers a Jamendo track from the error state on the next play press', async () => {
    await playTrack(jamendo('j1', { isStreamable: false, streamUrl: undefined }))
    expect(usePlayerStore.getState().status).toBe('error')

    const healthy = jamendo('j1')
    await playTrack(healthy)
    expect(usePlayerStore.getState().status).toBe('playing')
    expect(engine.src).toContain('trackid=j1')
  })

  it('surfaces an Audius failure without disturbing a Jamendo track already queued', async () => {
    provider.getStreamSource = vi.fn(() =>
      Promise.reject(new MusicError('NOT_STREAMABLE', "This track isn't available to stream.")),
    )
    const queue = [audius('a1'), jamendo('j1')]
    await playTrack(queue[0], { queue, index: 0 })
    expect(usePlayerStore.getState().status).toBe('error')

    await playNext()
    expect(usePlayerStore.getState().status).toBe('playing')
    expect(usePlayerStore.getState().currentTrack?.id).toBe('jamendo:j1')
  })
})
