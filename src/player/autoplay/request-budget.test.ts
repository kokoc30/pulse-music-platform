import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@/music/types'
import { resetPersonalizationForTests } from '@/personalization'
import { bufferedCandidates, clearAutoplayBuffer, refillBuffer, takeFromBuffer } from './buffer'
import { MAX_REQUESTS_PER_REFILL } from './candidates'
import { clearSessionPool, rememberTracks } from './session-pool'

/**
 * What one refill is allowed to cost.
 *
 * The ceiling is **one provider request per refill, per seed**, and the two
 * providers reach it by different routes because they offer different things:
 *
 * · Jamendo has a real `/tracks/similar`, so it spends its one request there and
 *   takes the answer — including an empty one.
 * · Audius has no such endpoint, so it is answered for free from the session
 *   pool, and only an exhausted pool may spend the one request on a genre-scoped
 *   list.
 *
 * The case this file exists to prevent is the tempting one: letting a Jamendo
 * seed whose similarity came back empty fall through to the Audius-style genre
 * list. That would substitute a weaker signal for a provider judgement that had
 * already arrived, and would quietly make a Jamendo refill cost two.
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

beforeEach(() => {
  counter = 0
  resetPersonalizationForTests()
  clearSessionPool()
  clearAutoplayBuffer()
})

describe('the ceiling', () => {
  it('is one provider request per refill', () => {
    expect(MAX_REQUESTS_PER_REFILL).toBe(1)
  })
})

describe('an Audius seed', () => {
  it('spends nothing while the session pool can answer', async () => {
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const seed = audiusTrack()
    rememberTracks([seed, audiusTrack()])

    await refillBuffer({ seed, queuedIds: [seed.id], recentIds: [], sources: { fetchByGenre } })

    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(takeFromBuffer()).not.toBeNull()
  })

  it('spends exactly one genre request when the pool is exhausted', async () => {
    const replacement = audiusTrack({ id: 'audius:fresh', providerId: 'fresh' })
    const fetchByGenre = vi.fn(() => Promise.resolve([replacement]))
    const seed = audiusTrack()
    // Only the seed itself is in memory, so the planner has nothing to offer.
    rememberTracks([seed])

    await refillBuffer({ seed, queuedIds: [seed.id], recentIds: [], sources: { fetchByGenre } })

    expect(fetchByGenre).toHaveBeenCalledTimes(1)
    expect(fetchByGenre).toHaveBeenCalledWith('Hip-Hop/Rap', undefined)
    expect(takeFromBuffer()?.id).toBe('audius:fresh')
  })

  it('spends nothing when it carries no genre to scope the request by', async () => {
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const seed = audiusTrack({ genre: undefined })
    rememberTracks([seed])

    await refillBuffer({ seed, queuedIds: [seed.id], recentIds: [], sources: { fetchByGenre } })

    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(takeFromBuffer()).toBeNull()
  })

  it('stops cleanly rather than retrying when the one request answers nothing', async () => {
    const fetchByGenre = vi.fn((): Promise<Track[]> => Promise.resolve([]))
    const seed = audiusTrack()
    rememberTracks([seed])

    await refillBuffer({ seed, queuedIds: [seed.id], recentIds: [], sources: { fetchByGenre } })

    expect(fetchByGenre).toHaveBeenCalledTimes(1)
    expect(takeFromBuffer()).toBeNull()
  })
})

describe('a Jamendo seed', () => {
  it('spends exactly one similarity request, and no genre request', async () => {
    const similar = jamendoTrack({ id: 'jamendo:similar', providerId: 'similar' })
    const fetchSimilar = vi.fn(() =>
      Promise.resolve({ tracks: [similar], requests: 1, status: 'success' as const }),
    )
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const seed = jamendoTrack()

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { session: [], fetchSimilar, fetchByGenre },
    })

    expect(fetchSimilar).toHaveBeenCalledTimes(1)
    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(takeFromBuffer()?.id).toBe('jamendo:similar')
  })

  /**
   * The whole point of this file.
   *
   * Jamendo answered "nothing is like this track". That is a provider judgement,
   * and following it with a generic same-genre list would both override it and
   * take the refill to two requests.
   */
  it('accepts an empty similarity answer instead of asking anything else', async () => {
    const fetchSimilar = vi.fn(() =>
      Promise.resolve({ tracks: [], requests: 1, status: 'success' as const }),
    )
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const seed = jamendoTrack()

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { session: [], fetchSimilar, fetchByGenre },
    })

    expect(fetchSimilar).toHaveBeenCalledTimes(1)
    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(takeFromBuffer()).toBeNull()
  })

  it('makes no second request when the similarity lookup fails outright', async () => {
    const fetchSimilar = vi.fn(() => Promise.reject(new Error('jamendo down')))
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const seed = jamendoTrack()

    await expect(
      refillBuffer({
        seed,
        queuedIds: [seed.id],
        recentIds: [],
        sources: { session: [], fetchSimilar, fetchByGenre },
      }),
    ).resolves.toBeUndefined()

    // One attempt, and nothing after it.
    expect(fetchSimilar).toHaveBeenCalledTimes(1)
    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(takeFromBuffer()).toBeNull()
  })

  it('is not rescued by a genre request even when its session pool is empty too', async () => {
    const fetchSimilar = vi.fn(() =>
      Promise.resolve({ tracks: [], requests: 1, status: 'success' as const }),
    )
    const fetchByGenre = vi.fn(() => Promise.resolve([audiusTrack()]))
    const seed = jamendoTrack()
    // Nothing anywhere: the strongest possible temptation to spend a second call.
    rememberTracks([seed])

    await refillBuffer({
      seed,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { fetchSimilar, fetchByGenre },
    })

    expect(fetchByGenre).not.toHaveBeenCalled()
    expect(bufferedCandidates()).toHaveLength(0)
  })
})
