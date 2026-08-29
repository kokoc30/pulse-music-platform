import { Heart, Music4 } from 'lucide-react'
import { Artwork } from '@/components/track/Artwork'
import type { CoverArt } from '@/library/selectors'

interface PlaylistCoverProps {
  cover: CoverArt
  /** Liked Songs gets its own mark rather than a collage of its first four. */
  variant?: 'playlist' | 'liked'
  size?: 'small' | 'medium'
}

/**
 * A playlist's cover, arranged from artwork the items already carry.
 *
 * **Nothing is generated or stored.** No canvas, no composite, no data URI, no
 * new binary anywhere: this is one to four `<img>` elements in a CSS grid,
 * pointing at the same provider addresses the track rows point at. Each one
 * fails over through the same mirror list every other cover in the app uses, so
 * an unhealthy Audius content node degrades one tile rather than blanking the
 * cover (agents/42 → "Do not generate/persist image bytes").
 *
 * **YouTube thumbnails are excluded upstream**, in `coverArtFor`. A 16:9 video
 * still cropped into a quarter of a square would present a video as album art,
 * which this app has declined to do since Phase 3.
 *
 * Zero artwork falls back to a mark rather than an empty box, so a playlist of
 * items whose covers all failed still reads as a playlist.
 */
export function PlaylistCover({
  cover,
  variant = 'playlist',
  size = 'medium',
}: PlaylistCoverProps) {
  const count = Math.min(cover.artworks.length, 4)

  if (variant === 'liked') {
    return (
      <div className="playlist-cover playlist-cover-liked" data-size={size} aria-hidden="true">
        <Heart size={size === 'small' ? 22 : 40} fill="currentColor" />
      </div>
    )
  }

  if (count === 0) {
    return (
      <div className="playlist-cover playlist-cover-empty" data-size={size} aria-hidden="true">
        <Music4 size={size === 'small' ? 20 : 34} />
      </div>
    )
  }

  return (
    <div
      className="playlist-cover"
      data-size={size}
      // One image reads as the cover; two to four read as a grid.
      data-tiles={count === 1 ? '1' : '4'}
      aria-hidden="true"
    >
      {cover.artworks.slice(0, 4).map((artwork) => (
        <Artwork
          key={artwork.url}
          artwork={{
            medium: artwork.url,
            ...(artwork.mirrors?.length ? { mirrors: artwork.mirrors } : {}),
          }}
          size="medium"
        />
      ))}
    </div>
  )
}
