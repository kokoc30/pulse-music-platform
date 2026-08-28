import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setMusicProvider, resetMusicProvider } from '@/music/provider'
import type { MusicProvider } from '@/music/provider'
import { normalizeYouTubeVideo } from '@/music/youtube'
import type { Track } from '@/music/types'
import { youtubePayload } from '@/test/fixtures/youtube'
import { setAudioEngine } from './audio-engine'
import { createFakeAudioEngine } from './fake-audio-engine'
import type { FakeAudioEngine } from './fake-audio-engine'
import { activeEngine, resetPlaybackCoordinator } from './playback-coordinator'
import { playTrack, togglePlay } from './player-actions'
import { initialPlayerState, usePlayerStore } from './player-store'
import { createFakeYouTubeFactory } from './youtube/fake-adapter'
import type { FakeYouTubeFactory } from './youtube/fake-adapter'
import { closeYouTubeSurface, playYouTubeVideo, toggleYouTubePlayback } from './youtube-actions'
import { createYouTubeIframeEngine, setYouTubeEngine } from './youtube-engine'
import { initialYouTubeState, useYouTubeStore } from './youtube-store'

/**
 * Every provider transition, in both directions.
 *
 * The single invariant under test is the one agents/24 states outright: exactly
 * one engine is active at a time. Two engines playing together would mean an
 * Audius track over a YouTube video — and, for policy, YouTube audio continuing
 * while the visitor's attention is elsewhere.
 *
 * The second invariant is structural: a YouTube item can never reach the
 * `HTMLAudioElement`, and an audio track can never reach the iframe engine.
 */

const AUDIUS_STREAM = 'https://cn1.audius.test/stream/a1.mp3'
const JAMENDO_STREAM = 'https://prod-1.storage.jamendo.com/?trackid=j1'

function audius(id: string): Track {
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
  }
}

function jamendo(id: string): Track {
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
    streamUrl: JAMENDO_STREAM,
    sourceUrl: 'https://www.jamendo.com/track/j1',
    attributionRequired: true,
  }
}

const video = (overrides = {}) => normalizeYouTubeVideo(youtubePayload(overrides))

let audio: FakeAudioEngine
let factory: FakeYouTubeFactory
let container: HTMLDivElement

const provider: MusicProvider = {
  id: 'fake-audius',
  searchTracks: () => Promise.resolve([]),
  searchCatalog: () => Promise.resolve({ tracks: [], artists: [] }),
  getArtistTracks: () => Promise.resolve([]),
  getTrendingTracks: () => Promise.resolve([]),
  getUndergroundTrendingTracks: () => Promise.resolve([]),
  getTopArtists: () => Promise.resolve([]),
  getTrack: () => Promise.resolve(null),
  getStreamSource: () => Promise.resolve(AUDIUS_STREAM),
}

beforeEach(() => {
  audio = createFakeAudioEngine()
  setAudioEngine(audio)
  setMusicProvider(provider)

  factory = createFakeYouTubeFactory()
  container = document.createElement('div')
  document.body.appendChild(container)
  const engine = createYouTubeIframeEngine({ factory, origin: 'https://pulse.test' })
  engine.attach(container)
  setYouTubeEngine(engine)

  usePlayerStore.setState(initialPlayerState)
  useYouTubeStore.setState(initialYouTubeState)
  resetPlaybackCoordinator()
})

afterEach(() => {
  setAudioEngine(null)
  setYouTubeEngine(null)
  resetMusicProvider()
  container.remove()
})

describe('Audius -> YouTube', () => {
  it('pauses the audio element and starts the embedded player', async () => {
    await playTrack(audius('a1'))
    expect(audio.playing).toBe(true)

    await playYouTubeVideo(video(), { userInitiated: true })

    expect(audio.playing).toBe(false)
    expect(factory.current()?.playing).toBe(true)
    expect(activeEngine()).toBe('youtube')
  })

  it('keeps the audio track and its queue loaded so it can be resumed', async () => {
    await playTrack(audius('a1'), { queue: [audius('a1'), audius('a2')], index: 0 })
    await playYouTubeVideo(video(), { userInitiated: true })

    // Paused, not unloaded: the source is still there.
    expect(audio.src).toBe(AUDIUS_STREAM)
    expect(usePlayerStore.getState().currentTrack?.id).toBe('audius:a1')
    expect(usePlayerStore.getState().queue).toHaveLength(2)
  })
})

describe('Jamendo -> YouTube', () => {
  it('pauses the Jamendo stream and starts the embedded player', async () => {
    await playTrack(jamendo('j1'))
    expect(audio.src).toBe(JAMENDO_STREAM)
    expect(audio.playing).toBe(true)

    await playYouTubeVideo(video(), { userInitiated: true })

    expect(audio.playing).toBe(false)
    expect(factory.current()?.playing).toBe(true)
    expect(activeEngine()).toBe('youtube')
  })
})

