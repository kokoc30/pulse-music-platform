import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MusicProvider } from '@/music/provider'
import { MusicError } from '@/music/types'
import type { Artist, CatalogSearchResult, Track } from '@/music/types'
import { MAX_PROVIDER_REQUESTS, smartSearchTracks } from './smart-search'
import { MIN_RELEVANCE } from './relevance'

let requestLog: string[] = []

const track = (id: string, title: string, artistName: string, extra: Partial<Track> = {}): Track => ({
  id: `audius:${id}`,
  mediaKind: 'audio',
  provider: 'audius',
  providerId: id,
  title,
  artistName,
  artwork: {},
  durationSeconds: 200,
  isStreamable: true,
  ...extra,
})

const artist = (id: string, name: string, trackCount = 5): Artist => ({
  id: `audius:${id}`,
  provider: 'audius',
  providerId: id,
  name,
  handle: name.toLowerCase().replace(/\s+/g, ''),
  artwork: {},
  isVerified: true,
  trackCount,
})

/** A provider whose catalogue is keyed by the exact query string. */
function makeProvider(
  catalogue: Record<string, CatalogSearchResult>,
  artistTracks: Record<string, Track[]> = {},
): MusicProvider {
  return {
    id: 'fake',
    searchTracks: vi.fn(() => Promise.resolve([])),
    searchCatalog: vi.fn((query: string) => {
      requestLog.push(`search:${query}`)
      return Promise.resolve(catalogue[query] ?? { tracks: [], artists: [] })
    }),
    getArtistTracks: vi.fn((artistId: string) => {
      requestLog.push(`artist:${artistId}`)
      return Promise.resolve(artistTracks[artistId] ?? [])
    }),
    getTrendingTracks: vi.fn(() => Promise.resolve([])),
    getUndergroundTrendingTracks: vi.fn(() => Promise.resolve([])),
    getTopArtists: vi.fn(() => Promise.resolve([])),
    getTrack: vi.fn(() => Promise.resolve(null)),
    getStreamSource: vi.fn(() => Promise.resolve('https://cdn.test/a.mp3')),
  }
}

beforeEach(() => {
  requestLog = []
})

describe('exact matches', () => {
  it('returns an exact title match as the top result', async () => {
    const provider = makeProvider({
      kosandra: {
        tracks: [
          track('noise', 'Indra Indra Madhuchandra Bgm', 'puspa'),
          track('hit', 'Kosandra', 'Miyagi & Andy Panda'),
        ],
        artists: [],
      },
    })
    const result = await smartSearchTracks('kosandra', { provider })
    expect(result.outcome).toBe('results')
    expect(result.tracks[0]?.title).toBe('Kosandra')
  })

  it('returns an artist-name match even when the title shares nothing', async () => {
    const provider = makeProvider({
      Skrillex: { tracks: [track('k', 'Kliptown Empyrean', 'Skrillex')], artists: [] },
    })
    const result = await smartSearchTracks('Skrillex', { provider })
    expect(result.tracks[0]?.title).toBe('Kliptown Empyrean')
  })
})

