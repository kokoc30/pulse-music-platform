import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JamendoSearchResult } from '@/music/jamendo/client'
import type { MusicProvider } from '@/music/provider'
import { resetMusicProvider, setMusicProvider } from '@/music/provider'
import { MusicError } from '@/music/types'
import type { Artist, CatalogSearchResult, Track } from '@/music/types'
import { multiProviderSearch } from './multi-provider-search'
import { MAX_JAMENDO_REQUESTS } from './provider-budget'

/* ------------------------------------------------------------------ doubles */

function audiusTrack(id: string, title: string, artistName: string, overrides: Partial<Track> = {}): Track {
  return {
    id: `audius:${id}`,
    mediaKind: 'audio',
    provider: 'audius',
    providerId: id,
    title,
    artistName,
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    ...overrides,
  }
}

function jamendoTrack(id: string, title: string, artistName: string, overrides: Partial<Track> = {}): Track {
  return {
    id: `jamendo:${id}`,
    mediaKind: 'audio',
    provider: 'jamendo',
    providerId: id,
    title,
    artistName,
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    attributionRequired: true,
    sourceUrl: `https://www.jamendo.com/track/${id}`,
    streamUrl: `https://prod-1.storage.jamendo.com/?trackid=${id}`,
    ...overrides,
  }
}

/** Audius double whose catalogue is a fixed list, matched by naive substring. */
function fakeAudius(tracks: Track[], artists: Artist[] = []): MusicProvider {
  return {
    id: 'audius',
    searchTracks: vi.fn(() => Promise.resolve(tracks)),
    searchCatalog: vi.fn(
      (): Promise<CatalogSearchResult> => Promise.resolve({ tracks, artists }),
    ),
    getArtistTracks: vi.fn(() => Promise.resolve([])),
    getTrendingTracks: vi.fn(() => Promise.resolve([])),
    getUndergroundTrendingTracks: vi.fn(() => Promise.resolve([])),
    getTopArtists: vi.fn(() => Promise.resolve([])),
    getTrack: vi.fn(() => Promise.resolve(null)),
    getStreamSource: vi.fn(() => Promise.resolve('https://cdn.audius.test/a.mp3')),
  }
}

function failingAudius(error: MusicError): MusicProvider {
  const provider = fakeAudius([])
  provider.searchCatalog = vi.fn(() => Promise.reject(error))
  return provider
}

const jamendoOk = (tracks: Track[]) =>
  vi.fn((): Promise<JamendoSearchResult> => Promise.resolve({ status: 'success', tracks }))
const jamendoDown = (status: 'unavailable' | 'error') =>
  vi.fn((): Promise<JamendoSearchResult> => Promise.resolve({ status, tracks: [] }))

afterEach(() => resetMusicProvider())

/* -------------------------------------------------------------- aggregation */

describe('multi-provider aggregation', () => {
  beforeEach(() => resetMusicProvider())

  it('returns Audius results when Jamendo has nothing', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Reverie', 'Lumen Field')]))
    const result = await multiProviderSearch('Reverie', { searchJamendo: jamendoOk([]) })

    expect(result.outcome).toBe('results')
    expect(result.tracks.map((track) => track.id)).toEqual(['audius:a1'])
    expect(result.providers).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: 'jamendo', status: 'success' })]),
    )
  })

  it('returns Jamendo results when Audius has nothing', async () => {
    setMusicProvider(fakeAudius([]))
    const result = await multiProviderSearch('Reverie', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Reverie', 'Lumen Field')]),
    })

    expect(result.outcome).toBe('results')
    expect(result.tracks.map((track) => track.id)).toEqual(['jamendo:j1'])
  })

  it('returns one merged list when both catalogues answer', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Reverie', 'Lumen Field')]))
    const result = await multiProviderSearch('Reverie', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Reverie Nights', 'Other Band')]),
    })

    expect(result.tracks).toHaveLength(2)
    // One list, ordered by relevance — not grouped by provider.
    expect(new Set(result.tracks.map((track) => track.provider))).toEqual(new Set(['audius', 'jamendo']))
  })

  it('cannot collide ids even when both providers use the same raw id', async () => {
    setMusicProvider(fakeAudius([audiusTrack('777', 'Reverie', 'Lumen Field')]))
    const result = await multiProviderSearch('Reverie', {
      searchJamendo: jamendoOk([jamendoTrack('777', 'Reverie Nights', 'Other Band')]),
    })

    const ids = result.tracks.map((track) => track.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('audius:777')
    expect(ids).toContain('jamendo:777')
  })
})

