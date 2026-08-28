import { describeError } from './redact.js'
import { sanitizeJamendoTracks } from './sanitize.js'
import type { JamendoTrackPayload } from './sanitize.js'

/**
 * The only place that talks to Jamendo, and the only place the client id is
 * ever written into a request.
 *
 * Endpoint and parameters follow agents/14_JAMENDO_PROVIDER_CONTRACT.md and the
 * live v3.0 documentation: `search` is Jamendo's free-text search across track,
 * album, artist and tags; `order=relevance` is its default relevance ranking;
 * `type=single albumtrack` covers both standalone releases and album tracks;
 * `audioformat=mp32` is the higher-quality documented MP3 stream; `imagesize`
 * accepts a fixed vocabulary of which 300 is the mid-size cover.
 */

export const JAMENDO_TRACKS_ENDPOINT = 'https://api.jamendo.com/v3.0/tracks/'

/** Jamendo documents 200 as the hard maximum; the app never needs more than 30. */
export const MAX_LIMIT = 30
export const DEFAULT_LIMIT = 20
export const MAX_QUERY_LENGTH = 120
export const UPSTREAM_TIMEOUT_MS = 8_000

export type UpstreamFailure =
  /** Jamendo answered with a transport/HTTP failure, or unparseable JSON. */
  | 'upstream'
  /** Jamendo's own response envelope reported failure. */
  | 'provider'
  /** Jamendo rate-limited us. */
  | 'rate_limit'
  /** The request exceeded `UPSTREAM_TIMEOUT_MS` or was aborted. */
  | 'timeout'

export type UpstreamResult =
  | { ok: true; tracks: JamendoTrackPayload[] }
  | { ok: false; failure: UpstreamFailure; detail: string; status?: number }

export interface SearchParams {
  query: string
  limit: number
}

export interface UpstreamOptions {
  clientId: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

/** Clamps the caller's limit into the range Jamendo and the UI both accept. */
export function clampLimit(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT)
}

/**
 * Builds the upstream URL through `URL`/`URLSearchParams` so the visitor's query
 * is percent-encoded rather than concatenated — Arabic, Cyrillic and Armenian
 * text survives intact and no query string can be injected
 * (agents/14_JAMENDO_PROVIDER_CONTRACT.md → "Recommended Search Request").
 */
export function buildSearchUrl(params: SearchParams, clientId: string): URL {
  const url = new URL(JAMENDO_TRACKS_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(clampLimit(params.limit)))
  url.searchParams.set('search', params.query)
  url.searchParams.set('order', 'relevance')
  // Documented multi-value syntax: values separated by a space.
  url.searchParams.set('type', 'single albumtrack')
  url.searchParams.set('audioformat', 'mp32')
  url.searchParams.set('imagesize', '300')
  return url
}

/**
 * Jamendo's documented similar-tracks endpoint.
 *
 * https://developer.jamendo.com/v3.0/tracks/similar — a real, supported
 * operation, which is why Jamendo gets provider-side similarity and Audius does
 * not (agents/32 → "Audius: do not invent an undocumented similar endpoint").
 */
export const JAMENDO_SIMILAR_ENDPOINT = 'https://api.jamendo.com/v3.0/tracks/similar/'

/**
 * Autoplay needs a handful of candidates, not a catalogue.
 *
 * Deliberately far below `MAX_LIMIT`: this action is reached automatically when
 * a track ends rather than by a visitor pressing search, so its cost is capped
 * at the source instead of being left to the caller.
 */
export const SIMILAR_LIMIT = 12

/** Jamendo ids are numeric strings. Anything else never reaches the network. */
export const JAMENDO_ID_PATTERN = /^[0-9]{1,12}$/

export function isValidJamendoId(value: unknown): value is string {
  return typeof value === 'string' && JAMENDO_ID_PATTERN.test(value)
}

export interface SimilarParams {
  id: string
}

