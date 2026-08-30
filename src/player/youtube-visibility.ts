/**
 * How much of the YouTube player is actually on screen.
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
 * ## Why there is a *wait* here as well as a read
 *
 * A synchronous read answers correctly only when the player already exists and
 * has already been measured. That is true for a video following a video, and it
 * is false for the transition this module was extended for: a saved list moving
 * from a catalogue track to a saved video. At the moment the collection decides
 * the video is next there is no player at all — the stage has not mounted, no
 * observer has run, and the honest answer to "how visible is the player" is
 * *there isn't one*. Reading the ratio there and treating the zero as a
 * measurement is what silently cued every automatic hand-off into YouTube.
 *
 * `waitForYouTubeVisibility` is the other half: the caller reveals the surface
 * first and then waits, bounded, for the *real* observer to report on the
 * geometry that now exists. Nothing here invents a ratio, and a wait that times
 * out reports exactly what was last measured — which, when nothing was, is zero.
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

export interface YouTubeVisibility {
  /** True only when the measured ratio cleared the threshold that was asked for. */
  visible: boolean
  /** The ratio the decision was made on. Zero when nothing was ever observed. */
  ratio: number
}

interface Waiter {
  minimumRatio: number
  settle: (result: YouTubeVisibility) => void
}

const waiters = new Set<Waiter>()

function settleWaiters(): void {
  if (waiters.size === 0) return
  for (const waiter of [...waiters]) {
    if (ratio > waiter.minimumRatio) {
      waiters.delete(waiter)
      waiter.settle({ visible: true, ratio })
    }
  }
}

/** Called by the stage's `IntersectionObserver`. */
export function setYouTubeVisibleRatio(next: number): void {
  ratio = Number.isFinite(next) ? Math.min(Math.max(next, 0), 1) : 0
  measured = true
  settleWaiters()
}

/** The latest observed ratio, 0–1. Zero until something has been observed. */
export function youTubeVisibleRatio(): number {
  return ratio
}

/** True once a real observation has been recorded for the current stage. */
export function hasMeasuredYouTubeVisibility(): boolean {
  return measured
}

/**
 * Reset when the stage unmounts, so a stale ratio cannot authorise autoplay.
 *
 * Anyone still waiting is answered rather than left hanging, and answered with
 * the truth: the surface they were waiting on has gone, so it is not visible.
 */
export function resetYouTubeVisibility(): void {
  ratio = 0
  measured = false
  for (const waiter of [...waiters]) {
    waiters.delete(waiter)
    waiter.settle({ visible: false, ratio: 0 })
  }
}

/**
 * How long a reveal may take before the wait gives up and cues instead.
 *
 * Long enough to cover a mount plus the expanded view's 260ms rise on a slow
 * device; short enough that a visitor never sits in front of a stalled player
 * wondering whether anything is going to happen. A timeout is not a failure —
 * it resolves to whatever was actually measured, and an unmeasured surface
 * resolves to *cue and wait for a press*, which is what the policy asks for.
 */
export const VISIBILITY_SETTLE_TIMEOUT_MS = 700

export interface WaitForVisibilityOptions {
  /** Strictly greater than this ratio counts as visible. */
  minimumRatio: number
  timeoutMs?: number
}

/**
 * Waits, bounded, for the real observer to report a player at least this visible.
 *
 * Resolves immediately when the current measurement already clears the bar, so
 * a video following a video costs nothing. Otherwise it resolves on the first
 * observation that does, or on the timeout with whatever the latest measurement
 * is — never with a number this module made up, and never later than the bound.
 */
export function waitForYouTubeVisibility(
  options: WaitForVisibilityOptions,
): Promise<YouTubeVisibility> {
  const { minimumRatio } = options
  if (measured && ratio > minimumRatio) return Promise.resolve({ visible: true, ratio })

  return new Promise<YouTubeVisibility>((resolve) => {
    let done = false
    const waiter: Waiter = {
      minimumRatio,
      settle: (result) => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(result)
      },
    }
    const timer = setTimeout(() => {
      waiters.delete(waiter)
      waiter.settle({ visible: measured && ratio > minimumRatio, ratio })
    }, options.timeoutMs ?? VISIBILITY_SETTLE_TIMEOUT_MS)

    waiters.add(waiter)
  })
}

/** True when the document itself is hidden — locked screen, background tab. */
export function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}
