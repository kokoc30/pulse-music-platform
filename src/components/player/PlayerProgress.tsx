import { useCallback, useRef, useState } from 'react'
import { formatDuration, formatTimeAnnouncement } from '@/lib/format'
import { seek } from '@/player/player-actions'
import { useCurrentTime, useDuration } from '@/player/player-selectors'
import { RangeRail } from './RangeRail'

/**
 * The reference's `.progress` row, and the Now Playing sheet's scrubber.
 *
 * **One implementation, two sizes.** The bar and the sheet differ by a class
 * name, not by a second component: a fork would mean two seek paths, two sets of
 * clamping and two chances for the displayed position to disagree with the audio
 * element. `variant` changes the wrapper and nothing else.
 *
 * Time and fill come from the real audio element — nothing here fakes progress.
 */

/**
 * Keyboard granularity, in seconds.
 *
 * The rail is a normalized 0–1 control, so a fixed ratio step means a different
 * number of seconds on every track: the old 0.02 was two seconds on a 100-second
 * song and eight on a 400-second one. Deriving the step from the duration makes
 * an arrow key mean one second, always, which is what a scrubber is expected to
 * do and what makes it usable without a pointer.
 */
export const SEEK_ARROW_SECONDS = 1
/** PageUp/PageDown, in seconds. A useful jump rather than a nudge. */
export const SEEK_PAGE_SECONDS = 10

/**
 * Minimum gap between real `currentTime` writes while dragging.
 *
 * A pointer drag fires far faster than an audio element wants to be re-seeked,
 * and every write restarts buffering. The thumb still follows the finger exactly
 * — that is local state — while the engine is asked at a sane rate, and the
 * final position is always committed on release, so where the drag *ends* is
 * never approximate.
 */
export const SEEK_DRAG_THROTTLE_MS = 120

interface PlayerProgressProps {
  /** `bar` is the bottom player; `sheet` is the expanded Now Playing view. */
  variant?: 'bar' | 'sheet'
}

export function PlayerProgress({ variant = 'bar' }: PlayerProgressProps) {
  const currentTime = useCurrentTime()
  const duration = useDuration()
  const seekable = duration > 0

  /** Where the thumb is while a drag is in progress, in seconds. */
  const [preview, setPreview] = useState<number | null>(null)
  const lastWriteRef = useRef(0)

  const displayed = preview ?? currentTime
  const ratio = seekable ? Math.min(Math.max(displayed / duration, 0), 1) : 0

  const handleChange = useCallback(
    (nextRatio: number) => {
      if (!seekable) return
      const seconds = nextRatio * duration
      setPreview(seconds)

      const now = Date.now()
      if (now - lastWriteRef.current < SEEK_DRAG_THROTTLE_MS) return
      lastWriteRef.current = now
      seek(seconds)
    },
    [duration, seekable],
  )

  const handleCommit = useCallback(
    (nextRatio: number) => {
      if (!seekable) return
      // The exact release position, unthrottled and unconditional.
      lastWriteRef.current = Date.now()
      seek(nextRatio * duration)
      setPreview(null)
    },
    [duration, seekable],
  )

  return (
    <div className={variant === 'sheet' ? 'progress progress-sheet' : 'progress'}>
      <span>{formatDuration(displayed)}</span>
      <RangeRail
        value={ratio}
        disabled={!seekable}
        // Seconds expressed as a share of this track's length.
        step={seekable ? SEEK_ARROW_SECONDS / duration : 0.02}
        pageStep={seekable ? SEEK_PAGE_SECONDS / duration : 0.1}
        className={variant === 'sheet' ? 'rail-seek' : undefined}
        ariaLabel="Seek"
        ariaValueText={formatTimeAnnouncement(displayed, duration)}
        onChange={handleChange}
        onCommit={handleCommit}
      />
      <span>{formatDuration(duration)}</span>
    </div>
  )
}
