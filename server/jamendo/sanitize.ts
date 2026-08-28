import { containsSecret } from './redact.js'

/**
 * Raw Jamendo track → the narrow payload the browser is allowed to see.
 *
 * Two jobs, both security-relevant:
 *
 * 1. **Validation.** Provider types are not trusted: `duration` arrives as a
 *    number or a string, `image` can be absent or empty, `audio` can be missing
 *    or non-HTTPS (agents/14_JAMENDO_PROVIDER_CONTRACT.md → "Jamendo Raw Track
 *    Shape").
 * 2. **Sanitization.** `audiodownload`, `audiodownload_allowed`, waveforms,
 *    internal counters and anything credential-bearing are dropped. Phase 2 has
 *    no download feature, so the download URL must not exist client-side at all
 *    (agents/16_JAMENDO_SERVERLESS_SECURITY.md → "Sanitized Response").
 */

/**
 * The wire contract. `src/music/jamendo/wire.ts` holds the browser-side mirror
 * of this shape and re-validates it on arrival — the two files are deliberately
 * independent so neither trusts the other, and each asserts the key list below
 * in its own tests.
 */
export interface JamendoTrackPayload {
  id: string
  title: string
  artistName: string
  artistId?: string
  albumName?: string
  durationSeconds: number
  artwork?: string
  artworkLarge?: string
  /** Direct HTTPS stream URL served by Jamendo's own storage. Never proxied. */
  audioUrl?: string
  /** Jamendo's page for this track — the attribution backlink. */
  sourceUrl?: string
  licenseUrl?: string
  releaseDate?: string
  /**
   * Similarity metadata, present only when the caller asked for `musicinfo`.
   *
   * Autoplay is the only action that requests it. Descriptive fields only —
   * tags and tempo — carrying no identity, no credential and no download path.
   */
  tags?: string[]
  bpm?: number
}

/** Every key the browser may receive. Asserted in tests on both sides. */
export const PAYLOAD_KEYS = [
  'id',
  'title',
  'artistName',
  'artistId',
  'albumName',
  'durationSeconds',
  'artwork',
  'artworkLarge',
  'audioUrl',
  'sourceUrl',
  'licenseUrl',
  'releaseDate',
  'tags',
  'bpm',
] as const

/** Keys that must never appear downstream, whatever Jamendo adds upstream. */
export const FORBIDDEN_KEYS = [
  'audiodownload',
  'audiodownload_allowed',
  'client_id',
  'clientId',
  'waveform',
  'prourl',
  'content_id_free',
] as const

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Jamendo returns `duration` as a number in the JSON API and as a string in
 * some cached responses; both must land on finite, positive seconds.
 */
function seconds(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  // A track longer than 24h is corrupt metadata, not a track.
  return parsed > 86_400 ? 0 : Math.round(parsed)
}

/**
 * Only absolute HTTPS URLs are ever passed on. A plain-HTTP media URL would be
 * blocked as mixed content anyway, and an unparseable one is upstream corruption.
 */
function httpsUrl(value: unknown): string | undefined {
  const raw = text(value)
  if (!raw) return undefined
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  return url.protocol === 'https:' ? url.toString() : undefined
}

/**
 * Last gate before a provider URL reaches the browser.
 *
 * Jamendo builds the stream URL's `from` parameter from the calling
 * application, and while the observed value is an app slug rather than the raw
 * credential, that is provider behaviour we do not control. If the configured
 * client id ever appears inside a URL, the URL is dropped rather than
 * published — the credential rule outranks playing that one track.
 */
function safeUrl(value: unknown, clientId: string | undefined): string | undefined {
  const url = httpsUrl(value)
  if (!url) return undefined
  return containsSecret(url, clientId) ? undefined : url
}

/** Bounded, deduplicated, lowercase tag list. Jamendo nests these under `musicinfo.tags`. */
const MAX_TAGS = 12

