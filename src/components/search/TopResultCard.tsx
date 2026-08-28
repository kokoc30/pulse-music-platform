import type { Track } from '@/music/types'
import { Artwork } from '@/components/track/Artwork'
import { PlayAction } from '@/components/track/PlayAction'
import { ProviderCredit } from '@/components/track/ProviderCredit'

interface TopResultCardProps {
  track: Track
  state: 'idle' | 'loading' | 'playing'
  onPlay: () => void
}

/** The reference's `.top-result-card`, promoted to a real button for keyboard use. */
export function TopResultCard({ track, state, onPlay }: TopResultCardProps) {
  return (
    <article className="top-result-card">
      <Artwork artwork={track.artwork} size="medium" loading="eager" />
      <div>
        <p className="track-kicker">Song</p>
        <h3 title={track.title}>{track.title}</h3>
        <p title={track.artistName}>
          {track.artistName}
          {/* The required Jamendo backlink: this card is an <article>, so a real
              anchor is valid here (agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md). */}
          <ProviderCredit track={track} variant="link" />
        </p>
      </div>
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
    </article>
  )
}
