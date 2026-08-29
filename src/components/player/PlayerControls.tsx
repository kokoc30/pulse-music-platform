import { Loader2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { playPrevious, skipToNext, togglePlay } from '@/player/player-actions'
import {
  useCanSkipNext,
  useHasPrevious,
  useIsLoading,
  useIsPlaying,
  useRepeatMode,
  useShuffle,
} from '@/player/player-selectors'
import { usePlayerStore } from '@/player/player-store'
import { REPEAT_LABELS } from '@/player/queue-order'
import { PlayerProgress } from './PlayerProgress'

/**
 * The reference's `.player-controls` block: prev / round play / next + progress,
 * now flanked by shuffle and repeat.
 *
 * Both new controls are state, not commands: they change how `playNext` chooses,
 * and nothing else. That is why the lock screen's Next honours them for free —
 * it calls the same `playNext` this bar does, and the precedence lives there
 * rather than in either caller (agents/45 → "Media Session").
 *
 * Repeat is a three-state button rather than two, so it is labelled with its
 * *current* state and cycles on press; `aria-pressed` marks it active for
 * anything other than off, and the accessible name says which mode is on.
 */
export function PlayerControls() {
  const isPlaying = useIsPlaying()
  const isLoading = useIsLoading()
  const canSkipNext = useCanSkipNext()
  const hasPrevious = useHasPrevious()
  const shuffle = useShuffle()
  const repeatMode = useRepeatMode()
  const setShuffle = usePlayerStore((state) => state.setShuffle)
  const cycleRepeatMode = usePlayerStore((state) => state.cycleRepeatMode)

  return (
    <div className="player-controls">
      <div>
        <button
          type="button"
          className="player-toggle"
          data-active={shuffle ? 'true' : 'false'}
          aria-pressed={shuffle}
          aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
          title={shuffle ? 'Shuffle on' : 'Shuffle off'}
          onClick={() => setShuffle(!shuffle)}
        >
          <Shuffle size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => void playPrevious()}
          disabled={!hasPrevious}
          aria-label="Previous track"
        >
          <SkipBack size={18} fill="currentColor" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="round-play"
          onClick={() => void togglePlay()}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isLoading ? (
            <Loader2 size={19} className="spin" aria-hidden="true" />
          ) : isPlaying ? (
            <Pause size={19} fill="currentColor" aria-hidden="true" />
          ) : (
            <Play size={19} fill="currentColor" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => void skipToNext()}
          disabled={!canSkipNext}
          aria-label="Next track"
        >
          <SkipForward size={18} fill="currentColor" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="player-toggle"
          data-active={repeatMode === 'off' ? 'false' : 'true'}
          aria-pressed={repeatMode !== 'off'}
          aria-label={REPEAT_LABELS[repeatMode]}
          title={REPEAT_LABELS[repeatMode]}
          onClick={cycleRepeatMode}
        >
          {repeatMode === 'one' ? (
            <Repeat1 size={16} aria-hidden="true" />
          ) : (
            <Repeat size={16} aria-hidden="true" />
          )}
        </button>
      </div>
      <PlayerProgress />
    </div>
  )
}