/* ---------------------------------------------------------- failure tolerance */

describe('provider failure tolerance', () => {
  beforeEach(() => resetMusicProvider())

  it('shows Audius results when Jamendo fails', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Reverie', 'Lumen Field')]))
    const result = await multiProviderSearch('Reverie', { searchJamendo: jamendoDown('error') })

    expect(result.outcome).toBe('results')
    expect(result.tracks.map((track) => track.id)).toEqual(['audius:a1'])
    expect(result.providers.find((entry) => entry.provider === 'jamendo')?.status).toBe('error')
  })

  it('shows Audius results when Jamendo is not configured at all', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Reverie', 'Lumen Field')]))
    const result = await multiProviderSearch('Reverie', { searchJamendo: jamendoDown('unavailable') })

    expect(result.outcome).toBe('results')
    expect(result.providers.find((entry) => entry.provider === 'jamendo')?.status).toBe('unavailable')
  })

  it('shows Jamendo results when Audius fails', async () => {
    setMusicProvider(failingAudius(new MusicError('PROVIDER', 'Audius is down.')))
    const result = await multiProviderSearch('Reverie', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Reverie', 'Lumen Field')]),
    })

    expect(result.outcome).toBe('results')
    expect(result.tracks.map((track) => track.id)).toEqual(['jamendo:j1'])
    expect(result.providers.find((entry) => entry.provider === 'audius')?.status).toBe('error')
  })

  it('raises the existing provider error only when both catalogues are down', async () => {
    setMusicProvider(failingAudius(new MusicError('RATE_LIMIT', 'Too many requests right now.')))
    await expect(
      multiProviderSearch('Reverie', { searchJamendo: jamendoDown('error') }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })

  it('raises rather than claiming "no results" when the survivor found nothing', async () => {
    // Audius is down and Jamendo answered with an empty catalogue. Reporting
    // "no matching music" would blame the query for an outage.
    setMusicProvider(failingAudius(new MusicError('PROVIDER', 'Audius is down.')))
    await expect(
      multiProviderSearch('Reverie', { searchJamendo: jamendoOk([]) }),
    ).rejects.toMatchObject({ code: 'PROVIDER' })
  })

  it('propagates a caller abort rather than swallowing it', async () => {
    setMusicProvider(failingAudius(new MusicError('ABORTED', 'Request cancelled.')))
    await expect(
      multiProviderSearch('Reverie', { searchJamendo: jamendoOk([]) }),
    ).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('propagates an abort raised by the Jamendo leg too', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Reverie', 'Lumen Field')]))
    await expect(
      multiProviderSearch('Reverie', {
        searchJamendo: vi.fn(() => Promise.reject(new MusicError('ABORTED', 'Request cancelled.'))),
      }),
    ).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('reports no-strong-match when both catalogues answered with only noise', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'djwashiwasha', 'Selawase')]))
    const result = await multiProviderSearch('sara al swas', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Paras Lowas GV RMX', 'Sagar Biswas')]),
    })

    expect(result.outcome).toBe('no-strong-match')
    expect(result.tracks).toEqual([])
  })

  it('reports empty when neither catalogue returned a single row', async () => {
    setMusicProvider(fakeAudius([]))
    const result = await multiProviderSearch('zzzzqqqq', { searchJamendo: jamendoOk([]) })
    expect(result.outcome).toBe('empty')
  })
})

/* ------------------------------------------------------------ request budget */

describe('request budget', () => {
  beforeEach(() => resetMusicProvider())

  it('spends exactly one Jamendo request when the first answer is strong', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Reverie', 'Lumen Field')]))
    const searchJamendo = jamendoOk([jamendoTrack('j1', 'Reverie', 'Lumen Field')])
    const result = await multiProviderSearch('Reverie', { searchJamendo })

    expect(searchJamendo).toHaveBeenCalledTimes(1)
    expect(result.diagnostics.jamendoRequests).toBe(1)
  })

  it('never exceeds the Jamendo ceiling, however many aliases exist', async () => {
    setMusicProvider(fakeAudius([]))
    // A curated alias query produces several Audius variants; Jamendo must not
    // inherit that fan-out (agents/15 → "Jamendo Alias Budget").
    const searchJamendo = jamendoOk([])
    await multiProviderSearch('kassandra', { searchJamendo })
    expect(searchJamendo.mock.calls.length).toBeLessThanOrEqual(MAX_JAMENDO_REQUESTS)
  })

  it('never retries Jamendo when Jamendo itself is down', async () => {
    setMusicProvider(fakeAudius([]))
    const searchJamendo = jamendoDown('error')
    await multiProviderSearch('kassandra', { searchJamendo })
    expect(searchJamendo).toHaveBeenCalledTimes(1)
  })

  it('leaves the Audius request ceiling exactly where Phase 1 set it', async () => {
    const provider = fakeAudius([])
    setMusicProvider(provider)
    const result = await multiProviderSearch('kassandra', { searchJamendo: jamendoOk([]) })
    expect(result.diagnostics.audius?.providerRequests).toBeLessThanOrEqual(4)
  })
})

