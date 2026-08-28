import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { AUDIUS_BASE } from '@/test/msw/handlers'
import {
  getAdvertisedContentNodes,
  isOriginKnownBad,
  reportFailedStreamOrigin,
  resetStreamOriginFailures,
  resolveHealthyStreamUrl,
} from './content-nodes'

const SIGNED_PATH = '/tracks/cidstream/QmAbc?signature=%7B%22data%22%3A%22x%22%7D'
const BAD = `https://cn2.example.audius${SIGNED_PATH}`

beforeEach(() => resetStreamOriginFailures())
afterEach(() => resetStreamOriginFailures())

describe('content-node failover', () => {
  it('reads the node list Audius advertises on /health_check', async () => {
    expect(await getAdvertisedContentNodes()).toEqual([
      'https://cn1.example.audius',
      'https://cn2.example.audius',
    ])
  })

  it('caches the node list rather than refetching it', async () => {
    let calls = 0
    server.use(
      http.get(`${AUDIUS_BASE}/health_check`, () => {
        calls += 1
        return HttpResponse.json({
          data: { network: { content_nodes: [{ endpoint: 'https://cn9.example.audius' }] } },
        })
      }),
    )
    await getAdvertisedContentNodes()
    await getAdvertisedContentNodes()
    expect(calls).toBe(1)
  })

  it('leaves a healthy URL untouched', async () => {
    expect(await resolveHealthyStreamUrl(BAD)).toBe(BAD)
    expect(isOriginKnownBad(BAD)).toBe(false)
  })

  it('replays the identical signed path against a healthy node once a host fails', async () => {
    reportFailedStreamOrigin(BAD)
    expect(isOriginKnownBad(BAD)).toBe(true)

    const rescued = await resolveHealthyStreamUrl(BAD)
    expect(rescued).toBe(`https://cn1.example.audius${SIGNED_PATH}`)
    // The signature travels with the path, so it must survive verbatim.
    expect(new URL(rescued).pathname + new URL(rescued).search).toBe(SIGNED_PATH)
  })

  it('never returns a node that has also failed', async () => {
    reportFailedStreamOrigin(BAD)
    reportFailedStreamOrigin('https://cn1.example.audius/anything')
    expect(await resolveHealthyStreamUrl(BAD)).toBe(BAD)
  })

  it('degrades to the original URL when the health check is unavailable', async () => {
    server.use(
      http.get(`${AUDIUS_BASE}/health_check`, () => HttpResponse.json({ error: 'down' }, { status: 503 })),
    )
    reportFailedStreamOrigin(BAD)
    expect(await resolveHealthyStreamUrl(BAD)).toBe(BAD)
  })

  it('ignores malformed input instead of throwing', async () => {
    expect(() => reportFailedStreamOrigin('not a url')).not.toThrow()
    expect(isOriginKnownBad('not a url')).toBe(false)
    expect(await resolveHealthyStreamUrl('not a url')).toBe('not a url')
  })

  it('rejects non-https endpoints from the health check', async () => {
    server.use(
      http.get(`${AUDIUS_BASE}/health_check`, () =>
        HttpResponse.json({
          data: {
            network: {
              content_nodes: [
                { endpoint: 'http://insecure.example' },
                { endpoint: 42 },
                { endpoint: 'https://good.example/' },
              ],
            },
          },
        }),
      ),
    )
    expect(await getAdvertisedContentNodes()).toEqual(['https://good.example'])
  })
})
