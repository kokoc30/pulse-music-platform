import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@/music/types'
import { resetPersonalizationForTests } from '@/personalization'
import { clearPlayedSession } from '../related-fetcher'
import { bufferedCandidates, clearAutoplayBuffer, refillBuffer, takeFromBuffer } from './buffer'
import { MAX_REQUESTS_PER_REFILL } from './candidates'
import { clearSessionPool, rememberTracks } from './session-pool'

/**
 * What one refill is allowed to cost.
 *
 * The ceiling is **two provider requests per refill, per seed**, and it was one
 * until the "playback never stops" rule arrived. That rule changed what the
 * budget is protecting: a refill that spends nothing and returns nothing used to
 * be a clean ending, and is now the reported bug. So a second request exists,
 * and it is spent only when the alternative is silence.
 *
 * The three passes, and who may use each:
 *
 * · **Free.** Jamendo has a real `/tracks/similar`, so it spends that; Audius,
 *   which has no such endpoint, is answered from the session pool.
 * · **One tag/language search** — `russian pop`, built from the seed's own
 *   metadata. Either provider may spend it, and only when what is already in
 *   hand cannot keep `MIN_QUEUE_DEPTH` items ahead of the listener.
 * · **One genre-scoped list**, still **Audius only**. The case this file has
 *   always existed to prevent is unchanged: a Jamendo seed whose similarity came
 *   back empty must not fall through to a generic popularity list, because that
 *   substitutes a weaker signal for a provider judgement that already arrived.
 *   A targeted tag search is not that; a trending-by-genre list is.
 */

/**
 * Names that are unmistakably different songs by different acts.
 *
 * `Song 1` and `Song 2` would not do: they differ by a single character, so the
 * same-song rule correctly reads them as one recording and removes the candidate
 * before this file's assertions can see it. That rule is tested in
 * `reupload-supply.test.ts`; here it must simply stay out of the way.
 */
const DISTINCT_TITLES = [
  'Harbour Lights',
  'Ferrous Sky',
  'Winter Tessellate',
  'Ольга',
  'Kite String',
]
const DISTINCT_ARTISTS = ['Rell Vance', 'Otavo', 'The Quiet Mile', 'Мираж', 'Bramblewick']

let counter = 0

function audiusTrack(overrides: Partial<Track> = {}): Track {
  counter += 1
  return {
    id: `audius:a${counter}`,
    mediaKind: 'audio',
    provider: 'audius',
    providerId: `a${counter}`,
    title: DISTINCT_TITLES[counter % DISTINCT_TITLES.length],
    artistName: DISTINCT_ARTISTS[counter % DISTINCT_ARTISTS.length],
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    genre: 'Hip-Hop/Rap',
    ...overrides,
  }
}

function jamendoTrack(overrides: Partial<Track> = {}): Track {
  counter += 1
  return {
    id: `jamendo:j${counter}`,
    mediaKind: 'audio',
    provider: 'jamendo',
    providerId: `j${counter}`,
    title: DISTINCT_TITLES[counter % DISTINCT_TITLES.length],
    artistName: DISTINCT_ARTISTS[counter % DISTINCT_ARTISTS.length],
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    genre: 'Electronic',
    streamUrl: 'https://prod.jamendo.test/stream.mp3',
    ...overrides,
  }
}

/** A tag/language search that finds nothing, so a test can reach past it. */
function noRelated() {
  return vi.fn(() => Promise.resolve([]))
}

beforeEach(() => {
  counter = 0
  resetPersonalizationForTests()
  clearSessionPool()
  clearAutoplayBuffer()
  clearPlayedSession()
})

describe('the ceiling', () => {
  it('is two provider requests per refill', () => {
    expect(MAX_REQUESTS_PER_REFILL).toBe(2)
  })
})

describe('an Audius seed', () => {
  it('spends nothing at all while the session pool can keep three ahead', async () => {
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const fetchRelatedTracks = noRelated()
    const seed = audiusTrack()
    rememberTracks([seed, audiusTrack(), audiusTrack(), audiusTrack(), audiusTrack()])

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { fetchByGenre, fetchRelatedTracks },
    })

    expect(fetchRelatedTracks).not.toHaveBeenCalled()
    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(takeFromBuffer()).not.toBeNull()
  })

  /**
   * The pass that did not exist, and whose absence was the reported bug.
   *
   * One track in memory is not a continuation — it is one more track and then
   * silence. The threshold is `MIN_QUEUE_DEPTH`, not zero, precisely so the
   * search happens over music that is still playing.
   */
  it('spends one tag search when the pool cannot keep three ahead', async () => {
    const found = audiusTrack({ id: 'audius:related', providerId: 'related' })
    const fetchRelatedTracks = vi.fn(() => Promise.resolve([found]))
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const seed = audiusTrack()
    rememberTracks([seed])

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { fetchByGenre, fetchRelatedTracks },
    })

    expect(fetchRelatedTracks).toHaveBeenCalledTimes(1)
    // The buffer is answerable now, so the weaker signal is never reached.
    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(takeFromBuffer()?.id).toBe('audius:related')
  })

  it('describes the seed by its tags and language, never by its title', async () => {
    const fetchRelatedTracks = noRelated()
    const seed = audiusTrack({ title: 'Косандра', genre: 'Pop', tags: ['pop', 'vocal'] })
    rememberTracks([seed])

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { fetchRelatedTracks },
    })

    const [described] = fetchRelatedTracks.mock.calls[0] as unknown as [
      { title: string; language?: string; tags?: string[] },
    ]
    expect(described.language).toBe('ru')
    expect(described.tags).toEqual(['pop', 'vocal'])
  })

  it('spends exactly one genre request when the tag search came back empty too', async () => {
    const replacement = audiusTrack({ id: 'audius:fresh', providerId: 'fresh' })
    const fetchByGenre = vi.fn(() => Promise.resolve([replacement]))
    const fetchRelatedTracks = noRelated()
    const seed = audiusTrack()
    // Only the seed itself is in memory, so the planner has nothing to offer.
    rememberTracks([seed])

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { fetchByGenre, fetchRelatedTracks },
    })

    expect(fetchRelatedTracks).toHaveBeenCalledTimes(1)
    expect(fetchByGenre).toHaveBeenCalledTimes(1)
    expect(fetchByGenre).toHaveBeenCalledWith('Hip-Hop/Rap', undefined)
    expect(takeFromBuffer()?.id).toBe('audius:fresh')
  })

  it('spends no genre request when it carries no genre to scope one by', async () => {
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const fetchRelatedTracks = noRelated()
    const seed = audiusTrack({ genre: undefined })
    rememberTracks([seed])

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { fetchByGenre, fetchRelatedTracks },
    })

    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(takeFromBuffer()).toBeNull()
  })

  it('stops cleanly rather than retrying when both requests answer nothing', async () => {
    const fetchByGenre = vi.fn((): Promise<Track[]> => Promise.resolve([]))
    const fetchRelatedTracks = noRelated()
    const seed = audiusTrack()
    rememberTracks([seed])

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { fetchByGenre, fetchRelatedTracks },
    })

    expect(fetchRelatedTracks).toHaveBeenCalledTimes(1)
    expect(fetchByGenre).toHaveBeenCalledTimes(1)
    expect(takeFromBuffer()).toBeNull()
  })
})