describe('artist-driven search', () => {
  it("pulls a strongly-matched artist's catalogue and marks the artist", async () => {
    const provider = makeProvider(
      {
        Skrillex: {
          tracks: [track('remix', 'SKRILLEX - XERECA NA VARA (bauti flip)', 'bauti')],
          artists: [artist('eAZl3', 'Skrillex', 1)],
        },
      },
      { 'audius:eAZl3': [track('own', 'Kliptown Empyrean', 'Skrillex', { playCount: 1_160_500 })] },
    )

    const result = await smartSearchTracks('Skrillex', { provider })

    expect(requestLog).toContain('artist:audius:eAZl3')
    expect(result.artist?.name).toBe('Skrillex')
    expect(result.tracks[0]?.title).toBe('Kliptown Empyrean')
  })

  it('ignores a coincidental artist match', async () => {
    const provider = makeProvider(
      {
        kosandra: {
          tracks: [track('hit', 'Kosandra', 'Miyagi')],
          // Real Audius result for this query — a substring, not a match.
          artists: [artist('x', 'salamandra')],
        },
      },
      { 'audius:x': [track('bad', 'Unrelated Song', 'salamandra')] },
    )

    const result = await smartSearchTracks('kosandra', { provider })

    expect(requestLog).not.toContain('artist:audius:x')
    expect(result.artist).toBeNull()
  })

  it('does not query an artist with no tracks', async () => {
    const provider = makeProvider({
      Skrillex: { tracks: [], artists: [artist('eAZl3', 'Skrillex', 0)] },
    })
    await smartSearchTracks('Skrillex', { provider })
    expect(requestLog.filter((entry) => entry.startsWith('artist:'))).toHaveLength(0)
  })

  it('survives a failing artist lookup', async () => {
    const provider = makeProvider({
      Skrillex: { tracks: [track('k', 'Kliptown Empyrean', 'Skrillex')], artists: [artist('e', 'Skrillex')] },
    })
    vi.mocked(provider.getArtistTracks).mockRejectedValueOnce(new MusicError('PROVIDER', 'boom'))
    const result = await smartSearchTracks('Skrillex', { provider })
    expect(result.outcome).toBe('results')
  })
})

describe('query expansion and merging', () => {
  it('finds a Cyrillic-titled release from a Latin transliteration', async () => {
    const provider = makeProvider({
      kassandra: { tracks: [track('c', 'Cassandra - Cinta Terbaik', 'gelpindoril')], artists: [] },
      kosandra: { tracks: [track('k', 'Kosandra', 'Miyagi & Andy Panda')], artists: [] },
      кассандра: { tracks: [], artists: [] },
    })

    const result = await smartSearchTracks('kassandra', { provider })

    expect(requestLog).toContain('search:kassandra')
    expect(requestLog).toContain('search:kosandra')
    expect(result.tracks[0]?.title).toBe('Kosandra')
  })

  it('finds a Latin-titled release from a Cyrillic query', async () => {
    const provider = makeProvider({
      кассандра: { tracks: [], artists: [] },
      kosandra: { tracks: [track('k', 'Kosandra', 'Miyagi & Andy Panda')], artists: [] },
    })
    const result = await smartSearchTracks('кассандра', { provider })
    expect(result.outcome).toBe('results')
    expect(result.tracks[0]?.title).toBe('Kosandra')
  })

  it('reaches an Arabic-script release from a Latin misspelling', async () => {
    const provider = makeProvider({
      'sara al swas': { tracks: [track('n', 'PARAS - LOWAS GV RMX', 'luis garcia vasquez')], artists: [] },
      'sara al sawas': { tracks: [], artists: [] },
      'سارة السواس': { tracks: [track('ar', 'سارة السواس - يا حبيبي', 'سارة السواس')], artists: [] },
    })

    const result = await smartSearchTracks('sara al swas', { provider })

    expect(requestLog).toContain('search:سارة السواس')
    expect(result.tracks[0]?.title).toBe('سارة السواس - يا حبيبي')
  })

  it('de-duplicates the same track returned by several variants', async () => {
    const shared = track('dup', 'Kosandra', 'Miyagi & Andy Panda')
    const provider = makeProvider({
      kassandra: { tracks: [shared], artists: [] },
      kosandra: { tracks: [{ ...shared }], artists: [] },
      кассандра: { tracks: [{ ...shared }], artists: [] },
    })

    const result = await smartSearchTracks('kassandra', { provider })

    expect(result.tracks.filter((entry) => entry.id === 'audius:dup')).toHaveLength(1)
    expect(new Set(result.tracks.map((entry) => entry.id)).size).toBe(result.tracks.length)
  })

  it('scores a track found by the first query against later variants too', async () => {
    // `Kosandra` arrives on the original query, where it looks mediocre; the
    // alias variant is what proves it is the right track.
    const provider = makeProvider({
      kassandra: { tracks: [track('k', 'Kosandra', 'Miyagi & Andy Panda')], artists: [] },
      kosandra: { tracks: [], artists: [] },
      кассандра: { tracks: [], artists: [] },
    })
    const result = await smartSearchTracks('kassandra', { provider })
    expect(result.diagnostics.scores[0]?.matchedQuery).toBe('kosandra')
  })
})

