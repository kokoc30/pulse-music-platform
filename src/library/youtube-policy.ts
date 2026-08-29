import { MS_PER_DAY, YOUTUBE_RETENTION_DAYS } from '@/personalization/config'
import type { LibraryState, LibraryTrackRef } from './types'

/**
 * Retention and deletion for YouTube metadata held in the library.
 *
 * The governing rule is the same one Phase 4 already enforces for listening
 * history — YouTube API Services Developer Policies §III.E.4.d: an API Client
 * "may temporarily store limited amounts of Non-Authorized Data … but not longer
 * than 30 calendar days". Pulse has no YouTube OAuth, so everything it holds is
 * Non-Authorized Data and 30 days is a ceiling, not a target. The constant is
 * deliberately shared with `personalization/config.ts` so the two paths cannot
 * drift apart.
 *
 * **The strict route, chosen deliberately.** agents/44 offers two readings at
 * expiry: keep a Pulse-owned membership record and drop only the API-derived
 * metadata, or remove the saved item outright. The first is only defensible if
 * the surviving record carries nothing derived from the API — but a YouTube
 * membership record with the video id stripped is not a playable reference, and
 * one that keeps the id keeps the thing that identifies YouTube's content. So
 * Pulse takes the route agents/44 names for exactly this case: *"If legal/policy
 * interpretation is uncertain, take the stricter route and fully remove the
 * expired YouTube saved item."* An expired ref is deleted and its key is removed
 * from Liked Songs and from every playlist that held it.
 *
 * **No refresh endpoint in this phase.** Refreshing would require adding a
 * `videos.list` action to `/api/youtube`, and the strict route makes it
 * unnecessary: the visitor can search for the video again and re-save it, which
 * is an ordinary permitted retrieval that starts a fresh 30 days.
 *
 * **The clock is `metadataUpdatedAt`.** Set when the metadata was written from a
 * real provider response, and moved only by another one. Nothing extends the
 * window on its own.
 */

/** Epoch milliseconds at which a ref stored now must be gone. */
export function youtubeExpiryFor(metadataUpdatedAt: number): number {
  return metadataUpdatedAt + YOUTUBE_RETENTION_DAYS * MS_PER_DAY
}

/** True when this ref is YouTube metadata that has outlived its retention. */
export function isExpiredYouTubeRef(ref: LibraryTrackRef, now = Date.now()): boolean {
  if (ref.provider !== 'youtube') return false
  const expiresAt = ref.youtubeExpiresAt ?? youtubeExpiryFor(ref.metadataUpdatedAt)
  return expiresAt <= now
}

/**
 * Whether a saved YouTube item may still be offered for playback.
 *
 * Mirrors the history rule exactly: within retention, reported embeddable, and
 * explicitly reported as not made for kids. `madeForKids` of `null` means
 * YouTube did not say, which is not the explicit `false` the policy audit
 * requires (docs/youtube-policy-audit.md §9).
 */
export function canPlaySavedYouTubeRef(ref: LibraryTrackRef, now = Date.now()): boolean {
  if (ref.provider !== 'youtube') return false
  if (isExpiredYouTubeRef(ref, now)) return false
  if (ref.embeddable !== true) return false
  return ref.madeForKids === false
}

/**
 * Removes every expired YouTube ref and every reference to it.
 *
 * Returns the same state instance when nothing expired, so callers can use
 * identity to skip a pointless write.
 */
export function purgeExpiredYouTubeFromLibrary(
  state: LibraryState,
  now = Date.now(),
): LibraryState {
  const expired = new Set(
    Object.values(state.tracks)
      .filter((ref) => isExpiredYouTubeRef(ref, now))
      .map((ref) => ref.key),
  )
  if (expired.size === 0) return state

  const tracks: Record<string, LibraryTrackRef> = {}
  for (const [key, ref] of Object.entries(state.tracks)) {
    if (!expired.has(key)) tracks[key] = ref
  }

  const playlists: Record<string, typeof state.playlists[string]> = {}
  for (const [id, playlist] of Object.entries(state.playlists)) {
    const itemKeys = playlist.itemKeys.filter((key) => !expired.has(key))
    playlists[id] =
      itemKeys.length === playlist.itemKeys.length ? playlist : { ...playlist, itemKeys }
  }

  return {
    ...state,
    tracks,
    playlists,
    likedTrackKeys: state.likedTrackKeys.filter((key) => !expired.has(key)),
    hiddenRecommendationKeys: state.hiddenRecommendationKeys.filter((key) => !expired.has(key)),
    updatedAt: now,
  }
}

/**
 * How often the app re-runs the library purge while a tab stays open.
 *
 * Six hours, matching the history sweep: far below the 30-day limit, and one
 * pass over an object the page already holds.
 */
export const LIBRARY_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000
