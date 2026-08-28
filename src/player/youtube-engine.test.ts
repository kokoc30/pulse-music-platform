import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeYouTubeVideo } from '@/music/youtube'
import type { Track } from '@/music/types'
import { youtubePayload } from '@/test/fixtures/youtube'
import { createFakeYouTubeFactory } from './youtube/fake-adapter'
import type { FakeYouTubeFactory } from './youtube/fake-adapter'
import {
  MINIMUM_DIMENSION,
  PROGRESS_POLL_MS,
  RECOMMENDED_HEIGHT,
  RECOMMENDED_WIDTH,
  createYouTubeIframeEngine,
  getYouTubeEngine,
  hasYouTubeEngine,
  setYouTubeEngine,
} from './youtube-engine'
import type { YouTubeEngine } from './youtube-engine'

const video = (overrides = {}) => normalizeYouTubeVideo(youtubePayload(overrides))

const audioTrack: Track = {
  id: 'audius:a1',
  mediaKind: 'audio',
  provider: 'audius',
  providerId: 'a1',
  title: 'Midnight Signal',
  artistName: 'Nova Sound',
  artwork: {},
  durationSeconds: 200,
  isStreamable: true,
}

let factory: FakeYouTubeFactory
let engine: YouTubeEngine
let container: HTMLElement

beforeEach(() => {
  factory = createFakeYouTubeFactory()
  engine = createYouTubeIframeEngine({ factory, origin: 'https://pulse.test' })
  container = document.createElement('div')
  document.body.appendChild(container)
  engine.attach(container)
})

afterEach(() => {
  engine.destroy()
  container.remove()
  setYouTubeEngine(null)
})

describe('the YouTube engine only accepts YouTube items', () => {
  it('refuses an audio track outright', async () => {
    // The mirror of `assertAudioTrack`: an Audius or Jamendo track must never
    // reach the iframe engine (agents/28 → "Audio providers never enter
    // YouTube engine").
    await expect(engine.play(audioTrack, { userInitiated: true })).rejects.toThrow(
      /only accepts YouTube video items/i,
    )
    await expect(engine.cue(audioTrack)).rejects.toThrow(/only accepts YouTube video items/i)
    expect(factory.created).toBe(0)
  })
})

describe('one player instance, reused', () => {
  it('creates exactly one player across many videos', async () => {
    await engine.play(video(), { userInitiated: true })
    await engine.play(video({ videoId: 'bbbbbbbbbbb' }), { userInitiated: true })
    await engine.play(video({ videoId: 'ccccccccccc' }), { userInitiated: true })
    expect(factory.created).toBe(1)
  })

  it('shares one creation between two concurrent starts', async () => {
    await Promise.all([
      engine.play(video(), { userInitiated: true }),
      engine.play(video({ videoId: 'bbbbbbbbbbb' }), { userInitiated: true }),
    ])
    expect(factory.created).toBe(1)
  })

  it('builds the player at the recommended 16:9 size, above the documented floor', async () => {
    await engine.play(video(), { userInitiated: true })
    const options = factory.players[0].options
    expect(options.width).toBe(RECOMMENDED_WIDTH)
    expect(options.height).toBe(RECOMMENDED_HEIGHT)
    expect(options.width / options.height).toBeCloseTo(16 / 9, 5)
    expect(options.width).toBeGreaterThanOrEqual(MINIMUM_DIMENSION)
    expect(options.height).toBeGreaterThanOrEqual(MINIMUM_DIMENSION)
  })

  it('passes the page origin, as the IFrame API reference instructs', async () => {
    await engine.play(video(), { userInitiated: true })
    expect(factory.players[0].options.origin).toBe('https://pulse.test')
  })

  it('builds no player until it has a visible container, then flushes the request', async () => {
    // The correct order of operations: the surface is rendered first and the
    // player is built into it, never the other way round.
    const detached = createYouTubeIframeEngine({ factory, origin: 'https://pulse.test' })
    await detached.play(video(), { userInitiated: true })
    expect(factory.created).toBe(0)

    const host = document.createElement('div')
    document.body.appendChild(host)
    detached.attach(host)

    await vi.waitFor(() => {
      expect(factory.created).toBe(1)
      expect(factory.current()?.playing).toBe(true)
    })
    detached.destroy()
    host.remove()
  })

  it('drops a deferred request if the surface is torn down before it mounts', async () => {
    const detached = createYouTubeIframeEngine({ factory })
    await detached.play(video(), { userInitiated: true })
    detached.detach()

    const host = document.createElement('div')
    document.body.appendChild(host)
    detached.attach(host)
    await Promise.resolve()
    expect(factory.created).toBe(0)
    detached.destroy()
    host.remove()
  })
})

