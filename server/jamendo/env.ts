/**
 * Server-only Jamendo configuration.
 *
 * `JAMENDO_CLIENT_ID` has no `VITE_` prefix on purpose: Vite inlines every
 * `VITE_*` variable into the public bundle, and Jamendo's developer terms treat
 * the client id as a personal credential
 * (agents/16_JAMENDO_SERVERLESS_SECURITY.md → "Why a Serverless Function Is
 * Required"). Nothing in this file may ever be imported from `src/`.
 */

export interface JamendoEnv {
  clientId: string
}

export type JamendoEnvResult =
  | { configured: true; env: JamendoEnv }
  | { configured: false; reason: 'missing' | 'malformed' }

/** Jamendo issues 8-character hex client ids; anything else is a paste error. */
const PLAUSIBLE_CLIENT_ID = /^[A-Za-z0-9_-]{6,64}$/

export type EnvSource = Record<string, string | undefined>

/**
 * Reads and validates the credential without ever echoing its value. A missing
 * variable is a supported state — Jamendo simply becomes unavailable and Audius
 * carries the application on its own.
 */
export function readJamendoEnv(source: EnvSource): JamendoEnvResult {
  const raw = source.JAMENDO_CLIENT_ID?.trim()
  if (!raw) return { configured: false, reason: 'missing' }
  if (!PLAUSIBLE_CLIENT_ID.test(raw)) return { configured: false, reason: 'malformed' }
  return { configured: true, env: { clientId: raw } }
}
