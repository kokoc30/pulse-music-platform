import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/app/ui-store'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { youtubePayload } from '@/test/fixtures/youtube'
import { lastTraceDetail, resetPlaybackTrace, tracedSteps } from './playback-trace'
import { resetPlaybackCoordinator } from './playback-coordinator'
import { initialPlayerState, usePlayerStore } from './player-store'
import { clearPlayedSession } from './related-fetcher'
import { createFakeYouTubeFactory } from './youtube/fake-adapter'
import type { FakeYouTubeFactory } from './youtube/fake-adapter'
import {
  bindYouTubeEngineEvents,
  getYouTubeSnapshot,
  playYouTubeVideo,
  resetYouTubeAdvanceGuard,
  resetYouTubeFailureStreak,
  resetYouTubeRelatedBudget,
  toggleYouTubePlayback,
} from './youtube-actions'
import {
  PLAYER_CREATE_TIMEOUT_MS,
  createYouTubeIframeEngine,
  getYouTubeEngine,
  setYouTubeEngine,
} from './youtube-engine'
import { initialYouTubeState, useYouTubeStore } from './youtube-store'
import {
  registerYouTubeStageElement,
  resetYouTubeVisibility,
  setYouTubeVisibleRatio,
} from './youtube-visibility'

/**
 * The failure a physical phone produced, and the recovery it needed.
 *
 * The trace from the device, in full:
 *
 * ```
 * status          cued        player ready  false
 * ratio           1           iframe autoplay —
 * measured        true        decision      cue
 * waited ms       4           withheld      player-not-ready
 * wait ended      observed    commands      []
 *                             states        []
 * ```
 *
 * Every number in the left column is the *success* case: the document was
 * visible, the stage was fully on screen, and the measurement landed in four
 * milliseconds. Nothing about visibility failed, and nothing about autoplay was
 * refused — a refusal requires a command, and no command was ever issued.
 *
 * What actually happened is in the right column. The transition prepared itself
 * by constructing an empty `YT.Player`, that construction never reported ready,
 * and the promise it was shared through never settled. The decision therefore
 * withheld playback for want of a player, the cue behind it inherited the same
 * dead promise and issued nothing, and — worst of all — so did the visitor's own
 * press of Play. The control case says the same thing from the other side: a
 * refresh followed by a direct click on the same video works every time, and a
 * direct click is the path that constructs the player *around the video*.
 *
 * These tests are that trace, reproduced, and the two things that must be true
 * afterwards: the transition must reach a bounded, honest, recoverable state,
 * and a press of Play must always start the video.
 */

const VIDEO = normalizeYouTubeVideo(
  youtubePayload({ videoId: 'aram0000001', title: 'Tangarjhek Manyak' }),
)

let factory: FakeYouTubeFactory
let container: HTMLDivElement
let stage: HTMLDivElement
let commands: string[]
let states: string[]

/** The two documented ways this engine ever starts playback. */
const PLAY_COMMANDS = ['loadVideoById', 'playVideo']

beforeEach(() => {
  vi.useFakeTimers()
  factory = createFakeYouTubeFactory()
  container = document.createElement('div')
  document.body.appendChild(container)
  stage = document.createElement('div')
  document.body.appendChild(stage)

  const engine = createYouTubeIframeEngine({ factory, origin: 'https://pulse.test' })
  engine.attach(container)
  setYouTubeEngine(engine)

  commands = []
  states = []
  engine.subscribe({
    onCommand: (command) => commands.push(command),
    onStateChange: (state) => states.push(state),
  })
  bindYouTubeEngineEvents()

  usePlayerStore.setState({ ...initialPlayerState, autoplaySimilar: false })
  useYouTubeStore.setState({ ...initialYouTubeState })
  useUiStore.setState({ nowPlayingOpen: false })
  resetPlaybackCoordinator()
  resetYouTubeVisibility()
  registerYouTubeStageElement(stage)
  resetPlaybackTrace()
  resetYouTubeAdvanceGuard()
  resetYouTubeFailureStreak()
  resetYouTubeRelatedBudget()
  clearPlayedSession()
})

afterEach(() => {
  setYouTubeEngine(null)
  registerYouTubeStageElement(null)
  resetYouTubeVisibility()
  container.remove()
  stage.remove()
  vi.useRealTimers()
})

/** The hand-off a saved list performs when an audio track ends. */
const handOff = () =>
  playYouTubeVideo(VIDEO, { userInitiated: false, reason: 'collection-transition' })

const status = () => useYouTubeStore.getState().status
const awaiting = () => useYouTubeStore.getState().awaitingUserPlayReason

/**
 * Reproduces the device trace exactly: a fully visible stage, and a player
 * construction that is accepted and then never reports ready.
 */
