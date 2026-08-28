import type { Artist } from '@/music/types'
import { Artwork } from './Artwork'

interface ArtistCardProps {
  artist: Artist
  onSelect: () => void
}

/** The reference's circular `.artist-card`. */
export function ArtistCard({ artist, onSelect }: ArtistCardProps) {
  return (
    <article className="artist-card">
      <button
        type="button"
        className="artist-image"
        onClick={onSelect}
        aria-label={`Search for ${artist.name}`}
      >
        <Artwork artwork={artist.artwork} size="medium" />
      </button>
      <h3 title={artist.name}>{artist.name}</h3>
      <p>Artist</p>
    </article>
  )
}