describe('relevance threshold', () => {
  /** Verbatim rows the live API returns for this query. */
  const noiseOnly = {
    'sara al swas': {
      tracks: [
        track('a', "Shit (Washiwasha 'SOY MODERNO...' 2021 Edit) - Marauda", 'djwashiwasha'),
        track('b', 'EMAS HANTARAN - ARIEF FT. YOLLANDA (LIVE) PENDOPO LAWAS', 'agon'),
        track('c', 'Radio Wasteland - Paranormal Oddities', 'Radio Wasteland'),
        track('d', 'PARAS - LOWAS GV RMX', 'luis garcia vasquez'),
        track('e', 'carwash (die by the sword) - bladee', 'parasite'),
      ],
      artists: [],
    },
    'sara al sawas': { tracks: [], artists: [] },
    'سارة السواس': { tracks: [], artists: [] },
  }

  it('reports no-strong-match instead of promoting unrelated results', async () => {
    const provider = makeProvider(noiseOnly)
    const result = await smartSearchTracks('sara al swas', { provider })

    expect(result.outcome).toBe('no-strong-match')
    expect(result.tracks).toEqual([])
    // The provider really did answer — that is what makes this state truthful.
    expect(result.diagnostics.candidates).toBeGreaterThan(0)
    expect(result.diagnostics.topScore).toBeLessThan(MIN_RELEVANCE)
  })

  it('reports empty when the provider returned nothing at all', async () => {
    const provider = makeProvider({})
    const result = await smartSearchTracks('nothing at all here', { provider })
    expect(result.outcome).toBe('empty')
    expect(result.diagnostics.candidates).toBe(0)
  })

  it('keeps a genuine match that arrives alongside the noise', async () => {
    const provider = makeProvider({
      ...noiseOnly,
      'sara al swas': {
        tracks: [
          ...noiseOnly['sara al swas'].tracks,
          track('real', 'Sara Al Sawas - Ya Habibi', 'Sara Al Sawas'),
        ],
        artists: [],
      },
    })

    const result = await smartSearchTracks('sara al swas', { provider })

    expect(result.outcome).toBe('results')
    expect(result.tracks).toHaveLength(1)
    expect(result.tracks[0]?.title).toBe('Sara Al Sawas - Ya Habibi')
  })

  it('never lets popularity carry an irrelevant track over the threshold', async () => {
    const provider = makeProvider({
      'sara al swas': {
        tracks: [track('pop', 'Completely Different Song', 'Nobody', { playCount: 900_000_000 })],
        artists: [],
      },
      'sara al sawas': { tracks: [], artists: [] },
      'سارة السواس': { tracks: [], artists: [] },
    })
    const result = await smartSearchTracks('sara al swas', { provider })
    expect(result.outcome).toBe('no-strong-match')
  })
})