async function stalledHandOff(): Promise<{ handedOff: Promise<boolean> }> {
  const handedOff = handOff()
  // Held from the moment the start reaches for a player. The construction is
  // begun and simply never completes — no `onReady`, no error, no event.
  factory.deferNextCreate()
  setTimeout(() => setYouTubeVisibleRatio(1), 50)
  await vi.advanceTimersByTimeAsync(400)
  // Wrapped, so awaiting the *helper* does not also await the transition it is
  // deliberately leaving in flight.
  return { handedOff }
}

/* ==========================================================================
   The trace, reproduced
   ========================================================================== */

describe('the black player a phone reported', () => {
  it('reaches the decision on a perfect measurement, and still has no player', async () => {
    await stalledHandOff()

    // The left column of the device readout, all of it the success case.
    expect(lastTraceDetail('decide:result')).toMatchObject({
      visibleRatio: 1,
      measured: true,
      mode: 'play',
    })
    // And the right column: nothing built, nothing commanded, nothing reported.
    expect(getYouTubeEngine().isReady()).toBe(false)
    expect(commands).toEqual([])
    expect(states).toEqual([])
  })

  /**
   * The decision is no longer withheld for want of a player, and that is the
   * substantive change. Requiring readiness *before* deciding, while the player
   * is only built *after* deciding, is a loop with one exit: cue, for ever.
   */
  it('no longer withholds the decision for a player nothing was building', async () => {
    await stalledHandOff()
    expect(lastTraceDetail('decide:result')?.mode).toBe('play')
    expect(lastTraceDetail('decide:result')?.withheld).toBeNull()
    // The script half of readiness was fine all along, which is exactly why
    // reading one readiness for the other was so misleading.
    expect(lastTraceDetail('decide:measured')?.apiReady).toBe(true)
    expect(lastTraceDetail('decide:measured')?.playerReady).toBe(false)
  })

  it('does not deadlock: the transition ends, bounded, and says why', async () => {
    const { handedOff } = await stalledHandOff()
    await vi.advanceTimersByTimeAsync(PLAYER_CREATE_TIMEOUT_MS + 200)

    // It ends. Before, this promise and the queue behind it never settled.
    expect(await handedOff).toBe(true)
    expect(status()).toBe('cued')
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
    expect(awaiting()).toBe('player-not-ready')
    expect(tracedSteps()).toContain('engine:player-not-ready')
  })

  /**
   * Not an error state. `setError` would move the store to `'error'`, where
   * there is no Play button to recover with — and there is nothing wrong with
   * the video.
   */
  it('is not reported as a failure of the video', async () => {
    await stalledHandOff()
    await vi.advanceTimersByTimeAsync(PLAYER_CREATE_TIMEOUT_MS + 200)

    expect(useYouTubeStore.getState().error).toBeNull()
    expect(status()).not.toBe('error')
  })

  /** The collection stays here. A slow player is not an unplayable item. */
  it('keeps the collection on this video rather than skipping it', async () => {
    const { handedOff } = await stalledHandOff()
    await vi.advanceTimersByTimeAsync(PLAYER_CREATE_TIMEOUT_MS + 200)

    expect(await handedOff).toBe(true)
    expect(useYouTubeStore.getState().item?.videoId).toBe('aram0000001')
    expect(useYouTubeStore.getState().surfaceOpen).toBe(true)
  })

  /**
   * The screenshot showed `0:33 / 4:51` on a black, never-ready player. The
   * position was not this video's and could not have been: nothing had loaded.
   */
  it('shows no position at all while nothing has loaded', async () => {
    await stalledHandOff()
    await vi.advanceTimersByTimeAsync(PLAYER_CREATE_TIMEOUT_MS + 200)

    expect(useYouTubeStore.getState().currentTime).toBe(0)
    // The length may honestly come from the item's own metadata; the *position*
    // may not come from anywhere.
    expect(getYouTubeSnapshot().currentTime).toBe(0)
    expect(getYouTubeSnapshot().duration).toBe(VIDEO.durationSeconds)
  })
})

/* ==========================================================================
   Play is the recovery authority
   ========================================================================== */

