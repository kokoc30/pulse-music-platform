import { MINIMUM_DIMENSION } from './youtube-engine'
import { tracePlayback } from './playback-trace'

/**
 * How much of the YouTube player is actually on screen, and when that answer
 * can be trusted.
 *
 * This exists because one policy sentence needs a real measurement rather than
 * an assumption: *"An API Client must not initiate an automatic playback until
 * the player is visible and more than half of the player is visible on the page
 * or screen."* Deciding that from React state would be both slower and wrong —
 * an `IntersectionObserver` callback fires far more often than a render should,
 * and the value is needed at the instant a video ends, not at the instant the
 * component last rendered.
 *
 * So the ratio lives here, outside React: the stage writes it from its observer,
 * and `youtube-actions` reads it when it has to decide whether an automatic
 * transition is permitted.
 *
 * **The default is zero and unmeasured, not one.** Before anything has been
 * observed the answer to "is the player more than half visible?" must be *no*.
 * Every unknown resolves against autoplay, which is the same discipline
 * `mayAutoplay` applies (agents/21 → "If uncertain, cue … and require an
 * explicit play action").
 *
 * ## Three states, not two
 *
 * The distinction this module is built around, and the one a single number
 * cannot carry:
 *
 * | state | `measured` | `ratio` | means |
 * |---|---|---|---|
 * | no player yet | `false` | `0` | keep waiting — nothing has been observed |
 * | measured, too little | `true` | `0.31` | an answer: do not autoplay |
 * | measured, enough | `true` | `0.92` | an answer: autoplay is permitted |
 *
 * Collapsing the first two was the original defect: a hand-off from a catalogue
 * track read the ratio before any stage existed, got the initial zero, and
 * `mayAutoplay` refused a player that had simply not been built yet.
 *
 * ## Why the wait is settle-based rather than a flat timeout
 *
 * The first correction gave the wait a single 700ms deadline. That is fine on a
 * desktop and demonstrably fragile on a phone, where the expanded view mounts,
 * rises for 260ms, and then has its geometry changed *again* by the browser's
 * own address bar collapsing and by safe-area insets resolving. A flat deadline
 * has to be either too short for the slow case or needlessly slow for the common
 * one, and it answers the wrong question: what matters is not "has 700ms passed"
 * but "has the layout stopped moving".
 *
 * So the wait is driven by observations, not by the clock:
 *
 * · it resolves **immediately** the moment any observation clears the threshold;
 * · otherwise it waits for the layout to go quiet — `settleMs` after the *last*
 *   observation, armed only once the stage is really laid out and something has
 *   really been observed;
 * · and `timeoutMs` is a hard cap so nothing can wait for ever.
 *
 * A player that settles at 0.4 is answered in about `settleMs`, not in two
 * seconds. A player still being laid out at 900ms is still waited for. Neither
 * outcome involves a number this module invented.
 */

/** The observed intersection ratio, 0–1. */
let ratio = 0

/**
 * Whether anything has been observed at all.
 *
 * Distinct from `ratio === 0`, and the distinction is load-bearing: "the player
 * is off screen" and "there is no player yet" are both zero, but only the first
 * is an answer. A waiter must keep waiting through the second.
 */
let measured = false

/** How many observations this stage has produced. Diagnostics only. */
let observations = 0

/** The highest ratio seen for this stage. Diagnostics only. */
let peak = 0

/**
 * The element the observer is watching — the one that contains the live player.
 *
 * Held so a waiter can ask the question `nowPlayingOpen` cannot answer: is there
 * a *real, laid-out* player on the page yet? An element that is detached, or
 * still has a zero box because its container has not been through layout, is not
 * a player that is off screen; it is a player that does not exist yet, and the
 * two must not resolve the same way.
 */
let stage: Element | null = null

export interface YouTubeVisibility {
  /** True only when the measured ratio cleared the threshold that was asked for. */
  visible: boolean
  /** The ratio the decision was made on. Zero when nothing was ever observed. */
  ratio: number
  /** False when nothing was ever observed — an absent player, not a hidden one. */
  measured: boolean
  /** How long the caller waited, in milliseconds. */
  elapsedMs: number
  /** Why the wait ended, for the trace. */
  outcome: 'already-visible' | 'observed' | 'settled' | 'timeout' | 'stage-gone'
}

interface Waiter {
  minimumRatio: number
  settle: (outcome: YouTubeVisibility['outcome']) => void
  /** Re-armed on every observation; fires when the layout goes quiet. */
  onObservation: () => void
}

const waiters = new Set<Waiter>()

/** Called by the stage's `IntersectionObserver`. */
export function setYouTubeVisibleRatio(next: number): void {
  ratio = Number.isFinite(next) ? Math.min(Math.max(next, 0), 1) : 0
  measured = true
  observations += 1
  if (ratio > peak) peak = ratio
  tracePlayback('visibility:observed', { ratio, observations })

  for (const waiter of [...waiters]) {
    if (ratio > waiter.minimumRatio) {
      waiters.delete(waiter)
      waiter.settle('observed')
      continue
    }
    // Below the bar, but the layout is still moving: restart its quiet timer
    // rather than concluding anything from an intermediate frame.
    waiter.onObservation()
  }
}

/** The latest observed ratio, 0–1. Zero until something has been observed. */
export function youTubeVisibleRatio(): number {
  return ratio
}

/** True once a real observation has been recorded for the current stage. */
export function hasMeasuredYouTubeVisibility(): boolean {
  return measured
}