describe('a Jamendo seed', () => {
  it('spends its similarity request first, and never a genre request', async () => {
    const similar = jamendoTrack({ id: 'jamendo:similar', providerId: 'similar' })
    const fetchSimilar = vi.fn(() =>
      Promise.resolve({ tracks: [similar], requests: 1, status: 'success' as const }),
    )
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const fetchRelatedTracks = noRelated()
    const seed = jamendoTrack()

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { session: [], fetchSimilar, fetchByGenre, fetchRelatedTracks },
    })

    expect(fetchSimilar).toHaveBeenCalledTimes(1)
    expect(fetchByGenre).not.toHaveBeenCalled()
    // Provider similarity leads the buffer; the search only tops it up.
    expect(takeFromBuffer()?.id).toBe('jamendo:similar')
  })

  it('leaves the search unspent when similarity already keeps three ahead', async () => {
    const tracks = [
      jamendoTrack({ id: 'jamendo:s1', providerId: 's1' }),
      jamendoTrack({ id: 'jamendo:s2', providerId: 's2' }),
      jamendoTrack({ id: 'jamendo:s3', providerId: 's3' }),
    ]
    const fetchSimilar = vi.fn(() =>
      Promise.resolve({ tracks, requests: 1, status: 'success' as const }),
    )
    const fetchRelatedTracks = noRelated()
    const seed = jamendoTrack()

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { session: [], fetchSimilar, fetchRelatedTracks },
    })

    expect(fetchRelatedTracks).not.toHaveBeenCalled()
  })

  /**
   * This assertion used to be the opposite, and the reversal is the point.
   *
   * Jamendo answering "nothing is like this track" is still a provider
   * judgement, and it is still not overridden by a generic same-genre list. What
   * changed is that it is no longer allowed to end the music: a targeted search
   * for the seed's own tags and language is a different question, not a weaker
   * answer to the one Jamendo already gave.
   */
  it('follows an empty similarity answer with the tag search, never a genre list', async () => {
    const found = jamendoTrack({ id: 'jamendo:related', providerId: 'related' })
    const fetchSimilar = vi.fn(() =>
      Promise.resolve({ tracks: [], requests: 1, status: 'success' as const }),
    )
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const fetchRelatedTracks = vi.fn(() => Promise.resolve([found]))
    const seed = jamendoTrack()

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { session: [], fetchSimilar, fetchByGenre, fetchRelatedTracks },
    })

    expect(fetchSimilar).toHaveBeenCalledTimes(1)
    expect(fetchRelatedTracks).toHaveBeenCalledTimes(1)
    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(takeFromBuffer()?.id).toBe('jamendo:related')
  })

  it('still searches when the similarity lookup fails outright', async () => {
    const found = jamendoTrack({ id: 'jamendo:related', providerId: 'related' })
    const fetchSimilar = vi.fn(() => Promise.reject(new Error('jamendo down')))
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const fetchRelatedTracks = vi.fn(() => Promise.resolve([found]))
    const seed = jamendoTrack()

    await expect(
      refillBuffer({
        seed,
        queuedIds: [seed.id],
        recentIds: [],
        sources: { session: [], fetchSimilar, fetchByGenre, fetchRelatedTracks },
      }),
    ).resolves.toBeUndefined()

    expect(fetchSimilar).toHaveBeenCalledTimes(1)
    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(takeFromBuffer()?.id).toBe('jamendo:related')
  })

  it('is not rescued by a genre request even when everything else came back empty', async () => {
    const fetchSimilar = vi.fn(() =>
      Promise.resolve({ tracks: [], requests: 1, status: 'success' as const }),
    )
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const fetchRelatedTracks = noRelated()
    const seed = jamendoTrack()
    // Nothing anywhere: the strongest possible temptation to spend a third call.
    rememberTracks([seed])

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { fetchSimilar, fetchByGenre, fetchRelatedTracks },
    })

    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(bufferedCandidates()).toHaveLength(0)
  })
})
