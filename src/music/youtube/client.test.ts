import { afterEach, describe, expect, it, vi } from 'vitest'
import { MusicError } from '@/music/types'
import { youtubePayload, youtubeSearchResponse } from '@/test/fixtures/youtube'
import {
  YOUTUBE_API_PATH,
  clearYouTubeSessionCache,
  searchYouTubeVideos,
  youTubeSessionCacheSize,
  youtubeRequestUrl,
} from './client'

afterEach(() => clearYouTubeSessionCache())

/** The request URL, without stringifying a `Request` object. */
function urlOf(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input))
}

function jsonFetch(body: unknown, status = 200) {
  const calls: URL[] = []
  const fetchImpl = vi.fn((input: RequestInfo | URL) => {
    calls.push(urlOf(input))
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('the browser YouTube client', () => {
  it('calls the same-origin route and nothing else', async () => {
    const { fetchImpl, calls } = jsonFetch(youtubeSearchResponse())
    await searchYouTubeVideos('sirusho', { fetchImpl })
    expect(calls).toHaveLength(1)
    expect(calls[0].pathname).toBe(YOUTUBE_API_PATH)
    expect(calls[0].origin).toBe(window.location.origin)
    // Never Google directly: the browser has no key and must never have one.
    expect(calls[0].host).not.toContain('googleapis')
  })

  it('sends only the two allow-listed parameters', async () => {
    const { fetchImpl, calls } = jsonFetch(youtubeSearchResponse())
    await searchYouTubeVideos('sirusho', { fetchImpl })
    expect([...calls[0].searchParams.keys()].sort()).toEqual(['action', 'q'])
    expect(calls[0].searchParams.get('action')).toBe('search')
    expect(calls[0].searchParams.get('q')).toBe('sirusho')
    // No caller-controlled result count, page token, part or key.
    expect(calls[0].searchParams.get('limit')).toBeNull()
    expect(calls[0].searchParams.get('maxResults')).toBeNull()
    expect(calls[0].searchParams.get('key')).toBeNull()
  })

  it('preserves Armenian, Arabic and Cyrillic queries literally', async () => {
    for (const query of ['Սիրուշո', 'أم كلثوم', 'Кино']) {
      const { fetchImpl, calls } = jsonFetch(youtubeSearchResponse([], query))
      await searchYouTubeVideos(query, { fetchImpl })
      expect(calls[0].searchParams.get('q')).toBe(query)
    }
  })

  it('normalizes the response into YouTube items', async () => {
    const { fetchImpl } = jsonFetch(youtubeSearchResponse([youtubePayload()]))
    const result = await searchYouTubeVideos('sirusho', { fetchImpl })
    expect(result.status).toBe('success')
    expect(result.requests).toBe(1)
    expect(result.videos).toHaveLength(1)
    expect(result.videos[0]).toMatchObject({
      id: 'youtube:aaaaaaaaaaa',
      provider: 'youtube',
      mediaKind: 'youtube-video',
      sourceUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    })
  })

  it('spends no request at all on an empty query', async () => {
    const { fetchImpl, calls } = jsonFetch(youtubeSearchResponse())
    const result = await searchYouTubeVideos('   ', { fetchImpl })
    expect(calls).toHaveLength(0)
    expect(result).toEqual({ status: 'success', videos: [], requests: 0 })
  })
})

describe('quota discipline in the client', () => {
  it('answers a repeated identical query from the session cache', async () => {
    const { fetchImpl, calls } = jsonFetch(youtubeSearchResponse())
    const first = await searchYouTubeVideos('sirusho', { fetchImpl })
    const second = await searchYouTubeVideos('sirusho', { fetchImpl })
    expect(calls).toHaveLength(1)
    expect(second.requests).toBe(0)
    expect(second.videos.map((v) => v.id)).toEqual(first.videos.map((v) => v.id))
  })

  it('does not confuse two different queries', async () => {
    const { fetchImpl, calls } = jsonFetch(youtubeSearchResponse())
    await searchYouTubeVideos('sirusho', { fetchImpl })
    await searchYouTubeVideos('Սիրուշո', { fetchImpl })
    expect(calls).toHaveLength(2)
  })

  it('keeps the cache bounded and in-memory only', async () => {
    const { fetchImpl } = jsonFetch(youtubeSearchResponse())
    for (let index = 0; index < 30; index += 1) {
      await searchYouTubeVideos(`query ${index}`, { fetchImpl })
    }
    expect(youTubeSessionCacheSize()).toBeLessThanOrEqual(20)
    // Nothing is persisted: no localStorage, no cookie, no IndexedDB.
    expect(Object.keys(localStorage)).not.toContain('pulse:youtube')
    expect(JSON.stringify(localStorage)).not.toContain('youtube')
  })

  it('never caches a failure, so a transient error is retryable', async () => {
    const failing = jsonFetch({ error: { code: 'UPSTREAM' } }, 502)
    await searchYouTubeVideos('sirusho', { fetchImpl: failing.fetchImpl })
    const succeeding = jsonFetch(youtubeSearchResponse())
    const result = await searchYouTubeVideos('sirusho', { fetchImpl: succeeding.fetchImpl })
    expect(succeeding.calls).toHaveLength(1)
    expect(result.status).toBe('success')
  })
})

describe('failure mapping', () => {
  it('reports an unconfigured deployment as unavailable, not as an error', async () => {
    const { fetchImpl } = jsonFetch({ error: { code: 'UNAVAILABLE' } }, 503)
    expect(await searchYouTubeVideos('x', { fetchImpl })).toEqual({
      status: 'unavailable',
      videos: [],
      requests: 1,
    })
  })

  it('reports quota exhaustion distinctly, and does not retry', async () => {
    const { fetchImpl, calls } = jsonFetch({ error: { code: 'QUOTA' } }, 429)
    const result = await searchYouTubeVideos('x', { fetchImpl })
    expect(result.status).toBe('quota')
    expect(calls).toHaveLength(1)
  })

  it('reports any other failure as a plain error', async () => {
    const { fetchImpl } = jsonFetch({ error: { code: 'UPSTREAM' } }, 502)
    const result = await searchYouTubeVideos('x', { fetchImpl })
    expect(result.status).toBe('error')
    expect(result.videos).toEqual([])
  })

  it('re-raises a caller abort as the domain ABORTED error', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    ) as unknown as typeof fetch

    const pending = searchYouTubeVideos('x', { fetchImpl, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(MusicError)
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('treats its own timeout as a soft error, not an abort', async () => {
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    ) as unknown as typeof fetch

    const result = await searchYouTubeVideos('x', { fetchImpl, timeoutMs: 1 })
    expect(result).toEqual({ status: 'error', videos: [], requests: 1, detail: 'timeout' })
  })
})

describe('request URL construction', () => {
  it('resolves against the current document, keeping it same-origin', () => {
    const url = youtubeRequestUrl(new URLSearchParams({ action: 'search', q: 'x' }))
    expect(url.startsWith(window.location.origin)).toBe(true)
    expect(url).toContain('/api/youtube?')
  })
})
