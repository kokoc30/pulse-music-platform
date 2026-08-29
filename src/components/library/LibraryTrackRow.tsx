import { ExternalLink } from 'lucide-react'
import { Artwork } from '@/components/track/Artwork'
import { Equalizer } from '@/components/track/Equalizer'
import { YouTubeThumbnail } from '@/components/youtube/YouTubeThumbnail'
import { formatDuration } from '@/lib/format'
import { canOfferForPlayback } from '@/library/selectors'
import { youTubeItemFromRef } from '@/library/track-ref'
import type { LibraryTrackRef } from '@/library/types'
import { providerLabel } from '@/music/provider-labels'
import { LikeButton } from './LikeButton'
import { TrackMenu } from './TrackMenu'
import type { PlaylistItemControls } from './TrackMenu'

interface LibraryTrackRowProps {
  trackRef: LibraryTrackRef
  index: number
  isCurrent: boolean
  isPlaying: boolean
  onPlay: () => void
  playlistControls?: PlaylistItemControls
  now?: number
}

/**
 * One saved item, in the reference's `.song-row` geometry.
 *
 * Structurally the same as `TrackRow` — a container with a stretched, painted-
 * nothing action button for keyboard and assistive technology, so the real
 * controls beside it can be genuine buttons and links. That constraint is why
 * neither row is one big `<button>`: an `<a>` may not nest inside a button, and
 * Jamendo's terms require a per-item backlink.
 *
 * A **YouTube** saved item is deliberately not disguised as a track. It keeps
 * its 16:9 thumbnail rather than square artwork, says *YouTube* in words, links
 * to the real watch page, and — once its 30-day retention has lapsed or its
 * status flags no longer permit an embed — loses its play affordance entirely
 * while staying visible so the visitor can remove it (agents/44).
 */
export function LibraryTrackRow({
  trackRef,
  index,
  isCurrent,
  isPlaying,
  onPlay,
  playlistControls,
  now = Date.now(),
}: LibraryTrackRowProps) {
  const isYouTube = trackRef.provider === 'youtube'
  const playable = canOfferForPlayback(trackRef, now)
  const youtubeItem = isYouTube ? youTubeItemFromRef(trackRef) : null
  // `providerLabel` only knows the audio catalogues, by design: YouTube is not a
  // `ProviderId` anywhere in this app, and naming it here rather than widening
  // that type keeps the distinction where it belongs.
  const source =
    trackRef.provider === 'youtube' ? 'YouTube' : providerLabel(trackRef.provider)

  const label = playable
    ? `Play ${trackRef.title} by ${trackRef.artist}`
    : `${trackRef.title} by ${trackRef.artist} is no longer available here`

  return (
    <div
      className="song-row library-row"
      data-provider={trackRef.provider}
      data-current={isCurrent ? 'true' : 'false'}
      data-streamable={playable ? 'true' : 'false'}
      aria-current={isCurrent ? 'true' : undefined}
      aria-disabled={playable ? undefined : 'true'}
      onClick={playable ? onPlay : undefined}
    >
      <button
        type="button"
        className="song-row-action"
        disabled={!playable}
        aria-label={label}
        onClick={onPlay}
      />

      <span className="song-index">
        {isCurrent ? <Equalizer paused={!isPlaying} /> : index + 1}
      </span>

      {isYouTube && youtubeItem ? (
        <span className="library-row-video">
          <YouTubeThumbnail item={youtubeItem} width={64} />
        </span>
      ) : (
        <Artwork
          artwork={{
            ...(trackRef.artwork?.url ? { small: trackRef.artwork.url } : {}),
            ...(trackRef.artwork?.mirrors?.length ? { mirrors: trackRef.artwork.mirrors } : {}),
          }}
          size="small"
        />
      )}

      <span className="song-data">
        <b title={trackRef.title}>{trackRef.title}</b>
        <small data-attributed="true">
          <span className="artist-name">{trackRef.artist}</span>
          {trackRef.sourceUrl ? (
            <span className="provider-credit">
              <a
                className="provider-credit-link"
                href={trackRef.sourceUrl}
                target="_blank"
                // `noopener` only: YouTube's Required Minimum Functionality says
                // an API client "must not use the noreferrer feature".
                rel="noopener"
                onClick={(event) => event.stopPropagation()}
                aria-label={`Open ${trackRef.title} on ${source}`}
              >
                {source} <ExternalLink size={10} aria-hidden="true" />
              </a>
            </span>
          ) : (
            <span className="provider-credit">{source}</span>
          )}
        </small>
      </span>

      <span className="song-duration">
        {playable ? formatDuration(trackRef.durationSeconds) : 'Unavailable'}
      </span>

      <span className="library-row-actions">
        <LikeButton
          itemKey={trackRef.key}
          title={trackRef.title}
          toRef={() => trackRef}
        />
        <TrackMenu
          title={trackRef.title}
          itemKey={trackRef.key}
          toRef={() => trackRef}
          {...(playlistControls ? { playlistControls } : {})}
        />
      </span>
    </div>
  )
}
