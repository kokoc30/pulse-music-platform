import type { EnvRecord, SmokeEnvInputs } from '../jamendo/smoke-env.js'

/**
 * Env resolution for the opt-in live YouTube smoke suite. Test harness only —
 * nothing under `api/` imports this, so it is never bundled into the Vercel
 * Function.
 *
 * Deliberately a sibling of `server/jamendo/smoke-env.ts` rather than an
 * extension of it: that module's allow-list is pinned by its own tests as
 * exactly `['JAMENDO_CLIENT_ID']`, which is a contract worth keeping. The two
 * resolvers are merged in `vitest.smoke.config.ts`, so each provider owns its
 * own key and neither can widen the other's.
 *
 * `YOUTUBE_API_KEY` is un-prefixed, which is exactly why the smoke run cannot
 * see it on its own: Vite only surfaces `VITE_*` variables into a process.
 */

/** The only variable this resolver will ever lift out of a `.env` file. */
export const YOUTUBE_SMOKE_ENV_KEYS = ['YOUTUBE_API_KEY'] as const

/**
 * **Shell and CI win.** A value explicitly exported before the run is never
 * overwritten by a file; a file value only fills a genuine gap.
 */
export function resolveYouTubeSmokeEnv({ loaded, processEnv }: SmokeEnvInputs): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const key of YOUTUBE_SMOKE_ENV_KEYS) {
    // An empty or whitespace-only shell value is not an override, it is unset.
    if (processEnv[key]?.trim()) continue
    const fromFile = loaded[key]?.trim()
    if (fromFile) resolved[key] = fromFile
  }
  return resolved
}

/** Guidance shown when the suite is asked to run without a key to run with. */
export const MISSING_YOUTUBE_KEY_MESSAGE =
  'YOUTUBE_SMOKE=1 was set but YOUTUBE_API_KEY is missing. ' +
  'Add it to .env (server-only, no VITE_ prefix) or export it before running the smoke suite. ' +
  'Create one in the Google Cloud console with the YouTube Data API v3 enabled, and restrict it to that API.'

/**
 * Fails the suite loudly rather than skipping it.
 *
 * Asking for the live suite and silently getting nothing is the worst outcome:
 * it reads as a pass. The message never contains the credential — only its
 * absence is reported.
 */
export function assertYouTubeSmokeCredential(processEnv: EnvRecord): void {
  if (!processEnv.YOUTUBE_API_KEY?.trim()) {
    throw new Error(MISSING_YOUTUBE_KEY_MESSAGE)
  }
}