/** The whole current measurement, for the trace and for diagnostics. */
export function youTubeVisibilitySnapshot(): {
  ratio: number
  peak: number
  measured: boolean
  observations: number
  stageLaidOut: boolean
} {
  return { ratio, peak, measured, observations, stageLaidOut: youTubeStageIsLaidOut() }
}

/**
 * Registers the element the observer watches, so "is there a player yet" is
 * answerable without asking React.
 */
export function registerYouTubeStageElement(element: Element | null): void {
  stage = element
}

/**
 * Whether a real, displayed player box exists right now.
 *
 * Deliberately geometric rather than declarative. `nowPlayingOpen === true` says
 * the app *intends* to show a player; this says the browser has actually laid
 * one out, at a size the embed is allowed to be. Those diverge for exactly the
 * few frames that this whole timing problem lives in.
 */
export function youTubeStageIsLaidOut(): boolean {
  if (!stage || !stage.isConnected) return false
  const box = stage.getBoundingClientRect()
  // jsdom reports a zero box for everything, so a test environment with no
  // layout must not be mistaken for a stage that failed to lay out. The
  // observer having reported at all is the evidence that stands in for it.
  if (box.width === 0 && box.height === 0) return measured
  return box.width >= MINIMUM_DIMENSION && box.height >= MINIMUM_DIMENSION
}

/**
 * Reset when the stage unmounts, so a stale ratio cannot authorise autoplay.
 *
 * Anyone still waiting is answered rather than left hanging, and answered with
 * the truth: the surface they were waiting on has gone, so it is not visible.
 */
export function resetYouTubeVisibility(): void {
  ratio = 0
  peak = 0
  measured = false
  observations = 0
  stage = null
  for (const waiter of [...waiters]) {
    waiters.delete(waiter)
    waiter.settle('stage-gone')
  }
}

/**
 * How long the layout must be quiet before an insufficient ratio is an answer.
 *
 * Measured from the *last* observation, not from the start of the wait. One
 * animation frame is 16ms and the expanded view's rise is 260ms, so a quarter of
 * a second without the observer saying anything new means the geometry has
 * stopped moving — on a phone as much as on a desktop, because it is the device
 * that sets the pace rather than a constant chosen here.
 */
export const VISIBILITY_SETTLE_MS = 400

/**
 * The absolute upper bound on one wait.
 *
 * Two seconds, and it should almost never be reached: it is only hit when the
 * stage never lays out or the observer never fires at all. It replaces a flat
 * 700ms deadline that a real phone could miss — the expanded player mounting,
 * rising, and then being re-laid-out by browser chrome — while the settle rule
 * above keeps the common cases fast. A visitor who does hit it gets a cued,
 * visible player and one Play button, which is what the policy asks for when
 * visibility cannot be established.
 */
export const VISIBILITY_TIMEOUT_MS = 2_000

export interface WaitForVisibilityOptions {
  /** Strictly greater than this ratio counts as visible. */
  minimumRatio: number
  /** Quiet period after the last observation. Defaults to `VISIBILITY_SETTLE_MS`. */
  settleMs?: number
  /** Hard cap. Defaults to `VISIBILITY_TIMEOUT_MS`. */
  timeoutMs?: number
}

/**
 * Waits, bounded, for the real observer to report a player at least this
 * visible.
 *
 * Resolves immediately when the current measurement already clears the bar, so
 * a video following a video in an open player costs nothing at all. Otherwise it
 * resolves on the first observation that clears it, on the layout going quiet
 * below it, or on the hard cap — never with a number this module made up, and
 * never later than the cap.
 */
export function waitForYouTubeVisibility(
  options: WaitForVisibilityOptions,
): Promise<YouTubeVisibility> {
  const { minimumRatio } = options
  const settleMs = options.settleMs ?? VISIBILITY_SETTLE_MS
  const timeoutMs = options.timeoutMs ?? VISIBILITY_TIMEOUT_MS
  const startedAt = Date.now()

  const result = (outcome: YouTubeVisibility['outcome']): YouTubeVisibility => ({
    visible: measured && ratio > minimumRatio,
    ratio,
    measured,
    elapsedMs: Date.now() - startedAt,
    outcome,
  })

  if (measured && ratio > minimumRatio) return Promise.resolve(result('already-visible'))

  return new Promise<YouTubeVisibility>((resolve) => {
    let done = false
    let quiet: ReturnType<typeof setTimeout> | null = null

    const finish = (outcome: YouTubeVisibility['outcome']) => {
      if (done) return
      done = true
      if (quiet) clearTimeout(quiet)
      clearTimeout(cap)
      waiters.delete(waiter)
      const value = result(outcome)
      tracePlayback('visibility:resolved', { ...value })
      resolve(value)
    }

    /**
     * Arms the quiet timer, but only once there is something to be quiet
     * *about*: a stage that has actually been laid out and has actually been
     * observed. Before that, silence means "not ready yet", which is the case
     * the hard cap is for — and treating it as an answer is precisely the
     * mistake a flat deadline made.
     */
    const arm = () => {
      if (quiet) clearTimeout(quiet)
      if (!measured || !youTubeStageIsLaidOut()) return
      quiet = setTimeout(() => finish('settled'), settleMs)
    }

    const waiter: Waiter = { minimumRatio, settle: finish, onObservation: arm }
    const cap = setTimeout(() => finish('timeout'), timeoutMs)

    waiters.add(waiter)
    arm()
  })
}

/** True when the document itself is hidden — locked screen, background tab. */
export function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}
