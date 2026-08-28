import type { Track as AudiusTrack, User as AudiusUser } from '@audius/sdk'
import type { Artist, Artwork, Track } from './types'

/**
 * The normalizer only ever reads this subset, so it accepts any Audius track
 * shape. `/search/full` returns `SearchTrack`, which is structurally looser than
 * `Track` (several counters are optional) — requiring the exact `Track` type
 * here would force a cast at every call site for fields nothing reads.
 */
export type NormalizableTrack = Pick<
  AudiusTrack,
  'id' | 'title' | 'duration' | 'genre' | 'mood' | 'playCount' | 'permalink' | 'artwork'
> &
  // Phase 6 similarity reads these when Audius supplies them. All optional: a
  // track with none of them scores neutrally rather than being penalised.
  Partial<Pick<AudiusTrack, 'tags' | 'bpm' | 'musicalKey'>> &
  Partial<Pick<AudiusTrack, 'isStreamable' | 'access' | 'user'>>

const AUDIUS_WEB_ORIGIN = 'https://audius.co'

/**
 * Audius image objects expose `_150x150` / `_480x480` / `_1000x1000`. Every one
 * is optional and the whole object can be absent, so nothing here may throw.
 */
type AudiusImage = {
  _150x150?: string
  _480x480?: string
  _1000x1000?: string
  mirrors?: string[]
}

