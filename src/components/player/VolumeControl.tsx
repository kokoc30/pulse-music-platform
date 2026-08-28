import { ListMusic, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useUiStore } from '@/app/ui-store'
import { formatPercent } from '@/lib/format'
import { setVolume, toggleMute } from '@/player/player-actions'
import { useMuted, useVolume } from '@/player/player-selectors'
import { RangeRail } from './RangeRail'

/**
 * The reference's `.player-volume` cluster. The trailing `Speaker` glyph in the
 * reference is inert; it becomes the queue toggle here (docs/reference-deviations.md D-07).
 */
export function VolumeControl() {
  const volume = useVolume()
  const muted = useMuted()
  const queueOpen = useUiStore((s) => s.queueOpen)
  const toggleQueue = useUiStore((s) => s.toggleQueue)
  const effective = muted ? 0 : volume
  const Icon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2

  return (
    <div className="player-volume">
      <button
        type="button"
        onClick={() => toggleMute()}
        aria-label={muted ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
      >
        <Icon size={18} aria-hidden="true" />
      </button>
      <RangeRail
        value={effective}
        ariaLabel="Volume"
        ariaValueText={formatPercent(effective)}
        onChange={(next) => setVolume(next)}
      />
      <button
        type="button"
        onClick={toggleQueue}
        aria-label="Play queue"
        aria-pressed={queueOpen}
        aria-expanded={queueOpen}
      >
        <ListMusic size={17} aria-hidden="true" />
      </button>
    </div>
  )
}
