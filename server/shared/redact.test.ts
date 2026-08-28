import { describe, expect, it } from 'vitest'
import { REDACTED, containsSecret, describeError, redactLiteral, redactSecrets } from './redact.js'
import { redactSecrets as jamendoRedactSecrets } from '../jamendo/redact.js'

const YOUTUBE_KEY = 'AIzaSyA-1234567890abcdefghijklmnopqrstu'

/**
 * Phase 3 extended the shared redactor with Google's `key` parameter and moved
 * it out of `server/jamendo/`. These assertions cover the new parameter and pin
 * the two properties the move must not have broken: the Jamendo behaviour, and
 * the fact that `key` does not steal the match inside `api_key`.
 */
describe('the shared redactor covers the YouTube credential parameter', () => {
  it('redacts a bare `key=` query parameter', () => {
    expect(redactSecrets(`https://www.googleapis.com/youtube/v3/search?q=x&key=${YOUTUBE_KEY}`)).toBe(
      'https://www.googleapis.com/youtube/v3/search?q=x&key=<redacted>',
    )
  })

  it('redacts `key=` wherever it sits in the query string', () => {
    expect(redactSecrets(`?key=${YOUTUBE_KEY}&part=snippet`)).toBe('?key=<redacted>&part=snippet')
    expect(redactSecrets(`?part=snippet&key=${YOUTUBE_KEY}`)).toBe('?part=snippet&key=<redacted>')
  })

  it('still redacts `api_key` as a whole, not just its `key` tail', () => {
    // `_` is a word character, so `\bkey=` cannot match inside `api_key=`.
    expect(redactSecrets('?api_key=abcdef123456')).toBe('?api_key=<redacted>')
    expect(redactSecrets('?apiKey=abcdef123456')).toBe('?apiKey=<redacted>')
  })

  it('leaves ordinary words ending in "key" alone', () => {
    expect(redactSecrets('?monkey=banana')).toBe('?monkey=banana')
    expect(redactSecrets('?sortkey=title')).toBe('?sortkey=title')
  })

  it('keeps every Jamendo behaviour it had before the move', () => {
    const url = 'https://api.jamendo.com/v3.0/tracks/?client_id=fcda1234&search=x'
    expect(redactSecrets(url)).toBe('https://api.jamendo.com/v3.0/tracks/?client_id=<redacted>&search=x')
    // The Jamendo entry point re-exports the same implementation.
    expect(jamendoRedactSecrets(url)).toBe(redactSecrets(url))
  })

  it('redacts bearer tokens in any casing', () => {
    expect(redactSecrets('Authorization: Bearer abc.def-ghi')).toBe('Authorization: Bearer <redacted>')
  })
})

describe('literal secret removal', () => {
  it('removes the YouTube key wherever it appears, in whatever shape', () => {
    expect(redactLiteral(`a ${YOUTUBE_KEY} b`, YOUTUBE_KEY)).toBe(`a ${REDACTED} b`)
    expect(redactLiteral(`/path/${YOUTUBE_KEY}/x`, YOUTUBE_KEY)).toBe(`/path/${REDACTED}/x`)
  })

  it('refuses to treat a too-short value as a secret', () => {
    // Otherwise "abc" would redact every occurrence of those letters.
    expect(redactLiteral('abc def', 'abc')).toBe('abc def')
    expect(containsSecret('abc def', 'abc')).toBe(false)
    expect(containsSecret(`x ${YOUTUBE_KEY}`, YOUTUBE_KEY)).toBe(true)
  })

  it('collapses a thrown error into one redacted line', () => {
    const error = new Error(`fetch failed:\n  GET https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_KEY}`)
    const described = describeError(error, YOUTUBE_KEY)
    expect(described).not.toContain(YOUTUBE_KEY)
    expect(described).toContain(REDACTED)
    expect(described).not.toContain('\n')
    expect(described.length).toBeLessThanOrEqual(300)
  })
})
