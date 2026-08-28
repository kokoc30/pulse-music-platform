/**
 * Server-only YouTube configuration.
 *
 * `YOUTUBE_API_KEY` has no `VITE_` prefix, and there is deliberately no
 * `VITE_YOUTUBE_API_KEY` anywhere in this repository: Vite inlines every
 * `VITE_*` variable into the public bundle, and a Google API key in the public
 * bundle is a key anyone can spend
 * (agents/23_YOUTUBE_SERVERLESS_SECURITY.md → "Environment"). Nothing in this
 * file may ever be imported from `src/`.
 */

export interface YouTubeEnv {
  apiKey: string
}

export type YouTubeEnvResult =
  | { configured: true; env: YouTubeEnv }
  | { configured: false; reason: 'missing' | 'malformed' }

/**
 * Google API keys are URL-safe base64-ish strings — in practice 39 characters
 * beginning `AIza`, but Google does not contractually pin that, so the check
 * stays a shape check rather than a prefix check. Its job is to catch a paste
 * error (a whole `key=...` fragment, a quoted value, a placeholder) before a
 * request is spent, not to authenticate the key.
 */
const PLAUSIBLE_API_KEY = /^[A-Za-z0-9_-]{20,80}$/

export type EnvSource = Record<string, string | undefined>

/**
 * Reads and validates the credential without ever echoing its value. A missing
 * variable is a fully supported state: YouTube is simply unavailable and Audius
 * and Jamendo carry the application exactly as they did in Phase 2
 * (agents/23 → "Missing Key").
 */
export function readYouTubeEnv(source: EnvSource): YouTubeEnvResult {
  const raw = source.YOUTUBE_API_KEY?.trim()
  if (!raw) return { configured: false, reason: 'missing' }
  if (!PLAUSIBLE_API_KEY.test(raw)) return { configured: false, reason: 'malformed' }
  return { configured: true, env: { apiKey: raw } }
}