describe('request discipline', () => {
  it('spends a single request when the first answer is already strong', async () => {
    const provider = makeProvider({
      'Kliptown Empyrean': { tracks: [track('k', 'Kliptown Empyrean', 'Skrillex')], artists: [] },
    })
    await smartSearchTracks('Kliptown Empyrean', { provider })
    expect(requestLog).toEqual(['search:Kliptown Empyrean'])
  })

  it('always searches a curated alias, even when the first answer looks exact', async () => {
    // "Kassandra" is a real, exactly-titled Audius track — and still not the
    // record a visitor typing "kassandra" is usually looking for. Both are exact
    // title matches, so they tie on text and popularity decides, exactly as it
    // does against the live catalogue.
    const provider = makeProvider({
      kassandra: { tracks: [track('decoy', 'Kassandra', 'Mert Canka', { playCount: 40 })], artists: [] },
      kosandra: {
        tracks: [track('real', 'Kosandra', 'Miyagi & Andy Panda', { playCount: 2_400_000 })],
        artists: [],
      },
      кассандра: { tracks: [], artists: [] },
    })

    const result = await smartSearchTracks('kassandra', { provider })

    expect(requestLog).toContain('search:kosandra')
    expect(result.tracks[0]?.title).toBe('Kosandra')
    // The exact-title match is still offered, just not promoted.
    expect(result.tracks.map((entry) => entry.title)).toContain('Kassandra')
  })

  it('only pays for variants when the first answer is weak', async () => {
    const provider = makeProvider({
      kassandra: { tracks: [track('n', 'Totally Unrelated', 'Nobody')], artists: [] },
      kosandra: { tracks: [], artists: [] },
      кассандра: { tracks: [], artists: [] },
    })
    await smartSearchTracks('kassandra', { provider })
    expect(requestLog.length).toBeGreaterThan(1)
  })

  it('never exceeds the request ceiling', async () => {
    const provider = makeProvider({
      'sara al swas': { tracks: [track('n', 'Nope', 'Nobody')], artists: [artist('a', 'Sara Al Swas')] },
    })
    const result = await smartSearchTracks('sara al swas', { provider })
    expect(requestLog.length).toBeLessThanOrEqual(MAX_PROVIDER_REQUESTS)
    expect(result.diagnostics.providerRequests).toBeLessThanOrEqual(MAX_PROVIDER_REQUESTS)
  })

  it('makes no request at all for a blank query', async () => {
    const provider = makeProvider({})
    const result = await smartSearchTracks('   ', { provider })
    expect(requestLog).toEqual([])
    expect(result.outcome).toBe('empty')
  })

  it('sends the original Unicode query to the provider, never a folded form', async () => {
    const provider = makeProvider({ 'سارة السواس': { tracks: [], artists: [] } })
    await smartSearchTracks('سارة السواس', { provider })
    expect(requestLog[0]).toBe('search:سارة السواس')
  })
})

describe('cancellation', () => {
  it('propagates an abort rather than resolving with partial results', async () => {
    const provider = makeProvider({})
    vi.mocked(provider.searchCatalog).mockRejectedValueOnce(new MusicError('ABORTED', 'cancelled'))
    await expect(smartSearchTracks('anything', { provider })).rejects.toMatchObject({
      code: 'ABORTED',
    })
  })

  it('forwards the abort signal to the provider', async () => {
    const provider = makeProvider({ kosandra: { tracks: [], artists: [] } })
    const controller = new AbortController()
    await smartSearchTracks('kosandra', { provider, signal: controller.signal })
    expect(vi.mocked(provider.searchCatalog).mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    })
  })

  it('a slow earlier search cannot overwrite a newer one', async () => {
    // Ordering is enforced by the caller, so prove the two runs stay independent.
    const slow = makeProvider({ dr: { tracks: [track('slow', 'Dr Result', 'Someone')], artists: [] } })
    vi.mocked(slow.searchCatalog).mockImplementationOnce(
      async () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ tracks: [track('slow', 'Dr Result', 'Dr')], artists: [] }), 40),
        ),
    )
    const fast = makeProvider({ drake: { tracks: [track('fast', 'Drake Song', 'Drake')], artists: [] } })

    const slowRun = smartSearchTracks('dr', { provider: slow })
    const fastRun = await smartSearchTracks('drake', { provider: fast })
    const slowResult = await slowRun

    expect(fastRun.tracks[0]?.id).toBe('audius:fast')
    expect(slowResult.tracks[0]?.id).not.toBe('audius:fast')
  })
})
