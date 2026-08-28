import { describe, expect, it, vi } from 'vitest'
import {
  MUSIC_CATEGORY_ID,
  RESULT_COUNT,
  YOUTUBE_SEARCH_ENDPOINT,
  YOUTUBE_VIDEOS_ENDPOINT,
  buildSearchUrl,
  buildVideosUrl,
  classifyGoogleError,
  detectRelevanceLanguage,
  searchYouTube,
} from './upstream.js'

const API_KEY = 'AIzaSyA-1234567890abcdefghijklmnopqrstu'

/** The request URL, without stringifying a `Request` object. */
function urlOf(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input))
}

function searchResponse(ids: string[]): unknown {
  return { items: ids.map((id) => ({ id: { kind: 'youtube#video', videoId: id } })) }
}

function videosResponse(ids: string[]): unknown {
  return {
    items: ids.map((id) => ({
      id,
      snippet: {
        title: `Title ${id}`,
        channelTitle: `Channel ${id}`,
        liveBroadcastContent: 'none',
        thumbnails: { maxres: { url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, width: 1280, height: 720 } },
      },
      contentDetails: { duration: 'PT3M00S' },
      status: { embeddable: true, madeForKids: false, privacyStatus: 'public', uploadStatus: 'processed' },
    })),
  }
}

/** Records every upstream URL so request counts can be asserted exactly. */
function recordingFetch(handlers: Array<(url: URL) => Response>): {
  fetchImpl: typeof fetch
  urls: URL[]
} {
  const urls: URL[] = []
  let call = 0
  const fetchImpl = vi.fn((input: RequestInfo | URL) => {
    const url = urlOf(input)
    urls.push(url)
    const handler = handlers[Math.min(call, handlers.length - 1)]
    call += 1
    return Promise.resolve(handler(url))
  }) as unknown as typeof fetch
  return { fetchImpl, urls }
}

const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 })

describe('search.list request shape', () => {
  it('sends exactly the documented, verified filters', () => {
    const url = buildSearchUrl({ query: 'sirusho' }, API_KEY)
    expect(url.origin + url.pathname).toBe(YOUTUBE_SEARCH_ENDPOINT)
    expect(url.searchParams.get('part')).toBe('snippet')
    expect(url.searchParams.get('type')).toBe('video')
    expect(url.searchParams.get('q')).toBe('sirusho')
    expect(url.searchParams.get('maxResults')).toBe(String(RESULT_COUNT))
    expect(url.searchParams.get('order')).toBe('relevance')
    expect(url.searchParams.get('videoEmbeddable')).toBe('true')
    expect(url.searchParams.get('videoSyndicated')).toBe('true')
    expect(url.searchParams.get('safeSearch')).toBe('moderate')
    expect(url.searchParams.get('videoCategoryId')).toBe(MUSIC_CATEGORY_ID)
    expect(url.searchParams.get('key')).toBe(API_KEY)
  })

  it('caps results at the product constant, which no caller can raise', () => {
    expect(RESULT_COUNT).toBe(8)
    expect(Number(buildSearchUrl({ query: 'x' }, API_KEY).searchParams.get('maxResults'))).toBeLessThanOrEqual(
      50,
    )
  })

  it('never requests pagination', () => {
    const url = buildSearchUrl({ query: 'x' }, API_KEY)
    expect(url.searchParams.get('pageToken')).toBeNull()
    expect(url.searchParams.has('publishedAfter')).toBe(false)
  })

  it('preserves Armenian, Arabic and Cyrillic queries literally', () => {
    for (const query of ['Սիրուշո', 'أم كلثوم', 'Кино Группа крови', '米津玄師']) {
      const url = buildSearchUrl({ query }, API_KEY)
      // `q` round-trips byte-for-byte; only the transport encoding differs.
      expect(url.searchParams.get('q')).toBe(query)

      // And it survives the wire as percent-encoded UTF-8, never as `?` or an
      // ASCII transliteration. (`URLSearchParams` writes a space as `+`, the
      // form-urlencoded convention Google's servers decode.)
      const raw = /[?&]q=([^&]*)/.exec(url.search)?.[1] ?? ''
      expect(decodeURIComponent(raw.replace(/\+/g, '%20'))).toBe(query)
      expect(raw).not.toContain('?')
    }
  })

  it('adds relevanceLanguage only for the two unambiguous scripts', () => {
    expect(detectRelevanceLanguage('Սիրուշո')).toBe('hy')
    expect(detectRelevanceLanguage('أم كلثوم')).toBe('ar')
    // Cyrillic spans many languages — guessing "ru" would be wrong as often as
    // it was right (agents/22 → "International Queries").
    expect(detectRelevanceLanguage('Кино')).toBeUndefined()
    expect(detectRelevanceLanguage('Океан Ельзи')).toBeUndefined()
    expect(detectRelevanceLanguage('adele hello')).toBeUndefined()

    expect(buildSearchUrl({ query: 'x' }, API_KEY).searchParams.get('relevanceLanguage')).toBeNull()
    expect(
      buildSearchUrl({ query: 'x', relevanceLanguage: 'hy' }, API_KEY).searchParams.get(
        'relevanceLanguage',
      ),
    ).toBe('hy')
  })
})