/* ----------------------------------------------------------- global ranking */

describe('global ranking across providers', () => {
  beforeEach(() => resetMusicProvider())

  it('puts an exact Jamendo match above an unrelated Audius result', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Something Else Entirely', 'Another Act', { playCount: 5_000_000 })]))
    const result = await multiProviderSearch('Reverie', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Reverie', 'Lumen Field')]),
    })

    expect(result.tracks[0]?.id).toBe('jamendo:j1')
  })

  it('puts an exact Audius match above an unrelated Jamendo result', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Reverie', 'Lumen Field')]))
    const result = await multiProviderSearch('Reverie', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Something Else Entirely', 'Another Act')]),
    })

    expect(result.tracks[0]?.id).toBe('audius:a1')
  })

  it('does not let Audius play counts outrank a better textual match', async () => {
    setMusicProvider(
      fakeAudius([audiusTrack('a1', 'Reverie Remix Extended Club Tool', 'DJ Someone', { playCount: 90_000_000 })]),
    )
    const result = await multiProviderSearch('Reverie', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Reverie', 'Lumen Field')]),
    })

    expect(result.tracks[0]?.id).toBe('jamendo:j1')
  })

  it('does not hand every exact tie to the catalogue that reports play counts', async () => {
    // Audius rows always carry a play count and Jamendo rows never do. Without
    // an explicit rule, the popularity tie-breaker would silently resolve every
    // exact tie in Audius' favour — a provider bias, not a relevance judgement.
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Reverie Nights', 'Other Act', { playCount: 90_000_000 })]))
    const result = await multiProviderSearch('Reverie', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Reverie', 'Lumen Field')]),
    })
    expect(result.tracks[0]?.id).toBe('jamendo:j1')
  })

  it('lets an exact artist match from either provider beat a loose title match', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Lumen Fields Forever', 'Someone Else')]))
    const result = await multiProviderSearch('Lumen Field', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Reverie', 'Lumen Field')]),
    })
    expect(result.tracks[0]?.id).toBe('jamendo:j1')
  })

  it('keeps the international behaviour Phase 1 fixed', async () => {
    // Cyrillic must survive to the provider and still match a Cyrillic title.
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Кассандра', 'Мияги')]))
    const result = await multiProviderSearch('Кассандра', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Unrelated Latin Title', 'Nobody')]),
    })
    expect(result.tracks[0]?.id).toBe('audius:a1')
  })

  it('rejects a coincidental substring match from either provider', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'djwashiwasha', 'Selawase')]))
    const result = await multiProviderSearch('sara al swas', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'jesuswasarapper', 'Paras')]),
    })
    expect(result.tracks).toEqual([])
  })

  it('is deterministic when two providers tie exactly', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Reverie', 'Lumen Field', { durationSeconds: 100 })]))
    const runOnce = () =>
      multiProviderSearch('Reverie', {
        searchJamendo: jamendoOk([jamendoTrack('j1', 'Reverie', 'Lumen Field', { durationSeconds: 400 })]),
      })
    const first = await runOnce()
    const second = await runOnce()
    expect(first.tracks.map((track) => track.id)).toEqual(second.tracks.map((track) => track.id))
  })

  it('collapses the same recording found on both catalogues into one row', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Reverie', 'Lumen Field', { durationSeconds: 214 })]))
    const result = await multiProviderSearch('Reverie', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Reverie', 'Lumen Field', { durationSeconds: 215 })]),
    })

    expect(result.tracks).toHaveLength(1)
    expect(result.diagnostics.mergedDuplicates).toBe(1)
  })

  it('honours the caller limit across the merged list', async () => {
    setMusicProvider(
      fakeAudius(Array.from({ length: 10 }, (_, i) => audiusTrack(`a${i}`, `Reverie ${i}`, 'Lumen Field'))),
    )
    const result = await multiProviderSearch('Reverie', {
      limit: 5,
      searchJamendo: jamendoOk(
        Array.from({ length: 10 }, (_, i) => jamendoTrack(`j${i}`, `Reverie ${i} Alt`, 'Other Band')),
      ),
    })
    expect(result.tracks.length).toBeLessThanOrEqual(5)
  })

  it('returns nothing for a blank query without calling either provider', async () => {
    const provider = fakeAudius([])
    setMusicProvider(provider)
    const searchJamendo = jamendoOk([])
    const result = await multiProviderSearch('   ', { searchJamendo })

    expect(result.outcome).toBe('empty')
    expect(searchJamendo).not.toHaveBeenCalled()
    expect(provider.searchCatalog).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------- open-catalog confidence */

describe('hasStrongOpenCatalogMatch', () => {
  beforeEach(() => resetMusicProvider())

  /** The three rows the live Jamendo catalogue really returned for this query. */
  const ARAM_NOISE = [
    jamendoTrack('j1', "Eternos Rivales - Fil d'aram", 'Eternos Rivales'),
    jamendoTrack('j2', '01. Météo sombre (prod. Aram)', 'L.IAM'),
    jamendoTrack('j3', 'Orom Aram', 'Joël Vanoli'),
  ]

  it('is false when every row shares only one generic token with the query', async () => {
    setMusicProvider(fakeAudius([]))
    const result = await multiProviderSearch('aram asatryan', {
      searchJamendo: jamendoOk(ARAM_NOISE),
    })

    expect(result.hasStrongOpenCatalogMatch).toBe(false)
    // No Top Result can be built from an empty list, which is the point.
    expect(result.tracks).toEqual([])
    // And the distinction survives: the catalogues *answered*, they just had
    // nothing good — a different, truthful story from "returned nothing".
    expect(result.outcome).toBe('no-strong-match')
  })

  it('is true as soon as one genuine match is present among the noise', async () => {
    setMusicProvider(fakeAudius([]))
    const result = await multiProviderSearch('aram asatryan', {
      searchJamendo: jamendoOk([...ARAM_NOISE, jamendoTrack('j4', 'Barov Ari', 'Aram Asatryan')]),
    })

    expect(result.hasStrongOpenCatalogMatch).toBe(true)
    // The genuine row is the only one shown, and it leads.
    expect(result.tracks.map((track) => track.id)).toEqual(['jamendo:j4'])
  })

  it('gates both catalogues by the same rule', async () => {
    // The same coincidence arriving from Audius is rejected identically.
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Orom Aram', 'Joël Vanoli')]))
    const result = await multiProviderSearch('aram asatryan', { searchJamendo: jamendoOk([]) })

    expect(result.hasStrongOpenCatalogMatch).toBe(false)
    expect(result.tracks).toEqual([])
  })

  it('reports the catalogues as reachable even when nothing was strong', async () => {
    setMusicProvider(fakeAudius([]))
    const result = await multiProviderSearch('aram asatryan', {
      searchJamendo: jamendoOk(ARAM_NOISE),
    })

    // "Nothing good" is not "provider down": a genuine outage must stay
    // distinguishable in diagnostics.
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'jamendo', status: 'success' }),
        expect.objectContaining({ provider: 'audius', status: 'success' }),
      ]),
    )
  })

  it('is true for an ordinary single-token query', async () => {
    setMusicProvider(fakeAudius([audiusTrack('a1', 'Bangarang', 'Skrillex')]))
    const result = await multiProviderSearch('skrillex', { searchJamendo: jamendoOk([]) })

    expect(result.hasStrongOpenCatalogMatch).toBe(true)
    expect(result.tracks.map((track) => track.id)).toEqual(['audius:a1'])
  })

  it('is false when neither catalogue returned anything at all', async () => {
    setMusicProvider(fakeAudius([]))
    const result = await multiProviderSearch('aram asatryan', { searchJamendo: jamendoOk([]) })

    expect(result.hasStrongOpenCatalogMatch).toBe(false)
    expect(result.outcome).toBe('empty')
  })

  it('keeps a cross-field match strong', async () => {
    setMusicProvider(fakeAudius([]))
    const result = await multiProviderSearch('barov ari aram asatryan', {
      searchJamendo: jamendoOk([jamendoTrack('j1', 'Barov Ari', 'Aram Asatryan')]),
    })

    expect(result.hasStrongOpenCatalogMatch).toBe(true)
    expect(result.tracks).toHaveLength(1)
  })
})
