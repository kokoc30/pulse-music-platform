import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeYouTubeVideo } from '@/music/youtube'
import type { Track } from '@/music/types'
import { youtubePayload } from '@/test/fixtures/youtube'
import { createFakeYouTubeFactory } from './youtube/fake-adapter'
import type { FakeYouTubeFactory } from './youtube/fake-adapter'
import {
  MINIMUM_DIMENSION,
  PLAYER_CREATE_TIMEOUT_MS,
  PROGRESS_POLL_MS,
  RECOMMENDED_HEIGHT,
  RECOMMENDED_WIDTH,
  createYouTubeIframeEngine,
  getYouTubeEngine,
  hasYouTubeEngine,
  isPlayerCreationAbandoned,
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
    await expect(engine.start(audioTrack, { mode: 'play' })).rejects.toThrow(
      /only accepts YouTube video items/i,
    )
    await expect(engine.start(audioTrack, { mode: 'cue' })).rejects.toThrow(
      /only accepts YouTube video items/i,
    )
    expect(factory.created).toBe(0)
  })
})

describe('one player instance, reused', () => {
  it('creates exactly one player across many videos', async () => {
    await engine.start(video(), { mode: 'play' })
    await engine.start(video({ videoId: 'bbbbbbbbbbb' }), { mode: 'play' })
    await engine.start(video({ videoId: 'ccccccccccc' }), { mode: 'play' })
    expect(factory.created).toBe(1)
  })

  it('shares one creation between two concurrent starts', async () => {
    await Promise.all([
      engine.start(video(), { mode: 'play' }),
      engine.start(video({ videoId: 'bbbbbbbbbbb' }), { mode: 'play' }),
    ])
    expect(factory.created).toBe(1)
  })

  it('builds the player at the recommended 16:9 size, above the documented floor', async () => {
    await engine.start(video(), { mode: 'play' })
    const options = factory.players[0].options
    expect(options.width).toBe(RECOMMENDED_WIDTH)
    expect(options.height).toBe(RECOMMENDED_HEIGHT)
    expect(options.width / options.height).toBeCloseTo(16 / 9, 5)
    expect(options.width).toBeGreaterThanOrEqual(MINIMUM_DIMENSION)
    expect(options.height).toBeGreaterThanOrEqual(MINIMUM_DIMENSION)
  })

  it('passes the page origin, as the IFrame API reference instructs', async () => {
    await engine.start(video(), { mode: 'play' })
    expect(factory.players[0].options.origin).toBe('https://pulse.test')
  })

  it('builds no player until it has a visible container, then flushes the request', async () => {
    // The correct order of operations: the surface is rendered first and the
    // player is built into it, never the other way round.
    const detached = createYouTubeIframeEngine({ factory, origin: 'https://pulse.test' })
    await detached.start(video(), { mode: 'play' })
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
    await detached.start(video(), { mode: 'play' })
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
    await engine.start(video(), { mode: 'play' })
    expect(factory.current()?.playing).toBe(true)
    expect(engine.isPlaying()).toBe(true)
  })

  it('only cues on a scripted transition — never auto-plays', async () => {
    // "An API Client must not initiate an automatic playback until the player
    // is visible and more than half of the player is visible on the page or
    // screen." The engine's scripted path therefore cues and stops.
    await engine.start(video(), { mode: 'cue' })
    const player = factory.current()
    expect(player?.cued).toBe(true)
    expect(player?.playing).toBe(false)
    expect(player?.playCalls).toBe(0)
    expect(engine.isPlaying()).toBe(false)
  })

  it('cue() never starts playback under any circumstances', async () => {
    await engine.start(video(), { mode: 'cue' })
    expect(factory.current()?.playing).toBe(false)
    expect(factory.current()?.playCalls).toBe(0)
  })

  it('reuses the same player for a YouTube -> YouTube transition', async () => {
    await engine.start(video(), { mode: 'play' })
    await engine.start(video({ videoId: 'bbbbbbbbbbb' }), { mode: 'play' })
    expect(factory.created).toBe(1)
    expect(factory.current()?.videoId).toBe('bbbbbbbbbbb')
    expect(engine.getCurrentItem()?.videoId).toBe('bbbbbbbbbbb')
  })

  it('resumes the same video rather than reloading it', async () => {
    await engine.start(video(), { mode: 'play' })
    engine.pause()
    await engine.start(video(), { mode: 'play' })
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

    await engine.start(video(), { mode: 'play' })
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
    await engine.start(video(), { mode: 'play' })
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

    await timed.start(video(), { mode: 'play' })
    factory.current()?.setCurrentTime(5)
    vi.advanceTimersByTime(PROGRESS_POLL_MS * 2)
    expect(ticks.length).toBeGreaterThanOrEqual(2)

    const before = ticks.length
    timed.pause()
    /**
     * Exactly one more, from the pause itself, and then silence.
     *
     * The timer runs once a second, so without a final publish the last position
     * anyone hears about is up to a second stale. That became load-bearing when
     * collapsing started destroying the player: the pause *is* the moment the
     * position is captured to restore from, and a second of drift there is a
     * second the visitor loses on every round trip.
     */
    expect(ticks.length).toBe(before + 1)
    expect(ticks.at(-1)).toBe(5)

    vi.advanceTimersByTime(PROGRESS_POLL_MS * 5)
    expect(ticks.length).toBe(before + 1)

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
    await engine.start(video(), { mode: 'play' })
    const player = factory.players[0]
    engine.detach()
    expect(player.destroyed).toBe(true)
    expect(engine.hasContainer()).toBe(false)
    expect(engine.getCurrentItem()).toBeNull()
  })

  it('builds a fresh player after a detach, not a leaked one', async () => {
    await engine.start(video(), { mode: 'play' })
    engine.detach()
    engine.attach(container)
    await engine.start(video(), { mode: 'play' })
    expect(factory.created).toBe(2)
    expect(factory.players[0].destroyed).toBe(true)
    expect(factory.players[1].destroyed).toBe(false)
  })

  it('surfaces a failed player creation instead of silently doing nothing', async () => {
    factory.failNextCreate('The YouTube player script could not be loaded.')
    await expect(engine.start(video(), { mode: 'play' })).rejects.toThrow(/could not be loaded/i)
    // And a later attempt still works — the failure is not sticky.
    await engine.start(video(), { mode: 'play' })
    expect(factory.current()?.playing).toBe(true)
  })
})

