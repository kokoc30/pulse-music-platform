import { qualifyThresholdSeconds } from './qualification'
import type { PlaySession, PlayedItem } from './history'

/**
 * Turns a stream of playback positions into `PlaySession`s.
 *
 * **Time heard is accumulated from position deltas, never read off the
 * playhead.** Dragging the scrubber to 3:45 of a four-minute track moves the
 * position by 200 seconds in one tick; this tracker adds nothing for that,
 * because a jump larger than `MAX_TICK_SECONDS` is a seek rather than listening.
 * Scrubbing to the end therefore cannot manufacture a qualified listen, and a
 * backwards seek cannot subtract one (STEP 28 → "seeking does not produce
 * impossible playedSeconds").
 *
 * **A play is committed at most twice.** Once the instant it crosses the
 * qualification threshold — so the home page can react while the track is still
 * playing (STEP 15) — and once when it finishes, is skipped, or is replaced.
 * Between those two moments the tracker touches nothing but its own local
 * counters, so a `timeupdate` firing four times a second costs no storage
 * traffic and no re-render (STEP 26).
 *
 * The tracker is deliberately free of React, storage and the player stores: it
 * is fed positions and emits sessions, which is what makes every threshold case
 * testable without a browser.
 */

/**
 * The largest position change one tick may contribute.
 *
 * Generous enough for a throttled background timer, far smaller than any
 * meaningful seek.
 */
export const MAX_TICK_SECONDS = 5

export interface TrackerSession {
  item: PlayedItem
  startedAt: number
  playedSeconds: number
  reachedSeconds: number
  lastPosition: number
  /** Seconds already folded into history by the qualification commit. */
  creditedSeconds: number
  qualified: boolean
}

export type SessionSink = (session: PlaySession) => void

export interface ListenTracker {
  /** Begins a new play session, finalizing any session already in progress. */
  start: (item: PlayedItem, now?: number) => void
  /** One playback position sample. */
  progress: (positionSeconds: number, now?: number) => void
  /** The media reported `ended`. */
  complete: (now?: number) => void
  /** Playback stopped without finishing: a skip, a stop, or a navigation away. */
  stop: (now?: number) => void
  /** The item currently being tracked, or null. */
  current: () => PlayedItem | null
  /** Test/inspection seam. */
  snapshot: () => TrackerSession | null
}

export function createListenTracker(emit: SessionSink): ListenTracker {
  let session: TrackerSession | null = null

  const toPlaySession = (
    active: TrackerSession,
    endedAt: number,
    completed: boolean,
  ): PlaySession => ({
    item: active.item,
    playedSeconds: active.playedSeconds,
    creditedSeconds: active.creditedSeconds,
    reachedSeconds: active.reachedSeconds,
    startedAt: active.startedAt,
    endedAt,
    completed,
  })

  const finalize = (endedAt: number, completed: boolean) => {
    const active = session
    session = null
    if (!active) return
    // Nothing heard at all, and nothing already credited: there is no signal
    // here, not even a weak one. Opening a track and closing it is not an event.
    if (active.playedSeconds <= 0) return
    // Everything was already credited and there is nothing new to say.
    if (active.creditedSeconds >= active.playedSeconds && !completed) return
    emit(toPlaySession(active, endedAt, completed))
  }

  return {
    start: (item, now = Date.now()) => {
      finalize(now, false)
      session = {
        item,
        startedAt: now,
        playedSeconds: 0,
        reachedSeconds: 0,
        lastPosition: 0,
        creditedSeconds: 0,
        qualified: false,
      }
    },

    progress: (positionSeconds, now = Date.now()) => {
      const active = session
      if (!active) return
      if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return

      const delta = positionSeconds - active.lastPosition
      active.lastPosition = positionSeconds
      active.reachedSeconds = Math.max(active.reachedSeconds, positionSeconds)

      // A negative delta is a rewind and a huge one is a scrub; neither is time
      // spent listening, so both move the cursor without crediting anything.
      if (delta > 0 && delta <= MAX_TICK_SECONDS) active.playedSeconds += delta

      if (active.qualified) return
      if (active.playedSeconds < qualifyThresholdSeconds(active.item.durationSeconds)) return

      // The single mid-play write: the moment this became a real listen.
      active.qualified = true
      emit(toPlaySession(active, now, false))
      active.creditedSeconds = active.playedSeconds
    },

    complete: (now = Date.now()) => finalize(now, true),
    stop: (now = Date.now()) => finalize(now, false),
    current: () => session?.item ?? null,
    snapshot: () => session,
  }
}
