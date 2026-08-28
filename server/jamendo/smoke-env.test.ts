import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MISSING_CREDENTIAL_MESSAGE,
  SMOKE_ENV_KEYS,
  assertSmokeCredential,
  resolveSmokeEnv,
} from './smoke-env.js'

/**
 * These run in the *deterministic* suite and never touch the network or a real
 * credential — they only pin the rules the smoke harness follows.
 */

const CLIENT_ID = 'abc12345'
const FROM_SHELL = 'shell1234'

describe('loading the smoke credential from the project env files', () => {
  it('lifts JAMENDO_CLIENT_ID out of the env files when the shell has none', () => {
    // The root cause of the original failure: an un-prefixed variable that Vite
    // loads but never copies into `process.env`.
    expect(resolveSmokeEnv({ loaded: { JAMENDO_CLIENT_ID: CLIENT_ID }, processEnv: {} })).toEqual({
      JAMENDO_CLIENT_ID: CLIENT_ID,
    })
  })

  it('trims a value that picked up whitespace in the file', () => {
    const resolved = resolveSmokeEnv({
      loaded: { JAMENDO_CLIENT_ID: `  ${CLIENT_ID}\n` },
      processEnv: {},
    })
    expect(resolved.JAMENDO_CLIENT_ID).toBe(CLIENT_ID)
  })

  it('injects nothing when neither source has the credential', () => {
    expect(resolveSmokeEnv({ loaded: {}, processEnv: {} })).toEqual({})
    expect(resolveSmokeEnv({ loaded: { JAMENDO_CLIENT_ID: '   ' }, processEnv: {} })).toEqual({})
  })
})

describe('shell and CI precedence', () => {
  it('never overwrites a credential the shell already exported', () => {
    const resolved = resolveSmokeEnv({
      loaded: { JAMENDO_CLIENT_ID: CLIENT_ID },
      processEnv: { JAMENDO_CLIENT_ID: FROM_SHELL },
    })
    // Nothing is injected, so the process keeps the value it already had. This
    // is what lets CI point the suite at a different credential, and stops a
    // stale .env from shadowing an intentional override.
    expect(resolved).toEqual({})
    expect(resolved.JAMENDO_CLIENT_ID).toBeUndefined()
  })

  it('treats an empty or whitespace-only shell value as unset, not as an override', () => {
    for (const blank of ['', '   ', '\n']) {
      expect(
        resolveSmokeEnv({
          loaded: { JAMENDO_CLIENT_ID: CLIENT_ID },
          processEnv: { JAMENDO_CLIENT_ID: blank },
        }),
      ).toEqual({ JAMENDO_CLIENT_ID: CLIENT_ID })
    }
  })
})

describe('what the harness is allowed to inject', () => {
  it('lifts only the allow-listed server-side key', () => {
    expect(SMOKE_ENV_KEYS).toEqual(['JAMENDO_CLIENT_ID'])
  })

  it('ignores every other variable the env files happen to contain', () => {
    // `loadEnv(mode, cwd, '')` returns *everything*; blanket-assigning it would
    // drag unrelated credentials into the test process.
    const resolved = resolveSmokeEnv({
      loaded: {
        JAMENDO_CLIENT_ID: CLIENT_ID,
        VITE_AUDIUS_API_KEY: 'should-not-be-lifted',
        VITE_JAMENDO_CLIENT_ID: 'forbidden',
        SOME_OTHER_SECRET: 'nope',
        AWS_SECRET_ACCESS_KEY: 'definitely-not',
      },
      processEnv: {},
    })
    expect(Object.keys(resolved)).toEqual(['JAMENDO_CLIENT_ID'])
  })

  it('never lifts a VITE_-prefixed variable, which would reach a bundle', () => {
    for (const key of SMOKE_ENV_KEYS) expect(key.startsWith('VITE_')).toBe(false)
  })
})

describe('the missing-credential guard', () => {
  it('throws when the suite is asked to run without a credential', () => {
    // Opting in and silently getting nothing is the worst outcome: it reads as
    // a pass. The guard must fail loudly instead.
    expect(() => assertSmokeCredential({})).toThrow(MISSING_CREDENTIAL_MESSAGE)
    expect(() => assertSmokeCredential({ JAMENDO_CLIENT_ID: '  ' })).toThrow(/is missing/)
  })

  it('passes once a credential is present', () => {
    expect(() => assertSmokeCredential({ JAMENDO_CLIENT_ID: CLIENT_ID })).not.toThrow()
  })

  it('names only the variable, never a value', () => {
    let message = ''
    try {
      assertSmokeCredential({})
    } catch (error) {
      message = error instanceof Error ? error.message : ''
    }
    expect(message).toContain('JAMENDO_CLIENT_ID')
    expect(message).toContain('.env')
    // Nothing that could be a credential is echoed back.
    expect(message.replace(/JAMENDO_CLIENT_ID|JAMENDO_SMOKE/g, '')).not.toMatch(/[A-Za-z0-9_-]{20,}/)
  })
})

describe('the deterministic suites stay independent of the live credential', () => {
  const root = process.cwd()

  it('does not inject any credential into the normal vitest config', () => {
    // `pnpm test:run` must pass on a machine that has never seen a Jamendo key.
    const config = readFileSync(join(root, 'vitest.config.ts'), 'utf8')
    expect(config).not.toContain('JAMENDO_CLIENT_ID')
    expect(config).not.toContain('loadEnv')
  })

  it('keeps the env loading scoped to the smoke config alone', () => {
    const smoke = readFileSync(join(root, 'vitest.smoke.config.ts'), 'utf8')
    expect(smoke).toContain('loadEnv')
    expect(smoke).toContain('resolveSmokeEnv')
    // The build config must not gain a client-visible Jamendo variable.
    const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
    expect(vite).not.toContain('VITE_JAMENDO')
  })

  it('keeps real env files out of version control', () => {
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/^\.env$/m)
    expect(gitignore).toMatch(/^\.env\.\*$/m)
    expect(gitignore).toMatch(/^!\.env\.example$/m)
  })
})
