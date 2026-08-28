import { beforeEach, describe, expect, it } from 'vitest'
import { server } from '@/test/msw/server'
import { AUDIUS_BASE, errorHandlers } from '@/test/msw/handlers'
import { http, HttpResponse } from 'msw'
import { setAudiusSdk } from './client'
import { createAudiusProvider, normalizeQuery, toProviderId } from './adapter'
import type { MusicProvider } from '../provider'
import { MusicError } from '../types'
import type { Track } from '../types'
import { STREAM_URL } from '@/test/fixtures/audius'

let provider: MusicProvider

beforeEach(() => {
  setAudiusSdk(null)
  provider = createAudiusProvider()
})

const track = (overrides: Partial<Track> = {}): Track => ({
  id: 'audius:trk1',
  mediaKind: 'audio',
  provider: 'audius',
  providerId: 'trk1',
  title: 'Midnight Signal',
  artistName: 'Nova Sound',
  artwork: {},
  durationSeconds: 214,
  isStreamable: true,
  ...overrides,
})

describe('normalizeQuery', () => {
  it('trims, collapses whitespace and length-limits', () => {
    expect(normalizeQuery('   drake   ')).toBe('drake')
    expect(normalizeQuery('deep    house')).toBe('deep house')
    expect(normalizeQuery('\n\t ')).toBe('')
    expect(normalizeQuery('x'.repeat(400))).toHaveLength(120)
  })
})

describe('toProviderId', () => {
  it('accepts both the domain id and a bare provider id', () => {
    expect(toProviderId('audius:abc')).toBe('abc')
    expect(toProviderId('abc')).toBe('abc')
    expect(toProviderId('  ')).toBe('')
  })
})

