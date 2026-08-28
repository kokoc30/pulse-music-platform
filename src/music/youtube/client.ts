import { MusicError } from '@/music/types'
import type { YouTubeVideoItem } from '@/music/types'
import { normalizeYouTubeVideos } from './normalize'
import { parseYouTubeSearchPayload } from './wire'

/**
 * The browser's YouTube client.
 *
 * It talks to one same-origin route and nothing else. There is no
 * `import.meta.env.VITE_YOUTUBE_API_KEY` anywhere in `src/`, and no request from
 * this file ever reaches `googleapis.com` — only the serverless function holds
 * the key (agents/23_YOUTUBE_SERVERLESS_SECURITY.md → "Environment").
 *
 * Direct browser traffic to Google happens only for the thumbnail images and,
 * once the visitor presses play, for YouTube's own embedded player — neither of
 * which carries a credential of ours.
 *
 * **This function is only ever called from a click handler.** It is not wired to
 * the debounced search input, not to an effect that runs on mount, and not to
 * any prefetch. The daily allowance is 100 searches for the whole deployment
 * (docs/youtube-policy-audit.md §1); a type-ahead would exhaust it in one word.
 */

export const YOUTUBE_API_PATH = '/api/youtube'
export const YOUTUBE_TIMEOUT_MS = 8_000

export type YouTubeStatus =
  /** YouTube answered. `videos` may still be empty. */
  | 'success'
  /** No key on this deployment, or the key was rejected — hide the feature. */
  | 'unavailable'
  /** The daily quota is spent. Distinct copy, and no retry. */
  | 'quota'
  /** Configured but failed. Audius and Jamendo are unaffected. */
  | 'error'

export interface YouTubeSearchResult {
  status: YouTubeStatus
  videos: YouTubeVideoItem[]
  /** Round-trips this call actually made to `/api/youtube`. 0 on a cache hit. */
  requests: number
  /** Diagnostics only — never rendered. */
  detail?: string
}

export interface YouTubeSearchOptions {
  signal?: AbortSignal
  /** Test seam. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Set false to force a network round-trip regardless of the session cache. */
  useCache?: boolean
}

/**
 * Exact-query, in-memory, per-tab cache.
 *
 * agents/22 → "Caching" permits a short-lived session cache and forbids caching
 * audiovisual content. This holds neither media nor anything user-identifying:
 * only the normalized metadata of a query the visitor already ran, keyed on the
 * literal query text, in a plain `Map` that dies with the tab. Nothing is
 * written to `localStorage`, to a cookie or to a database.
 *
 * Its purpose is quota, not speed: pressing the fallback button twice for the
 * same query must not cost two of the day's hundred searches.
 */
const sessionCache = new Map<string, YouTubeVideoItem[]>()
const MAX_CACHE_ENTRIES = 20

export function clearYouTubeSessionCache(): void {
  sessionCache.clear()
}

export function youTubeSessionCacheSize(): number {
  return sessionCache.size
}

function rememberQuery(query: string, videos: YouTubeVideoItem[]): void {
  if (sessionCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = sessionCache.keys().next()
    if (!oldest.done) sessionCache.delete(oldest.value)
  }
  sessionCache.set(query, videos)
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError'
}

/**
 * Resolves the route against the current document, which keeps the request
 * same-origin by construction and makes the URL absolute — jsdom and Node
 * require an absolute URL where a browser would accept the bare path.
 */
export function youtubeRequestUrl(params: URLSearchParams): string {
  const path = `${YOUTUBE_API_PATH}?${params.toString()}`
  const base = typeof window === 'undefined' ? undefined : window.location?.href
  if (!base) return path
  try {
    return new URL(path, base).toString()
  } catch {
    return path
  }
}

/**
 * One explicit YouTube fallback search. Never throws except on caller abort,
 * which is re-raised as the domain's `ABORTED`.
 *
 * There is no retry on any failure path. A quota error in particular is final:
 * retrying it would spend nothing but would also never succeed, and rotating
 * keys or projects to get around it is explicitly forbidden.
 */
export async function searchYouTubeVideos(
  query: string,
  options: YouTubeSearchOptions = {},
): Promise<YouTubeSearchResult> {
  // The literal query is preserved: only surrounding whitespace is trimmed, so
  // Armenian, Arabic and Cyrillic text reaches the endpoint in its own script.
  const trimmed = query.trim()
  if (!trimmed) return { status: 'success', videos: [], requests: 0 }

  if (options.useCache !== false) {
    const cached = sessionCache.get(trimmed)
    if (cached) return { status: 'success', videos: cached, requests: 0 }
  }

  const doFetch = options.fetchImpl ?? fetch
  // Exactly two parameters. No limit, no page token, no part, no key: the
  // endpoint is a narrow action, not a proxy.
  const params = new URLSearchParams({ action: 'search', q: trimmed })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? YOUTUBE_TIMEOUT_MS)
  let callerAborted = false
  const onCallerAbort = () => {
    callerAborted = true
    controller.abort()
  }
  if (options.signal?.aborted) onCallerAbort()
  options.signal?.addEventListener('abort', onCallerAbort, { once: true })

  try {
    const response = await doFetch(youtubeRequestUrl(params), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    // 503 is the documented "not configured / key rejected" answer: a
    // deployment state, not something the visitor should be asked to fix.
    if (response.status === 503) return { status: 'unavailable', videos: [], requests: 1 }
    if (response.status === 429) return { status: 'quota', videos: [], requests: 1 }
    if (!response.ok) {
      return { status: 'error', videos: [], requests: 1, detail: `HTTP ${response.status}` }
    }

    const body: unknown = await response.json()
    const videos = normalizeYouTubeVideos(parseYouTubeSearchPayload(body))
    if (options.useCache !== false) rememberQuery(trimmed, videos)
    return { status: 'success', videos, requests: 1 }
  } catch (error) {
    if (callerAborted || options.signal?.aborted) {
      throw new MusicError('ABORTED', 'Request cancelled.', { cause: error })
    }
    if (isAbort(error)) return { status: 'error', videos: [], requests: 1, detail: 'timeout' }
    return { status: 'error', videos: [], requests: 1, detail: 'network' }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onCallerAbort)
  }
}
