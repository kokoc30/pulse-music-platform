import type { sdk } from '@audius/sdk'

export type AudiusSdk = ReturnType<typeof sdk>

export type AudiusCredentialMode = 'api-key' | 'app-name-only'

export interface AudiusClientConfig {
  apiKey?: string
  appName: string
  mode: AudiusCredentialMode
}

const DEFAULT_APP_NAME = 'Pulse Music Platform'

/**
 * Reads the Audius credentials from Vite's env.
 *
 * `VITE_AUDIUS_API_KEY` is the expected credential (agents/10_SECURITY_ENV_DEPLOYMENT.md).
 * Audius documents the API key as safe for browser use; a bearer token or API
 * secret must never appear in a `VITE_` variable and is never read here.
 *
 * When the key is absent the SDK still supports read-only public access
 * identified only by `appName` — the SDK itself warns "No apiKey provided, some
 * endpoints may have lower rate limits". Production therefore stays usable, but
 * development fails loudly so the misconfiguration is impossible to miss.
 */
/**
 * The key is passed through as-is apart from trimming, and that is deliberate:
 * the API key is the developer app's address, and the installed SDK's own
 * `isApiKeyValid` accepts 40 hex characters after an optional `0x` prefix. This
 * module must not invent a stricter shape — a length or charset rule guessed
 * here would reject valid credentials that the SDK and the API both accept.
 */
export function readAudiusConfig(env: ImportMetaEnv = import.meta.env): AudiusClientConfig {
  const apiKey = env.VITE_AUDIUS_API_KEY?.trim()
  const appName = env.VITE_AUDIUS_APP_NAME?.trim() || DEFAULT_APP_NAME

  if (apiKey) {
    return { apiKey, appName, mode: 'api-key' }
  }
  return { appName, mode: 'app-name-only' }
}

let warned = false

function warnAboutMissingKey(): void {
  if (warned) return
  warned = true
  console.error(
    [
      'VITE_AUDIUS_API_KEY is not set.',
      'Pulse is running in read-only public mode, which Audius rate-limits more aggressively.',
      'Copy .env.example to .env.local and add a key from the Audius developer docs: https://docs.audius.co',
    ].join('\n  '),
  )
}

let instance: AudiusSdk | null = null
let pending: Promise<AudiusSdk> | null = null

/**
 * One SDK instance for the whole application, created on first use. The SDK is
 * imported dynamically so its ~380 kB gzip bundle never blocks the app shell —
 * it downloads in parallel while the reference layout paints. Never construct
 * the SDK inside a component (agents/06_AUDIUS_INTEGRATION.md).
 */
export async function getAudiusSdk(): Promise<AudiusSdk> {
  if (instance) return instance
  pending ??= createSdkInstance()
  instance = await pending
  pending = null
  return instance
}

async function createSdkInstance(): Promise<AudiusSdk> {
  const config = readAudiusConfig()
  if (config.mode === 'app-name-only' && import.meta.env.DEV) {
    warnAboutMissingKey()
  }

  const { sdk } = await import('@audius/sdk')
  return config.apiKey !== undefined
    ? sdk({ apiKey: config.apiKey, appName: config.appName })
    : sdk({ appName: config.appName })
}

/** Test seam: inject a stub SDK or clear the cached instance. */
export function setAudiusSdk(next: AudiusSdk | null): void {
  instance = next
  pending = null
}
