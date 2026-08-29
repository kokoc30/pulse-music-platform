import { LikeButton } from '@/components/library/LikeButton'
import { TrackMenu } from '@/components/library/TrackMenu'
import { trackRefFromTrack } from '@/library/track-ref'
import type { Track } from '@/music/types'
import { Artwork } from './Artwork'
import { PlayAction } from './PlayAction'
import { ProviderCredit } from './ProviderCredit'

interface TrackCardProps {
  track: Track
  onPlay: () => void
  state?: 'idle' | 'loading' | 'playing'
  /**
   * Offered on generated recommendation shelves, where *Not interested* is
   * meaningful. A trending or chart card is not a recommendation about the
   * visitor, so hiding one there would have nothing to act on.
   */
  canHide?: boolean
}

/**
 * The reference's square `.media-card`.
 *
 * Phase 7 adds the library actions in the corner of the artwork rather than
 * under the title: the reference's type block is two tight lines with fixed
 * leading, and adding a control row beneath it would change every shelf's height
 * across all four breakpoints. The corner cluster leaves the grid untouched.
 */
export function TrackCard({ track, onPlay, state = 'idle', canHide = false }: TrackCardProps) {
  return (
    <article className="media-card">
      <div className="art-wrap">
        <Artwork artwork={track.artwork} size="medium" />
        <span className="card-actions">
          <LikeButton
            itemKey={track.id}
            title={track.title}
            toRef={() => trackRefFromTrack(track)}
          />
          <TrackMenu
            title={track.title}
            itemKey={track.id}
            toRef={() => trackRefFromTrack(track)}
            canHide={canHide}
          />
        </span>
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
