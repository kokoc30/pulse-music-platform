import { describe, expect, it, vi } from 'vitest'
import { ALLOWED_PARAMS, handleYouTubeRequest, handleYouTubeRequestSafely } from './handler.js'
import type { YouTubeSearchBody } from './handler.js'

const API_KEY = 'AIzaSyA-1234567890abcdefghijklmnopqrstu'
const ENV = { YOUTUBE_API_KEY: API_KEY }

/** The request URL, without stringifying a `Request` object. */
function urlOf(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input))
}

const IDS = ['aaaaaaaaaaa', 'bbbbbbbbbbb']

function upstreamFetch(
  overrides: { search?: () => Response; videos?: () => Response } = {},
): { fetchImpl: typeof fetch; urls: URL[] } {
  const urls: URL[] = []
  const fetchImpl = vi.fn((input: RequestInfo | URL) => {
    const url = urlOf(input)
    urls.push(url)
    if (url.pathname.includes('/search')) {
      return Promise.resolve(
        overrides.search?.() ??
        new Response(
          JSON.stringify({ items: IDS.map((id) => ({ id: { kind: 'youtube#video', videoId: id } })) }),
          { status: 200 },
        )
      )
    }
    return Promise.resolve(
      overrides.videos?.() ??
      new Response(
        JSON.stringify({
          items: IDS.map((id) => ({
            id,
            snippet: {
              title: `Song &amp; ${id}`,
              channelTitle: `Channel ${id}`,
              liveBroadcastContent: 'none',
              thumbnails: {
                maxres: { url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, width: 1280, height: 720 },
              },
            },
            contentDetails: { duration: 'PT3M20S' },
            status: {
              embeddable: true,
              madeForKids: false,
              privacyStatus: 'public',
              uploadStatus: 'processed',
            },
            statistics: { viewCount: '999' },
          })),
        }),
        { status: 200 },
      )
    )
  }) as unknown as typeof fetch
  return { fetchImpl, urls }
}

const request = (query: string) => new Request(`https://pulse.test/api/youtube?${query}`)

