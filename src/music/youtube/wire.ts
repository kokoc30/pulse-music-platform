/**
 * The browser's independent validation of `/api/youtube`'s response.
 *
 * `server/youtube/sanitize.ts` holds the server-side mirror of this shape. The
 * two files are deliberately independent: neither imports the other, and each
 * asserts the same key list in its own tests. A field the server stops sending
 * therefore fails a test here rather than rendering `undefined` in the UI.
 *
 * Nothing here trusts the payload. Every field is re-checked, because "our own
 * endpoint" is still a network boundary.
 */

export interface YouTubeVideoPayload {
  videoId: string
  title: string
  channelTitle: string
  channelId?: string
  thumbnailUrl: string
  thumbnailWidth?: number
  thumbnailHeight?: number
  publishedAt?: string
  durationSeconds?: number
  embeddable: boolean
  madeForKids: boolean | null
  liveBroadcast?: 'live' | 'upcoming'
}

/** Mirror of `server/youtube/sanitize.ts` → `PAYLOAD_KEYS`. */
export const WIRE_KEYS = [
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

/** YouTube video ids are 11 URL-safe characters; the range stays generous. */
const VIDEO_ID = /^[A-Za-z0-9_-]{5,20}$/

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

export function parseYouTubeVideoPayload(raw: unknown): YouTubeVideoPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>

  const videoId = text(row.videoId)
  if (!VIDEO_ID.test(videoId)) return null

  const title = text(row.title)
  if (!title) return null

  // Only an https image is ever rendered: a downgraded or data: URL would be
  // both a mixed-content problem and a sign the payload is not ours.
  const thumbnailUrl = text(row.thumbnailUrl)
  if (!/^https:\/\//i.test(thumbnailUrl)) return null

  const channelId = text(row.channelId)
  const publishedAt = text(row.publishedAt)
  const width = positiveNumber(row.thumbnailWidth)
  const height = positiveNumber(row.thumbnailHeight)
  const durationSeconds = positiveNumber(row.durationSeconds)
  const live = text(row.liveBroadcast)

  return {
    videoId,
    title,
    channelTitle: text(row.channelTitle),
    ...(channelId ? { channelId } : {}),
    thumbnailUrl,
    ...(width !== undefined ? { thumbnailWidth: width } : {}),
    ...(height !== undefined ? { thumbnailHeight: height } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    // Absent or non-boolean means "not stated", which must never read as
    // permission to embed.
    embeddable: row.embeddable === true,
    madeForKids: typeof row.madeForKids === 'boolean' ? row.madeForKids : null,
    ...(live === 'live' || live === 'upcoming' ? { liveBroadcast: live } : {}),
  }
}

export function parseYouTubeSearchPayload(body: unknown): YouTubeVideoPayload[] {
  if (typeof body !== 'object' || body === null) return []
  const results = (body as { results?: unknown }).results
  if (!Array.isArray(results)) return []
  const out: YouTubeVideoPayload[] = []
  const seen = new Set<string>()
  for (const entry of results) {
    const payload = parseYouTubeVideoPayload(entry)
    if (!payload || seen.has(payload.videoId)) continue
    seen.add(payload.videoId)
    out.push(payload)
  }
  return out
}
