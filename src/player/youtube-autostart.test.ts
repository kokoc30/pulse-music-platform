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
  playYouTubeVideo,
  resetYouTubeAdvanceGuard,
  resetYouTubeFailureStreak,
  resetYouTubeRelatedBudget,
} from './youtube-actions'
import { createYouTubeIframeEngine, getYouTubeEngine, setYouTubeEngine } from './youtube-engine'
import { initialYouTubeState, useYouTubeStore } from './youtube-store'
import {
  VISIBILITY_SETTLE_MS,
  VISIBILITY_TIMEOUT_MS,
  registerYouTubeStageElement,
  resetYouTubeVisibility,
  setYouTubeVisibleRatio,
} from './youtube-visibility'

/**
 * Why an automatic hand-off into a saved video did or did not start.
 *
 * The reported symptom — "the expanded player opens and the video does not
 * play" — has at least two causes that need opposite fixes, and the previous
 * pass could not tell them apart:
 *
 * · **The application never asked.** The visibility wait gave up before the real
 *   observer reported a ratio above the threshold, so a cue went out instead of
 *   a play. The app is at fault and the reveal/measure timing is what to change.
 * · **The browser refused.** The player was visible, ready, and genuinely asked
 *   to play — and an unmuted cross-origin start minutes after the last gesture
 *   is precisely what mobile autoplay policy exists to stop. The app is not at
 *   fault, and changing the visibility code would only hide it.
 *
 * These tests make the two distinguishable. Every one of them drives the real
 * actions, the real engine and the real bounded waits; what they control is the
 * *environment* — when observations arrive, and what the player does with the
 * command it is given. Nothing writes a ratio the production code then reads
 * back as its own measurement, and nothing shortens the threshold.
 */

const VIDEO = normalizeYouTubeVideo(
  youtubePayload({ videoId: 'aram0000001', title: 'Tangarjhek Manyak' }),
)

let factory: FakeYouTubeFactory
let container: HTMLDivElement
let stage: HTMLDivElement
/** Every documented IFrame API command the engine actually issued, in order. */
let commands: string[]

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
  engine.subscribe({ onCommand: (command) => commands.push(command) })
  bindYouTubeEngineEvents()

  usePlayerStore.setState({ ...initialPlayerState, autoplaySimilar: false })
  useYouTubeStore.setState({ ...initialYouTubeState })
  useUiStore.setState({ nowPlayingOpen: false })
  resetPlaybackCoordinator()
  resetYouTubeVisibility()
  // Registered *after* the reset, which clears it: the element the observer
  // watches is how a waiter tells "no player yet" from "player off screen",
  // and jsdom's zero-sized boxes make the observation itself stand in for
  // layout.
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

/** The hand-off a saved list performs: no gesture, no measurement in hand. */
const handOff = () =>
  playYouTubeVideo(VIDEO, { userInitiated: false, reason: 'collection-transition' })

/** Schedules a real observation, the way a browser's observer would deliver it. */
function observeAt(delayMs: number, ratio: number) {
  setTimeout(() => setYouTubeVisibleRatio(ratio), delayMs)
}

const status = () => useYouTubeStore.getState().status
const awaiting = () => useYouTubeStore.getState().awaitingUserPlayReason

/* ==========================================================================
   A — the player is visible, and the provider accepts the start
   ========================================================================== */

