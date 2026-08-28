/**
 * Env resolution for the opt-in live smoke suite. Test harness only — nothing
 * under `api/` imports this, so it is never bundled into the Vercel Function.
 *
 * `JAMENDO_CLIENT_ID` is deliberately un-prefixed, which is exactly why the
 * smoke run could not see it: Vite only surfaces `VITE_*` variables, and it
 * never copies unprefixed ones into `process.env`. The dev and preview servers
 * work because `vite.config.ts` reads the value itself and hands it to the
 * middleware; a bare Node/Vitest process has no such step.
 *
 * So `vitest.smoke.config.ts` does the same thing the dev server does — reads
 * the project's env files with Vite's own `loadEnv` — and this module decides
 * what may be lifted out of them. Keeping the decision here, as a pure
 * function, is what makes the precedence rule testable without touching the
 * filesystem or the real environment.
 */

export type EnvRecord = Record<string, string | undefined>

/**
 * The only variables the smoke harness will ever lift out of a `.env` file.
 *
 * An allow-list, not a spread: `loadEnv(mode, cwd, '')` returns *every*
 * variable it finds, and blanket-assigning that into `process.env` would drag
 * unrelated credentials into the test process.
 */
export const SMOKE_ENV_KEYS = ['JAMENDO_CLIENT_ID'] as const

export interface SmokeEnvInputs {
  /** Whatever `loadEnv` found across the project's `.env*` files. */
  loaded: EnvRecord
  /** The real process environment. Always wins. */
  processEnv: EnvRecord
}

/**
 * The variables to inject, given what the env files hold and what the shell
 * already set.
 *
 * **Shell and CI win.** A value explicitly exported before the run is never
 * overwritten by a file — that is what lets CI point the suite at a different
 * credential, and what stops a stale `.env` from silently shadowing an
 * intentional override. A file value is used only to fill a genuine gap.
 */
export function resolveSmokeEnv({ loaded, processEnv }: SmokeEnvInputs): Record<string, string> {
  const resolved: Record<string, string> = {}

  for (const key of SMOKE_ENV_KEYS) {
    // An empty or whitespace-only shell value is not an override, it is unset —
    // the same reading `readJamendoEnv` already applies to the credential.
    if (processEnv[key]?.trim()) continue

    const fromFile = loaded[key]?.trim()
    if (fromFile) resolved[key] = fromFile
  }

  return resolved
}

/** Guidance shown when the suite is asked to run without a credential to run with. */
export const MISSING_CREDENTIAL_MESSAGE =
  'JAMENDO_SMOKE=1 was set but JAMENDO_CLIENT_ID is missing. ' +
  'Add it to .env (server-only, no VITE_ prefix) or export it before running the smoke suite. ' +
  'Get one at https://devportal.jamendo.com.'

/**
 * Fails the suite loudly rather than skipping it.
 *
 * Asking for the live suite and silently getting nothing is the worst outcome:
 * it reads as a pass. The message never contains the credential — only its
 * absence is reported.
 */
export function assertSmokeCredential(processEnv: EnvRecord): void {
  if (!processEnv.JAMENDO_CLIENT_ID?.trim()) {
    throw new Error(MISSING_CREDENTIAL_MESSAGE)
  }
}
