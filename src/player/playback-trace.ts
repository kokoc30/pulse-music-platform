/**
 * A compact, in-memory trace of one playback transition.
 *
 * This exists because the reported failure cannot be diagnosed from its
 * symptom. "The video did not start" has at least two entirely different
 * causes, which need opposite fixes:
 *
 * · **Visibility or timing.** The `IntersectionObserver` had not yet reported a
 *   ratio above the threshold when the bounded wait gave up, so the app never
 *   asked the player to play. The app is at fault, and the reveal/measure timing
 *   is what to change.
 * · **A real autoplay block.** The player was visible, ready, and genuinely
 *   asked to play — and the browser refused, because an unmuted cross-origin
 *   media start minutes after the last gesture is exactly what mobile autoplay
 *   policies exist to prevent. The app is *not* at fault, and changing the
 *   visibility code would only paper over it.
 *
 * Guessing between those two is how the wrong layer gets "fixed". So every step
 * of a transition records what it actually observed, and the trace can be read
 * back — by a test, or by a visitor running a debug build on the phone that
 * reproduces it.
 *
 * ## What this is not
 *
 * Not logging, and not shipped console noise. Recording is a push onto a capped
 * array and nothing else; the console and the on-screen readout are silent
 * unless the debug flag is on. Nothing here changes a decision, and nothing here
 * is read by playback logic — a trace that could alter behaviour would be a
 * second, invisible source of truth.
 */

/** One recorded step. `at` is milliseconds since the transition began. */
export interface PlaybackTraceEvent {
  at: number
  step: string
  detail?: Record<string, unknown>
}

/**
 * How many steps one transition may record.
 *
 * A transition is a dozen or so steps; the cap exists so a page left open for a
 * day cannot grow this without bound, not because a normal trace approaches it.
 */
const MAX_EVENTS = 120

let events: PlaybackTraceEvent[] = []
let startedAt = 0
let label: string | null = null
let debug: boolean | null = null

/** Milliseconds since the current trace began. Monotonic where available. */
function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * Whether the diagnostic build is switched on.
 *
 * `?debugPlayback=1` for a one-off run, or `pulse.debugPlayback` in
 * `localStorage` so a physical-device session survives the reloads a real test
 * involves. Read once and cached: this is consulted on every recorded step, and
 * parsing a URL each time would make the instrument expensive enough to change
 * what it measures.
 */
export function isPlaybackDebugEnabled(): boolean {
  if (debug !== null) return debug
  debug = false
  try {
    if (typeof window !== 'undefined') {
      if (new URLSearchParams(window.location.search).get('debugPlayback') === '1') debug = true
      else if (window.localStorage.getItem('pulse.debugPlayback') === '1') debug = true
    }
  } catch {
    // A context with storage disabled is simply not a debug context.
  }
  return debug
}

/** Test seam, and the switch the debug overlay writes. */
export function setPlaybackDebug(enabled: boolean | null): void {
  debug = enabled
}

/**
 * Starts a fresh trace.
 *
 * One transition at a time, deliberately: the question this answers is always
 * "what happened during *this* hand-off", and a rolling buffer across several
 * would bury it.
 */
export function beginPlaybackTrace(next: string): void {
  events = []
  startedAt = now()
  label = next
  record('begin', { label: next })
}

/** Records one step. Cheap enough to call unconditionally. */
export function tracePlayback(step: string, detail?: Record<string, unknown>): void {
  record(step, detail)
}

function record(step: string, detail?: Record<string, unknown>): void {
  if (events.length >= MAX_EVENTS) return
  const event: PlaybackTraceEvent = detail
    ? { at: Math.round(now() - startedAt), step, detail }
    : { at: Math.round(now() - startedAt), step }
  events.push(event)
  if (!isPlaybackDebugEnabled()) return
  // eslint-disable-next-line no-console -- the whole point of the debug build.
  console.info(`[pulse:playback] +${event.at}ms ${step}`, detail ?? '')
}

/** The current trace, oldest first. */
export function playbackTrace(): readonly PlaybackTraceEvent[] {
  return events
}

/** What the current trace is of, or null when nothing has been traced. */
export function playbackTraceLabel(): string | null {
  return label
}

/** The most recent detail recorded for a step, or undefined. */
export function lastTraceDetail(step: string): Record<string, unknown> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.step === step) return events[index]?.detail
  }
  return undefined
}

/** True when a step was recorded at all — "did this even happen". */
export function tracedSteps(): string[] {
  return events.map((event) => event.step)
}

/**
 * Every value a repeated step recorded, oldest first.
 *
 * The two sequences a diagnosis is read from are histories rather than single
 * values: the commands this application issued, and the states YouTube reported
 * back. A successful start looks like `cue → loadVideoById` against
 * `cued → buffering → playing`; the reported failure looks like the same
 * commands against a sequence that stops at `cued`. Only the pair says which.
 */
export function tracedValues(step: string, key: string): string[] {
  const values: string[] = []
  for (const event of events) {
    if (event.step !== step) continue
    const value = event.detail?.[key]
    if (typeof value === 'string') values.push(value)
  }
  return values
}

/** Test seam. */
export function resetPlaybackTrace(): void {
  events = []
  startedAt = now()
  label = null
}
