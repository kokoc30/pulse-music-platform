import { describe, expect, it, vi } from 'vitest'
import { handleJamendoRequest, handleJamendoRequestSafely } from './handler.js'
import { FORBIDDEN_KEYS } from './sanitize.js'

const CLIENT_ID = 'abc12345'
const ENV = { JAMENDO_CLIENT_ID: CLIENT_ID }

const RAW_TRACK = {
  id: '1880336',
  name: 'Reverie',
  duration: 214,
  artist_id: '440321',
  artist_name: 'Lumen Field',
  image: 'https://usercontent.jamendo.com/track/1880336/covers/1.300.jpg',
  audio: 'https://prod-1.storage.jamendo.com/?trackid=1880336&format=mp32&from=app-devsite',
  audiodownload: 'https://prod-1.storage.jamendo.com/download/track/1880336/mp32/',
  audiodownload_allowed: true,
  shareurl: 'https://www.jamendo.com/track/1880336/reverie',
  license_ccurl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
  waveform: '{"peaks":[1]}',
}

function upstream(results: unknown[] = [RAW_TRACK]) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          headers: { status: 'success', code: 0, results_count: results.length },
          results,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  )
}

const get = (query: string) => new Request(`https://pulse.example${query}`)

/** The URL the handler actually sent upstream, as a parsed URL. */
function upstreamUrl(fetchImpl: { mock: { calls: unknown[][] } }): URL {
  const first = fetchImpl.mock.calls[0]?.[0]
  if (typeof first !== 'string') throw new Error('the handler did not call Jamendo')
  return new URL(first)
}

