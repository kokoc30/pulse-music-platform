/**
 * Browser-side mirror of the `/api/jamendo` wire contract, plus the runtime
 * validation that enforces it.
 *
 * This file is deliberately independent of `server/jamendo/sanitize.ts`: the
 * server decides what it emits, the browser decides what it accepts, and
 * neither trusts the other. Both sides assert the same key list in their own
 * tests, so a drift shows up as a failing test rather than a runtime surprise.
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
  audioUrl?: string
  sourceUrl?: string
  licenseUrl?: string
  releaseDate?: string
  /** Similarity metadata. Present only on the autoplay similar action. */
  tags?: string[]
  bpm?: number
}

/** Mirrors `PAYLOAD_KEYS` in `server/jamendo/sanitize.ts`. */
export const WIRE_KEYS = [
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

/**
 * Keys that must never arrive. Mirrors `FORBIDDEN_KEYS` server-side; a response
 * carrying any of them is treated as compromised and rejected wholesale rather
 * than filtered, because it means the sanitizer did not run.
 */
export const FORBIDDEN_WIRE_KEYS = [
  'audiodownload',
  'audiodownload_allowed',
  'client_id',
  'clientId',
  'waveform',
  'prourl',
] as const

export interface JamendoSearchPayload {
  provider: 'jamendo'
  query: string
  results: JamendoTrackPayload[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown): string | undefined {
  const trimmed = text(value)
  return trimmed || undefined
}

function seconds(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0
}

/** Only absolute HTTPS URLs are accepted, whatever the server said. */
function httpsUrl(value: unknown): string | undefined {
  const raw = text(value)
  if (!raw) return undefined
  try {
    return new URL(raw).protocol === 'https:' ? raw : undefined
  } catch {
    return undefined
  }
}

export function parseJamendoTrack(raw: unknown): JamendoTrackPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>

  for (const forbidden of FORBIDDEN_WIRE_KEYS) {
    if (forbidden in row) return null
  }

  const id = text(row.id)
  const title = text(row.title)
  if (!id || !title) return null

  const track: JamendoTrackPayload = {
    id,
    title,
    artistName: text(row.artistName) || 'Unknown artist',
    durationSeconds: seconds(row.durationSeconds),
  }

  const artistId = optionalText(row.artistId)
  if (artistId) track.artistId = artistId
  const albumName = optionalText(row.albumName)
  if (albumName) track.albumName = albumName
  const artwork = httpsUrl(row.artwork)
  if (artwork) track.artwork = artwork
  const artworkLarge = httpsUrl(row.artworkLarge)
  if (artworkLarge) track.artworkLarge = artworkLarge
  const audioUrl = httpsUrl(row.audioUrl)
  if (audioUrl) track.audioUrl = audioUrl
  const sourceUrl = httpsUrl(row.sourceUrl)
  if (sourceUrl) track.sourceUrl = sourceUrl
  const licenseUrl = httpsUrl(row.licenseUrl)
  if (licenseUrl) track.licenseUrl = licenseUrl
  const releaseDate = optionalText(row.releaseDate)
  if (releaseDate) track.releaseDate = releaseDate
  const tags = tagList(row.tags)
  if (tags.length) track.tags = tags
  const bpm = tempo(row.bpm)
  if (bpm !== undefined) track.bpm = bpm

  return track
}

/** Validates the whole envelope; an unusable body yields an empty result set. */
export function parseJamendoSearchPayload(body: unknown): JamendoTrackPayload[] {
  if (typeof body !== 'object' || body === null) return []
  const results = (body as { results?: unknown }).results
  if (!Array.isArray(results)) return []

  const seen = new Set<string>()
  const tracks: JamendoTrackPayload[] = []
  for (const row of results) {
    const track = parseJamendoTrack(row)
    if (!track || seen.has(track.id)) continue
    seen.add(track.id)
    tracks.push(track)
  }
  return tracks
}

/**
 * Bounded, lowercase tag list. The browser re-validates rather than trusting
 * the server's own cap, for the same reason this whole file exists.
 */
function tagList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const tag = entry.trim().toLowerCase().slice(0, 40)
    if (!tag || tags.includes(tag)) continue
    tags.push(tag)
    if (tags.length >= 12) break
  }
  return tags
}

function tempo(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value < 20 || value > 300) return undefined
  return Math.round(value)
}

/**
 * The similar action's envelope.
 *
 * Shares `parseJamendoTrack`, so a similar result is validated by exactly the
 * same rules — including the forbidden-key rejection — as a search result.
 */
export function parseJamendoSimilarPayload(body: unknown): JamendoTrackPayload[] {
  if (typeof body !== 'object' || body === null) return []
  if ((body as { action?: unknown }).action !== 'similar') return []
  return parseJamendoSearchPayload(body)
}