describe('searchTracks', () => {
  it('returns normalized domain tracks from a real SDK round-trip', async () => {
    const tracks = await provider.searchTracks('midnight')
    expect(tracks.length).toBeGreaterThan(0)
    expect(tracks[0]).toMatchObject({
      provider: 'audius',
      id: expect.stringMatching(/^audius:/),
    })
    // No raw provider field leaks into the domain model.
    expect(tracks[0]).not.toHaveProperty('track_cid')
    expect(tracks[0]).not.toHaveProperty('user')
  })

  it('never fires a request for a blank query', async () => {
    let called = false
    server.use(
      http.get(`${AUDIUS_BASE}/v1/tracks/search`, () => {
        called = true
        return HttpResponse.json({ data: [] })
      }),
    )
    expect(await provider.searchTracks('   ')).toEqual([])
    expect(called).toBe(false)
  })

  it('returns an empty list rather than throwing when there are no matches', async () => {
    expect(await provider.searchTracks('nothing at all')).toEqual([])
  })

  it('maps a 429 to RATE_LIMIT', async () => {
    server.use(errorHandlers.rateLimited)
    await expect(provider.searchTracks('drake')).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      userMessage: expect.stringContaining('Too many requests') as unknown as string,
    })
  })

  it('maps a 500 to PROVIDER', async () => {
    server.use(errorHandlers.serverError)
    await expect(provider.searchTracks('drake')).rejects.toMatchObject({ code: 'PROVIDER' })
  })

  it('maps a transport failure to NETWORK', async () => {
    server.use(errorHandlers.networkError)
    await expect(provider.searchTracks('drake')).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('maps an aborted request to ABORTED', async () => {
    const controller = new AbortController()
    const pending = provider.searchTracks('drake', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('never leaks an SDK object through the error', async () => {
    server.use(errorHandlers.serverError)
    const error = await provider.searchTracks('drake').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MusicError)
    expect((error as MusicError).userMessage).not.toContain('api_key')
    expect((error as MusicError).userMessage).not.toContain('http')
  })
})

describe('discovery operations', () => {
  it('getTrendingTracks normalizes the shelf', async () => {
    const tracks = await provider.getTrendingTracks({ limit: 4 })
    expect(tracks.length).toBeGreaterThan(0)
    expect(tracks.every((t) => t.id.startsWith('audius:'))).toBe(true)
  })

  it('getTrendingTracks forwards genre and time as provider parameters', async () => {
    let seen: URLSearchParams | null = null
    server.use(
      http.get(`${AUDIUS_BASE}/v1/tracks/trending`, ({ request }) => {
        seen = new URL(request.url).searchParams
        return HttpResponse.json({ data: [] })
      }),
    )
    await provider.getTrendingTracks({ genre: 'Hip-Hop/Rap', time: 'month', limit: 7 })
    expect(seen!.get('genre')).toBe('Hip-Hop/Rap')
    expect(seen!.get('time')).toBe('month')
    expect(seen!.get('limit')).toBe('7')
  })

  it('getUndergroundTrendingTracks hits the underground route', async () => {
    const tracks = await provider.getUndergroundTrendingTracks({ limit: 2 })
    expect(tracks).toHaveLength(2)
  })

  it('getTopArtists filters out deactivated profiles', async () => {
    const artists = await provider.getTopArtists({ limit: 4 })
    expect(artists.map((a) => a.providerId)).toEqual(['usr1', 'usr2'])
  })

  it('getTrack returns null for an unknown id instead of throwing', async () => {
    expect(await provider.getTrack('audius:does-not-exist')).toBeNull()
    expect(await provider.getTrack('  ')).toBeNull()
  })

  it('getTrack resolves a known id', async () => {
    const found = await provider.getTrack('audius:trk1')
    expect(found?.title).toBe('Midnight Signal')
  })
})

describe('getStreamSource', () => {
  it('returns the provider-signed URL from the SDK stream helper', async () => {
    expect(await provider.getStreamSource(track())).toBe(STREAM_URL)
  })

  it('requests no_redirect so the SDK can return JSON rather than audio bytes', async () => {
    let seen: URLSearchParams | null = null
    server.use(
      http.get(`${AUDIUS_BASE}/v1/tracks/:trackId/stream`, ({ request }) => {
        seen = new URL(request.url).searchParams
        return HttpResponse.json({ data: STREAM_URL })
      }),
    )
    await provider.getStreamSource(track())
    expect(seen!.get('no_redirect')).toBe('true')
  })

  it('rejects a non-streamable track before touching the network', async () => {
    let called = false
    server.use(
      http.get(`${AUDIUS_BASE}/v1/tracks/:trackId/stream`, () => {
        called = true
        return HttpResponse.json({ data: STREAM_URL })
      }),
    )
    await expect(provider.getStreamSource(track({ isStreamable: false }))).rejects.toMatchObject({
      code: 'NOT_STREAMABLE',
    })
    expect(called).toBe(false)
  })

  it('maps a gated 403 to NOT_STREAMABLE', async () => {
    await expect(
      provider.getStreamSource(track({ id: 'audius:trk4', providerId: 'trk4' })),
    ).rejects.toMatchObject({ code: 'NOT_STREAMABLE' })
  })

  it('maps a 404 on the stream route to NOT_STREAMABLE', async () => {
    await expect(
      provider.getStreamSource(track({ id: 'audius:nope', providerId: 'nope' })),
    ).rejects.toMatchObject({ code: 'NOT_STREAMABLE' })
  })

  it('treats an empty stream URL as not streamable', async () => {
    server.use(
      http.get(`${AUDIUS_BASE}/v1/tracks/:trackId/stream`, () => HttpResponse.json({ data: '  ' })),
    )
    await expect(provider.getStreamSource(track())).rejects.toMatchObject({
      code: 'NOT_STREAMABLE',
    })
  })

  it('never returns a URL served by this application', async () => {
    const url = await provider.getStreamSource(track())
    expect(url).not.toContain('localhost')
    expect(new URL(url).origin).not.toBe(window.location.origin)
  })
})