/**
 * `include=musicinfo` is what makes provider similarity usable: it returns the
 * tags and `speed` the local scorer reads. The search action deliberately does
 * **not** ask for it — that request is on the visitor's critical path and its
 * shape is pinned by existing tests.
 */
export function buildSimilarUrl(params: SimilarParams, clientId: string): URL {
  const url = new URL(JAMENDO_SIMILAR_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(SIMILAR_LIMIT))
  url.searchParams.set('id', params.id)
  url.searchParams.set('type', 'single albumtrack')
  url.searchParams.set('audioformat', 'mp32')
  url.searchParams.set('imagesize', '300')
  url.searchParams.set('include', 'musicinfo')
  return url
}

interface JamendoEnvelope {
  headers?: { status?: unknown; code?: unknown; error_message?: unknown; results_count?: unknown }
  results?: unknown
}

/**
 * Jamendo answers `200 OK` with `headers.status === 'failed'` for its own
 * errors, so the HTTP status alone is never enough
 * (agents/14_JAMENDO_PROVIDER_CONTRACT.md → "API Response Validation").
 */
export function readEnvelope(body: unknown): { ok: true; results: unknown } | { ok: false; detail: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, detail: 'Jamendo returned a non-object response.' }
  }
  const envelope = body as JamendoEnvelope
  const status = envelope.headers?.status
  if (typeof status === 'string' && status !== 'success') {
    const message = typeof envelope.headers?.error_message === 'string' ? envelope.headers.error_message : ''
    const rawCode = envelope.headers?.code
    // Jamendo documents `code` as a number, but the envelope is untrusted input
    // like everything else here, so anything exotic is simply dropped.
    const code = typeof rawCode === 'number' || typeof rawCode === 'string' ? String(rawCode) : ''
    return {
      ok: false,
      detail: `Jamendo reported ${status}${code ? ` (code ${code})` : ''}${message ? `: ${message}` : ''}`,
    }
  }
  if (!Array.isArray(envelope.results)) {
    return { ok: false, detail: 'Jamendo response carried no results array.' }
  }
  return { ok: true, results: envelope.results }
}

/**
 * One Jamendo search. Never throws: every failure is mapped onto
 * `UpstreamResult` so a Jamendo outage can only ever degrade the search, never
 * break it.
 */
export async function searchJamendo(
  params: SearchParams,
  options: UpstreamOptions,
): Promise<UpstreamResult> {
  return requestJamendo(buildSearchUrl(params, options.clientId), options)
}

/**
 * One Jamendo similar-tracks lookup, for autoplay.
 *
 * Shares every failure path with `searchJamendo`, so a Jamendo outage degrades
 * autoplay exactly the way it degrades search: quietly, and never by throwing.
 */
export async function similarJamendo(
  params: SimilarParams,
  options: UpstreamOptions,
): Promise<UpstreamResult> {
  return requestJamendo(buildSimilarUrl(params, options.clientId), options)
}

/**
 * The single request path. Both actions share it so timeout, abort, envelope
 * validation, sanitization and — most importantly — credential redaction cannot
 * drift apart between them.
 */
async function requestJamendo(url: URL, options: UpstreamOptions): Promise<UpstreamResult> {
  const { clientId } = options
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

    if (response.status === 429) {
      return { ok: false, failure: 'rate_limit', detail: 'Jamendo rate-limited the request.', status: 429 }
    }
    if (!response.ok) {
      return {
        ok: false,
        failure: 'upstream',
        detail: `Jamendo answered HTTP ${response.status}.`,
        status: response.status,
      }
    }

    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      return { ok: false, failure: 'upstream', detail: describeError(error, clientId) }
    }

    const envelope = readEnvelope(body)
    if (!envelope.ok) return { ok: false, failure: 'provider', detail: envelope.detail }

    return { ok: true, tracks: sanitizeJamendoTracks(envelope.results, { clientId }) }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      failure: aborted ? 'timeout' : 'upstream',
      // Redacted: `fetch` puts the full request URL — client id included — into
      // the error it throws.
      detail: describeError(error, clientId),
    }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onOuterAbort)
  }
}
