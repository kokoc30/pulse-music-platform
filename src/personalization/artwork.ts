import type { Artwork } from '@/music/types'
import type { ListenEntry } from './types'

/**
 * A stored history row's artwork, in the shape the app's `Artwork` component
 * expects.
 *
 * A row keeps one URL plus the alternate origins it was published with, which is
 * exactly `{ medium, mirrors }` — so `buildArtworkCandidates` produces the same
 * candidate list it would for the live track and the same failover runs. That is
 * what makes a history card render whenever a track card for the same song
 * would, instead of blanking on the first unhealthy content node.
 *
 * An entry with no artwork yields `{}`, which renders as the reference's dark
 * placeholder tile rather than a broken image.
 */
export function historyArtwork(entry: ListenEntry): Artwork {
  const artwork: Artwork = {}
  if (entry.artworkUrl) artwork.medium = entry.artworkUrl
  if (entry.artworkMirrors?.length) artwork.mirrors = entry.artworkMirrors
  return artwork
}
