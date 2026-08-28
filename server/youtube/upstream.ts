import { describeError } from '../shared/redact'
import { sanitizeYouTubeVideos } from './sanitize'
import type { YouTubeVideoPayload } from './sanitize'

/**
 * The only place that talks to the YouTube Data API, and the only place the API
 * key is ever written into a request.
 *
 * Endpoints and parameters follow the live v3 documentation re-verified in
 * docs/youtube-policy-audit.md §2 and §3. The exchange is deliberately fixed at
 * **two requests, always, per explicit user action**:
 *
 *   1. one `search.list`  — 1 unit from the 100/day search bucket,
 *   2. one `videos.list`  — 1 unit from the 10,000/day general pool, batched
 *      over every id the search returned.
 *
 * There is no pagination, no alias fan-out, no retry loop and no second search
 * under any condition (agents/22_YOUTUBE_SEARCH_QUOTA_ARCHITECTURE.md).
 */

export const YOUTUBE_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search'
export const YOUTUBE_VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos'

/** Fixed product cap. Not caller-controllable — quota is a shared resource. */
export const RESULT_COUNT = 8
export const MAX_QUERY_LENGTH = 120
export const UPSTREAM_TIMEOUT_MS = 8_000
/** YouTube's own Music category. Documented; requires `type=video`. */
export const MUSIC_CATEGORY_ID = '10'

export type UpstreamFailure =
  /** Transport/HTTP failure, or unparseable JSON. */
  | 'upstream'
  /** The daily quota is exhausted, or the key is rate-limited. */
  | 'quota'
  /** The key was rejected — wrong key, API not enabled, key restricted out. */
  | 'forbidden'
  /** The request exceeded `UPSTREAM_TIMEOUT_MS` or was aborted. */
  | 'timeout'

export interface UpstreamSuccess {
  ok: true
  videos: YouTubeVideoPayload[]
  /** Round-trips actually spent upstream. Asserted by the quota tests. */
  requests: { search: number; videos: number }
}

export type UpstreamResult =
  | UpstreamSuccess
  | { ok: false; failure: UpstreamFailure; detail: string; status?: number }

export interface SearchParams {
  query: string
  /** ISO 639-1, only when the script is unambiguous. Never guessed. */
  relevanceLanguage?: string
}

