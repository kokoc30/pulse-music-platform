import { describe, expect, it } from 'vitest'
import { readAudiusConfig } from './client'

const env = (overrides: Record<string, string | undefined>) =>
  ({ ...overrides }) as unknown as ImportMetaEnv

describe('readAudiusConfig', () => {
  it('uses the API key when one is configured', () => {
    expect(readAudiusConfig(env({ VITE_AUDIUS_API_KEY: 'abc123' }))).toEqual({
      apiKey: 'abc123',
      appName: 'Pulse Music Platform',
      mode: 'api-key',
    })
  })

  it('trims a padded key rather than sending whitespace', () => {
    expect(readAudiusConfig(env({ VITE_AUDIUS_API_KEY: '  abc  ' })).apiKey).toBe('abc')
  })

  it('falls back to Audius read-only app-name mode when the key is missing', () => {
    expect(readAudiusConfig(env({}))).toEqual({
      appName: 'Pulse Music Platform',
      mode: 'app-name-only',
    })
    expect(readAudiusConfig(env({ VITE_AUDIUS_API_KEY: '   ' })).mode).toBe('app-name-only')
  })

  it('honours a custom app name', () => {
    expect(readAudiusConfig(env({ VITE_AUDIUS_APP_NAME: 'My App' })).appName).toBe('My App')
  })

  it('never reads a bearer token or secret from the client environment', () => {
    const config = readAudiusConfig(
      env({
        VITE_AUDIUS_API_KEY: 'abc',
        VITE_AUDIUS_BEARER_TOKEN: 'should-be-ignored',
        VITE_AUDIUS_API_SECRET: 'should-be-ignored',
      }),
    )
    expect(JSON.stringify(config)).not.toContain('should-be-ignored')
    expect(Object.keys(config).sort()).toEqual(['apiKey', 'appName', 'mode'])
  })
})
