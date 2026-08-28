import { describe, expect, it, vi } from 'vitest'
import { MusicError } from '@/music/types'
import { JAMENDO_API_PATH, searchJamendoTracks } from './client'

const TRACK = {
  id: '1',
  title: 'Reverie',
  artistName: 'Lumen Field',
  durationSeconds: 214,
  audioUrl: 'https://prod-1.storage.jamendo.com/?trackid=1&format=mp32',
  sourceUrl: 'https://www.jamendo.com/track/1/reverie',
}

const ok = (results: unknown[] = [TRACK]) =>
  vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ provider: 'jamendo', query: 'x', count: results.length, results }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  ) as unknown as typeof fetch

describe('browser Jamendo client', () => {
  it('calls only the same-origin route, never Jamendo directly', async () => {
    const fetchImpl = ok()
    await searchJamendoTracks('reverie', { fetchImpl })
    const url = new URL(
      String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]),
      window.location.href,
    )
    expect(url.pathname).toBe(JAMENDO_API_PATH)
    expect(url.origin).toBe(window.location.origin)
    expect(url.href).not.toContain('api.jamendo.com')
    expect(url.href).not.toContain('client_id')
  })

  it('sends the allow-listed parameters and nothing else', async () => {
    const fetchImpl = ok()
    await searchJamendoTracks('reverie', { fetchImpl, limit: 15 })
    const url = String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])
    const params = new URL(url, window.location.href).searchParams
    expect([...params.keys()].sort()).toEqual(['action', 'limit', 'q'])
    expect(params.get('action')).toBe('search')
    expect(params.get('q')).toBe('reverie')
    expect(params.get('limit')).toBe('15')
  })

  it('returns normalized, namespaced tracks', async () => {
    const result = await searchJamendoTracks('reverie', { fetchImpl: ok() })
    expect(result.status).toBe('success')
    expect(result.tracks[0]?.id).toBe('jamendo:1')
    expect(result.tracks[0]?.provider).toBe('jamendo')
    expect(result.tracks[0]?.attributionRequired).toBe(true)
  })

  it('preserves a Unicode query without folding it', async () => {
    const fetchImpl = ok([])
    await searchJamendoTracks('кассандра', { fetchImpl })
    const url = String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])
    expect(new URL(url, window.location.href).searchParams.get('q')).toBe('кассандра')
  })

  it('reports 503 as "unavailable", which the UI degrades from silently', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}', { status: 503 }))) as unknown as typeof fetch
    const result = await searchJamendoTracks('x', { fetchImpl })
    expect(result).toEqual({ status: 'unavailable', tracks: [] })
  })

  it('reports any other failure as an error without throwing', async () => {
    for (const status of [400, 429, 500, 502, 504]) {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(new Response('{}', { status })),
      ) as unknown as typeof fetch
      const result = await searchJamendoTracks('x', { fetchImpl })
      expect(result.status).toBe('error')
      expect(result.tracks).toEqual([])
    }
  })

  it('survives a network failure', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch
    const result = await searchJamendoTracks('x', { fetchImpl })
    expect(result.status).toBe('error')
  })

  it('survives a response body that is not the expected shape', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('<html/>', { status: 200 })),
    ) as unknown as typeof fetch
    const result = await searchJamendoTracks('x', { fetchImpl })
    expect(result.status).toBe('error')
  })

  it('gives up on a slow provider instead of holding the search open', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        }),
    ) as unknown as typeof fetch
    const result = await searchJamendoTracks('x', { fetchImpl, timeoutMs: 10 })
    expect(result).toEqual({ status: 'error', tracks: [], detail: 'timeout' })
  })

  it('re-raises a caller abort as the domain ABORTED, so stale searches still cancel', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        }),
    ) as unknown as typeof fetch

    const pending = searchJamendoTracks('x', { fetchImpl, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(MusicError)
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('does not call the network for a blank query', async () => {
    const fetchImpl = ok()
    const result = await searchJamendoTracks('   ', { fetchImpl })
    expect(result).toEqual({ status: 'success', tracks: [] })
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0)
  })
})
