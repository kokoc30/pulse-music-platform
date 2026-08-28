import { beforeAll, describe, expect, it } from 'vitest'
import { sdk } from '@audius/sdk'
import { createAudiusProvider } from '@/music/audius/adapter'
import { AUDIUS_GENRES } from '@/music/audius/genres'
import type { MusicProvider } from '@/music/provider'

/**
 * Optional real-provider smoke check (agents/09_TESTING_QA.md → "Rule 10").
 *
 * It is NOT part of `pnpm test:run`. Run it deliberately:
 *
 *   AUDIUS_SMOKE=1 pnpm test:smoke
 *
 * It uses `AUDIUS_API_KEY` when one is present and otherwise Audius' supported
 * read-only `appName` mode. It talks to the live network, so it is allowed to be
 * slower and is retried once.
 */
const ENABLED = process.env.AUDIUS_SMOKE === '1'
const describeSmoke = ENABLED ? describe : describe.skip

describeSmoke('Audius real-provider smoke', () => {
  let provider: MusicProvider

  beforeAll(() => {
    const apiKey = process.env.AUDIUS_API_KEY?.trim()
    const appName = process.env.AUDIUS_APP_NAME?.trim() || 'Pulse Music Platform Smoke'
    const instance = apiKey ? sdk({ apiKey, appName }) : sdk({ appName })
    provider = createAudiusProvider(() => Promise.resolve(instance))
  })

  it('returns real trending tracks', async () => {
    const tracks = await provider.getTrendingTracks({ limit: 5 })
    expect(tracks.length).toBeGreaterThan(0)
    for (const track of tracks) {
      expect(track.id.startsWith('audius:')).toBe(true)
      expect(track.title.length).toBeGreaterThan(0)
      expect(track.artistName.length).toBeGreaterThan(0)
      expect(track.durationSeconds).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns real search results', async () => {
    const tracks = await provider.searchTracks('lofi', { limit: 5 })
    expect(tracks.length).toBeGreaterThan(0)
  })

  it('returns real top artists', async () => {
    const artists = await provider.getTopArtists({ limit: 4 })
    expect(artists.length).toBeGreaterThan(0)
    expect(artists[0]?.name.length).toBeGreaterThan(0)
  })

  it('accepts the canonical genre vocabulary', async () => {
    const tracks = await provider.getTrendingTracks({ limit: 3, genre: AUDIUS_GENRES.house })
    expect(tracks.length).toBeGreaterThan(0)
  })

  it('resolves a stream URL served by Audius, not by this app', async () => {
    const [track] = await provider.getTrendingTracks({ limit: 5 })
    expect(track).toBeDefined()

    const url = await provider.getStreamSource(track)
    const origin = new URL(url).origin
    expect(origin).toMatch(/^https:\/\//)
    expect(origin).not.toContain('localhost')
    expect(origin).not.toContain('vercel.app')
  })

  it('serves real audio bytes over a range request from that URL', async () => {
    const [track] = await provider.getTrendingTracks({ limit: 5 })
    const url = await provider.getStreamSource(track)

    const response = await fetch(url, { headers: { Range: 'bytes=0-2047' } })
    expect([200, 206]).toContain(response.status)

    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(response.headers.get('content-type') ?? '').toMatch(/audio|octet-stream/i)
  })
})