function tagList(value: unknown): string[] {
  // Jamendo returns either a flat array or an object of themed arrays
  // (`genres`, `instruments`, `vartags`), so both are flattened here.
  const source: unknown[] = Array.isArray(value)
    ? (value as unknown[])
    : typeof value === 'object' && value !== null
      ? Object.values(value as Record<string, unknown>).flatMap((entry): unknown[] =>
          Array.isArray(entry) ? (entry as unknown[]) : [],
        )
      : []

  const tags: string[] = []
  for (const entry of source) {
    if (typeof entry !== 'string') continue
    const tag = entry.trim().toLowerCase().slice(0, 40)
    if (!tag || tags.includes(tag)) continue
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

/** Plausible tempo, or nothing. Jamendo's `speed` is sometimes a word, not a number. */
function tempo(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  if (!Number.isFinite(parsed) || parsed < 20 || parsed > 300) return undefined
  return Math.round(parsed)
}

export interface SanitizeOptions {
  /** Used only to prove the credential is absent from what we emit. */
  clientId?: string
}

/**
 * Maps one raw Jamendo result. Returns `null` for a row with no usable identity
 * — a track with no id or no title cannot be rendered or played.
 */
export function sanitizeJamendoTrack(
  raw: unknown,
  options: SanitizeOptions = {},
): JamendoTrackPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>

  const id = text(row.id)
  if (!id) return null

  const title = text(row.name)
  if (!title) return null

  const clientId = options.clientId
  const payload: JamendoTrackPayload = {
    id,
    title,
    artistName: text(row.artist_name) || 'Unknown artist',
    durationSeconds: seconds(row.duration),
  }

  const artistId = text(row.artist_id)
  if (artistId) payload.artistId = artistId

  const albumName = text(row.album_name)
  if (albumName) payload.albumName = albumName

  // `image` is the track's own cover; `album_image` is the fallback the API
  // documents for tracks that carry no artwork of their own.
  const artwork = safeUrl(row.image, clientId) ?? safeUrl(row.album_image, clientId)
  if (artwork) payload.artwork = artwork
  const artworkLarge = safeUrl(row.album_image, clientId)
  if (artworkLarge && artworkLarge !== artwork) payload.artworkLarge = artworkLarge

  const audioUrl = safeUrl(row.audio, clientId)
  if (audioUrl) payload.audioUrl = audioUrl

  // `shareurl` is the canonical public page; `shorturl` is the documented
  // fallback (agents/14_JAMENDO_PROVIDER_CONTRACT.md → "Jamendo Normalization").
  const sourceUrl = safeUrl(row.shareurl, clientId) ?? safeUrl(row.shorturl, clientId)
  if (sourceUrl) payload.sourceUrl = sourceUrl

  const licenseUrl = safeUrl(row.license_ccurl, clientId)
  if (licenseUrl) payload.licenseUrl = licenseUrl

  const releaseDate = text(row.releasedate)
  if (releaseDate) payload.releaseDate = releaseDate

  // `musicinfo` arrives only on the similar action. Absent is normal, and the
  // similarity scorer treats it as neutral rather than as a negative signal.
  const musicinfo = row.musicinfo
  if (typeof musicinfo === 'object' && musicinfo !== null) {
    const info = musicinfo as Record<string, unknown>
    const tags = tagList(info.tags)
    if (tags.length) payload.tags = tags
    const bpm = tempo(info.speed) ?? tempo((info as { bpm?: unknown }).bpm)
    if (bpm !== undefined) payload.bpm = bpm
  }

  return payload
}

/** Sanitizes a whole result array, dropping unusable rows and duplicate ids. */
export function sanitizeJamendoTracks(
  raw: unknown,
  options: SanitizeOptions = {},
): JamendoTrackPayload[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const tracks: JamendoTrackPayload[] = []
  for (const row of raw) {
    const track = sanitizeJamendoTrack(row, options)
    if (!track || seen.has(track.id)) continue
    seen.add(track.id)
    tracks.push(track)
  }
  return tracks
}
