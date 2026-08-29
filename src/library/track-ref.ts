import { pickArtwork } from '@/music/normalize'
import type { MediaItem, Track, YouTubeVideoItem } from '@/music/types'
import { isYouTubeVideoItem } from '@/music/types'
import type { ListenEntry } from '@/personalization/types'
import type { LibraryProvider, LibraryTrackRef } from './types'
import { MAX_ARTWORK_MIRRORS } from './types'
import { youtubeExpiryFor } from './youtube-policy'

/**
 * Projections from a playable item to the minimum reference needed to save it.
 *
 * Every function here builds its result field by field. None of them spreads a
 * provider object, which is what makes "a stream URL cannot be saved" a
 * structural property rather than a review comment: there is no line that copies
 * one, and `Track.streamUrl` is simply never read in this file.
 */

/** The one identity rule: provider plus the provider's own id, never text. */
export function libraryKey(provider: LibraryProvider, providerItemId: string): string {
  return `${provider}:${providerItemId}`
}

/** Splits a key back into its parts, or `null` if it is not one of ours. */
export function parseLibraryKey(
  key: string,
): { provider: LibraryProvider; providerItemId: string } | null {
  const separator = key.indexOf(':')
  if (separator <= 0) return null
  const provider = key.slice(0, separator)
  const providerItemId = key.slice(separator + 1)
  if (!providerItemId) return null
  if (provider !== 'audius' && provider !== 'jamendo' && provider !== 'youtube') return null
  return { provider, providerItemId }
}

export function isYouTubeKey(key: string): boolean {
  return key.startsWith('youtube:')
}

/** Keys that may take part in cross-provider recommendation scoring. */
export function isCatalogKey(key: string): boolean {
  const parsed = parseLibraryKey(key)
  return parsed !== null && parsed.provider !== 'youtube'
}

/** A catalogue track, reduced to what a saved row needs to render. */
export function trackRefFromTrack(track: Track, now = Date.now()): LibraryTrackRef {
  const ref: LibraryTrackRef = {
    key: libraryKey(track.provider, track.providerId),
    provider: track.provider,
    providerItemId: track.providerId,
    title: track.title,
    artist: track.artistName,
    durationSeconds: track.durationSeconds,
    addedAt: now,
    metadataUpdatedAt: now,
  }
  if (track.artistId) ref.artistId = track.artistId

  const url = pickArtwork(track.artwork, 'medium')
  if (url) {
    ref.artwork = { url }
    // The mirror origins travel with the URL, for the same reason Recently
    // Played keeps them: one unhealthy Audius content node otherwise leaves the
    // row on a blank placeholder while every other card fails over and renders.
    const mirrors = track.artwork.mirrors?.slice(0, MAX_ARTWORK_MIRRORS)
    if (mirrors?.length) ref.artwork.mirrors = mirrors
  }

  if (track.genre) ref.genre = track.genre
  // Jamendo's required backlink; Audius expresses the same thing as a permalink.
  const sourceUrl = track.sourceUrl ?? track.permalink
  if (sourceUrl) ref.sourceUrl = sourceUrl

  return ref
}

/**
 * A YouTube video, reduced to the fields already on screen.
 *
 * Title, channel, YouTube's own thumbnail address, duration, the watch-page
 * backlink, and the two status flags the player needs before it may embed
 * anything. No statistics: Pulse never requests view counts, likes or ratings,
 * so there is nothing here that could carry them even by accident.
 *
 * The 30-day deletion deadline is stamped at save time, not computed later, so
 * an entry restored from a hand-edited backup still carries its own expiry.
 */
export function trackRefFromYouTube(item: YouTubeVideoItem, now = Date.now()): LibraryTrackRef {
  const ref: LibraryTrackRef = {
    key: libraryKey('youtube', item.videoId),
    provider: 'youtube',
    providerItemId: item.videoId,
    title: item.title,
    artist: item.channelTitle,
    sourceUrl: item.sourceUrl,
    embeddable: item.embeddable,
    madeForKids: item.madeForKids,
    addedAt: now,
    metadataUpdatedAt: now,
    youtubeExpiresAt: youtubeExpiryFor(now),
  }
  if (item.thumbnailUrl) ref.thumbnailUrl = item.thumbnailUrl
  if (item.durationSeconds) ref.durationSeconds = item.durationSeconds
  return ref
}

/** Whichever projection the item's own type calls for. */
export function trackRefFromMediaItem(item: MediaItem, now = Date.now()): LibraryTrackRef {
  return isYouTubeVideoItem(item) ? trackRefFromYouTube(item, now) : trackRefFromTrack(item, now)
}

/**
 * A reference built from a history row.
 *
 * Recently Played is a surface a visitor can like from, and its rows are
 * `ListenEntry`s rather than live provider objects. The fields line up
 * one-for-one because both were built by the same allow-list discipline.
 */
export function trackRefFromListenEntry(entry: ListenEntry, now = Date.now()): LibraryTrackRef {
  const base: LibraryTrackRef = {
    key: entry.id,
    provider: entry.provider,
    providerItemId: entry.providerItemId,
    title: entry.title,
    artist: entry.artist,
    addedAt: now,
    // The metadata itself came from the provider when the row was written, and
    // that is the moment the retention clock should run from — not now.
    metadataUpdatedAt: entry.storedAt || now,
  }
  if (entry.artistId) base.artistId = entry.artistId
  if (entry.durationSeconds) base.durationSeconds = entry.durationSeconds
  if (entry.sourceUrl) base.sourceUrl = entry.sourceUrl

  if (entry.provider === 'youtube') {
    if (entry.thumbnailUrl) base.thumbnailUrl = entry.thumbnailUrl
    base.embeddable = entry.embeddable === true
    base.madeForKids = entry.madeForKids ?? null
    base.youtubeExpiresAt = youtubeExpiryFor(base.metadataUpdatedAt)
    return base
  }

  if (entry.artworkUrl) {
    base.artwork = { url: entry.artworkUrl }
    if (entry.artworkMirrors?.length) {
      base.artwork.mirrors = entry.artworkMirrors.slice(0, MAX_ARTWORK_MIRRORS)
    }
  }
  if (entry.genre) base.genre = entry.genre
  return base
}

/**
 * Folds fresh provider metadata into an existing reference.
 *
 * `addedAt` is the visitor's act and never moves. Everything else is provider
 * display data and is replaced, which is what "use reasonable efforts to keep
 * stored API Data current" means in practice — and, for a YouTube ref, restarts
 * the 30-day clock from a genuine new retrieval.
 */
export function mergeTrackRef(existing: LibraryTrackRef, fresh: LibraryTrackRef): LibraryTrackRef {
  return { ...fresh, addedAt: existing.addedAt }
}

/** Reconstructs the YouTube item a saved reference stands for. */
export function youTubeItemFromRef(ref: LibraryTrackRef): YouTubeVideoItem | null {
  if (ref.provider !== 'youtube' || !ref.sourceUrl) return null
  return {
    id: ref.key,
    mediaKind: 'youtube-video',
    provider: 'youtube',
    providerId: ref.providerItemId,
    videoId: ref.providerItemId,
    title: ref.title,
    channelTitle: ref.artist,
    thumbnailUrl: ref.thumbnailUrl ?? '',
    ...(ref.durationSeconds ? { durationSeconds: ref.durationSeconds } : {}),
    sourceUrl: ref.sourceUrl,
    embeddable: ref.embeddable === true,
    madeForKids: ref.madeForKids ?? null,
  }
}
