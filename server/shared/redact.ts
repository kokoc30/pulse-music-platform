/**
 * Credential redaction for anything that can reach a log line.
 *
 * Shared by every server-only provider module. Both upstreams put their
 * credential in the request query string — Jamendo as `client_id`, YouTube as
 * `key` — and `fetch` puts the full URL into the error it throws. Logging that
 * raw would publish the credential to the Vercel function log
 * (agents/16_JAMENDO_SERVERLESS_SECURITY.md → "Credential Redaction",
 * agents/23_YOUTUBE_SERVERLESS_SECURITY.md → "Sanitization").
 *
 * Phase 3 moved this out of `server/jamendo/` unchanged apart from one added
 * parameter name; `server/jamendo/redact.ts` re-exports it so nothing that
 * imported it before had to move.
 */

/**
 * Query parameters whose value is a credential and must never be logged.
 *
 * `key` is last in the alternation and guarded by `\b`, which is what keeps it
 * from stealing the match inside `api_key=`: `_` is a word character, so there
 * is no word boundary before the `key` in `api_key`. Google's YouTube Data API
 * spells its credential parameter exactly `key`, so it has to be listed.
 */
const SECRET_PARAMS =
  /\b(client_id|clientId|client_secret|api_key|apiKey|access_token|accessToken|refresh_token|signature|token|key)=([^&\s"'#]*)/gi

/** `Authorization: Bearer <token>` in any casing. */
const BEARER = /\b(bearer)\s+([A-Za-z0-9._~+/-]+=*)/gi

export const REDACTED = '<redacted>'

/**
 * Strips credential-bearing query parameters and bearer values from free text.
 * Safe to call on anything — a URL, an error message, a whole stack.
 */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_PARAMS, (_match, key: string) => `${key}=${REDACTED}`).replace(
    BEARER,
    (_match, scheme: string) => `${scheme} ${REDACTED}`,
  )
}

/**
 * Additionally removes one specific literal secret, wherever it appears and in
 * whatever shape — `client_id=abc`, `key=abc`, `from=app-abc`, or a bare `abc`
 * in a path. Used as the last gate before any string is handed to the browser
 * or a log.
 */
export function redactLiteral(text: string, secret: string | undefined): string {
  const redacted = redactSecrets(text)
  const trimmed = secret?.trim()
  // A very short "secret" would match everywhere; Jamendo client ids are 8 hex
  // characters and Google API keys 39, so anything below 6 is a
  // misconfiguration, not a credential.
  if (!trimmed || trimmed.length < 6) return redacted
  return redacted.split(trimmed).join(REDACTED)
}

/** True when `text` contains the literal secret. */
export function containsSecret(text: string, secret: string | undefined): boolean {
  const trimmed = secret?.trim()
  if (!trimmed || trimmed.length < 6) return false
  return text.includes(trimmed)
}

/** Collapses an unknown thrown value into a redacted, single-line message. */
export function describeError(error: unknown, secret?: string): string {
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : 'Unknown error'
  return redactLiteral(raw.replace(/\s+/g, ' ').trim(), secret).slice(0, 300)
}
