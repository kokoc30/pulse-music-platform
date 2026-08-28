import { Loader2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { playNext, playPrevious, togglePlay } from '@/player/player-actions'
import {
  useHasNext,
  useHasPrevious,
  useIsLoading,
  useIsPlaying,
} from '@/player/player-selectors'
import { PlayerProgress } from './PlayerProgress'

/** The reference's `.player-controls` block: prev / round play / next + progress. */
export function PlayerControls() {
  const isPlaying = useIsPlaying()
  const isLoading = useIsLoading()
  const hasNext = useHasNext()
  const hasPrevious = useHasPrevious()

  return (
    <div className="player-controls">
      <div>
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
          onClick={() => void playNext()}
          disabled={!hasNext}
          aria-label="Next track"
        >
          <SkipForward size={18} fill="currentColor" aria-hidden="true" />
        </button>
      </div>
      <PlayerProgress />
    </div>
  )
}
