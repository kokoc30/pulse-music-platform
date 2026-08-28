import {
  COMPLETION_RATIO,
  EARLY_SKIP_SECONDS,
  QUALIFY_DURATION_RATIO,
  QUALIFY_MAX_SECONDS,
  QUALIFY_MIN_SECONDS,
} from './config'

/**
 * The one definition of "this listener actually listened to this".
 *
 * Clicking play is not a signal. The threshold is deliberately the *smaller* of
 * half a minute and a quarter of the track, so a long track qualifies quickly
 * and a short one still has to be genuinely heard:
 *
 * · a 4-minute song    → 30s  (`min(30, 60)`)
 * · a 60-second song   → 15s  (`min(30, 15)`)
 * · a 20-second jingle → 10s  (the floor)
 *
 * The floor is absolute. Content shorter than `QUALIFY_MIN_SECONDS` therefore
 * never qualifies at all, which is the intended behaviour: an eight-second
 * accidental playback must not train recommendations, and a piece of media that
 * is only eight seconds long carries the same amount of evidence.
 *
 * Nothing outside this module may compute a listen threshold.
 */
export function qualifyThresholdSeconds(durationSeconds?: number): number {
  if (
    typeof durationSeconds !== 'number' ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    // Unknown duration — a live stream, or metadata that never arrived.
    return QUALIFY_MAX_SECONDS
  }
  const proportional = durationSeconds * QUALIFY_DURATION_RATIO
  return Math.min(Math.max(Math.min(QUALIFY_MAX_SECONDS, proportional), QUALIFY_MIN_SECONDS), QUALIFY_MAX_SECONDS)
}

/** Whether accumulated listening time has earned a qualified listen. */
export function isQualifiedListen(playedSeconds: number, durationSeconds?: number): boolean {
  if (!Number.isFinite(playedSeconds) || playedSeconds <= 0) return false
  return playedSeconds >= qualifyThresholdSeconds(durationSeconds)
}

/**
 * Whether abandoning a play here is an early skip.
 *
 * A skip only counts as negative evidence when the item never qualified *and*
 * was dropped inside the early window. Leaving a track after three minutes is
 * not a rejection of it.
 */
export function isEarlySkip(playedSeconds: number, durationSeconds?: number): boolean {
  if (!Number.isFinite(playedSeconds) || playedSeconds <= 0) return false
  if (isQualifiedListen(playedSeconds, durationSeconds)) return false
  return playedSeconds <= EARLY_SKIP_SECONDS
}

/** Fraction of the item heard on one play, clamped to 0–1. */
export function completionRatioFor(playedSeconds: number, durationSeconds?: number): number {
  if (
    typeof durationSeconds !== 'number' ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isFinite(playedSeconds) ||
    playedSeconds <= 0
  ) {
    return 0
  }
  return Math.min(playedSeconds / durationSeconds, 1)
}

export function isCompletion(playedSeconds: number, durationSeconds?: number): boolean {
  return completionRatioFor(playedSeconds, durationSeconds) >= COMPLETION_RATIO
}