describe('a visible player that accepts the start', () => {
  it('issues a real play command and reaches playing, with no press', async () => {
    const handedOff = handOff()
    observeAt(50, 0.92)

    await vi.advanceTimersByTimeAsync(400)
    await handedOff

    expect(status()).toBe('playing')
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(false)
    expect(factory.current()?.playing).toBe(true)
  })

  /**
   * The assertion the whole diagnosis turned on.
   *
   * An authorised automatic start must reach a documented *play* command. The
   * engine used to decide this from a `userInitiated` boolean and cue whenever
   * it was false, so the only way to express "scripted, but authorised" was to
   * tell the engine a human had clicked. Now it is told a mode, and this is what
   * that mode has to produce.
   */
  it('ends on a documented play command, never on a cue', async () => {
    const handedOff = handOff()
    observeAt(50, 0.92)
    await vi.advanceTimersByTimeAsync(400)
    await handedOff

    // `playVideo` rather than `loadVideoById`, and that is right: phase 1 cued
    // this very video while the measurement settled, so the play resumes the
    // player it prepared instead of reloading it. Both are documented play
    // paths; what matters — and what was wrong before — is that the final
    // command is not `cueVideoById`.
    expect(PLAY_COMMANDS).toContain(commands.at(-1))
    expect(commands.at(-1)).not.toBe('cue')
    expect(factory.current()?.playCalls).toBeGreaterThan(0)
  })

  /**
   * The stage cues the loaded item when it mounts so a remount does not lose the
   * video. That cue must never land *after* the play it was racing — which it
   * did once, leaving the player on a thumbnail while the store said playing.
   */
  it('cannot be overwritten by a late cue from the stage', async () => {
    const handedOff = handOff()
    // Exactly what the stage's remount-restore branch issues, arriving in the
    // middle of the transition rather than before it.
    void getYouTubeEngine().start(VIDEO, { mode: 'cue' })
    observeAt(50, 0.92)

    await vi.advanceTimersByTimeAsync(400)
    await handedOff
    await vi.advanceTimersByTimeAsync(50)

    expect(commands.at(-1)).not.toBe('cue')
    expect(factory.current()?.playing).toBe(true)
    expect(status()).toBe('playing')
  })
})

/* ==========================================================================
   B — the player is visible, and the browser refuses
   ========================================================================== */

describe('a visible player the browser refuses to start', () => {
  async function blockedHandOff() {
    const handedOff = handOff()
    observeAt(50, 0.95)
    await vi.advanceTimersByTimeAsync(400)
    await handedOff
    // Exactly what the IFrame API sends when the browser declines a scripted
    // play: the command was accepted, and playback did not begin.
    factory.current()?.emitAutoplayBlocked()
    return handedOff
  }

  it('records the refusal as its own reason, not as a visibility failure', async () => {
    await blockedHandOff()

    expect(awaiting()).toBe('autoplay-blocked')
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
    expect(status()).toBe('paused')
  })

  it('proves the application did issue a play command first', async () => {
    await blockedHandOff()

    // This is what separates "the browser refused" from "we never asked", and
    // it is the difference between a browser limitation and an app bug.
    expect(commands.some((command) => PLAY_COMMANDS.includes(command))).toBe(true)
    expect(tracedSteps()).toContain('engine:autoplay-blocked')
    expect(lastTraceDetail('decide:result')?.mode).toBe('play')
  })

  it('does not retry — one automatic attempt per transition', async () => {
    await blockedHandOff()
    const attempts = factory.current()?.playCalls ?? 0

    await vi.advanceTimersByTimeAsync(5_000)

    expect(factory.current()?.playCalls).toBe(attempts)
    expect(commands.filter((command) => command !== 'cue')).toHaveLength(1)
  })

  it('keeps the video loaded rather than skipping past it', async () => {
    await blockedHandOff()
    expect(useYouTubeStore.getState().item?.videoId).toBe('aram0000001')
  })
})

/* ==========================================================================
   C — the player settles below the threshold
   ========================================================================== */

describe('a player that settles below the threshold', () => {
  it('cues, names visibility as the reason, and never lowers the bar', async () => {
    const handedOff = handOff()
    observeAt(50, 0.42)

    // Resolved by the layout going quiet, well inside the hard cap.
    await vi.advanceTimersByTimeAsync(50 + VISIBILITY_SETTLE_MS + 50)
    await handedOff

    expect(status()).toBe('cued')
    expect(awaiting()).toBe('visibility')
    expect(commands.at(-1)).toBe('cue')
    expect(factory.current()?.playing).toBe(false)
    expect(lastTraceDetail('decide:result')?.visibleRatio).toBe(0.42)
  })

  it('is answered promptly rather than waiting out the hard cap', async () => {
    const handedOff = handOff()
    observeAt(50, 0.42)

    await vi.advanceTimersByTimeAsync(50 + VISIBILITY_SETTLE_MS + 50)
    await handedOff

    const waited = lastTraceDetail('decide:result')?.waitedMs
    expect(typeof waited).toBe('number')
    expect(waited as number).toBeLessThan(VISIBILITY_TIMEOUT_MS)
  })
})

