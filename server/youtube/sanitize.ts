import { containsSecret } from '../shared/redact.js'

/**
 * Raw YouTube API resources → the narrow payload the browser is allowed to see.
 *
 * Three jobs:
 *
 * 1. **Validation.** Nothing Google returns is trusted: ids can be objects or
 *    strings, `status` can be absent, `madeForKids` can be missing entirely.
 * 2. **Sanitization.** Only the fields the UI and the embedded player actually
 *    need cross the wire. Statistics, tags, topic ids, localizations, region
 *    restrictions, player embed HTML and anything credential-bearing are
 *    dropped (agents/23 → "Sanitization").
 * 3. **Presentation truth.** Titles and channel names arrive HTML-escaped from
 *    the API and are decoded to text here, never rendered as markup
 *    (agents/22 → "HTML Entities").
 */

/**
 * The wire contract. `src/music/youtube/wire.ts` holds the browser-side mirror
 * of this shape and re-validates it on arrival — the two files are deliberately
 * independent so neither trusts the other, and each asserts the key list below
 * in its own tests.
 */
export interface YouTubeVideoPayload {
  videoId: string
  title: string
  channelTitle: string
  channelId?: string
  /** Natively 16:9 where YouTube published one. Never cropped or re-hosted. */
  thumbnailUrl: string
  thumbnailWidth?: number
  thumbnailHeight?: number
  publishedAt?: string
  durationSeconds?: number
  /** `status.embeddable`. Absent upstream is treated as not embeddable. */
  embeddable: boolean
  /**
   * `status.madeForKids`. `null` means YouTube did not report it, which is
   * treated as "not known safe" — see docs/youtube-policy-audit.md §9.
   */
  madeForKids: boolean | null
  /** `snippet.liveBroadcastContent` other than `none`, when present. */
  liveBroadcast?: 'live' | 'upcoming'
}

/** Every key the browser may receive. Asserted in tests on both sides. */
export const PAYLOAD_KEYS = [
  'videoId',
  'title',
  'channelTitle',
  'channelId',
  'thumbnailUrl',
  'thumbnailWidth',
  'thumbnailHeight',
  'publishedAt',
  'durationSeconds',
  'embeddable',
  'madeForKids',
  'liveBroadcast',
] as const

/** Keys that must never appear downstream, whatever Google adds upstream. */
export const FORBIDDEN_KEYS = [
  'key',
  'api_key',
  'apiKey',
  'etag',
  'statistics',
  'player',
  'topicDetails',
  'recordingDetails',
  'fileDetails',
  'processingDetails',
  'suggestions',
  'localizations',
  'contentRating',
  'regionRestriction',
] as const

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The five named HTML entities the YouTube Data API uses when escaping snippet
 * text, plus numeric references. Decoding is done with a table rather than by
 * assigning to `innerHTML`: this runs on a server with no DOM, and turning
 * provider text into markup is precisely what must never happen
 * (agents/22 → "Never use `dangerouslySetInnerHTML` for YouTube titles").
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase()
    const named = NAMED_ENTITIES[key]
    if (named !== undefined) return named
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? safeFromCodePoint(code) : match
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? safeFromCodePoint(code) : match
    }
    return match
  })
}

