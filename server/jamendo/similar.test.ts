import { describe, expect, it, vi } from 'vitest'
import { handleJamendoRequest } from './handler'
import type { JamendoSimilarBody } from './handler'
import { PAYLOAD_KEYS } from './sanitize'
import {
  JAMENDO_SIMILAR_ENDPOINT,
  SIMILAR_LIMIT,
  buildSimilarUrl,
  isValidJamendoId,
} from './upstream'

/**
 * The `similar` action.
 *
 * Everything here asks the same question the Phase 2 security tests ask of
 * `search`: can a caller widen it, and can the credential escape? The action is
 * reached automatically when a track ends, so it gets *more* scrutiny than a
 * visitor-initiated search, not less.
 */

const CLIENT_ID = 'test-client-id-2f9a'

const upstreamTrack = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Track ${id}`,
  artist_name: 'Some Artist',
  artist_id: `a-${id}`,
  duration: 210,
  audio: `https://prod.jamendo.com/?trackid=${id}`,
  shareurl: `https://www.jamendo.com/track/${id}`,
  image: 'https://usercontent.jamendo.com/cover.jpg',
  ...extra,
})

function envelope(results: unknown[]) {
  return { headers: { status: 'success', results_count: results.length }, results }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const request = (query: string) => new Request(`https://pulse.local/api/jamendo?${query}`)
const env = { JAMENDO_CLIENT_ID: CLIENT_ID }

describe('the upstream URL', () => {
  it('targets Jamendo’s documented similar endpoint', () => {
    const url = buildSimilarUrl({ id: '1880336' }, CLIENT_ID)
    expect(url.toString().startsWith(JAMENDO_SIMILAR_ENDPOINT)).toBe(true)
  })

  it('fixes the result limit server-side', () => {
    const url = buildSimilarUrl({ id: '1880336' }, CLIENT_ID)
    expect(url.searchParams.get('limit')).toBe(String(SIMILAR_LIMIT))
    expect(SIMILAR_LIMIT).toBeLessThanOrEqual(20)
  })

  it('asks for the metadata the similarity scorer reads', () => {
    // Only this action requests `musicinfo`; the search request is untouched.
    expect(buildSimilarUrl({ id: '1' }, CLIENT_ID).searchParams.get('include')).toBe('musicinfo')
  })

  it('carries the credential, which is why it is server-side only', () => {
    expect(buildSimilarUrl({ id: '1' }, CLIENT_ID).searchParams.get('client_id')).toBe(CLIENT_ID)
  })
})

describe('id validation', () => {
  it('accepts a Jamendo numeric id', () => {
    expect(isValidJamendoId('1880336')).toBe(true)
  })

  it('rejects everything else', () => {
    for (const bad of [
      '',
      'abc',
      '../../etc/passwd',
      '1880336; DROP TABLE',
      '1880336&client_id=leak',
      '-1',
      '1.5',
      '12345678901234567890',
      null,
      undefined,
      12345,
    ]) {
      expect(isValidJamendoId(bad as never)).toBe(false)
    }
  })

  it('is enforced before any network call happens', async () => {
    const fetchImpl = vi.fn()
    const response = await handleJamendoRequest(request('action=similar&id=notanid'), {
      env,
      fetchImpl: fetchImpl as never,
      logger: () => undefined,
    })
    expect(response.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('requires an id at all', async () => {
    const response = await handleJamendoRequest(request('action=similar'), {
      env,
      fetchImpl: vi.fn() as never,
      logger: () => undefined,
    })
    expect(response.status).toBe(400)
  })
})

describe('the answer', () => {
  it('returns sanitized similar tracks', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelope([upstreamTrack('1880336')])))
    const response = await handleJamendoRequest(request('action=similar&id=999'), {
      env,
      fetchImpl: fetchImpl as never,
      logger: () => undefined,
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as JamendoSimilarBody
    expect(body.provider).toBe('jamendo')
    expect(body.action).toBe('similar')
    expect(body.id).toBe('999')
    expect(body.count).toBe(1)
    expect(body.results[0].title).toBe('Track 1880336')
  })

  it('emits only allow-listed keys', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        envelope([
          upstreamTrack('1', {
            musicinfo: { tags: { genres: ['electronic'], vartags: ['club'] }, speed: '124' },
          }),
        ]),
      ),
    )
    const response = await handleJamendoRequest(request('action=similar&id=1'), {
      env,
      fetchImpl: fetchImpl as never,
      logger: () => undefined,
    })
    const body = (await response.json()) as JamendoSimilarBody

    for (const key of Object.keys(body.results[0])) {
      expect(PAYLOAD_KEYS).toContain(key as (typeof PAYLOAD_KEYS)[number])
    }
    expect(body.results[0].tags).toEqual(['electronic', 'club'])
    expect(body.results[0].bpm).toBe(124)
  })

  it('never returns a download URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        envelope([
          upstreamTrack('1', {
            audiodownload: 'https://prod.jamendo.com/download/track/1/mp32',
            audiodownload_allowed: true,
          }),
        ]),
      ),
    )
    const response = await handleJamendoRequest(request('action=similar&id=1'), {
      env,
      fetchImpl: fetchImpl as never,
      logger: () => undefined,
    })
    const raw = await response.text()
    expect(raw).not.toContain('audiodownload')
    expect(raw).not.toContain('/download/')
  })

  it('never returns the client id, in the body or in an error', async () => {
    const logs: string[] = []
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error(`fetch failed for ...client_id=${CLIENT_ID}&format=json`))
    const response = await handleJamendoRequest(request('action=similar&id=1'), {
      env,
      fetchImpl: fetchImpl as never,
      logger: (message) => logs.push(message),
    })

    const raw = await response.text()
    expect(raw).not.toContain(CLIENT_ID)
    expect(logs.join('\n')).not.toContain(CLIENT_ID)
  })

  it('sets no CORS header and no cache', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelope([])))
    const response = await handleJamendoRequest(request('action=similar&id=1'), {
      env,
      fetchImpl: fetchImpl as never,
      logger: () => undefined,
    })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('it is not a proxy', () => {
  it('ignores a caller-supplied limit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelope([])))
    await handleJamendoRequest(request('action=similar&id=1&limit=200'), {
      env,
      fetchImpl: fetchImpl as never,
      logger: () => undefined,
    })
    const url = new URL((fetchImpl.mock.calls[0] as string[])[0])
    expect(url.searchParams.get('limit')).toBe(String(SIMILAR_LIMIT))
  })

  it('forwards no unknown parameter upstream', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelope([])))
    await handleJamendoRequest(
      request('action=similar&id=1&fullcount=true&client_id=attacker&order=popularity'),
      { env, fetchImpl: fetchImpl as never, logger: () => undefined },
    )
    const url = new URL((fetchImpl.mock.calls[0] as string[])[0])
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(url.searchParams.get('fullcount')).toBeNull()
    expect(url.searchParams.get('order')).toBeNull()
  })

  it('still rejects an unknown action', async () => {
    const response = await handleJamendoRequest(request('action=albums&id=1'), {
      env,
      fetchImpl: vi.fn() as never,
      logger: () => undefined,
    })
    expect(response.status).toBe(400)
  })

  it('still refuses anything but GET', async () => {
    const response = await handleJamendoRequest(
      new Request('https://pulse.local/api/jamendo?action=similar&id=1', { method: 'POST' }),
      { env, fetchImpl: vi.fn() as never, logger: () => undefined },
    )
    expect(response.status).toBe(405)
  })
})

