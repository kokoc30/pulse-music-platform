import type { Track } from '@/music/types'
import { Artwork } from './Artwork'
import { PlayAction } from './PlayAction'
import { ProviderCredit } from './ProviderCredit'

interface TrackCardProps {
  track: Track
  onPlay: () => void
  state?: 'idle' | 'loading' | 'playing'
}

/** The reference's square `.media-card`. */
export function TrackCard({ track, onPlay, state = 'idle' }: TrackCardProps) {
  return (
    <article className="media-card">
      <div className="art-wrap">
        <Artwork artwork={track.artwork} size="medium" />
        <PlayAction
          onClick={onPlay}
          state={state}
          disabled={!track.isStreamable}
          label={
            track.isStreamable
              ? `${state === 'playing' ? 'Pause' : 'Play'} ${track.title} by ${track.artistName}`
              : `${track.title} is not available to stream`
          }
        />
      </div>
      <h3 title={track.title}>{track.title}</h3>
      <p title={track.artistName}>
        {track.artistName}
        {/* Discovery shelves are Audius-only today, so this renders nothing —
            but a card is a rendered content item, and if a shelf ever carries a
            Jamendo track it must arrive already carrying its backlink rather
            than silently breaching the terms. The card root is an <article>, so
            a real anchor is valid here. */}
        <ProviderCredit track={track} variant="link" />
      </p>
    </article>
  )
}