function safeFromCodePoint(code: number): string {
  // Lone surrogates are not characters; leaving them out keeps the string
  // well-formed UTF-8 for JSON.stringify.
  if (code >= 0xd800 && code <= 0xdfff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/**
 * `PT4M13S` → `253`. Per the Video resource reference, `contentDetails.duration`
 * "is an ISO 8601 duration". Only the day/hour/minute/second components a video
 * can actually carry are honoured; anything else yields `undefined` rather than
 * a wrong number.
 */
export function parseIso8601Duration(value: unknown): number | undefined {
  const raw = text(value)
  if (!raw) return undefined
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(raw)
  if (!match) return undefined
  const [, days, hours, minutes, seconds] = match
  if (!days && !hours && !minutes && !seconds) return undefined
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  if (!Number.isFinite(total) || total <= 0) return undefined
  // A "video" longer than 24h is a stuck livestream placeholder, not a track.
  return total > 86_400 ? undefined : Math.round(total)
}

interface RawThumbnail {
  url?: unknown
  width?: unknown
  height?: unknown
}

/**
 * Picks the largest natively-16:9 thumbnail YouTube published.
 *
 * Documented sizes: `maxres` 1280×720 and `medium` 320×180 are 16:9; `default`
 * 120×90, `high` 480×360 and `standard` 640×480 are 4:3. `agents/25` requires
 * the thumbnail be shown unmodified at 16:9, so a 4:3 key is only ever used as
 * a last resort — and when one is, its real dimensions travel with it so the UI
 * can letterbox rather than crop (docs/youtube-policy-audit.md §3).
 */
const THUMBNAIL_PREFERENCE = ['maxres', 'medium', 'standard', 'high', 'default'] as const

export function pickThumbnail(thumbnails: unknown): {
  url: string
  width?: number
  height?: number
} | null {
  if (typeof thumbnails !== 'object' || thumbnails === null) return null
  const map = thumbnails as Record<string, RawThumbnail | undefined>
  for (const key of THUMBNAIL_PREFERENCE) {
    const candidate = map[key]
    const url = text(candidate?.url)
    if (!url || !/^https:\/\//i.test(url)) continue
    const width = typeof candidate?.width === 'number' ? candidate.width : undefined
    const height = typeof candidate?.height === 'number' ? candidate.height : undefined
    return {
      url,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    }
  }
  return null
}

/** `search.list` returns `id` as `{ kind, videoId }`; `videos.list` as a string. */
export function readVideoId(value: unknown): string {
  if (typeof value === 'string') return /^[A-Za-z0-9_-]{5,20}$/.test(value.trim()) ? value.trim() : ''
  if (typeof value === 'object' && value !== null) {
    return readVideoId((value as { videoId?: unknown }).videoId)
  }
  return ''
}

interface RawItem {
  id?: unknown
  snippet?: {
    title?: unknown
    channelTitle?: unknown
    channelId?: unknown
    thumbnails?: unknown
    publishedAt?: unknown
    liveBroadcastContent?: unknown
  }
  contentDetails?: { duration?: unknown }
  status?: { embeddable?: unknown; madeForKids?: unknown; privacyStatus?: unknown; uploadStatus?: unknown }
}

/**
 * One `videos.list` item → one payload, or `null` when the item cannot be shown
 * safely or usefully.
 *
 * A missing `status` block is *not* treated as permission to embed: without an
 * explicit `embeddable === true` the item becomes external-only downstream.
 */
export function sanitizeYouTubeVideo(raw: unknown, options: { apiKey?: string } = {}): YouTubeVideoPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as RawItem

  const videoId = readVideoId(item.id)
  if (!videoId) return null

  const title = decodeHtmlEntities(text(item.snippet?.title))
  if (!title) return null

  const thumbnail = pickThumbnail(item.snippet?.thumbnails)
  if (!thumbnail) return null

  const status = item.status
  const privacy = text(status?.privacyStatus)
  const upload = text(status?.uploadStatus)
  // A non-public or unprocessed video cannot be shown to a visitor at all.
  if (privacy && privacy !== 'public') return null
  if (upload && upload !== 'processed' && upload !== 'uploaded') return null

  const live = text(item.snippet?.liveBroadcastContent)
  const durationSeconds = parseIso8601Duration(item.contentDetails?.duration)
  const channelId = text(item.snippet?.channelId)
  const publishedAt = text(item.snippet?.publishedAt)

  const payload: YouTubeVideoPayload = {
    videoId,
    title,
    channelTitle: decodeHtmlEntities(text(item.snippet?.channelTitle)),
    ...(channelId ? { channelId } : {}),
    thumbnailUrl: thumbnail.url,
    ...(thumbnail.width !== undefined ? { thumbnailWidth: thumbnail.width } : {}),
    ...(thumbnail.height !== undefined ? { thumbnailHeight: thumbnail.height } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    embeddable: status?.embeddable === true,
    madeForKids: typeof status?.madeForKids === 'boolean' ? status.madeForKids : null,
    ...(live === 'live' || live === 'upcoming' ? { liveBroadcast: live } : {}),
  }

  // Last gate: a credential can never have got in here, but the assertion is
  // cheap and it is what makes "no key in the response" a tested property
  // rather than a claim.
  if (options.apiKey && containsSecret(JSON.stringify(payload), options.apiKey)) return null

  return payload
}

export function sanitizeYouTubeVideos(
  raw: unknown,
  options: { apiKey?: string } = {},
): YouTubeVideoPayload[] {
  if (!Array.isArray(raw)) return []
  const out: YouTubeVideoPayload[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const payload = sanitizeYouTubeVideo(entry, options)
    if (!payload || seen.has(payload.videoId)) continue
    seen.add(payload.videoId)
    out.push(payload)
  }
  return out
}
