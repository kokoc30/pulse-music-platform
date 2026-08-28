import { describe, expect, it } from 'vitest'
import { MusicError } from '../types'
import { MUSIC_ERROR_MESSAGES, isAbortError, musicErrorMessage, toMusicError } from './errors'

/** Mirrors the SDK's own `FetchError { cause }` wrapper. */
function fetchError(cause: unknown): Error {
  const error = new Error('The request failed and the interceptors did not return an alternative response', {
    cause,
  })
  error.name = 'FetchError'
  return error
}

function responseError(status: number): Error {
  const error = new Error('Response returned an error code') as Error & {
    response: { status: number }
  }
  error.name = 'ResponseError'
  error.response = { status }
  return error
}

describe('toMusicError', () => {
  it('passes an existing MusicError straight through', () => {
    const original = new MusicError('NOT_STREAMABLE', 'nope')
    expect(toMusicError(original)).toBe(original)
  })

  it('maps HTTP statuses onto the domain codes', () => {
    expect(toMusicError(responseError(404)).code).toBe('NOT_FOUND')
    expect(toMusicError(responseError(429)).code).toBe('RATE_LIMIT')
    expect(toMusicError(responseError(401)).code).toBe('CONFIG')
    expect(toMusicError(responseError(403)).code).toBe('CONFIG')
    expect(toMusicError(responseError(500)).code).toBe('PROVIDER')
    expect(toMusicError(responseError(503)).code).toBe('PROVIDER')
    expect(toMusicError(responseError(418)).code).toBe('PROVIDER')
  })

  it('records the status alongside the code', () => {
    expect(toMusicError(responseError(429)).status).toBe(429)
  })

  it('unwraps a status buried inside the SDK FetchError wrapper', () => {
    expect(toMusicError(fetchError(responseError(429))).code).toBe('RATE_LIMIT')
  })

  it('detects an abort even when the SDK has wrapped it', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(toMusicError(abort).code).toBe('ABORTED')
    expect(toMusicError(fetchError(abort)).code).toBe('ABORTED')
    expect(isAbortError(fetchError(fetchError(abort)))).toBe(true)
  })

  it('maps a transport failure to NETWORK', () => {
    expect(toMusicError(new TypeError('Failed to fetch')).code).toBe('NETWORK')
    expect(toMusicError(fetchError(new TypeError('Failed to fetch'))).code).toBe('NETWORK')
  })

  it('falls back to the requested code for anything unrecognised', () => {
    expect(toMusicError({ weird: true }).code).toBe('PROVIDER')
    expect(toMusicError(null, 'CONFIG').code).toBe('CONFIG')
  })

  it('survives a self-referencing cause chain', () => {
    const looping = new Error('loop') as Error & { cause?: unknown }
    looping.cause = looping
    expect(() => toMusicError(looping)).not.toThrow()
  })

  it('produces a user message that is safe to render', () => {
    for (const code of Object.keys(MUSIC_ERROR_MESSAGES) as Array<
      keyof typeof MUSIC_ERROR_MESSAGES
    >) {
      const message = musicErrorMessage(code)
      expect(message.length).toBeGreaterThan(0)
      // No URLs and no credentials. The CONFIG message names the environment
      // *variable* `VITE_AUDIUS_API_KEY`, which is public documentation — it can
      // never contain a value, and nothing here may look like a token.
      expect(message).not.toMatch(/https?:\/\//)
      expect(message).not.toMatch(/bearer|secret|private key/i)
      expect(message.replace('VITE_AUDIUS_API_KEY', '')).not.toMatch(/[A-Za-z0-9_-]{24,}/)
    }
  })
})