describe('the /api/youtube contract', () => {
  it('answers a valid search with the sanitized wire body', async () => {
    const { fetchImpl } = upstreamFetch()
    const response = await handleYouTubeRequest(request('action=search&q=sirusho'), {
      env: ENV,
      fetchImpl,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as YouTubeSearchBody
    expect(body.provider).toBe('youtube')
    expect(body.action).toBe('search')
    expect(body.query).toBe('sirusho')
    expect(body.count).toBe(2)
    expect(body.results[0]).toMatchObject({
      videoId: 'aaaaaaaaaaa',
      title: 'Song & aaaaaaaaaaa',
      embeddable: true,
      madeForKids: false,
      durationSeconds: 200,
    })
    // Statistics never cross the wire: no cross-platform popularity metric can
    // be derived from data the browser does not have (agents/22 → "Ranking").
    expect(JSON.stringify(body)).not.toContain('999')
  })

  it('defaults to the search action and rejects any other', async () => {
    const { fetchImpl } = upstreamFetch()
    expect((await handleYouTubeRequest(request('q=x'), { env: ENV, fetchImpl })).status).toBe(200)
    for (const action of ['videos', 'proxy', 'playlists', 'channels']) {
      const response = await handleYouTubeRequest(request(`action=${action}&q=x`), { env: ENV, fetchImpl })
      expect(response.status).toBe(400)
    }
  })

  it('rejects anything that is not a GET', async () => {
    const response = await handleYouTubeRequest(
      new Request('https://pulse.test/api/youtube?q=x', { method: 'POST' }),
      { env: ENV },
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })

  it('rejects an empty query before spending any quota', async () => {
    const { fetchImpl, urls } = upstreamFetch()
    for (const query of ['action=search', 'action=search&q=', 'action=search&q=%20%20']) {
      expect((await handleYouTubeRequest(request(query), { env: ENV, fetchImpl })).status).toBe(400)
    }
    expect(urls).toHaveLength(0)
  })

  it('is a narrow action, not a Google proxy', async () => {
    const { fetchImpl, urls } = upstreamFetch()
    // Everything a proxy would honour is ignored: the caller cannot raise the
    // result count, page, change the part, pick another endpoint or inject a
    // key (agents/23 → "API Shape").
    await handleYouTubeRequest(
      request(
        'action=search&q=x&maxResults=50&pageToken=CAUQAA&part=snippet,statistics&key=leaked&url=https://evil.test&videoCategoryId=1&order=viewCount',
      ),
      { env: ENV, fetchImpl },
    )
    const search = urls[0]
    expect(search.origin).toBe('https://www.googleapis.com')
    expect(search.searchParams.get('maxResults')).toBe('8')
    expect(search.searchParams.get('pageToken')).toBeNull()
    expect(search.searchParams.get('part')).toBe('snippet')
    expect(search.searchParams.get('key')).toBe(API_KEY)
    expect(search.searchParams.get('order')).toBe('relevance')
    expect(search.searchParams.get('videoCategoryId')).toBe('10')
    expect(ALLOWED_PARAMS).toEqual(['action', 'q'])
  })

  it('preserves a non-Latin query end to end', async () => {
    const { fetchImpl, urls } = upstreamFetch()
    const response = await handleYouTubeRequest(
      new Request(`https://pulse.test/api/youtube?action=search&q=${encodeURIComponent('Սիրուշո')}`),
      { env: ENV, fetchImpl },
    )
    const body = (await response.json()) as YouTubeSearchBody
    expect(body.query).toBe('Սիրուշո')
    expect(urls[0].searchParams.get('q')).toBe('Սիրուշո')
    expect(urls[0].searchParams.get('relevanceLanguage')).toBe('hy')
  })

  it('never sets a CORS header, and never lets a response be cached', async () => {
    const { fetchImpl } = upstreamFetch()
    const response = await handleYouTubeRequest(request('action=search&q=x'), { env: ENV, fetchImpl })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('configuration and failure states', () => {
  it('answers 503 without a key, and never calls Google', async () => {
    const { fetchImpl, urls } = upstreamFetch()
    const response = await handleYouTubeRequest(request('action=search&q=x'), { env: {}, fetchImpl })
    expect(response.status).toBe(503)
    expect(urls).toHaveLength(0)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('UNAVAILABLE')
  })

  it('maps quota exhaustion to the documented user message, with no retry', async () => {
    const { fetchImpl, urls } = upstreamFetch({
      search: () =>
        new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 }),
    })
    const response = await handleYouTubeRequest(request('action=search&q=x'), {
      env: ENV,
      fetchImpl,
      logger: () => {},
    })
    expect(response.status).toBe(429)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('QUOTA')
    expect(body.error.message).toBe('YouTube search is temporarily unavailable. Try again later.')
    expect(urls).toHaveLength(1)
  })

  it('treats a rejected key as unavailable rather than as the visitors problem', async () => {
    const { fetchImpl } = upstreamFetch({
      search: () =>
        new Response(JSON.stringify({ error: { errors: [{ reason: 'forbidden' }] } }), { status: 403 }),
    })
    const response = await handleYouTubeRequest(request('action=search&q=x'), {
      env: ENV,
      fetchImpl,
      logger: () => {},
    })
    expect(response.status).toBe(503)
  })

  it('turns an unexpected throw into a safe 502, never a stack trace', async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error(`boom https://www.googleapis.com/youtube/v3/search?key=${API_KEY}`)
    }) as unknown as typeof fetch
    const logged: string[] = []
    const response = await handleYouTubeRequestSafely(request('action=search&q=x'), {
      env: ENV,
      fetchImpl,
      logger: (message) => logged.push(message),
    })
    expect(response.status).toBe(502)
    const text = await response.text()
    expect(text).not.toContain(API_KEY)
    expect(text).not.toContain('boom')
  })
})

describe('credential containment', () => {
  it('never returns the key in a success body', async () => {
    const { fetchImpl } = upstreamFetch()
    const response = await handleYouTubeRequest(request('action=search&q=x'), { env: ENV, fetchImpl })
    expect(await response.text()).not.toContain(API_KEY)
  })

  it('never returns the key in any error body', async () => {
    for (const status of [400, 403, 429, 500]) {
      const { fetchImpl } = upstreamFetch({
        search: () =>
          new Response(JSON.stringify({ error: { message: `failed with key=${API_KEY}` } }), { status }),
      })
      const response = await handleYouTubeRequest(request('action=search&q=x'), {
        env: ENV,
        fetchImpl,
        logger: () => {},
      })
      expect(await response.text()).not.toContain(API_KEY)
    }
  })

  it('redacts the key out of everything it logs', async () => {
    const logged: string[] = []
    const { fetchImpl } = upstreamFetch({
      search: () =>
        // The realistic shape: fetch throws with the whole request URL in it.
        new Response(JSON.stringify({ error: {} }), { status: 500 }),
    })
    await handleYouTubeRequest(request('action=search&q=x'), {
      env: ENV,
      fetchImpl,
      logger: (message) => logged.push(message),
    })
    expect(logged.length).toBeGreaterThan(0)
    expect(logged.join('\n')).not.toContain(API_KEY)
  })

  it('drops any result row that somehow carries the key', async () => {
    const { fetchImpl } = upstreamFetch({
      videos: () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: IDS[0],
                snippet: {
                  title: `Leak ${API_KEY}`,
                  channelTitle: 'c',
                  thumbnails: { maxres: { url: 'https://i.ytimg.com/vi/a/maxresdefault.jpg' } },
                },
                status: { embeddable: true, madeForKids: false, privacyStatus: 'public' },
              },
            ],
          }),
          { status: 200 },
        ),
    })
    const response = await handleYouTubeRequest(request('action=search&q=x'), { env: ENV, fetchImpl })
    const body = (await response.json()) as YouTubeSearchBody
    expect(body.results).toHaveLength(0)
  })
})
