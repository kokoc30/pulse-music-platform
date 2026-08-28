import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LIMIT,
  JAMENDO_TRACKS_ENDPOINT,
  MAX_LIMIT,
  buildSearchUrl,
  clampLimit,
  readEnvelope,
  searchJamendo,
} from './upstream.js'

const CLIENT_ID = 'abc12345'

function envelope(results: unknown[], headers: Record<string, unknown> = {}) {
  return {
    headers: { status: 'success', code: 0, error_message: '', results_count: results.length, ...headers },
    results,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Jamendo upstream request', () => {
  it('targets the documented v3.0 tracks endpoint', () => {
    const url = buildSearchUrl({ query: 'reverie', limit: 20 }, CLIENT_ID)
    expect(`${url.origin}${url.pathname}`).toBe(JAMENDO_TRACKS_ENDPOINT)
    expect(url.protocol).toBe('https:')
  })

  it('sends the credential, relevance order, both track types and a JSON format', () => {
    const params = buildSearchUrl({ query: 'reverie', limit: 20 }, CLIENT_ID).searchParams
    expect(params.get('client_id')).toBe(CLIENT_ID)
    expect(params.get('format')).toBe('json')
    expect(params.get('order')).toBe('relevance')
    expect(params.get('type')).toBe('single albumtrack')
    expect(params.get('audioformat')).toBe('mp32')
    expect(params.get('imagesize')).toBe('300')
    expect(params.get('search')).toBe('reverie')
  })

  it('percent-encodes the query instead of concatenating it into the URL', () => {
    const url = buildSearchUrl({ query: 'a&b=c #d', limit: 20 }, CLIENT_ID)
    // The raw characters must not appear as URL syntax…
    expect(url.toString()).not.toContain('search=a&b=c')
    // …but must round-trip exactly.
    expect(url.searchParams.get('search')).toBe('a&b=c #d')
  })

  it('preserves Arabic, Cyrillic and Armenian queries byte for byte', () => {
    for (const query of ['سارة الصواص', 'кассандра', 'Սիրտ', '미야기']) {
      const url = buildSearchUrl({ query, limit: 20 }, CLIENT_ID)
      expect(url.searchParams.get('search')).toBe(query)
      expect(new URL(url.toString()).searchParams.get('search')).toBe(query)
    }
  })

  it('clamps the limit into the range Jamendo and the UI both accept', () => {
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(-5)).toBe(1)
    expect(clampLimit(1_000)).toBe(MAX_LIMIT)
    expect(clampLimit('25')).toBe(25)
    expect(clampLimit('abc')).toBe(DEFAULT_LIMIT)
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT)
    expect(clampLimit(12.7)).toBe(12)
    expect(buildSearchUrl({ query: 'x', limit: 9_999 }, CLIENT_ID).searchParams.get('limit')).toBe(
      String(MAX_LIMIT),
    )
  })

  it('never forwards a caller-supplied parameter it does not own', () => {
    const params = buildSearchUrl({ query: 'x', limit: 20 }, CLIENT_ID).searchParams
    expect([...params.keys()].sort()).toEqual([
      'audioformat',
      'client_id',
      'format',
      'imagesize',
      'limit',
      'order',
      'search',
      'type',
    ])
  })
})

describe('Jamendo response envelope', () => {
  it('accepts a successful envelope', () => {
    expect(readEnvelope(envelope([{ id: '1' }]))).toEqual({ ok: true, results: [{ id: '1' }] })
  })

  it('rejects a 200 OK whose own status reports failure', () => {
    const result = readEnvelope(
      envelope([], { status: 'failed', code: 5, error_message: 'Your credential is not valid' }),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a body carrying no results array', () => {
    expect(readEnvelope({ headers: { status: 'success' } }).ok).toBe(false)
    expect(readEnvelope({ headers: { status: 'success' }, results: 'nope' }).ok).toBe(false)
    expect(readEnvelope(null).ok).toBe(false)
    expect(readEnvelope('a string').ok).toBe(false)
  })
})

describe('Jamendo search transport', () => {
  const track = {
    id: '1',
    name: 'Reverie',
    duration: 200,
    artist_name: 'Lumen Field',
    audio: 'https://prod-1.storage.jamendo.com/?trackid=1&format=mp32',
    shareurl: 'https://www.jamendo.com/track/1/reverie',
    audiodownload: 'https://prod-1.storage.jamendo.com/download/track/1/mp32/',
  }

  it('returns sanitized tracks on success', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(envelope([track]))))
    const result = await searchJamendo({ query: 'reverie', limit: 5 }, { clientId: CLIENT_ID, fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.ok && result.tracks[0]?.title).toBe('Reverie')
    expect(result.ok && result.tracks[0]).not.toHaveProperty('audiodownload')
  })

  it('maps a 429 onto a rate-limit failure rather than a generic one', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({}, 429)))
    const result = await searchJamendo({ query: 'x', limit: 5 }, { clientId: CLIENT_ID, fetchImpl })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure).toBe('rate_limit')
  })

  it('maps any other non-2xx onto an upstream failure', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({}, 500)))
    const result = await searchJamendo({ query: 'x', limit: 5 }, { clientId: CLIENT_ID, fetchImpl })
    expect(!result.ok && result.failure).toBe('upstream')
    expect(!result.ok && result.status).toBe(500)
  })

  it('does not throw when Jamendo returns unparseable JSON', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('<html>502</html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    )
    const result = await searchJamendo({ query: 'x', limit: 5 }, { clientId: CLIENT_ID, fetchImpl })
    expect(!result.ok && result.failure).toBe('upstream')
  })

  it('does not throw when the network itself fails, and redacts the URL it reports', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError(`fetch failed: ${JAMENDO_TRACKS_ENDPOINT}?client_id=${CLIENT_ID}`)),
    )
    const result = await searchJamendo({ query: 'x', limit: 5 }, { clientId: CLIENT_ID, fetchImpl })
    expect(!result.ok && result.failure).toBe('upstream')
    expect(!result.ok && result.detail).not.toContain(CLIENT_ID)
  })

  it('reports a provider failure when the envelope says so', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(envelope([], { status: 'failed', code: 5, error_message: 'bad credential' }))),
    )
    const result = await searchJamendo({ query: 'x', limit: 5 }, { clientId: CLIENT_ID, fetchImpl })
    expect(!result.ok && result.failure).toBe('provider')
  })

  it('gives up on a provider that never answers', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        }),
    ) as unknown as typeof fetch

    const result = await searchJamendo(
      { query: 'x', limit: 5 },
      { clientId: CLIENT_ID, fetchImpl, timeoutMs: 10 },
    )
    expect(!result.ok && result.failure).toBe('timeout')
  })
})