function toArtwork(image: AudiusImage | undefined | null): Artwork {
  if (!image) return {}
  const artwork: Artwork = {}
  if (image._150x150) artwork.small = image._150x150
  if (image._480x480) artwork.medium = image._480x480
  if (image._1000x1000) artwork.large = image._1000x1000
  const mirrors = Array.isArray(image.mirrors)
    ? image.mirrors.filter((origin) => typeof origin === 'string' && /^https?:\/\//i.test(origin))
    : []
  if (mirrors.length) artwork.mirrors = mirrors
  return artwork
}

/**
 * Same image path served from an alternate content node. Audius publishes the
 * mirror origins precisely so a client can fail over.
 */
export function buildArtworkCandidates(artwork: Artwork, size: 'small' | 'medium' | 'large'): string[] {
  const primary = pickArtwork(artwork, size)
  if (!primary) return []
  const candidates = [primary]
  let path: string
  try {
    path = new URL(primary).pathname
  } catch {
    return candidates
  }
  for (const origin of artwork.mirrors ?? []) {
    const candidate = `${origin.replace(/\/+$/, '')}${path}`
    if (candidate !== primary) candidates.push(candidate)
  }
  return candidates
}

/**
 * Best available artwork at or above the requested size, falling back downwards
 * so a partially-populated artwork object still renders something.
 */
export function pickArtwork(artwork: Artwork, size: 'small' | 'medium' | 'large'): string | undefined {
  if (size === 'large') return artwork.large ?? artwork.medium ?? artwork.small
  if (size === 'medium') return artwork.medium ?? artwork.large ?? artwork.small
  return artwork.small ?? artwork.medium ?? artwork.large
}

function toAbsolutePermalink(permalink: string | undefined | null): string | undefined {
  if (!permalink) return undefined
  if (/^https?:\/\//i.test(permalink)) return permalink
  return `${AUDIUS_WEB_ORIGIN}${permalink.startsWith('/') ? '' : '/'}${permalink}`
}

function toFiniteSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function toCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Audius display names sometimes carry a leading `@`; the handle already has one. */
function toArtistName(user: AudiusUser | undefined | null): string {
  const name = cleanText(user?.name).replace(/^@/, '').trim()
  if (name) return name
  const handle = cleanText(user?.handle)
  return handle || 'Unknown artist'
}

/**
 * A track is playable only when Audius says it is streamable *and* grants
 * stream access. Gated / premium / deleted tracks fail one of the two.
 */
export function isTrackStreamable(track: NormalizableTrack): boolean {
  const streamableFlag = track.isStreamable !== false
  const accessFlag = track.access?.stream !== false
  return streamableFlag && accessFlag
}

export function normalizeTrack(raw: NormalizableTrack): Track | null {
  const providerId = cleanText(raw?.id)
  if (!providerId) return null

  const title = cleanText(raw.title) || 'Untitled track'
  const genre = cleanText(raw.genre)
  const mood = cleanText(raw.mood)

  const track: Track = {
    id: `audius:${providerId}`,
    mediaKind: 'audio',
    provider: 'audius',
    providerId,
    title,
    artistName: toArtistName(raw.user),
    artwork: toArtwork(raw.artwork),
    durationSeconds: toFiniteSeconds(raw.duration),
    isStreamable: isTrackStreamable(raw),
  }

  const artistId = cleanText(raw.user?.id)
  if (artistId) track.artistId = artistId
  const artistHandle = cleanText(raw.user?.handle)
  if (artistHandle) track.artistHandle = artistHandle
  if (genre) track.genre = genre
  if (mood) track.mood = mood
  const tags = normalizeTags(raw.tags)
  if (tags.length) track.tags = tags
  const bpm = normalizeBpm(raw.bpm)
  if (bpm !== undefined) track.bpm = bpm
  const musicalKey = cleanText(raw.musicalKey)
  if (musicalKey) track.musicalKey = musicalKey
  const playCount = toCount(raw.playCount)
  if (playCount !== undefined) track.playCount = playCount
  const permalink = toAbsolutePermalink(raw.permalink)
  if (permalink) track.permalink = permalink

  return track
}

/**
 * `Array.isArray` widens a `readonly T[]` to `any[]`, so the check goes through
 * an explicit predicate to keep the element type.
 */
function isReadonlyArray<T>(value: readonly T[] | undefined | null): value is readonly T[] {
  return Array.isArray(value)
}

export function normalizeTracks(
  raw: readonly NormalizableTrack[] | undefined | null,
): Track[] {
  if (!isReadonlyArray(raw)) return []
  const seen = new Set<string>()
  const tracks: Track[] = []
  for (const item of raw) {
    const track = normalizeTrack(item)
    // De-duplicate: Audius shelves can repeat a track, which would produce
    // duplicate React keys and a confusing queue.
    if (!track || seen.has(track.id)) continue
    seen.add(track.id)
    tracks.push(track)
  }
  return tracks
}

export function normalizeArtist(raw: AudiusUser): Artist | null {
  const providerId = cleanText(raw?.id)
  if (!providerId) return null

  const handle = cleanText(raw.handle)
  const artist: Artist = {
    id: `audius:${providerId}`,
    provider: 'audius',
    providerId,
    name: toArtistName(raw),
    handle,
    artwork: toArtwork(raw.profilePicture),
    isVerified: raw.isVerified === true,
  }

  const followerCount = toCount(raw.followerCount)
  if (followerCount !== undefined) artist.followerCount = followerCount
  const trackCount = toCount(raw.trackCount)
  if (trackCount !== undefined) artist.trackCount = trackCount
  if (handle) artist.permalink = `${AUDIUS_WEB_ORIGIN}/${handle}`

  return artist
}

export function normalizeArtists(raw: AudiusUser[] | undefined | null): Artist[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const artists: Artist[] = []
  for (const item of raw) {
    const artist = normalizeArtist(item)
    if (!artist || seen.has(artist.id)) continue
    // Deactivated or unavailable profiles render as broken cards.
    if (item.isDeactivated === true || item.isAvailable === false) continue
    seen.add(artist.id)
    artists.push(artist)
  }
  return artists
}

/**
 * Provider tags → a comparable, bounded, lowercase list.
 *
 * Audius publishes one comma-separated string, Jamendo an array under
 * `musicinfo.tags`, and both occasionally contain blanks, duplicates or a
 * hundred-item dump. Accepting either shape here means the similarity scorer
 * only ever sees `string[]`, and the cap keeps one over-tagged track from
 * dominating an overlap score.
 */
export const MAX_TAGS = 12

export function normalizeTags(value: unknown): string[] {
  const raw =
    typeof value === 'string'
      ? value.split(',')
      : Array.isArray(value)
        ? value.filter((tag): tag is string => typeof tag === 'string')
        : []

  const tags: string[] = []
  for (const entry of raw) {
    const tag = entry.trim().toLowerCase()
    if (!tag || tags.includes(tag)) continue
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

/** Plausible musical tempo, or `undefined`. Anything outside is bad metadata. */
export function normalizeBpm(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  if (!Number.isFinite(parsed) || parsed < 20 || parsed > 300) return undefined
  return Math.round(parsed * 10) / 10
}