export interface UpstreamOptions {
  apiKey: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Armenian and Arabic scripts each map to exactly one language, so a
 * `relevanceLanguage` hint is safe and improves international recall. Cyrillic
 * does not — it spans Russian, Ukrainian, Bulgarian, Serbian, Macedonian and
 * more — so it is deliberately left unset rather than guessed
 * (agents/22 → "International Queries").
 */
export function detectRelevanceLanguage(query: string): string | undefined {
  if (/[԰-֏]/u.test(query)) return 'hy'
  if (/[؀-ۿݐ-ݿࢠ-ࣿ]/u.test(query)) return 'ar'
  return undefined
}

/**
 * Builds the `search.list` URL through `URL`/`URLSearchParams` so the visitor's
 * query is percent-encoded rather than concatenated — Armenian, Arabic and
 * Cyrillic text survives byte-for-byte and no query string can be injected.
 */
export function buildSearchUrl(params: SearchParams, apiKey: string): URL {
  const url = new URL(YOUTUBE_SEARCH_ENDPOINT)
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('type', 'video')
  url.searchParams.set('q', params.query)
  url.searchParams.set('maxResults', String(RESULT_COUNT))
  url.searchParams.set('order', 'relevance')
  url.searchParams.set('videoEmbeddable', 'true')
  url.searchParams.set('videoSyndicated', 'true')
  url.searchParams.set('safeSearch', 'moderate')
  url.searchParams.set('videoCategoryId', MUSIC_CATEGORY_ID)
  if (params.relevanceLanguage) url.searchParams.set('relevanceLanguage', params.relevanceLanguage)
  url.searchParams.set('key', apiKey)
  return url
}

/**
 * One batched `videos.list` for every id the search returned. `id` is documented
 * as "a comma-separated list of the YouTube video ID(s)", and the call costs one
 * unit regardless of how many ids it carries.
 */
export function buildVideosUrl(videoIds: readonly string[], apiKey: string): URL {
  const url = new URL(YOUTUBE_VIDEOS_ENDPOINT)
  url.searchParams.set('part', 'snippet,contentDetails,status')
  url.searchParams.set('id', videoIds.join(','))
  url.searchParams.set('maxResults', String(Math.max(videoIds.length, 1)))
  url.searchParams.set('key', apiKey)
  return url
}

interface GoogleErrorEnvelope {
  error?: {
    code?: unknown
    message?: unknown
    errors?: Array<{ reason?: unknown; domain?: unknown }>
  }
}

/**
 * Google reports quota exhaustion as HTTP 403 with `reason: quotaExceeded` (or
 * `rateLimitExceeded`/`dailyLimitExceeded`), and a bad or restricted key as 403
 * with a different reason. The two need different user-facing outcomes, so the
 * reason is read rather than the status alone.
 */
export function classifyGoogleError(status: number, body: unknown): UpstreamFailure {
  if (status === 429) return 'quota'
  const reasons = new Set<string>()
  if (typeof body === 'object' && body !== null) {
    for (const entry of (body as GoogleErrorEnvelope).error?.errors ?? []) {
      if (typeof entry?.reason === 'string') reasons.add(entry.reason)
    }
  }
  if (reasons.has('quotaExceeded') || reasons.has('dailyLimitExceeded') || reasons.has('rateLimitExceeded')) {
    return 'quota'
  }
  if (status === 401 || status === 403) return 'forbidden'
  return 'upstream'
}

/** Never logged, never returned: only the reason strings above are read. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

interface FetchOnce {
  ok: true
  body: unknown
}
type FetchResult = FetchOnce | { ok: false; failure: UpstreamFailure; detail: string; status?: number }

async function fetchJson(
  url: URL,
  options: UpstreamOptions,
  label: string,
): Promise<FetchResult> {
  const doFetch = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? UPSTREAM_TIMEOUT_MS)
  const onOuterAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    const response = await doFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await readJson(response)
      return {
        ok: false,
        failure: classifyGoogleError(response.status, body),
        // No part of Google's error payload is echoed: it can contain the
        // request URL, and the request URL carries `key=`.
        detail: `${label} answered HTTP ${response.status}.`,
        status: response.status,
      }
    }

    const body = await readJson(response)
    if (body === null) {
      return { ok: false, failure: 'upstream', detail: `${label} returned unparseable JSON.` }
    }
    return { ok: true, body }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      failure: aborted ? 'timeout' : 'upstream',
      // Redacted: `fetch` puts the full request URL — API key included — into
      // the error it throws.
      detail: describeError(error, options.apiKey),
    }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onOuterAbort)
  }
}

function readSearchIds(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return []
  const items = (body as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  const ids: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const raw = (item as { id?: unknown } | null)?.id
    const id =
      typeof raw === 'object' && raw !== null ? (raw as { videoId?: unknown }).videoId : raw
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (!/^[A-Za-z0-9_-]{5,20}$/.test(trimmed) || seen.has(trimmed)) continue
    seen.add(trimmed)
    ids.push(trimmed)
    if (ids.length >= RESULT_COUNT) break
  }
  return ids
}

/**
 * One explicit YouTube fallback: exactly one `search.list`, then exactly one
 * batched `videos.list`. Never throws — every failure is mapped onto
 * `UpstreamResult`, so a YouTube outage can only degrade the fallback, never
 * break the page.
 */
export async function searchYouTube(
  params: SearchParams,
  options: UpstreamOptions,
): Promise<UpstreamResult> {
  const search = await fetchJson(buildSearchUrl(params, options.apiKey), options, 'YouTube search')
  if (!search.ok) return search

  const ids = readSearchIds(search.body)
  if (ids.length === 0) {
    return { ok: true, videos: [], requests: { search: 1, videos: 0 } }
  }

  const details = await fetchJson(buildVideosUrl(ids, options.apiKey), options, 'YouTube videos')
  if (!details.ok) return details

  const items = (details.body as { items?: unknown }).items
  const videos = sanitizeYouTubeVideos(items, { apiKey: options.apiKey })

  // `videos.list` does not promise the request order, and relevance order is
  // the only ranking YouTube gives us — `agents/22` → "Ranking" says preserve
  // it rather than invent a score. So the search order is reapplied here.
  const order = new Map(ids.map((id, index) => [id, index]))
  videos.sort((a, b) => (order.get(a.videoId) ?? 0) - (order.get(b.videoId) ?? 0))

  return { ok: true, videos, requests: { search: 1, videos: 1 } }
}