/* ==========================================================================
   D — the observation arrives later than the old flat deadline allowed
   ========================================================================== */

describe('a phone-paced reveal', () => {
  /**
   * The timing the brief describes, and the test that says whether the previous
   * 700ms deadline was the culprit.
   *
   * The stage mounts at 300ms, the first observation lands at 650ms below the
   * bar, and the geometry settles at 900ms above it — which is an ordinary
   * sequence on a device whose address bar collapses and whose safe-area insets
   * resolve after the first paint. A flat 700ms deadline answers "not visible"
   * at 700ms and cues a video that was about to be perfectly visible.
   *
   * The settle-based wait keeps listening because the layout is still moving,
   * and starts the video.
   */
  it('starts the video when the layout settles above the bar after 700ms', async () => {
    const handedOff = handOff()
    observeAt(650, 0.45)
    observeAt(900, 0.92)

    await vi.advanceTimersByTimeAsync(1_200)
    await handedOff

    expect(status()).toBe('playing')
    expect(PLAY_COMMANDS).toContain(commands.at(-1))
    expect(lastTraceDetail('decide:result')?.visibleRatio).toBe(0.92)
  })

  it('would have been refused by a flat 700ms deadline', async () => {
    // Stated as an assertion rather than left as a claim in a comment: at the
    // old deadline the only measurement in hand is the 0.45 one, which is
    // exactly the answer that produced the reported bug.
    const handedOff = handOff()
    observeAt(650, 0.45)
    observeAt(900, 0.92)

    await vi.advanceTimersByTimeAsync(700)
    expect(useYouTubeStore.getState().status).not.toBe('playing')

    await vi.advanceTimersByTimeAsync(500)
    await handedOff
    expect(status()).toBe('playing')
  })

  it('still gives up, and cues, when nothing is ever observed', async () => {
    const handedOff = handOff()

    await vi.advanceTimersByTimeAsync(VISIBILITY_TIMEOUT_MS + 100)
    await handedOff

    expect(status()).toBe('cued')
    expect(awaiting()).toBe('visibility')
    expect(lastTraceDetail('decide:measured')?.measured).toBe(false)
    // Bounded: it did not wait for ever, and it did not invent a ratio.
    expect(lastTraceDetail('decide:result')?.visibleRatio).toBe(0)
  })
})

/* ==========================================================================
   The document is the one thing no measurement can override
   ========================================================================== */

describe('a hidden document', () => {
  it('refuses immediately, without waiting or measuring', async () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      const handedOff = handOff()
      observeAt(10, 0.99)
      await vi.advanceTimersByTimeAsync(100)
      await handedOff

      expect(status()).toBe('cued')
      expect(awaiting()).toBe('document-hidden')
      expect(commands).not.toContain('loadVideoById')
      expect(commands).not.toContain('playVideo')
    } finally {
      hidden.mockRestore()
    }
  })
})

/* ==========================================================================
   The trace itself — the instrument the diagnosis depends on
   ========================================================================== */

describe('the transition trace', () => {
  it('records every step a diagnosis needs, in order', async () => {
    const handedOff = handOff()
    observeAt(50, 0.92)
    await vi.advanceTimersByTimeAsync(400)
    await handedOff

    const steps = tracedSteps()
    expect(steps).toContain('reveal:begin')
    expect(steps).toContain('prepare:cue')
    expect(steps).toContain('visibility:observed')
    expect(steps).toContain('visibility:resolved')
    expect(steps).toContain('decide:result')
    expect(steps).toContain('engine:command')
    expect(steps).toContain('engine:started')

    // And it says which of the two candidate causes this run was.
    expect(lastTraceDetail('decide:result')).toMatchObject({
      mode: 'play',
      directUserGesture: false,
      measured: true,
    })
  })
})
