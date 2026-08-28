import type { Track } from '@/music/types'
import { TrackRow } from './TrackRow'

interface TrackListProps {
  tracks: Track[]
  currentTrackId: string | null
  isPlaying: boolean
  onPlay: (track: Track, index: number) => void
  compact?: boolean
}

/** The reference's `.song-list`. */
export function TrackList({
  tracks,
  currentTrackId,
  isPlaying,
  onPlay,
  compact = false,
}: TrackListProps) {
  return (
    <div className="song-list" data-testid={compact ? 'queue-list' : 'track-list'}>
      {tracks.map((track, index) => (
        <TrackRow
          key={track.id}
          track={track}
          index={index}
          isCurrent={track.id === currentTrackId}
          isPlaying={isPlaying}
          compact={compact}
          onPlay={() => onPlay(track, index)}
        />
      ))}
    </div>
  )
}