describe('user-initiated play versus scripted transition', () => {
  it('plays on a direct user gesture', async () => {
    await engine.play(video(), { userInitiated: true })
    expect(factory.current()?.playing).toBe(true)
    expect(engine.isPlaying()).toBe(true)
  })

  it('only cues on a scripted transition — never auto-plays', async () => {
    // "An API Client must not initiate an automatic playback until the player
    // is visible and more than half of the player is visible on the page or
    // screen." The engine's scripted path therefore cues and stops.
    await engine.play(video(), { userInitiated: false })
    const player = factory.current()
    expect(player?.cued).toBe(true)
    expect(player?.playing).toBe(false)
    expect(player?.playCalls).toBe(0)
    expect(engine.isPlaying()).toBe(false)
  })

  it('cue() never starts playback under any circumstances', async () => {
    await engine.cue(video())
    expect(factory.current()?.playing).toBe(false)
    expect(factory.current()?.playCalls).toBe(0)
  })

  it('reuses the same player for a YouTube -> YouTube transition', async () => {
    await engine.play(video(), { userInitiated: true })
    await engine.play(video({ videoId: 'bbbbbbbbbbb' }), { userInitiated: true })
    expect(factory.created).toBe(1)
    expect(factory.current()?.videoId).toBe('bbbbbbbbbbb')
    expect(engine.getCurrentItem()?.videoId).toBe('bbbbbbbbbbb')
  })

  it('resumes the same video rather than reloading it', async () => {
    await engine.play(video(), { userInitiated: true })
    engine.pause()
    await engine.play(video(), { userInitiated: true })
    // Same id: playVideo(), not loadVideoById(), so the position is kept.
    expect(factory.current()?.videoId).toBe('aaaaaaaaaaa')
    expect(factory.current()?.playing).toBe(true)
  })
})

describe('engine events', () => {
  it('reports ready, state changes, errors and autoplay blocks', async () => {
    const seen: string[] = []
    engine.subscribe({
      onReady: () => seen.push('ready'),
      onStateChange: (state) => seen.push(`state:${state}`),
      onError: (message) => seen.push(`error:${message}`),
      onAutoplayBlocked: () => seen.push('blocked'),
    })

    await engine.play(video(), { userInitiated: true })
    const player = factory.current()!
    player.pauseVideo()
    player.emitState(0)
    player.emitError(101)
    player.emitAutoplayBlocked()

    expect(seen).toContain('ready')
    expect(seen).toContain('state:playing')
    expect(seen).toContain('state:paused')
    expect(seen).toContain('state:ended')
    expect(seen.some((entry) => entry.startsWith('error:'))).toBe(true)
    expect(seen).toContain('blocked')
  })

  it('stops emitting to a listener that unsubscribed', async () => {
    const seen: string[] = []
    const unsubscribe = engine.subscribe({ onStateChange: (state) => seen.push(state) })
    await engine.play(video(), { userInitiated: true })
    unsubscribe()
    factory.current()?.pauseVideo()
    expect(seen).toEqual(['playing'])
  })
})

describe('the progress timer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs only while playing, and stops on pause', async () => {
    const ticks: number[] = []
    const timed = createYouTubeIframeEngine({ factory, origin: 'https://pulse.test' })
    timed.attach(container)
    timed.subscribe({ onTimeUpdate: (currentTime) => ticks.push(currentTime) })

    await timed.play(video(), { userInitiated: true })
    factory.current()?.setCurrentTime(5)
    vi.advanceTimersByTime(PROGRESS_POLL_MS * 2)
    expect(ticks.length).toBeGreaterThanOrEqual(2)

    const before = ticks.length
    timed.pause()
    vi.advanceTimersByTime(PROGRESS_POLL_MS * 5)
    expect(ticks.length).toBe(before)

    timed.destroy()
  })

  it('never runs before anything is playing', () => {
    const ticks: number[] = []
    const idle = createYouTubeIframeEngine({ factory })
    idle.subscribe({ onTimeUpdate: (currentTime) => ticks.push(currentTime) })
    vi.advanceTimersByTime(PROGRESS_POLL_MS * 10)
    expect(ticks).toEqual([])
    idle.destroy()
  })
})

describe('teardown', () => {
  it('destroys the player and forgets its container on detach', async () => {
    await engine.play(video(), { userInitiated: true })
    const player = factory.players[0]
    engine.detach()
    expect(player.destroyed).toBe(true)
    expect(engine.hasContainer()).toBe(false)
    expect(engine.getCurrentItem()).toBeNull()
  })

  it('builds a fresh player after a detach, not a leaked one', async () => {
    await engine.play(video(), { userInitiated: true })
    engine.detach()
    engine.attach(container)
    await engine.play(video(), { userInitiated: true })
    expect(factory.created).toBe(2)
    expect(factory.players[0].destroyed).toBe(true)
    expect(factory.players[1].destroyed).toBe(false)
  })

  it('surfaces a failed player creation instead of silently doing nothing', async () => {
    factory.failNextCreate('The YouTube player script could not be loaded.')
    await expect(engine.play(video(), { userInitiated: true })).rejects.toThrow(/could not be loaded/i)
    // And a later attempt still works — the failure is not sticky.
    await engine.play(video(), { userInitiated: true })
    expect(factory.current()?.playing).toBe(true)
  })
})

describe('the module-level singleton', () => {
  it('is not created until something asks for it', () => {
    setYouTubeEngine(null)
    expect(hasYouTubeEngine()).toBe(false)
    const injected = createYouTubeIframeEngine({ factory })
    setYouTubeEngine(injected)
    expect(hasYouTubeEngine()).toBe(true)
    expect(getYouTubeEngine()).toBe(injected)
  })
})
