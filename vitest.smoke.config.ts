import { fileURLToPath, URL } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { resolveSmokeEnv } from './server/jamendo/smoke-env'
import { resolveYouTubeSmokeEnv } from './server/youtube/smoke-env'

/**
 * Opt-in smoke suites that talk to the real provider networks.
 * Never part of `pnpm test:run`.
 *
 *   AUDIUS_SMOKE=1  pnpm test:smoke   — live Audius
 *   JAMENDO_SMOKE=1 pnpm test:smoke   — live Jamendo
 *   YOUTUBE_SMOKE=1 pnpm test:smoke   — live YouTube Data API (spends 2 units:
 *                                       one search.list from the 100/day search
 *                                       bucket, one videos.list from the pool)
 *
 * `JAMENDO_CLIENT_ID` and `YOUTUBE_API_KEY` are read from the project's `.env`
 * files, so no flag needs its credential exported by hand. They are loaded
 * exactly the way `vite.config.ts` loads them for the dev server — via Vite's
 * own `loadEnv`, with no dotenv dependency — and only the allow-listed
 * server-side keys are injected (see `server/jamendo/smoke-env.ts` and
 * `server/youtube/smoke-env.ts`). An explicit shell/CI value always wins.
 *
 * This applies to the smoke process alone: the app build and `pnpm test:run`
 * use their own configs, so nothing here can reach the client bundle.
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/test/smoke/**/*.smoke.test.ts', 'server/**/*.smoke.test.ts'],
    testTimeout: 45_000,
    hookTimeout: 45_000,
    retry: 1,
    // Applied to `process.env` inside the test worker before any test module is
    // imported, which matters: the Jamendo smoke suite reads the credential at
    // module scope to decide whether it can run at all.
    // Each provider owns its own allow-list, so neither can widen the other's.
    env: {
      ...resolveSmokeEnv({ loaded: loadEnv(mode, process.cwd(), ''), processEnv: process.env }),
      ...resolveYouTubeSmokeEnv({ loaded: loadEnv(mode, process.cwd(), ''), processEnv: process.env }),
    },
  },
}))
