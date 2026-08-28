import type { YouTubeVideoItem } from '@/music/types'

interface YouTubeThumbnailProps {
  item: YouTubeVideoItem
  /**
   * Rendered width in CSS pixels, with the height following from 16:9; or
   * `'fill'` to take the width of the surrounding card and keep the same ratio
   * through `aspect-ratio` instead of fixed pixels. `'fill'` exists for the
   * Recently Played grid, whose columns are fluid — it changes how the box is
   * measured, never the 16:9 shape or the image inside it.
   */
  width: number | 'fill'
}

/**
 * A YouTube thumbnail, shown unmodified inside a 16:9 box.
 *
 * `object-fit: contain` rather than `cover` is the whole point: `cover` would
 * crop the image to fill the frame, and `agents/25` forbids cropping a YouTube
 * thumbnail into square album art or applying visual filters over it. The
 * normaliser already prefers the natively-16:9 `maxres`/`medium` keys, so in
 * practice the image fills the box exactly; when only a 4:3 key exists it
 * letterboxes instead of losing the top and bottom of the frame
 * (docs/youtube-policy-audit.md §3).
 *
 * The image is loaded straight from YouTube's own CDN. It is never proxied,
 * re-encoded, cached or re-hosted by this application.
 */
export function YouTubeThumbnail({ item, width }: YouTubeThumbnailProps) {
  const fill = width === 'fill'
  const height = fill ? undefined : Math.round((width * 9) / 16)
  return (
    <span
      className={fill ? 'yt-thumb yt-thumb-fill' : 'yt-thumb'}
      style={fill ? undefined : { width, height }}
      data-testid="youtube-thumbnail"
    >
      <img
        src={item.thumbnailUrl}
        // Decorative relative to the adjacent title, which carries the same
        // information as real text.
        alt=""
        width={item.thumbnailWidth ?? (fill ? 1280 : width)}
        height={item.thumbnailHeight ?? (height ?? 720)}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </span>
  )
}
