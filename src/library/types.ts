import type { MediaProviderId } from '@/music/types'

/**
 * The persisted library model: Liked Songs, user playlists, and the track
 * references they are built from.
 *
 * **Separate from personalization, on purpose.** `pulse.personalization.v1` is a
 * behavioural record — what was played, what was typed — that the visitor may
 * switch off entirely. The library is the opposite: things the visitor
 * deliberately saved, which must keep working whether or not personalization is
 * on. Mixing them would mean either losing playlists when consent is withdrawn,
 * or keeping a behavioural profile the visitor asked not to have
 * (agents/41 → "Separate library from personalization").
 *
 * Two rules shape every field below, and both are enforced structurally in
 * `storage.ts` rather than by convention:
 *
 * 1. **A reference, never a copy.** A saved item records *which* provider item
 *    it is and the minimum needed to draw a row for it. It never records
 *    anything that could play it — no stream URL, no signed URL, no bytes — so
 *    playback always goes back to the provider through the existing resolution
 *    path.
 * 2. **An explicit allow-list.** `toPersisted` names every stored field one line
 *    at a time. A provider that starts returning a credential, a token or a
 *    statistic in its payload cannot reach disk, because nothing copies an
 *    object wholesale into storage.
 */

/** Storage schema version. Bumping it requires a migration in `migrations.ts`. */
export const LIBRARY_VERSION = 1

/**
 * Single namespace for the library. IndexedDB database name; nothing else in the
 * app may write to it.
 */
export const LIBRARY_DB_NAME = 'pulse.library.v1'
export const LIBRARY_STORE_NAME = 'state'
/** One record holds the whole state, which is what makes a write atomic. */
export const LIBRARY_RECORD_KEY = 'state'

/** Everything the library can hold a reference to. */
export type LibraryProvider = MediaProviderId

/**
 * Cover art for a saved item, kept as addresses only.
 *
 * `mirrors` carries the alternate Audius content-node origins for the same path,
 * for exactly the reason Recently Played does: an individual node is regularly
 * unreachable, and a row with one candidate has nothing to fail over to.
 */
export interface SafeArtworkRef {
  url: string
  mirrors?: string[]
}

/**
 * One saved provider item.
 *
 * Identity is always `provider:providerItemId` — never title and artist. A
 * Jamendo cover and the Audius original are two different saves, and merging
 * them on text similarity would silently replace one with the other
 * (agents/41 → "Stable identity").
 */
export interface LibraryTrackRef {
  /** `${provider}:${providerItemId}`. The key everything else refers to. */
  key: string
  provider: LibraryProvider
  providerItemId: string
  title: string
  /** Artist for a catalogue track; channel title for a YouTube video. */
  artist: string
  /** Provider artist id, when the provider supplied one. */
  artistId?: string
  /** Square cover art. Catalogue items only. */
  artwork?: SafeArtworkRef
  /** YouTube's own 16:9 thumbnail, unmodified. YouTube items only. */
  thumbnailUrl?: string
  durationSeconds?: number
  /** Provider genre/tag, when supplied. Never derived, and never from YouTube. */
  genre?: string
  /** The provider's own page — Jamendo's required backlink, YouTube's watch page. */
  sourceUrl?: string
  /** `status.embeddable`. YouTube items only. */
  embeddable?: boolean
  /** `status.madeForKids`. `null` means YouTube did not report it. */
  madeForKids?: boolean | null
  /** When this item was first saved to the library. */
  addedAt: number
  /** When its display metadata was last written from a provider response. */
  metadataUpdatedAt: number
  /**
   * Hard deletion deadline for YouTube API metadata, `metadataUpdatedAt + 30d`.
   *
   * Present only on YouTube refs, and the only thing that governs their
   * lifetime — see `youtube-policy.ts`.
   */
  youtubeExpiresAt?: number
}