describe('YouTube -> Audius', () => {
  it('pauses the embedded player and starts the audio element', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    expect(factory.current()?.playing).toBe(true)

    await playTrack(audius('a1'))

    expect(factory.current()?.playing).toBe(false)
    expect(audio.playing).toBe(true)
    expect(audio.src).toBe(AUDIUS_STREAM)
    expect(activeEngine()).toBe('audio')
  })

  it('leaves the YouTube surface open and visible, merely paused', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    await playTrack(audius('a1'))
    // A paused embedded player that is still on screen is exactly what the
    // policy allows; hiding it while it played would not be.
    expect(useYouTubeStore.getState().surfaceOpen).toBe(true)
    expect(useYouTubeStore.getState().item?.videoId).toBe('aaaaaaaaaaa')
  })
})

describe('YouTube -> Jamendo', () => {
  it('pauses the embedded player and starts the Jamendo stream', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    await playTrack(jamendo('j1'))

    expect(factory.current()?.playing).toBe(false)
    expect(audio.playing).toBe(true)
    expect(audio.src).toBe(JAMENDO_STREAM)
    expect(activeEngine()).toBe('audio')
  })
})

describe('YouTube -> YouTube', () => {
  it('reuses the single player instance', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    await playYouTubeVideo(video({ videoId: 'bbbbbbbbbbb', title: 'PreGomesh' }), {
      userInitiated: true,
    })

    expect(factory.created).toBe(1)
    expect(factory.current()?.videoId).toBe('bbbbbbbbbbb')
    expect(useYouTubeStore.getState().item?.videoId).toBe('bbbbbbbbbbb')
    expect(audio.playing).toBe(false)
  })
})

describe('exactly one engine is ever active', () => {
  it('never has both engines playing, through a long alternating sequence', async () => {
    const assertOne = () => {
      const both = audio.playing && Boolean(factory.current()?.playing)
      expect(both).toBe(false)
    }

    await playTrack(audius('a1'))
    assertOne()
    await playYouTubeVideo(video(), { userInitiated: true })
    assertOne()
    await playTrack(jamendo('j1'))
    assertOne()
    await playYouTubeVideo(video({ videoId: 'bbbbbbbbbbb' }), { userInitiated: true })
    assertOne()
    await playTrack(audius('a2'))
    assertOne()
    await playYouTubeVideo(video({ videoId: 'ccccccccccc', madeForKids: false }), {
      userInitiated: true,
    })
    assertOne()
  })

  it('pauses YouTube when the bottom bar resumes audio', async () => {
    await playTrack(audius('a1'))
    usePlayerStore.getState().setStatus('paused')
    await playYouTubeVideo(video(), { userInitiated: true })
    expect(factory.current()?.playing).toBe(true)

    await togglePlay()

    expect(factory.current()?.playing).toBe(false)
    expect(audio.playing).toBe(true)
  })

  it('pauses audio when the YouTube surface resumes', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    toggleYouTubePlayback()
    expect(factory.current()?.playing).toBe(false)

    await playTrack(audius('a1'))
    expect(audio.playing).toBe(true)

    toggleYouTubePlayback()
    expect(audio.playing).toBe(false)
    expect(factory.current()?.playing).toBe(true)
  })
})

describe('the two engines are hermetically separated', () => {
  it('never loads a YouTube URL into the audio element', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    await playTrack(audius('a1'))
    await playYouTubeVideo(video({ videoId: 'bbbbbbbbbbb' }), { userInitiated: true })

    expect(audio.src).toBe(AUDIUS_STREAM)
    expect(audio.src).not.toMatch(/youtube|ytimg|googlevideo/i)
  })

  it('rejects an audio track handed to the YouTube path, at runtime', async () => {
    // TypeScript already forbids this; the runtime guard covers data that
    // crossed a wire (agents/28 → "Audio providers never enter YouTube engine").
    const asAny = audius('a1') as unknown as Parameters<typeof playYouTubeVideo>[0]
    await expect(playYouTubeVideo(asAny, { userInitiated: true })).resolves.toBe(false)
    expect(factory.created).toBe(0)
  })

  it('rejects a YouTube item handed to the audio path, at runtime', async () => {
    const asAny = video() as unknown as Track
    await expect(playTrack(asAny)).rejects.toMatchObject({ code: 'NOT_STREAMABLE' })
    expect(audio.src).toBeNull()
  })
})

describe('closing the surface', () => {
  it('stops YouTube playback outright and releases the engine', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    expect(factory.current()?.playing).toBe(true)

    closeYouTubeSurface()

    expect(factory.current()?.playing).toBe(false)
    expect(useYouTubeStore.getState().surfaceOpen).toBe(false)
    expect(useYouTubeStore.getState().item).toBeNull()
    expect(activeEngine()).toBe('none')
  })

  it('leaves the audio player untouched and ready', async () => {
    await playTrack(audius('a1'))
    await playYouTubeVideo(video(), { userInitiated: true })
    closeYouTubeSurface()

    expect(usePlayerStore.getState().currentTrack?.id).toBe('audius:a1')
    await togglePlay()
    expect(audio.playing).toBe(true)
  })
})