describe('videos.list batching', () => {
  it('asks for every id in one request', () => {
    const url = buildVideosUrl(['a1', 'b2', 'c3'], API_KEY)
    expect(url.origin + url.pathname).toBe(YOUTUBE_VIDEOS_ENDPOINT)
    expect(url.searchParams.get('id')).toBe('a1,b2,c3')
    expect(url.searchParams.get('part')).toBe('snippet,contentDetails,status')
    expect(url.searchParams.get('key')).toBe(API_KEY)
  })

  it('requests the status part, which is where madeForKids lives', () => {
    expect(buildVideosUrl(['a'], API_KEY).searchParams.get('part')).toContain('status')
  })
})

describe('one explicit search = one search.list + one videos.list', () => {
  it('spends exactly two upstream requests', async () => {
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']
    const { fetchImpl, urls } = recordingFetch([ok(searchResponse(ids)), ok(videosResponse(ids))])

    const result = await searchYouTube({ query: 'sirusho' }, { apiKey: API_KEY, fetchImpl })

    expect(result.ok).toBe(true)
    expect(urls).toHaveLength(2)
    expect(urls[0].pathname).toContain('/search')
    expect(urls[1].pathname).toContain('/videos')
    expect(result.ok && result.requests).toEqual({ search: 1, videos: 1 })
  })

  it('never calls videos.list once per result', async () => {
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd']
    const { fetchImpl, urls } = recordingFetch([ok(searchResponse(ids)), ok(videosResponse(ids))])
    await searchYouTube({ query: 'x' }, { apiKey: API_KEY, fetchImpl })
    expect(urls.filter((url) => url.pathname.includes('/videos'))).toHaveLength(1)
  })

  it('skips videos.list entirely when the search found nothing', async () => {
    const { fetchImpl, urls } = recordingFetch([ok({ items: [] })])
    const result = await searchYouTube({ query: 'x' }, { apiKey: API_KEY, fetchImpl })
    expect(urls).toHaveLength(1)
    expect(result).toEqual({ ok: true, videos: [], requests: { search: 1, videos: 0 } })
  })

  it('reapplies the search relevance order, which videos.list does not promise', async () => {
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']
    const shuffled = { items: (videosResponse(ids) as { items: unknown[] }).items.slice().reverse() }
    const { fetchImpl } = recordingFetch([ok(searchResponse(ids)), ok(shuffled)])
    const result = await searchYouTube({ query: 'x' }, { apiKey: API_KEY, fetchImpl })
    expect(result.ok && result.videos.map((video) => video.videoId)).toEqual(ids)
  })

  it('never retries a failed search', async () => {
    const { fetchImpl, urls } = recordingFetch([
      () => new Response(JSON.stringify({ error: { code: 500 } }), { status: 500 }),
    ])
    const result = await searchYouTube({ query: 'x' }, { apiKey: API_KEY, fetchImpl })
    expect(urls).toHaveLength(1)
    expect(result.ok).toBe(false)
  })
})

describe('error classification', () => {
  it('recognises every documented quota-exhaustion reason', () => {
    for (const reason of ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded']) {
      expect(classifyGoogleError(403, { error: { errors: [{ reason }] } })).toBe('quota')
    }
    expect(classifyGoogleError(429, {})).toBe('quota')
  })

  it('separates a rejected or restricted key from an exhausted quota', () => {
    expect(classifyGoogleError(403, { error: { errors: [{ reason: 'forbidden' }] } })).toBe('forbidden')
    expect(classifyGoogleError(400, { error: { errors: [{ reason: 'keyInvalid' }] } })).toBe('upstream')
    expect(classifyGoogleError(401, {})).toBe('forbidden')
    expect(classifyGoogleError(500, {})).toBe('upstream')
  })

  it('maps a timeout without leaking the request URL', async () => {
    const fetchImpl = vi.fn(() => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      return Promise.reject(error)
    }) as unknown as typeof fetch
    const result = await searchYouTube({ query: 'x' }, { apiKey: API_KEY, fetchImpl })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.failure).toBe('timeout')
    expect(JSON.stringify(result)).not.toContain(API_KEY)
  })

  it('never puts the API key in a failure detail', async () => {
    // `fetch` normally embeds the whole request URL in the error it throws.
    const fetchImpl = vi.fn(() =>
      Promise.reject(new Error(`request to ${YOUTUBE_SEARCH_ENDPOINT}?key=${API_KEY} failed`)),
    ) as unknown as typeof fetch
    const result = await searchYouTube({ query: 'x' }, { apiKey: API_KEY, fetchImpl })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(API_KEY)
    expect(result.ok === false && result.detail).toContain('<redacted>')
  })

  it('never echoes Googles own error payload, which can carry the request URL', async () => {
    const { fetchImpl } = recordingFetch([
      () =>
        new Response(
          JSON.stringify({
            error: { message: `Bad Request https://www.googleapis.com/youtube/v3/search?key=${API_KEY}` },
          }),
          { status: 400 },
        ),
    ])
    const result = await searchYouTube({ query: 'x' }, { apiKey: API_KEY, fetchImpl })
    expect(JSON.stringify(result)).not.toContain(API_KEY)
  })
})
