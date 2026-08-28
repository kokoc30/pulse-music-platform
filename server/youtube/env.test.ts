import { describe, expect, it } from 'vitest'
import { readYouTubeEnv } from './env.js'

describe('YouTube server environment', () => {
  it('accepts a plausible Google API key', () => {
    const result = readYouTubeEnv({ YOUTUBE_API_KEY: 'AIzaSyA-1234567890abcdefghijklmnopqrstu' })
    expect(result).toEqual({
      configured: true,
      env: { apiKey: 'AIzaSyA-1234567890abcdefghijklmnopqrstu' },
    })
  })

  it('trims surrounding whitespace from a pasted key', () => {
    const result = readYouTubeEnv({ YOUTUBE_API_KEY: '  AIzaSyA-1234567890abcdefghijklmnopqrstu \n' })
    expect(result).toEqual({
      configured: true,
      env: { apiKey: 'AIzaSyA-1234567890abcdefghijklmnopqrstu' },
    })
  })

  it('treats a missing key as a supported deployment state, not an error', () => {
    expect(readYouTubeEnv({})).toEqual({ configured: false, reason: 'missing' })
    expect(readYouTubeEnv({ YOUTUBE_API_KEY: '' })).toEqual({ configured: false, reason: 'missing' })
    expect(readYouTubeEnv({ YOUTUBE_API_KEY: '   ' })).toEqual({ configured: false, reason: 'missing' })
  })

  it('rejects common paste errors rather than spending a request on them', () => {
    // A whole query fragment, a quoted value, a placeholder, something far too
    // short — each is a mistake, and each must fail before any quota is used.
    for (const value of [
      'key=AIzaSyA-1234567890abcdefghijklmnopqrstu',
      '"AIzaSyA-1234567890abcdefghijklmnopqrstu"',
      'your-api-key-here!',
      'short',
    ]) {
      expect(readYouTubeEnv({ YOUTUBE_API_KEY: value })).toEqual({
        configured: false,
        reason: 'malformed',
      })
    }
  })

  it('never reads a VITE_-prefixed variable, which would be public', () => {
    const result = readYouTubeEnv({
      VITE_YOUTUBE_API_KEY: 'AIzaSyA-1234567890abcdefghijklmnopqrstu',
    })
    expect(result).toEqual({ configured: false, reason: 'missing' })
  })

  it('never echoes the credential in its own result shape when unconfigured', () => {
    const result = readYouTubeEnv({ YOUTUBE_API_KEY: 'nope!' })
    expect(JSON.stringify(result)).not.toContain('nope')
  })
})
