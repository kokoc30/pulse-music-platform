import { MusicError } from '../types'
import type { MusicErrorCode } from '../types'

const MESSAGES: Record<MusicErrorCode, string> = {
  CONFIG: 'Music service is not configured. Add VITE_AUDIUS_API_KEY and reload.',
  NETWORK: 'Could not reach the music service. Check your connection and try again.',
  RATE_LIMIT: 'Too many requests right now. Give it a moment and try again.',
  NOT_FOUND: "We couldn't find that track.",
  NOT_STREAMABLE: "This track isn't available to stream.",
  PROVIDER: 'The music service had a problem. Please try again.',
  ABORTED: 'Request cancelled.',
}

/**
 * The SDK wraps transport failures in `FetchError { cause }`, so the real error
 * — including an `AbortError` — is one or more levels down. Walk the chain.
 */
function unwrap(error: unknown, depth = 0): unknown[] {
  if (depth > 4 || typeof error !== 'object' || error === null) return [error]
  const cause = (error as { cause?: unknown }).cause
  return cause === undefined || cause === error ? [error] : [error, ...unwrap(cause, depth + 1)]
}

function hasName(value: unknown, name: string): boolean {
  return typeof value === 'object' && value !== null && (value as { name?: unknown }).name === name
}

export function isAbortError(error: unknown): boolean {
  return unwrap(error).some((link) => hasName(link, 'AbortError'))
}

/** The generated SDK throws `ResponseError { response: Response }` on non-2xx. */
function readStatus(error: unknown): number | undefined {
  for (const link of unwrap(error)) {
    if (typeof link !== 'object' || link === null) continue
    const response = (link as { response?: { status?: unknown } }).response
    if (response && typeof response.status === 'number') return response.status
    const status = (link as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return undefined
}

const SECRET_PARAMS = /\b(api_key|apiKey|app_name|signature|user_signature|nft_access_signature|token)=([^&\s"']*)/gi

/**
 * Strips credential-bearing query parameters from any text before it is logged.
 * `@audius/sdk` puts the full request URL — including `api_key` — into its
 * `FetchError` message, so a raw log would publish the key to the console.
 */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_PARAMS, (_match, key: string) => `${key}=<redacted>`)
}

function isNetworkFailure(error: unknown): boolean {
  return unwrap(error).some((link) => link instanceof TypeError || hasName(link, 'FetchError'))
}

function codeForStatus(status: number): MusicErrorCode {
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 401 || status === 403) return 'CONFIG'
  return 'PROVIDER'
}

/**
 * Collapses anything the SDK, fetch or the network can throw into the small
 * domain error set from agents/06_AUDIUS_INTEGRATION.md. Never leaks an SDK dump.
 */
export function toMusicError(error: unknown, fallback: MusicErrorCode = 'PROVIDER'): MusicError {
  if (error instanceof MusicError) return error

  if (isAbortError(error)) {
    return new MusicError('ABORTED', MESSAGES.ABORTED, { cause: error })
  }

  // Development-only detail so a provider failure is debuggable. Messages are
  // redacted first: the SDK embeds the full request URL in its `FetchError`
  // text, and that URL carries `api_key`.
  if (import.meta.env?.DEV) {
    console.error(
      '[music] provider call failed:',
      unwrap(error)
        .map((link) => (link instanceof Error ? `${link.name}: ${link.message}` : String(link)))
        .map(redactSecrets)
        .join(' <- '),
    )
  }

  const status = readStatus(error)
  if (status !== undefined) {
    const code = codeForStatus(status)
    return new MusicError(code, MESSAGES[code], { cause: error, status })
  }

  // `fetch` rejects with a TypeError when the request never reached the server;
  // the SDK re-wraps that as FetchError.
  if (isNetworkFailure(error)) {
    return new MusicError('NETWORK', MESSAGES.NETWORK, { cause: error })
  }

  return new MusicError(fallback, MESSAGES[fallback], { cause: error })
}

export function musicErrorMessage(code: MusicErrorCode): string {
  return MESSAGES[code]
}

export { MESSAGES as MUSIC_ERROR_MESSAGES }
