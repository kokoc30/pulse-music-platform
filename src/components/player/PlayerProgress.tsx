import { formatDuration, formatTimeAnnouncement } from '@/lib/format'
import { seek } from '@/player/player-actions'
import { useCurrentTime, useDuration, useProgressRatio } from '@/player/player-selectors'
import { RangeRail } from './RangeRail'

/**
 * The reference's `.progress` row. Time and fill come from the real audio
 * element — nothing here fakes progress.
 */
export function PlayerProgress() {
  const currentTime = useCurrentTime()
  const duration = useDuration()
  const ratio = useProgressRatio()
  const seekable = duration > 0

  return (
    <div className="progress">
      <span>{formatDuration(currentTime)}</span>
      <RangeRail
        value={ratio}
        disabled={!seekable}
        step={0.02}
        ariaLabel="Seek"
        ariaValueText={formatTimeAnnouncement(currentTime, duration)}
        onChange={(next) => seek(next * duration)}
      />
      <span>{formatDuration(duration)}</span>
    </div>
  )
}
