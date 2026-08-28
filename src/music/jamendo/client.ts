import { MusicError } from '@/music/types'
import type { Track } from '@/music/types'
import { normalizeJamendoTracks } from './normalize'
import { parseJamendoSearchPayload, parseJamendoSimilarPayload } from './wire'

/**
 * The browser's Jamendo client.
 *
 * It talks to one same-origin route and nothing else. There is no
 * `import.meta.env.VITE_JAMENDO_CLIENT_ID` anywhere in `src/`, and no request
 * from this file ever reaches `api.jamendo.com` — only the serverless function
 * holds the credential (agents/14_JAMENDO_PROVIDER_CONTRACT.md → "No Direct
 * Browser Credential Calls").
 *
 * Direct browser traffic to Jamendo happens only for the audio stream and the
 * artwork URLs the sanitized response hands back, which carry no credential.
 */

export const JAMENDO_API_PATH = '/api/jamendo'
/** The secondary provider must never hold the result list hostage. */
export const JAMENDO_TIMEOUT_MS = 6_000
export const DEFAULT_JAMENDO_LIMIT = 20

export type JamendoStatus =
  /** Jamendo answered. `tracks` may still be empty. */
  | 'success'
  /** Jamendo is not configured for this deployment — degrade silently. */
  | 'unavailable'
  /** Jamendo is configured but failed. Audius still carries the search. */
  | 'error'

export interface JamendoSearchResult {
  status: JamendoStatus
  tracks: Track[]
  /** Diagnostics only — never rendered. */
  detail?: string
}

export interface JamendoSearchOptions {
  limit?: number
  signal?: AbortSignal
  /** Test seam. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError'
}

/**
 * Resolves the route against the current document, which keeps the request
 * same-origin by construction and makes the URL absolute. `fetch` in a browser
 * accepts the bare path, but the WHATWG-compliant implementations used outside
 * one (jsdom, Node) require an absolute URL — resolving here means the client is
 * exercised identically in tests and in production.
 */
export function jamendoRequestUrl(params: URLSearchParams): string {
  const path = `${JAMENDO_API_PATH}?${params.toString()}`
  const base = typeof window === 'undefined' ? undefined : window.location?.href
  if (!base) return path
  try {
    return new URL(path, base).toString()
  } catch {
    return path
  }
}

/**
 * Never throws except on caller abort, which is re-raised as the domain's
 * `ABORTED` so the existing stale-request discipline keeps working unchanged.
 */
export async function searchJamendoTracks(
  query: string,
  options: JamendoSearchOptions = {},
): Promise<JamendoSearchResult> {
  const trimmed = query.trim()
  if (!trimmed) return { status: 'success', tracks: [] }

  const doFetch = options.fetchImpl ?? fetch
  const params = new URLSearchParams({
    action: 'search',
    q: trimmed,
    limit: String(options.limit ?? DEFAULT_JAMENDO_LIMIT),
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? JAMENDO_TIMEOUT_MS)
  // A caller abort must be distinguishable from our own timeout: the first is a
  // stale search and must propagate, the second is just Jamendo being slow.
  let callerAborted = false
  const onCallerAbort = () => {
    callerAborted = true
    controller.abort()
  }
  if (options.signal?.aborted) onCallerAbort()
  options.signal?.addEventListener('abort', onCallerAbort, { once: true })

  try {
    const response = await doFetch(jamendoRequestUrl(params), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    // 503 is the documented "not configured" answer. It is a deployment state,
    // not a failure the visitor should ever see (agents/13 → "Configuration
    // Degradation").
    if (response.status === 503) return { status: 'unavailable', tracks: [] }
    if (!response.ok) {
      return { status: 'error', tracks: [], detail: `HTTP ${response.status}` }
    }

    const body: unknown = await response.json()
    const payloads = parseJamendoSearchPayload(body)
    return { status: 'success', tracks: normalizeJamendoTracks(payloads) }
  } catch (error) {
    if (callerAborted || options.signal?.aborted) {
      throw new MusicError('ABORTED', 'Request cancelled.', { cause: error })
    }
    if (isAbort(error)) return { status: 'error', tracks: [], detail: 'timeout' }
    return { status: 'error', tracks: [], detail: 'network' }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onCallerAbort)
  }
}

/**
 * Jamendo's own similar-tracks answer, for autoplay.
 *
 * The same same-origin route, the same timeout discipline and the same "never
 * throw except on caller abort" contract as search. Autoplay is a background
 * convenience, so a Jamendo outage degrades it to nothing rather than surfacing
 * an error: every failure path returns an empty track list.
 *
 * The result limit is fixed server-side and is deliberately not a parameter
 * here — a caller cannot widen it.
 */
export async function fetchSimilarJamendoTracks(
  trackId: string,
  options: Omit<JamendoSearchOptions, 'limit'> = {},
): Promise<JamendoSearchResult> {
  const id = trackId.trim()
  if (!id) return { status: 'success', tracks: [] }

  const doFetch = options.fetchImpl ?? fetch
  const params = new URLSearchParams({ action: 'similar', id })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? JAMENDO_TIMEOUT_MS)
  let callerAborted = false
  const onCallerAbort = () => {
    callerAborted = true
    controller.abort()
  }
  if (options.signal?.aborted) onCallerAbort()
  options.signal?.addEventListener('abort', onCallerAbort, { once: true })

  try {
    const response = await doFetch(jamendoRequestUrl(params), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    if (response.status === 503) return { status: 'unavailable', tracks: [] }
    if (!response.ok) return { status: 'error', tracks: [], detail: `HTTP ${response.status}` }

    const body: unknown = await response.json()
    return { status: 'success', tracks: normalizeJamendoTracks(parseJamendoSimilarPayload(body)) }
  } catch (error) {
    if (callerAborted || options.signal?.aborted) {
      throw new MusicError('ABORTED', 'Request cancelled.', { cause: error })
    }
    if (isAbort(error)) return { status: 'error', tracks: [], detail: 'timeout' }
    return { status: 'error', tracks: [], detail: 'network' }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onCallerAbort)
  }
}
