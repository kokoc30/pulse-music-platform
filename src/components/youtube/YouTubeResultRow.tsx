import { ExternalLink, Play } from 'lucide-react'
import { formatDuration } from '@/lib/format'
import { canEmbedYouTubeItem, embedBlockReason } from '@/music/youtube'
import type { YouTubeVideoItem } from '@/music/types'
import { YouTubeThumbnail } from './YouTubeThumbnail'

interface YouTubeResultRowProps {
  item: YouTubeVideoItem
  isCurrent: boolean
  isPlaying: boolean
  onPlay: () => void
}

/** 16:9 at the row density the reference's `.song-row` uses: 80 × 45. */
export const ROW_THUMBNAIL_WIDTH = 80

/**
 * One YouTube search result.
 *
 * Structurally close to the reference's `.song-row` — same height rhythm, same
 * hover, same type scale — but deliberately *not* disguised as one. It carries a
 * 16:9 thumbnail instead of square artwork, a channel name instead of an artist,
 * a plain-text **YouTube** source label, and a real link to the watch page. A
 * visitor can never mistake it for an Audius or Jamendo track
 * (agents/25 → "Results Section"; docs/reference-deviations.md D-28 … D-32).
 *
 * Like `TrackRow`, the row is a container with two separate real controls rather
 * than one big button: an `<a>` may not live inside a `<button>`, and the
 * YouTube backlink is not optional.
 *
 * An item that may not be embedded — embedding off, made for kids, live — has no
 * play control at all. Its only affordance is the external link, and the reason
 * is stated in words (docs/youtube-policy-audit.md §9).
 */
export function YouTubeResultRow({ item, isCurrent, isPlaying, onPlay }: YouTubeResultRowProps) {
  const embeddable = canEmbedYouTubeItem(item)
  const blockedReason = embedBlockReason(item)

  return (
    <div
      className="yt-row"
      data-current={isCurrent ? 'true' : 'false'}
      data-embeddable={embeddable ? 'true' : 'false'}
      data-testid="youtube-result"
      aria-current={isCurrent ? 'true' : undefined}
      onClick={embeddable ? onPlay : undefined}
    >
      {embeddable ? (
        <button
          type="button"
          className="yt-row-action"
          aria-label={`Play ${item.title} by ${item.channelTitle} on the YouTube player`}
          onClick={onPlay}
        />
      ) : null}

      <span className="yt-row-art">
        <YouTubeThumbnail item={item} width={ROW_THUMBNAIL_WIDTH} />
        {embeddable ? (
          <span className="yt-row-play" aria-hidden="true">
            <Play size={14} fill="currentColor" />
          </span>
        ) : null}
      </span>

      <span className="yt-row-data">
        <b title={item.title}>{item.title}</b>
        <small>
          <span className="yt-channel" title={item.channelTitle}>
            {item.channelTitle}
          </span>
          <span className="yt-source">
            <span aria-hidden="true">·</span>{' '}
            <a
              className="yt-source-link"
              href={item.sourceUrl}
              target="_blank"
              // `noopener` only. `noreferrer` would suppress the `Referer`
              // value, and YouTube's Required Minimum Functionality says API
              // clients "must not use the noreferrer feature".
              rel="noopener"
              onClick={(event) => event.stopPropagation()}
              aria-label={`Watch ${item.title} on YouTube`}
            >
              YouTube <ExternalLink size={11} aria-hidden="true" />
            </a>
          </span>
        </small>
        {blockedReason ? <small className="yt-row-note">{blockedReason}</small> : null}
      </span>

      <span className="yt-row-duration">
        {item.liveBroadcast === 'live'
          ? 'Live'
          : item.durationSeconds
            ? formatDuration(item.durationSeconds)
            : '--:--'}
      </span>

      {isCurrent ? (
        <span className="yt-row-state">{isPlaying ? 'Playing' : 'Paused'}</span>
      ) : null}
    </div>
  )
}
