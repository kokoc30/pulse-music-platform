import { buildArtworkCandidates } from '@/music/normalize'
import type { Track } from '@/music/types'

/**
 * A catalogue track → the fields an OS media control shows.
 *
 * Pure, so what the lock screen would display is testable without a browser
 * that implements the Media Session API at all.
 */

/**
 * Sizes the platform is told about.
 *
 * Android's notification and the iOS lock screen pick from this list, so a
 * couple of honest options beat one guess. The dimensions are declared rather
 * than measured — the API takes `sizes` as a hint, and the image behind a URL is
 * whatever the content node serves.
 */
export const ARTWORK_SIZES = ['512x512', '256x256', '96x96'] as const

export interface ArtworkEntry {
  src: string
  sizes: string
  type: string
}

/**
 * Indexed so it can be handed straight to `new MediaMetadata(...)`, whose
 * constructor signature varies across TypeScript DOM library versions.
 */
export interface SessionMetadata {
  title: string
  artist: string
  album: string
  artwork: ArtworkEntry[]
  [key: string]: unknown
}

/**
 * Artwork for the OS, built through the app's existing resolver.
 *
 * `buildArtworkCandidates` is the same function every card and the player bar
 * use, so a track whose primary Audius content node is unhealthy hands the OS
 * the mirror origins too. Nothing here re-hosts, re-encodes or proxies an image
 * — only URLs are passed on.
 */
export function artworkForSession(track: Track): ArtworkEntry[] {
  const candidates = buildArtworkCandidates(track.artwork, 'large')
  if (!candidates.length) return []

  // One entry per candidate, largest declared size first. A platform that
  // cannot load the first will try the next, which is exactly the failover the
  // in-page `Artwork` component performs.
  return candidates.slice(0, ARTWORK_SIZES.length).map((src, index) => ({
    src,
    sizes: ARTWORK_SIZES[index] ?? ARTWORK_SIZES[ARTWORK_SIZES.length - 1],
    // Audius and Jamendo both serve JPEG covers; the hint is advisory and a
    // wrong guess does not stop a platform loading the image.
    type: 'image/jpeg',
  }))
}

/**
 * The metadata for one track.
 *
 * `album` is only ever a real album. The Media Session spec has no "provider"
 * field, and putting "Audius" or "Jamendo" there would be presenting the source
 * as the record it came from — the attribution obligation is met by the visible
 * in-app credit, not by mislabelling a lock screen.
 */
export function sessionMetadataFor(track: Track): SessionMetadata {
  return {
    title: track.title,
    artist: track.artistName,
    album: '',
    artwork: artworkForSession(track),
  }
}