describe('a press of Play after a construction that stalled', () => {
  /**
   * The assertion that matters most in this file. Before, this press reached
   * `engine.resume()`, which is `player?.playVideo()` — a no-op with no player.
   * The visitor was left with a black rectangle and a dead button.
   */
  it('builds a fresh player and starts the video', async () => {
    await stalledHandOff()
    await vi.advanceTimersByTimeAsync(PLAYER_CREATE_TIMEOUT_MS + 200)
    expect(commands).toEqual([])

    toggleYouTubePlayback()
    await vi.advanceTimersByTimeAsync(50)

    expect(getYouTubeEngine().isReady()).toBe(true)
    expect(PLAY_COMMANDS).toContain(commands.at(-1))
    expect(states).toContain('playing')
    expect(status()).toBe('playing')
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(false)
  })

  it('builds that player around the video the store is showing', async () => {
    await stalledHandOff()
    await vi.advanceTimersByTimeAsync(PLAYER_CREATE_TIMEOUT_MS + 200)

    toggleYouTubePlayback()
    await vi.advanceTimersByTimeAsync(50)

    expect(factory.created).toBe(2)
    expect(factory.current()?.options.videoId).toBe('aram0000001')
    expect(factory.current()?.playing).toBe(true)
    expect(tracedSteps()).toContain('user:recover-player')
  })

  /**
   * And it does not make the visitor wait out the bound first. A press that
   * takes six seconds to do anything is the same unresponsive button, slower.
   */
  it('does not queue behind the attempt that stalled', async () => {
    await stalledHandOff()
    // Pressed while the first construction is still nominally in flight.
    expect(getYouTubeEngine().describeCreation().state).toBe('creating')

    toggleYouTubePlayback()
    await vi.advanceTimersByTimeAsync(50)

    expect(status()).toBe('playing')
    expect(PLAY_COMMANDS).toContain(commands.at(-1))
  })

  /**
   * The stalled transition is still out there and will end on its own bound.
   * Its conclusion must not land on top of the video now playing.
   */
  it('is not undone when the abandoned attempt finally gives up', async () => {
    await stalledHandOff()

    toggleYouTubePlayback()
    await vi.advanceTimersByTimeAsync(50)
    expect(status()).toBe('playing')

    await vi.advanceTimersByTimeAsync(PLAYER_CREATE_TIMEOUT_MS + 500)

    expect(status()).toBe('playing')
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(false)
  })

  /** A working player is never rebuilt: a press on one is a resume. */
  it('resumes a healthy player instead of replacing it', async () => {
    const handedOff = handOff()
    setTimeout(() => setYouTubeVisibleRatio(1), 50)
    await vi.advanceTimersByTimeAsync(400)
    await handedOff
    expect(status()).toBe('playing')

    toggleYouTubePlayback()
    expect(status()).toBe('paused')
    toggleYouTubePlayback()
    await vi.advanceTimersByTimeAsync(50)

    expect(factory.created).toBe(1)
    expect(status()).toBe('playing')
  })
})

/* ==========================================================================
   The control case, which must not regress
   ========================================================================== */

describe('a direct click on a YouTube video', () => {
  /**
   * The path a physical device confirms works, on a fresh app with nothing
   * prepared. The automatic transition now converges on this same setup rather
   * than keeping a lifecycle of its own, so it is worth stating plainly what
   * "this setup" is.
   */
  it('creates, becomes ready and starts, with no measurement at all', async () => {
    const played = await playYouTubeVideo(VIDEO, { userInitiated: true })

    expect(played).toBe(true)
    expect(factory.created).toBe(1)
    expect(factory.players[0]?.options.videoId).toBe('aram0000001')
    expect(getYouTubeEngine().isReady()).toBe(true)
    expect(PLAY_COMMANDS).toContain(commands.at(-1))
    expect(status()).toBe('playing')
  })

  it('issues one media command, never a cue in front of the load', async () => {
    await playYouTubeVideo(VIDEO, { userInitiated: true })
    expect(commands).toEqual(['loadVideoById'])
  })
})

/* ==========================================================================
   The automatic transition, when the player does build
   ========================================================================== */

describe('an authorised automatic transition with a video-seeded player', () => {
  it('starts the video on its own, with no tap', async () => {
    const handedOff = handOff()
    setTimeout(() => setYouTubeVisibleRatio(1), 50)
    await vi.advanceTimersByTimeAsync(400)

    expect(await handedOff).toBe(true)
    expect(factory.players[0]?.options.videoId).toBe('aram0000001')
    expect(PLAY_COMMANDS).toContain(commands.at(-1))
    expect(status()).toBe('playing')
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(false)
  })

  /** The policy is unchanged, and is still the only thing that withholds. */
  it('still refuses to start a player that is not more than half visible', async () => {
    const handedOff = handOff()
    setTimeout(() => setYouTubeVisibleRatio(0.4), 50)
    await vi.advanceTimersByTimeAsync(2_000)
    await handedOff

    expect(commands.at(-1)).toBe('cue')
    expect(awaiting()).toBe('visibility')
    expect(status()).toBe('cued')
  })

  it('still refuses to start into a hidden document', async () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      const handedOff = handOff()
      setTimeout(() => setYouTubeVisibleRatio(1), 10)
      await vi.advanceTimersByTimeAsync(200)
      await handedOff

      expect(awaiting()).toBe('document-hidden')
      expect(commands.some((command) => PLAY_COMMANDS.includes(command))).toBe(false)
    } finally {
      hidden.mockRestore()
    }
  })
})