describe('degradation', () => {
  it('reports unavailable when Jamendo is not configured', async () => {
    const response = await handleJamendoRequest(request('action=similar&id=1'), {
      env: {},
      fetchImpl: vi.fn() as never,
      logger: () => undefined,
    })
    expect(response.status).toBe(503)
  })

  it('maps a rate limit and an upstream failure onto the existing codes', async () => {
    const limited = await handleJamendoRequest(request('action=similar&id=1'), {
      env,
      fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 429 })) as never,
      logger: () => undefined,
    })
    expect(limited.status).toBe(429)

    const broken = await handleJamendoRequest(request('action=similar&id=1'), {
      env,
      fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 500 })) as never,
      logger: () => undefined,
    })
    expect(broken.status).toBe(502)
  })

  it('leaves the search action working exactly as before', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelope([upstreamTrack('1')])))
    const response = await handleJamendoRequest(request('action=search&q=night'), {
      env,
      fetchImpl: fetchImpl as never,
      logger: () => undefined,
    })
    const body = (await response.json()) as { action: string }
    expect(response.status).toBe(200)
    expect(body.action).toBe('search')

    // Crucially, the search request still does not ask for `musicinfo`: its
    // shape is on the visitor's critical path and is pinned by Phase 2 tests.
    const url = new URL((fetchImpl.mock.calls[0] as string[])[0])
    expect(url.searchParams.get('include')).toBeNull()
    expect(url.pathname).toContain('/tracks/')
    expect(url.pathname).not.toContain('/similar')
  })
})
