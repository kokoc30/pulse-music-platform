import { containsSecret, describeError, redactLiteral } from '../shared/redact'
import { readYouTubeEnv } from './env'
import type { EnvSource } from './env'
import { FORBIDDEN_KEYS } from './sanitize'
import type { YouTubeVideoPayload } from './sanitize'
import { MAX_QUERY_LENGTH, RESULT_COUNT, detectRelevanceLanguage, searchYouTube } from './upstream'

/**
 * The one same-origin endpoint the browser is allowed to call for YouTube
 * metadata.
 *
 * This is deliberately **not** a Google proxy: the method, the action and every
 * query parameter are allow-listed, the result count is a fixed product
 * constant the caller cannot raise, and nothing the caller sends is forwarded
 * upstream except the search text
 * (agents/23_YOUTUBE_SERVERLESS_SECURITY.md → "API Shape").
 *
 * Shared by both hosts so local development and production can never diverge:
 * `api/youtube.ts` (Vercel Function) and the Vite dev/preview middleware both
 * call `handleYouTubeRequest`.
 */

export type YouTubeErrorCode =
  | 'BAD_REQUEST'
  | 'METHOD_NOT_ALLOWED'
  | 'UNAVAILABLE'
  | 'QUOTA'
  | 'TIMEOUT'
  | 'UPSTREAM'

export interface YouTubeErrorBody {
  error: { code: YouTubeErrorCode; message: string }
}

export interface YouTubeSearchBody {
  provider: 'youtube'
  action: 'search'
  query: string
  count: number
  results: YouTubeVideoPayload[]
}

/** Only these actions exist. Anything else is rejected before any work happens. */
const ALLOWED_ACTIONS = new Set(['search'])
/** Every query parameter the endpoint understands. Unknown ones are ignored. */
export const ALLOWED_PARAMS = ['action', 'q'] as const

/**
 * Copy that is safe to show a visitor — never carries provider detail.
 *
 * `QUOTA` is the message agents/22 → "Quota Errors" specifies. It is a dead end
 * on purpose: there is no retry, no key rotation and no scraping fallback.
 */
const USER_MESSAGES: Record<YouTubeErrorCode, string> = {
  BAD_REQUEST: 'That search request was not valid.',
  METHOD_NOT_ALLOWED: 'Only GET is supported here.',
  UNAVAILABLE: 'YouTube search is not available on this deployment.',
  QUOTA: 'YouTube search is temporarily unavailable. Try again later.',
  TIMEOUT: 'YouTube took too long to answer.',
  UPSTREAM: 'YouTube search had a problem.',
}

const STATUS: Record<YouTubeErrorCode, number> = {
  BAD_REQUEST: 400,
  METHOD_NOT_ALLOWED: 405,
  UNAVAILABLE: 503,
  QUOTA: 429,
  TIMEOUT: 504,
  UPSTREAM: 502,
}

export interface HandlerOptions {
  env?: EnvSource
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Injected in tests so redaction can be asserted without a real console. */
  logger?: (message: string) => void
}

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Same-origin only: no CORS header is emitted on purpose.
      //
      // `no-store` on purpose too. agents/22 → "Caching" permits a short CDN
      // cache, but a shared cache keyed only on the URL would serve one
      // visitor's YouTube metadata to another, and the quota saving is
      // negligible next to that: the expensive call is already gated behind a
      // deliberate click. Repeat queries are absorbed by a per-session,
      // in-memory client cache instead — nothing is written to disk anywhere.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  })
}

function fail(code: YouTubeErrorCode, extraHeaders?: Record<string, string>): Response {
  const body: YouTubeErrorBody = { error: { code, message: USER_MESSAGES[code] } }
  return json(body, STATUS[code], extraHeaders)
}

/**
 * Belt-and-braces check that nothing forbidden survived sanitization. A payload
 * that fails this is dropped rather than published, so a future upstream field
 * cannot leak by being added to `sanitize.ts` and forgotten here.
 */
function isPublishable(video: YouTubeVideoPayload, apiKey: string): boolean {
  const row = video as unknown as Record<string, unknown>
  for (const key of FORBIDDEN_KEYS) {
    if (key in row) return false
  }
  return !containsSecret(JSON.stringify(video), apiKey)
}

export async function handleYouTubeRequest(
  request: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  const env = options.env ?? (globalThis as { process?: { env?: EnvSource } }).process?.env ?? {}
  const log = options.logger ?? ((message: string) => console.error(message))

  if (request.method !== 'GET') {
    return fail('METHOD_NOT_ALLOWED', { allow: 'GET' })
  }

  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return fail('BAD_REQUEST')
  }

  const action = url.searchParams.get('action') ?? 'search'
  if (!ALLOWED_ACTIONS.has(action)) return fail('BAD_REQUEST')

  const rawQuery = url.searchParams.get('q') ?? ''
  // Unicode is preserved exactly: only whitespace is normalized, so Arabic,
  // Cyrillic and Armenian queries reach Google in their own script.
  const query = rawQuery.replace(/\s+/gu, ' ').trim().slice(0, MAX_QUERY_LENGTH)
  if (!query) return fail('BAD_REQUEST')

  // Configuration is read last so a malformed request is rejected identically
  // whether or not YouTube happens to be configured.
  const config = readYouTubeEnv(env)
  if (!config.configured) {
    // Not an error the visitor caused: this deployment simply has no key, and
    // Audius and Jamendo carry the app exactly as in Phase 2 (agents/23 →
    // "Missing Key").
    return fail('UNAVAILABLE')
  }

  const { apiKey } = config.env
  const relevanceLanguage = detectRelevanceLanguage(query)
  const result = await searchYouTube(
    { query, ...(relevanceLanguage ? { relevanceLanguage } : {}) },
    {
      apiKey,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    },
  )

  if (!result.ok) {
    // Redacted twice over: `detail` is already scrubbed upstream, and the
    // literal credential is removed again here before anything is written out.
    log(`[youtube] ${redactLiteral(result.detail, apiKey)}`)
    if (result.failure === 'quota') return fail('QUOTA')
    if (result.failure === 'timeout') return fail('TIMEOUT')
    // A rejected or restricted key is a deployment problem, not a visitor
    // problem, and it is indistinguishable from "no YouTube here" as far as the
    // visitor is concerned.
    if (result.failure === 'forbidden') return fail('UNAVAILABLE')
    return fail('UPSTREAM')
  }

  const results = result.videos.filter((video) => isPublishable(video, apiKey)).slice(0, RESULT_COUNT)
  const body: YouTubeSearchBody = {
    provider: 'youtube',
    action: 'search',
    query,
    count: results.length,
    results,
  }
  return json(body, 200)
}

/**
 * Adapter used by both hosts: turns any unexpected throw into a safe 502 rather
 * than a stack trace, which on Vercel would otherwise reach the response body.
 */
export async function handleYouTubeRequestSafely(
  request: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  try {
    return await handleYouTubeRequest(request, options)
  } catch (error) {
    const log = options.logger ?? ((message: string) => console.error(message))
    log(`[youtube] unhandled: ${describeError(error, options.env?.YOUTUBE_API_KEY)}`)
    return fail('UPSTREAM')
  }
}
