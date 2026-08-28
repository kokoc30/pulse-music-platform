import { ExternalLink } from 'lucide-react'
import { Artwork } from '@/components/track/Artwork'
import { PlayAction } from '@/components/track/PlayAction'
import { YouTubeThumbnail } from '@/components/youtube/YouTubeThumbnail'
import { providerLabel } from '@/music/provider-labels'
import { historyArtwork } from '@/personalization/artwork'
import { toYouTubeItem } from '@/personalization/replay'
import type { ListenEntry } from '@/personalization/types'

interface HistoryCardProps {
  entry: ListenEntry
  onPlay: () => void
  state?: 'idle' | 'loading' | 'playing'
}

/**
 * One Recently Played card.
 *
 * Reuses the reference's `.media-card` geometry — same grid column, same title
 * and subtitle scale, same hover and play affordance — so the shelf reads as
 * part of the original design rather than a bolt-on.
 *
 * The one deliberate difference is the artwork box, and it is a policy
 * requirement rather than a style choice: a YouTube entry keeps its 16:9
 * thumbnail, letterboxed inside the square tile, and is labelled *YouTube* with
 * a link to the watch page. Cropping it to a square would present a video as an
 * album cover, which Phase 3 explicitly avoided and this phase does not undo
 * (STEP 24; docs/reference-deviations.md D-33).
 */
export function HistoryCard({ entry, onPlay, state = 'idle' }: HistoryCardProps) {
  const isYouTube = entry.provider === 'youtube'
  const youtubeItem = isYouTube ? toYouTubeItem(entry) : null

  return (
    <article className="media-card history-card" data-provider={entry.provider}>
      <div className={isYouTube ? 'art-wrap art-wrap-video' : 'art-wrap'}>
        {isYouTube && youtubeItem ? (
          <YouTubeThumbnail item={youtubeItem} width="fill" />
        ) : (
          // The same `Artwork` component every other card uses, given the same
          // shape: primary URL plus the mirror origins to fail over to. That is
          // what makes a history card render exactly whenever a track card for
          // the same song would, rather than blanking on the first dead node.
          <Artwork artwork={historyArtwork(entry)} size="medium" />
        )}
        <PlayAction
          onClick={onPlay}
          state={state}
          label={`${state === 'playing' ? 'Pause' : 'Play'} ${entry.title} by ${entry.artist}`}
        />
      </div>
      <h3 title={entry.title}>{entry.title}</h3>
      <p title={entry.artist}>
        {entry.artist}
        {entry.sourceUrl ? (
          <>
            {' · '}
            <a
              className="card-source-link"
              href={entry.sourceUrl}
              target="_blank"
              // `noopener` only: YouTube's Required Minimum Functionality says an
              // API client "must not use the noreferrer feature".
              rel="noopener"
              aria-label={`Open ${entry.title} on ${isYouTube ? 'YouTube' : providerLabel(entry.provider === 'jamendo' ? 'jamendo' : 'audius')}`}
            >
              {isYouTube ? 'YouTube' : providerLabel(entry.provider === 'jamendo' ? 'jamendo' : 'audius')}{' '}
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          </>
        ) : null}
      </p>
    </article>
  )
}