/* ==========================================================================
   Player construction — the lifecycle the reported physical failure broke on
   ========================================================================== */

/**
 * The invariant every test below serves:
 *
 * **A failed, timed-out, detached, superseded or never-ready construction must
 * never stop a later real start from building a functional player.**
 *
 * The engine used to hold one creation promise and share it with everything
 * that asked. A construction that never settled was therefore inherited for
 * ever — by the request behind it, by the request queue, and by the visitor's
 * own press of Play. On a phone that produced a black player with a Play button
 * that did nothing at all, which is a worse failure than any autoplay refusal.
 */
describe('a construction that never becomes ready', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is abandoned on its bound rather than held for ever', async () => {
    factory.deferNextCreate()
    const start = engine.start(video(), { mode: 'play' })
    const settled = start.then(
      () => 'resolved',
      (error: unknown) => (isPlayerCreationAbandoned(error) ? 'abandoned' : 'other'),
    )

    // Inside the bound it is genuinely still trying: no verdict either way.
    await vi.advanceTimersByTimeAsync(PLAYER_CREATE_TIMEOUT_MS - 100)
    expect(engine.describeCreation().state).toBe('creating')
    expect(engine.isReady()).toBe(false)

    await vi.advanceTimersByTimeAsync(200)
    expect(await settled).toBe('abandoned')
    expect(engine.describeCreation()).toMatchObject({ state: 'timed-out', timedOut: true })
  })

  it('does not poison the next attempt', async () => {
    factory.deferNextCreate()
    const abandoned = engine.start(video(), { mode: 'play' }).catch(() => 'abandoned')
    await vi.advanceTimersByTimeAsync(PLAYER_CREATE_TIMEOUT_MS + 100)
    await abandoned

    // The whole point: a second attempt builds a working player.
    await engine.start(video(), { mode: 'play' })
    expect(engine.isReady()).toBe(true)
    expect(factory.current()?.playing).toBe(true)
    expect(engine.describeCreation().state).toBe('ready')
  })

  /**
   * A direct press does not wait out the bound, and does not queue behind the
   * attempt that stalled. Waiting six seconds for a button is the same
   * unresponsive Play button in a slower disguise.
   */
  it('is superseded at once by a start that asks to recover', async () => {
    factory.deferNextCreate()
    const stalled = engine.start(video(), { mode: 'play' }).catch(() => 'abandoned')
    await vi.advanceTimersByTimeAsync(100)
    expect(engine.isReady()).toBe(false)

    await engine.start(video(), { mode: 'play', recover: true })

    expect(engine.isReady()).toBe(true)
    expect(factory.current()?.playing).toBe(true)
    // And the stalled one ends as an abandonment rather than as an error about
    // the video, which is fine and is nobody's fault.
    await vi.advanceTimersByTimeAsync(PLAYER_CREATE_TIMEOUT_MS + 100)
    expect(await stalled).toBe('abandoned')
  })

  /**
   * The late arrival. Attempt 1 times out, attempt 2 succeeds, and attempt 1
   * then reports ready after all — as a slow network genuinely can. It must not
   * install itself over the player the visitor is watching.
   */
  it('cannot install itself once a later attempt has succeeded', async () => {
    factory.deferNextCreate()
    const abandoned = engine.start(video(), { mode: 'play' }).catch(() => 'abandoned')
    await vi.advanceTimersByTimeAsync(PLAYER_CREATE_TIMEOUT_MS + 100)
    await abandoned

    await engine.start(video({ videoId: 'bbbbbbbbbbb' }), { mode: 'play' })
    const working = factory.players[1]
    expect(working.playing).toBe(true)

    // Attempt 1 finally reports ready, long after it stopped mattering.
    factory.releaseDeferredCreates()
    await vi.advanceTimersByTimeAsync(10)

    expect(factory.players[0].destroyed).toBe(true)
    expect(working.destroyed).toBe(false)
    expect(engine.isPlaying()).toBe(true)
    expect(engine.getCurrentItem()?.videoId).toBe('bbbbbbbbbbb')
  })

  it('does not rebuild a player that is working', async () => {
    await engine.start(video(), { mode: 'play' })
    engine.pause()
    await engine.start(video(), { mode: 'play', recover: true })

    expect(factory.created).toBe(1)
    expect(factory.current()?.playing).toBe(true)
  })
})

