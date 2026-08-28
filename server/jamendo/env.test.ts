import { describe, expect, it } from 'vitest'
import { readJamendoEnv } from './env'

describe('Jamendo server environment', () => {
  it('accepts a plausible client id', () => {
    const result = readJamendoEnv({ JAMENDO_CLIENT_ID: 'abc12345' })
    expect(result).toEqual({ configured: true, env: { clientId: 'abc12345' } })
  })

  it('trims surrounding whitespace from a pasted value', () => {
    const result = readJamendoEnv({ JAMENDO_CLIENT_ID: '  abc12345\n' })
    expect(result.configured && result.env.clientId).toBe('abc12345')
  })

  it('treats an absent variable as "not configured", not as an error', () => {
    expect(readJamendoEnv({})).toEqual({ configured: false, reason: 'missing' })
    expect(readJamendoEnv({ JAMENDO_CLIENT_ID: '' })).toEqual({ configured: false, reason: 'missing' })
    expect(readJamendoEnv({ JAMENDO_CLIENT_ID: '   ' })).toEqual({ configured: false, reason: 'missing' })
  })

  it('rejects a value that cannot be a client id', () => {
    // A whole `.env` line pasted into the value, or a URL, is a paste error.
    expect(readJamendoEnv({ JAMENDO_CLIENT_ID: 'JAMENDO_CLIENT_ID=abc' }).configured).toBe(false)
    expect(readJamendoEnv({ JAMENDO_CLIENT_ID: 'abc' }).configured).toBe(false)
    expect(readJamendoEnv({ JAMENDO_CLIENT_ID: 'a'.repeat(200) }).configured).toBe(false)
  })

  it('never reads a VITE_-prefixed Jamendo variable', () => {
    // The forbidden variable must be inert even if someone sets it.
    const result = readJamendoEnv({ VITE_JAMENDO_CLIENT_ID: 'abc12345' })
    expect(result).toEqual({ configured: false, reason: 'missing' })
  })
})
