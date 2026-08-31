import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/app/ui-store'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { youtubePayload } from '@/test/fixtures/youtube'
import { lastTraceDetail, resetPlaybackTrace, tracedSteps } from './playback-trace'
import { resetPlaybackCoordinator } from './playback-coordinator'
import { initialPlayerState, usePlayerStore } from './player-store'
import { clearPlayedSession } from './related-fetcher'
import { YT_STATE as YT } from './youtube/iframe-adapter'
import { createFakeYouTubeFactory } from './youtube/fake-adapter'
import type { FakeYouTubeFactory } from './youtube/fake-adapter'
import {
  bindYouTubeEngineEvents,
  playYouTubeVideo,
  resetYouTubeAdvanceGuard,
  resetYouTubeFailureStreak,
  resetYouTubeRelatedBudget,
  START_CONFIRMATION_MS,
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

/**
 * Makes a player accept every command and report nothing back.
 *
 * The doubled player normally fires the state event a real one would. Silencing
 * it reproduces a browser that takes the command and quietly declines — which is
 * the case no event announces, and the one a bounded confirmation exists for.
 */
function silenceStateEvents(player: ReturnType<FakeYouTubeFactory['current']>) {
  if (!player) return
  player.loadVideoById = () => {
    commands.push('loadVideoById')
  }
  player.playVideo = () => {
    commands.push('playVideo')
  }
}

/**
 * Silences the live player *and* every player built from here on.
 *
 * A test used to reach for `factory.current()` partway through a transition,
 * because the preparation had already built an empty player by then. It no
 * longer does — a player is constructed only once there is a video to construct
 * it around, which is the fix — so there is nothing to reach for, and a test
 * that wants to change how the player behaves has to be handed it instead.
 */
function silencePlayers() {
  silenceStateEvents(factory.current())
  factory.onCreate = silenceStateEvents
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

    // `loadVideoById`: the player is constructed around this video and has
    // never started, so load-and-play is the documented command for it rather
    // than a resume of something that never ran. Both are documented play
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
    expect(steps).toContain('prepare:player')
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

/* ==========================================================================
   The two quiet failures — a command that starts nothing, and a frame that was
   never allowed to
   ========================================================================== */

describe('a play command that starts nothing', () => {
  /**
   * The state a real phone reported, and the one no event announces.
   *
   * Everything the application controls went right: the view opened, the player
   * was measured visible, it was ready, and a documented play command went out.
   * The player then stayed on its thumbnail behind YouTube's own red overlay —
   * no `onAutoplayBlocked`, no error, no state change at all. A browser may
   * decline a scripted start without saying so, and from the store that is
   * indistinguishable from a start still in flight.
   *
   * Confirming the outcome is what makes the two distinguishable, and it is
   * bounded: one attempt, then an honest cued state with one Play button.
   */
  async function silentlyRefusedHandOff() {
    const handedOff = handOff()
    observeAt(300, 0.95)
    await vi.advanceTimersByTimeAsync(150)
    // Every command is accepted and none of them starts anything, which is
    // precisely what a silent refusal looks like from here.
    silencePlayers()
    await vi.advanceTimersByTimeAsync(300 + START_CONFIRMATION_MS + 200)
    await handedOff
    return handedOff
  }

  it('gives up after one attempt and asks for a press', async () => {
    const handedOff = handOff()
    // Every player this factory builds from here on accepts commands and reports
    // nothing back, which is what a silent refusal looks like from the app.
    observeAt(300, 0.95)
    await vi.advanceTimersByTimeAsync(150)
    // From here it accepts every command and reports nothing back.
    silencePlayers()
    await vi.advanceTimersByTimeAsync(300 + START_CONFIRMATION_MS + 200)
    await handedOff

    expect(awaiting()).toBe('player-command-no-start')
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
    expect(status()).toBe('cued')
  })

  it('proves a play command was issued before giving up', async () => {
    const handedOff = handOff()
    observeAt(300, 0.95)
    await vi.advanceTimersByTimeAsync(150)
    silencePlayers()
    await vi.advanceTimersByTimeAsync(300 + START_CONFIRMATION_MS + 200)
    await handedOff

    expect(PLAY_COMMANDS).toContain(commands.at(-1))
    expect(lastTraceDetail('engine:outcome')?.outcome).toBe('timeout')
  })

  it('does not re-issue the command afterwards', async () => {
    const handedOff = handOff()
    observeAt(300, 0.95)
    await vi.advanceTimersByTimeAsync(150)
    silencePlayers()
    await vi.advanceTimersByTimeAsync(300 + START_CONFIRMATION_MS + 200)
    await handedOff
    const issued = commands.length

    await vi.advanceTimersByTimeAsync(10_000)
    expect(commands).toHaveLength(issued)
  })

  it('keeps the collection on this item rather than skipping it', async () => {
    await silentlyRefusedHandOff()
    expect(useYouTubeStore.getState().item?.videoId).toBe('aram0000001')
  })
})

describe('the generated iframe permission', () => {
  it('is recorded from the real frame, whichever way it comes out', async () => {
    const handedOff = handOff()
    observeAt(50, 0.92)
    await vi.advanceTimersByTimeAsync(400)
    await handedOff

    // A current API build sets `autoplay` itself, so this is the expected read —
    // and the point is that it is a read rather than an assumption.
    // Read from the frame after it exists: before the start there is no player
    // and therefore no frame, and a `null` there would say nothing at all.
    expect(lastTraceDetail('engine:iframe')?.allowsAutoplay).toBe(true)
  })

  it('is delegated when the API build did not include it', async () => {
    // A version of the script whose `allow` list omits the token.
    factory.allowAttribute = 'encrypted-media; picture-in-picture'

    const handedOff = handOff()
    observeAt(50, 0.92)
    await vi.advanceTimersByTimeAsync(400)
    await handedOff

    const frame = getYouTubeEngine().describeIframe()
    expect(frame?.allowsAutoplay).toBe(true)
    // And nothing the API put there was lost doing it.
    expect(frame?.allow).toContain('encrypted-media')
    expect(frame?.allow).toContain('picture-in-picture')
  })
})

/* ==========================================================================
   The exact sequence a physical phone reported
   ========================================================================== */

/**
 * `unstarted → buffering → unstarted → cued`, with no error and no
 * `onAutoplayBlocked` — the trace a real device produced while the diagnostic
 * panel claimed `outcome: started` beside `status: cued`.
 *
 * Those two statements cannot both be true, and the reason they appeared
 * together is the defect: the confirmation stopped watching at the first
 * `buffering` and called it success. Buffering is the player saying it accepted
 * the command and went to fetch content. Whether it then plays is a different
 * question, and here the answer was no.
 */
describe('the sequence a real phone reported', () => {
  /** Drives YouTube's own state numbers, in order, on the live player. */
  function emitStates(states: number[]) {
    const player = factory.current()
    for (const state of states) player?.emitState(state)
  }

  /** Accepts the command, reports nothing itself — the test drives the states. */
  function silentPlayer() {
    silencePlayers()
  }

  async function handOffThen(states: number[]) {
    const handedOff = handOff()
    observeAt(300, 0.95)
    await vi.advanceTimersByTimeAsync(150)
    silentPlayer()
    await vi.advanceTimersByTimeAsync(300)
    await handedOff
    emitStates(states)
    // Let the confirmation window run out if the states did not settle it.
    await vi.advanceTimersByTimeAsync(START_CONFIRMATION_MS + 200)
  }

  it('does not call buffering a success', async () => {
    await handOffThen([YT.UNSTARTED, YT.BUFFERING, YT.UNSTARTED, YT.CUED])

    expect(lastTraceDetail('engine:outcome')?.outcome).toBe('returned-to-cued')
    expect(lastTraceDetail('engine:outcome')?.outcome).not.toBe('started')
  })

  it('leaves the player cued and asking for a press, with the honest reason', async () => {
    await handOffThen([YT.UNSTARTED, YT.BUFFERING, YT.UNSTARTED, YT.CUED])

    expect(status()).toBe('cued')
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
    expect(awaiting()).toBe('player-returned-to-cued')
  })

  /**
   * The invariant that made the panel self-contradictory. `outcome: started`
   * beside `status: cued` must be impossible, whichever way the states fall.
   */
  it('never reports started while the store says cued', async () => {
    await handOffThen([YT.UNSTARTED, YT.BUFFERING, YT.UNSTARTED, YT.CUED])

    const outcome = lastTraceDetail('engine:outcome')?.outcome
    if (status() === 'cued') expect(outcome).not.toBe('started')
    if (outcome === 'started') expect(status()).toBe('playing')
  })

  it('does not retry the command after falling back', async () => {
    await handOffThen([YT.UNSTARTED, YT.BUFFERING, YT.UNSTARTED, YT.CUED])
    const issued = commands.length

    await vi.advanceTimersByTimeAsync(10_000)
    expect(commands).toHaveLength(issued)
  })

  it('keeps the collection on this item rather than skipping it', async () => {
    await handOffThen([YT.UNSTARTED, YT.BUFFERING, YT.UNSTARTED, YT.CUED])
    expect(useYouTubeStore.getState().item?.videoId).toBe('aram0000001')
  })

  it('confirms a start that genuinely reaches playing', async () => {
    await handOffThen([YT.UNSTARTED, YT.BUFFERING, YT.PLAYING])

    expect(lastTraceDetail('engine:outcome')?.outcome).toBe('started')
    expect(status()).toBe('playing')
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(false)
  })

  /**
   * A slow connection buffers for seconds before anything plays. That must not
   * be mistaken for a refusal — which is why the bound is generous and why
   * `buffering` merely keeps the watch open rather than ending it either way.
   */
  it('waits out a long buffer rather than calling it a refusal', async () => {
    const handedOff = handOff()
    observeAt(300, 0.95)
    await vi.advanceTimersByTimeAsync(150)
    silentPlayer()
    await vi.advanceTimersByTimeAsync(300)
    await handedOff

    factory.current()?.emitState(YT.BUFFERING)
    await vi.advanceTimersByTimeAsync(START_CONFIRMATION_MS - 1_000)
    // Still watching: no verdict either way while the player is working.
    expect(lastTraceDetail('engine:outcome')).toBeUndefined()

    factory.current()?.emitState(YT.PLAYING)
    await vi.advanceTimersByTimeAsync(50)

    expect(lastTraceDetail('engine:outcome')?.outcome).toBe('started')
    expect(status()).toBe('playing')
  })
})

/* ==========================================================================
   One authoritative media command
   ========================================================================== */

describe('the command an authorised automatic start issues', () => {
  /**
   * The preparation builds the *player*, not a cued video, so the hand-off is a
   * single `loadVideoById` rather than `cue → loadVideoById`. One authoritative
   * media command, at a player that holds nothing until it is given something.
   */
  it('is exactly one load, with no preparatory cue in front of it', async () => {
    const handedOff = handOff()
    observeAt(50, 0.92)
    await vi.advanceTimersByTimeAsync(400)
    await handedOff

    expect(commands).toEqual(['loadVideoById'])
  })

  /**
   * The reversal a physical device forced, and the reason it is asserted rather
   * than left to the implementation.
   *
   * This used to require the opposite: a player constructed *empty*, with the id
   * reaching it only through the load command. The reasoning was sound and the
   * documented constructor supports it — and on a real phone that construction
   * never emitted `onReady`, so nothing was ever built, no command was ever
   * issued, and Play did nothing. The video-seeded construction is the one a
   * direct click has always used and the one physical devices confirm works, so
   * the automatic path converges on it instead of keeping a lifecycle of its own.
   */
  it('builds the player around the video it is about to play', async () => {
    const handedOff = handOff()
    observeAt(50, 0.92)
    await vi.advanceTimersByTimeAsync(400)
    await handedOff

    expect(factory.players[0]?.options.videoId).toBe('aram0000001')
    // And still one authoritative media command, not a cue in front of a load.
    expect(commands).toEqual(['loadVideoById'])
  })

  /** The preparation loads the script, and builds nothing. */
  it('preloads the API script without constructing a player', async () => {
    const handedOff = handOff()

    // Before any measurement lands there is no player at all — only the script
    // request that used to be accompanied by an empty player that could hang.
    await vi.advanceTimersByTimeAsync(100)
    expect(factory.created).toBe(0)
    expect(factory.apiPrepared).toBeGreaterThan(0)
    expect(getYouTubeEngine().isApiReady()).toBe(true)
    expect(getYouTubeEngine().isReady()).toBe(false)

    observeAt(150, 0.92)
    await vi.advanceTimersByTimeAsync(400)
    await handedOff
    expect(factory.created).toBe(1)
  })

  /** A refusal still cues, because that is what a refusal is for. */
  it('still cues when the decision withholds playback', async () => {
    const handedOff = handOff()
    observeAt(50, 0.42)
    await vi.advanceTimersByTimeAsync(50 + VISIBILITY_SETTLE_MS + 100)
    await handedOff

    expect(commands.at(-1)).toBe('cue')
    expect(awaiting()).toBe('visibility')
  })
})