describe('preparing the infrastructure', () => {
  it('loads the API script and constructs nothing', async () => {
    const prepared = await engine.prepare(video())

    expect(prepared).toBe(true)
    expect(factory.apiPrepared).toBe(1)
    // The empty player is gone: nothing is built until there is a video for it.
    expect(factory.created).toBe(0)
    expect(engine.isApiReady()).toBe(true)
    expect(engine.isReady()).toBe(false)
    expect(engine.describeCreation().state).toBe('idle')
  })

  it('records the item so a remount does not cue over an in-flight start', async () => {
    await engine.prepare(video({ videoId: 'bbbbbbbbbbb' }))
    expect(engine.getCurrentItem()?.videoId).toBe('bbbbbbbbbbb')
  })

  it('never stops a later start from building a player', async () => {
    await engine.prepare(video())
    await engine.start(video(), { mode: 'play' })
    expect(factory.current()?.playing).toBe(true)
  })
})

/**
 * A black, never-ready player showing 0:33 of 4:51 was in the reported
 * screenshot, and none of it was true of the video on screen. A rail that
 * confidently reports somebody else's position is worse than an empty one.
 */
describe('progress belongs to the video that is loaded', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('forgets the position the moment a different video is requested', async () => {
    const ticks: [number, number][] = []
    engine.subscribe({
      onTimeUpdate: (currentTime, duration) => ticks.push([currentTime, duration]),
    })

    await engine.start(video(), { mode: 'play' })
    factory.current()?.setCurrentTime(33)
    factory.current()?.setDuration(291)
    await vi.advanceTimersByTimeAsync(PROGRESS_POLL_MS)
    expect(ticks.at(-1)).toEqual([33, 291])

    // A different video, on a player that never builds — the reported case.
    // The position is republished as nothing at once, rather than left standing.
    engine.detach()
    engine.attach(container)
    factory.deferNextCreate()
    void engine.start(video({ videoId: 'bbbbbbbbbbb' }), { mode: 'play' }).catch(() => {})

    expect(ticks.at(-1)).toEqual([0, 0])
    await vi.advanceTimersByTimeAsync(PROGRESS_POLL_MS * 3)
    // And nothing republishes the old position while nothing is loaded.
    expect(ticks.at(-1)).toEqual([0, 0])
  })

  it('keeps the position when the same video is resumed', async () => {
    const ticks: [number, number][] = []
    await engine.start(video(), { mode: 'play' })
    engine.subscribe({
      onTimeUpdate: (currentTime, duration) => ticks.push([currentTime, duration]),
    })
    factory.current()?.setCurrentTime(33)
    factory.current()?.setDuration(291)

    engine.pause()
    await engine.start(video(), { mode: 'play' })

    expect(ticks).not.toContainEqual([0, 0])
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
