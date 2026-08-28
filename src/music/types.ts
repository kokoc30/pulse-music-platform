/**
 * Normalized music domain model.
 *
 * The rest of the application depends on these types only — never on raw
 * `@audius/sdk` response shapes (agents/03_ARCHITECTURE.md → "Provider Boundary").
 */

/**
 * Catalogues whose audio the app streams through its single `HTMLAudioElement`.
 *
 * YouTube is deliberately **not** in this union. It is a video provider played
 * by YouTube's own embedded IFrame player, and giving it a `ProviderId` would
 * let it flow into every function that assumes "provider ⇒ audio stream"
 * (agents/21_YOUTUBE_POLICY_BOUNDARIES.md → "Domain Model").
 */
export type ProviderId = 'audius' | 'jamendo'

/** Every media source the app can present, audio or video. */
export type MediaProviderId = ProviderId | 'youtube'

export interface Artwork {
  small?: string
  medium?: string
  large?: string
  /**
   * Alternate content-node origins Audius publishes alongside each image. Some
   * primary nodes intermittently serve broken TLS, so the UI retries the same
   * path against these.
   */
  mirrors?: string[]
}

export interface Track {
  /** Globally unique within the app: `${provider}:${providerId}`. */
  id: string
  /**
   * Discriminant of the `MediaItem` union. Always `'audio'` — a value that only
   * ever appears on something the `HTMLAudioElement` may legitimately load.
   */
  mediaKind: 'audio'
  provider: ProviderId
  providerId: string
  title: string
  artistId?: string
  artistName: string
  artistHandle?: string
  artwork: Artwork
  durationSeconds: number
  genre?: string
  mood?: string
  /**
   * Free-form tags the provider published, already split and lowercased.
   *
   * Audius returns these as one comma-separated string; Jamendo exposes them
   * under `musicinfo.tags`. Both are normalized to an array here so the
   * similarity scorer never has to know which provider it is looking at.
   * Absent — not empty — when the provider said nothing.
   */
  tags?: string[]
  /** Beats per minute, when the provider measured or was told it. */
  bpm?: number
  /** Musical key as the provider writes it, e.g. `"C major"`. */
  musicalKey?: string
  playCount?: number
  /** Absolute URL on the provider's website, safe to open in a new tab. */
  permalink?: string
  isStreamable: boolean
  /**
   * The provider's own page for this track. Drives the attribution backlink
   * Jamendo's API terms require (agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md);
   * Audius expresses the same thing through `permalink`.
   */
  sourceUrl?: string
  /** Creative Commons deed the release is published under (`license_ccurl`). */
  licenseUrl?: string
  /** True when the provider requires visible source attribution. Jamendo does. */
  attributionRequired?: boolean
  /**
   * Provider-issued direct audio URL, when the provider hands one out with the
   * search result (Jamendo). Audius resolves a signed URL lazily instead, so
   * this is absent for Audius tracks. Never a download endpoint: Jamendo's
   * `audiodownload` is stripped server-side and never reaches this model.
   */
  streamUrl?: string
}

/**
 * One YouTube search result.
 *
 * Deliberately **not** shaped like a `Track`: it has no stream URL, no
 * `isStreamable`, no artwork object and no play count, because none of those
 * exist for it. Its `thumbnailUrl` is YouTube's own image, presented unmodified
 * at 16:9, and its `sourceUrl` is the real watch page
 * (agents/22_YOUTUBE_SEARCH_QUOTA_ARCHITECTURE.md → "Normalized YouTube Item").
 *
 * Playback happens exclusively in YouTube's embedded IFrame player. There is no
 * field on this type that could be handed to an `<audio>` element, by design.
 */
export interface YouTubeVideoItem {
  /** Globally unique within the app: `youtube:<videoId>`. */
  id: string
  mediaKind: 'youtube-video'
  provider: 'youtube'
  providerId: string
  videoId: string
  title: string
  channelTitle: string
  channelId?: string
  /** YouTube's own thumbnail URL. Never cropped, filtered or re-hosted. */
  thumbnailUrl: string
  thumbnailWidth?: number
  thumbnailHeight?: number
  durationSeconds?: number
  publishedAt?: string
  /** `https://www.youtube.com/watch?v=<id>` — the required backlink. */
  sourceUrl: string
  /** `status.embeddable`. False ⇒ the item is offered as external-only. */
  embeddable: boolean
  /**
   * `status.madeForKids`. `null` means YouTube did not report it. Only an
   * explicit `false` permits embedding — see docs/youtube-policy-audit.md §9.
   */
  madeForKids: boolean | null
  liveBroadcast?: 'live' | 'upcoming'
}

/**
 * Anything the app can put in front of a listener. The union is discriminated on
 * `provider` (and equivalently on `mediaKind`), which is what makes "a YouTube
 * video can never reach the audio engine" a compile-time property rather than a
 * convention.
 */
export type MediaItem = Track | YouTubeVideoItem

export function isYouTubeVideoItem(item: MediaItem): item is YouTubeVideoItem {
  return item.provider === 'youtube'
}

export function isAudioTrack(item: MediaItem): item is Track {
  return item.provider !== 'youtube'
}

/**
 * Runtime belt-and-braces for the one boundary the type system cannot police:
 * data crossing the wire. Throws rather than returning, because the only way to
 * reach it is a genuine programming error, and silently degrading would mean
 * loading a YouTube URL into an `<audio>` element.
 */
export function assertAudioTrack(item: MediaItem): Track {
  if (!isAudioTrack(item) || item.mediaKind !== 'audio') {
    throw new MusicError(
      'NOT_STREAMABLE',
      'This item plays on YouTube, not through the audio player.',
    )
  }
  return item
}

export interface Artist {
  id: string
  provider: ProviderId
  providerId: string
  name: string
  handle: string
  artwork: Artwork
  followerCount?: number
  trackCount?: number
  isVerified: boolean
  permalink?: string
}

export type MusicErrorCode =
  | 'CONFIG'
  | 'NETWORK'
  | 'RATE_LIMIT'
  | 'NOT_FOUND'
  | 'NOT_STREAMABLE'
  | 'PROVIDER'
  | 'ABORTED'

/**
 * The only error shape allowed to reach the UI. Never carries an SDK dump.
 */
export class MusicError extends Error {
  readonly code: MusicErrorCode
  /** Copy that is safe to render directly to a visitor. */
  readonly userMessage: string
  readonly status?: number

  constructor(
    code: MusicErrorCode,
    userMessage: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(`[${code}] ${userMessage}`, options?.cause ? { cause: options.cause } : undefined)
    this.name = 'MusicError'
    this.code = code
    this.userMessage = userMessage
    this.status = options?.status
  }
}

export interface SearchOptions {
  limit?: number
  offset?: number
  signal?: AbortSignal
}

/** One provider round-trip that returns both tracks and artists. */
export interface CatalogSearchResult {
  tracks: Track[]
  artists: Artist[]
}

export interface TrendingOptions {
  limit?: number
  offset?: number
  genre?: string
  time?: 'week' | 'month' | 'year' | 'allTime'
  signal?: AbortSignal
}

export interface TopArtistsOptions {
  limit?: number
  offset?: number
  signal?: AbortSignal
}
