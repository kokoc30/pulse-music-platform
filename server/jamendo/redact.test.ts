import { describe, expect, it } from 'vitest'
import { REDACTED, containsSecret, describeError, redactLiteral, redactSecrets } from './redact'

describe('credential redaction', () => {
  it('strips the Jamendo client id from a request URL', () => {
    const url = 'https://api.jamendo.com/v3.0/tracks/?client_id=abc12345&search=kosandra'
    const redacted = redactSecrets(url)
    expect(redacted).not.toContain('abc12345')
    expect(redacted).toContain(`client_id=${REDACTED}`)
    // Everything that is not a credential survives, so the log stays useful.
    expect(redacted).toContain('search=kosandra')
  })

  it('strips the other credential-shaped parameters too', () => {
    const text = 'api_key=k1&access_token=t1&signature=s1&client_secret=c1'
    const redacted = redactSecrets(text)
    for (const secret of ['k1', 't1', 's1', 'c1']) expect(redacted).not.toContain(secret)
  })

  it('strips bearer values from an Authorization header', () => {
    expect(redactSecrets('Authorization: Bearer sk-live-9f8e7d')).not.toContain('sk-live-9f8e7d')
  })

  it('removes the literal credential wherever it hides, not only in query strings', () => {
    // Jamendo builds the stream URL's `from` parameter from the calling app, so
    // the credential can appear outside a recognised parameter name.
    const text = 'https://prod-1.storage.jamendo.com/?trackid=1&from=app-abc12345'
    expect(redactLiteral(text, 'abc12345')).not.toContain('abc12345')
  })

  it('refuses to treat a too-short value as a secret, which would redact everything', () => {
    expect(redactLiteral('the quick brown fox', 'the')).toBe('the quick brown fox')
    expect(containsSecret('the quick brown fox', 'the')).toBe(false)
  })

  it('detects the literal credential for the publish-time guard', () => {
    expect(containsSecret('…from=app-abc12345…', 'abc12345')).toBe(true)
    expect(containsSecret('…from=app-devsite…', 'abc12345')).toBe(false)
  })

  it('collapses a thrown error into one redacted line', () => {
    const error = new TypeError('fetch failed for https://api.jamendo.com/v3.0/tracks/?client_id=abc12345')
    const described = describeError(error, 'abc12345')
    expect(described).not.toContain('abc12345')
    expect(described).toContain('TypeError')
    expect(described).not.toContain('\n')
  })

  it('handles a non-Error throw without leaking anything', () => {
    expect(describeError({ weird: true })).toBe('Unknown error')
    expect(describeError('client_id=abc12345 exploded', 'abc12345')).not.toContain('abc12345')
  })
})