describe('/api/jamendo request validation', () => {
  it('answers a valid search', async () => {
    const response = await handleJamendoRequest(get('/api/jamendo?action=search&q=reverie'), {
      env: ENV,
      fetchImpl: upstream() as unknown as typeof fetch,
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.provider).toBe('jamendo')
    expect(body.query).toBe('reverie')
    expect(body.count).toBe(1)
    expect(body.results[0].title).toBe('Reverie')
  })

  it('defaults to the search action when none is given', async () => {
    const response = await handleJamendoRequest(get('/api/jamendo?q=reverie'), {
      env: ENV,
      fetchImpl: upstream() as unknown as typeof fetch,
    })
    expect(response.status).toBe(200)
  })

  it('rejects an unsupported action instead of proxying it', async () => {
    const fetchImpl = upstream()
    const response = await handleJamendoRequest(get('/api/jamendo?action=albums&q=x'), {
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    // Nothing reached Jamendo: this is an allow-list, not a proxy.
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a non-GET method', async () => {
    const response = await handleJamendoRequest(
      new Request('https://pulse.example/api/jamendo?q=x', { method: 'POST' }),
      { env: ENV, fetchImpl: upstream() as unknown as typeof fetch },
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })

  it('rejects a missing or blank query', async () => {
    for (const query of ['/api/jamendo', '/api/jamendo?q=', '/api/jamendo?q=%20%20']) {
      const response = await handleJamendoRequest(get(query), { env: ENV })
      expect(response.status).toBe(400)
    }
  })

  it('length-limits an absurd query rather than forwarding it', async () => {
    const fetchImpl = upstream([])
    await handleJamendoRequest(get(`/api/jamendo?q=${'a'.repeat(5_000)}`), {
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const sent = upstreamUrl(fetchImpl).searchParams.get('search') ?? ''
    expect(sent.length).toBe(120)
  })

  it('clamps the limit, whatever the caller asks for', async () => {
    const cases: Array<[string, string]> = [
      ['1000', '30'],
      ['0', '1'],
      ['-4', '1'],
      ['abc', '20'],
      ['25', '25'],
    ]
    for (const [requested, expected] of cases) {
      const fetchImpl = upstream([])
      await handleJamendoRequest(get(`/api/jamendo?q=x&limit=${requested}`), {
        env: ENV,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      const sent = upstreamUrl(fetchImpl).searchParams.get('limit')
      expect(sent).toBe(expected)
    }
  })

  it('ignores unknown parameters instead of forwarding them upstream', async () => {
    const fetchImpl = upstream([])
    await handleJamendoRequest(
      get('/api/jamendo?q=x&client_id=attacker&order=downloads_total&include=stats&featured=1'),
      { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    const params = upstreamUrl(fetchImpl).searchParams
    expect(params.get('client_id')).toBe(CLIENT_ID)
    expect(params.get('order')).toBe('relevance')
    expect(params.get('include')).toBeNull()
    expect(params.get('featured')).toBeNull()
  })

  it('preserves a UTF-8 query end to end', async () => {
    for (const query of ['سارة الصواص', 'кассандра', 'Սիրտ']) {
      const fetchImpl = upstream([])
      const response = await handleJamendoRequest(
        get(`/api/jamendo?q=${encodeURIComponent(query)}`),
        { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch },
      )
      expect(upstreamUrl(fetchImpl).searchParams.get('search')).toBe(query)
      expect((await response.json()).query).toBe(query)
    }
  })
})

describe('/api/jamendo configuration and failure', () => {
  it('reports "unavailable" — not an error — when the credential is absent', async () => {
    const fetchImpl = upstream()
    const response = await handleJamendoRequest(get('/api/jamendo?q=x'), {
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('UNAVAILABLE')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('treats a VITE_-prefixed Jamendo variable as no configuration at all', async () => {
    const response = await handleJamendoRequest(get('/api/jamendo?q=x'), {
      env: { VITE_JAMENDO_CLIENT_ID: CLIENT_ID },
    })
    expect(response.status).toBe(503)
  })

  it('maps upstream failures onto safe status codes', async () => {
    const cases: Array<[number, number, string]> = [
      [429, 429, 'RATE_LIMIT'],
      [500, 502, 'UPSTREAM'],
      [404, 502, 'UPSTREAM'],
    ]
    for (const [upstreamStatus, expectedStatus, code] of cases) {
      const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}', { status: upstreamStatus })))
      const response = await handleJamendoRequest(get('/api/jamendo?q=x'), {
        env: ENV,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        logger: () => {},
      })
      expect(response.status).toBe(expectedStatus)
      expect((await response.json()).error.code).toBe(code)
    }
  })

  it('never puts provider detail into the body the visitor can read', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError(`fetch failed https://api.jamendo.com/v3.0/tracks/?client_id=${CLIENT_ID}`)),
    )
    const response = await handleJamendoRequest(get('/api/jamendo?q=x'), {
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: () => {},
    })
    const text = await response.text()
    expect(text).not.toContain(CLIENT_ID)
    expect(text).not.toContain('api.jamendo.com')
    expect(text).not.toContain('TypeError')
  })

  it('redacts the credential from everything it logs', async () => {
    const logged: string[] = []
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError(`fetch failed https://api.jamendo.com/v3.0/tracks/?client_id=${CLIENT_ID}`)),
    )
    await handleJamendoRequest(get('/api/jamendo?q=x'), {
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: (message) => logged.push(message),
    })
    expect(logged.length).toBeGreaterThan(0)
    for (const line of logged) expect(line).not.toContain(CLIENT_ID)
  })

  it('turns an unexpected throw into a safe 502 rather than a stack trace', async () => {
    const response = await handleJamendoRequestSafely(get('/api/jamendo?q=x'), {
      env: ENV,
      fetchImpl: (() => {
        throw new Error(`boom ${CLIENT_ID}`)
      }) as unknown as typeof fetch,
      logger: () => {},
    })
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain(CLIENT_ID)
  })
})

describe('/api/jamendo response sanitization', () => {
  it('sends the credential upstream and never downstream', async () => {
    const fetchImpl = upstream()
    const response = await handleJamendoRequest(get('/api/jamendo?q=reverie'), {
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    // Upstream: present.
    expect(upstreamUrl(fetchImpl).searchParams.get('client_id')).toBe(CLIENT_ID)
    // Downstream: absent, in the body and in every header.
    const text = await response.clone().text()
    expect(text).not.toContain(CLIENT_ID)
    expect(text).not.toContain('client_id')
    response.headers.forEach((value) => expect(value).not.toContain(CLIENT_ID))
  })

  it('strips the download URL and every other forbidden field', async () => {
    const response = await handleJamendoRequest(get('/api/jamendo?q=reverie'), {
      env: ENV,
      fetchImpl: upstream() as unknown as typeof fetch,
    })
    const text = await response.text()
    for (const key of FORBIDDEN_KEYS) expect(text).not.toContain(key)
    expect(text).not.toContain('/download/')
  })

  it('drops a track whose URL would carry the credential', async () => {
    const leaky = { ...RAW_TRACK, audio: `https://prod-1.storage.jamendo.com/?from=app-${CLIENT_ID}` }
    const response = await handleJamendoRequest(get('/api/jamendo?q=reverie'), {
      env: ENV,
      fetchImpl: upstream([leaky]) as unknown as typeof fetch,
    })
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain(CLIENT_ID)
    expect(body.results[0].audioUrl).toBeUndefined()
  })

  it('is not cached and is not CORS-enabled', async () => {
    const response = await handleJamendoRequest(get('/api/jamendo?q=x'), {
      env: ENV,
      fetchImpl: upstream() as unknown as typeof fetch,
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers an empty catalogue result as success, not as a failure', async () => {
    const response = await handleJamendoRequest(get('/api/jamendo?q=zzzznothing'), {
      env: ENV,
      fetchImpl: upstream([]) as unknown as typeof fetch,
    })
    expect(response.status).toBe(200)
    expect((await response.json()).results).toEqual([])
  })
})
