import { readJamendoEnv } from './env.js'
import type { EnvSource } from './env.js'
import { containsSecret, describeError, redactLiteral } from './redact.js'
import { FORBIDDEN_KEYS } from './sanitize.js'
import type { JamendoTrackPayload } from './sanitize.js'
import {
  MAX_QUERY_LENGTH,
  clampLimit,
  isValidJamendoId,
  searchJamendo,
  similarJamendo,
} from './upstream.js'

/**
 * The one same-origin endpoint the browser is allowed to call.
 *
 * This is deliberately **not** a Jamendo proxy: the method, the action and every
 * query parameter are allow-listed, and nothing the caller sends is forwarded
 * upstream except the search text and a clamped limit
 * (agents/16_JAMENDO_SERVERLESS_SECURITY.md → "Public API Contract").
 *
 * Shared by both hosts so local development and production can never diverge:
 * `api/jamendo.ts` (Vercel Function) and the Vite dev/preview middleware both
 * call `handleJamendoRequest`.
 */

export type JamendoErrorCode =
  | 'BAD_REQUEST'
  | 'METHOD_NOT_ALLOWED'
  | 'UNAVAILABLE'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'UPSTREAM'

export interface JamendoErrorBody {
  error: { code: JamendoErrorCode; message: string }
}

export interface JamendoSearchBody {
  provider: 'jamendo'
  action: 'search'
  query: string
  count: number
  results: JamendoTrackPayload[]
}

/**
 * The autoplay action's envelope.
 *
 * Deliberately a sibling of the search body rather than a widened version of
 * it: the two actions answer different questions, and keeping the shapes apart
 * means the browser can tell which one it asked for without inspecting fields.
 */
export interface JamendoSimilarBody {
  provider: 'jamendo'
  action: 'similar'
  /** The seed track's id, echoed back so a stale answer is recognisable. */
  id: string
  count: number
  results: JamendoTrackPayload[]
}

/** Only these actions exist. Anything else is rejected before any work happens. */
const ALLOWED_ACTIONS = new Set(['search', 'similar'])
/** Every query parameter the endpoint understands. Unknown ones are ignored. */
export const ALLOWED_PARAMS = ['action', 'q', 'limit', 'id'] as const

/** Copy that is safe to show a visitor — never carries provider detail. */
const USER_MESSAGES: Record<JamendoErrorCode, string> = {
  BAD_REQUEST: 'That search request was not valid.',
  METHOD_NOT_ALLOWED: 'Only GET is supported here.',
  UNAVAILABLE: 'The Jamendo catalogue is not available right now.',
  RATE_LIMIT: 'Too many requests to the Jamendo catalogue. Try again shortly.',
  TIMEOUT: 'The Jamendo catalogue took too long to answer.',
  UPSTREAM: 'The Jamendo catalogue had a problem.',
}

const STATUS: Record<JamendoErrorCode, number> = {
  BAD_REQUEST: 400,
  METHOD_NOT_ALLOWED: 405,
  UNAVAILABLE: 503,
  RATE_LIMIT: 429,
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
      // The endpoint is same-origin only: no CORS header is emitted on purpose
      // (agents/16_JAMENDO_SERVERLESS_SECURITY.md → "CORS").
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  })
}

function fail(code: JamendoErrorCode, extraHeaders?: Record<string, string>): Response {
  const body: JamendoErrorBody = { error: { code, message: USER_MESSAGES[code] } }
  return json(body, STATUS[code], extraHeaders)
}

/**
 * Belt-and-braces check that nothing forbidden survived sanitization. A payload
 * that fails this is dropped rather than published, so a future upstream field
 * cannot leak by being added to `sanitize.ts` and forgotten here.
 */
function isPublishable(track: JamendoTrackPayload, clientId: string): boolean {
  const row = track as unknown as Record<string, unknown>
  for (const key of FORBIDDEN_KEYS) {
    if (key in row) return false
  }
  return !containsSecret(JSON.stringify(track), clientId)
}

export async function handleJamendoRequest(
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

  /**
   * The similar action, for autoplay.
   *
   * Narrow by construction: one parameter, validated against a numeric-id
   * pattern before anything is configured or fetched, and a result limit fixed
   * server-side rather than accepted from the caller. It is a similar-tracks
   * lookup, not a step towards a general Jamendo proxy.
   */
  if (action === 'similar') {
    const id = url.searchParams.get('id') ?? ''
    if (!isValidJamendoId(id)) return fail('BAD_REQUEST')

    const config = readJamendoEnv(env)
    if (!config.configured) return fail('UNAVAILABLE')
    const { clientId } = config.env

    const result = await similarJamendo(
      { id },
      {
        clientId,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    )

    if (!result.ok) {
      log(`[jamendo] ${redactLiteral(result.detail, clientId)}`)
      if (result.failure === 'rate_limit') return fail('RATE_LIMIT')
      if (result.failure === 'timeout') return fail('TIMEOUT')
      return fail('UPSTREAM')
    }

    const similar = result.tracks.filter((track) => isPublishable(track, clientId))
    const similarBody: JamendoSimilarBody = {
      provider: 'jamendo',
      action: 'similar',
      id,
      count: similar.length,
      results: similar,
    }
    return json(similarBody, 200)
  }

  const rawQuery = url.searchParams.get('q') ?? ''
  // Unicode is preserved exactly: only whitespace is normalized, so Arabic,
  // Cyrillic and Armenian queries reach Jamendo in their own script.
  const query = rawQuery.replace(/\s+/gu, ' ').trim().slice(0, MAX_QUERY_LENGTH)
  if (!query) return fail('BAD_REQUEST')

  const limit = clampLimit(url.searchParams.get('limit'))

  // Configuration is read last so a malformed request is rejected identically
  // whether or not Jamendo happens to be configured.
  const config = readJamendoEnv(env)
  if (!config.configured) {
    // Not an error the visitor caused, and not one they can act on: the search
    // simply proceeds without Jamendo (agents/13 → "Configuration Degradation").
    return fail('UNAVAILABLE')
  }

  const { clientId } = config.env
  const result = await searchJamendo(
    { query, limit },
    {
      clientId,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    },
  )

  if (!result.ok) {
    // Redacted twice over: `detail` is already scrubbed upstream, and the
    // literal credential is removed again here before anything is written out.
    log(`[jamendo] ${redactLiteral(result.detail, clientId)}`)
    if (result.failure === 'rate_limit') return fail('RATE_LIMIT')
    if (result.failure === 'timeout') return fail('TIMEOUT')
    return fail('UPSTREAM')
  }

  const results = result.tracks.filter((track) => isPublishable(track, clientId))
  const body: JamendoSearchBody = {
    provider: 'jamendo',
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
export async function handleJamendoRequestSafely(
  request: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  try {
    return await handleJamendoRequest(request, options)
  } catch (error) {
    const log = options.logger ?? ((message: string) => console.error(message))
    log(`[jamendo] unhandled: ${describeError(error, options.env?.JAMENDO_CLIENT_ID)}`)
    return fail('UPSTREAM')
  }
}