/** A playlist the visitor created on this device. */
export interface Playlist {
  /** Pulse-local id. Never a provider id — this list exists nowhere else. */
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  /** Explicit, stable custom order. Keys into `LibraryState.tracks`. */
  itemKeys: string[]
  /** Covers are drawn from item artwork at render time; no bytes are stored. */
  coverMode: 'auto'
}

export interface LibraryState {
  version: number
  tracks: Record<string, LibraryTrackRef>
  /** Liked Songs membership, most recently liked first. */
  likedTrackKeys: string[]
  playlists: Record<string, Playlist>
  /** Order playlists are listed in, most recently created first. */
  playlistOrder: string[]
  /** Items the visitor marked *Not interested*. */
  hiddenRecommendationKeys: string[]
  updatedAt: number
}

export function createEmptyLibrary(now = Date.now()): LibraryState {
  return {
    version: LIBRARY_VERSION,
    tracks: {},
    likedTrackKeys: [],
    playlists: {},
    playlistOrder: [],
    hiddenRecommendationKeys: [],
    updatedAt: now,
  }
}

/* --------------------------------------------------------------------------
   Bounds
   -------------------------------------------------------------------------- */

/** Local playlists one browser may hold. */
export const MAX_PLAYLISTS = 100
/** Tracks one playlist may hold. */
export const MAX_TRACKS_PER_PLAYLIST = 1000
/** Distinct saved track references. Bounds the whole store, not one list. */
export const MAX_LIBRARY_TRACKS = 10_000
/** Liked Songs membership cap. */
export const MAX_LIKED_TRACKS = 5000
/** Hidden ("Not interested") keys retained. */
export const MAX_HIDDEN_KEYS = 500
export const MAX_PLAYLIST_NAME_LENGTH = 120
export const MAX_PLAYLIST_DESCRIPTION_LENGTH = 500
/** Alternate artwork origins kept per reference. Matches personalization. */
export const MAX_ARTWORK_MIRRORS = 4
/** Artwork references a generated cover collage draws from. */
export const COVER_COLLAGE_SIZE = 4

/**
 * The two sentences a like toggle reports, in one place.
 *
 * They live in this dependency-free module rather than beside the action,
 * because two layers need them and the layers may not import each other: the
 * library imports the player (to route a saved reference to its engine), so the
 * player's unified transport cannot import the library back without a cycle.
 *
 * The wording says **in Pulse** on the way in, every time. Pulse has no provider
 * OAuth, so a heart here changes nothing on Audius, Jamendo or YouTube, and copy
 * that implied otherwise would be a false claim about someone else's service
 * (agents/44 → "Clear disclosure").
 */
export const LIKE_ADDED_MESSAGE = 'Added to Liked Songs in Pulse'
export const LIKE_REMOVED_MESSAGE = 'Removed from Liked Songs'

/** How the last library storage attempt went. Surfaced so the UI can be honest. */
export type LibraryStorageStatus =
  /** Read and parsed cleanly, including "there was nothing there yet". */
  | 'ok'
  /** Something was malformed and was dropped; the rest was kept. */
  | 'recovered'
  /** A version this build does not understand. Left untouched, not reinterpreted. */
  | 'incompatible'
  /** No usable storage: private mode, disabled storage, quota exhausted. */
  | 'unavailable'

/** Why a mutation was refused. Every one maps to a specific, honest message. */
export type LibraryFailureReason =
  | 'storage-unavailable'
  | 'playlist-limit'
  | 'playlist-track-limit'
  | 'library-limit'
  | 'duplicate'
  | 'not-found'
  | 'invalid-name'

export interface LibraryResult {
  ok: boolean
  reason?: LibraryFailureReason
  /** Id of the playlist a successful create produced. */
  playlistId?: string
}

export const LIBRARY_OK: LibraryResult = { ok: true }

export function libraryFailure(reason: LibraryFailureReason): LibraryResult {
  return { ok: false, reason }
}
