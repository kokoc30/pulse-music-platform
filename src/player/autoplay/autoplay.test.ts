import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@/music/types'
import {
  ARTIST_CAP_FAR,
  ARTIST_CAP_NEAR,
  BUFFER_TARGET,
  MAX_SESSION_CANDIDATES,
  RECENT_WINDOW,
  artistAllowed,
  bpmCloseness,
  clearSessionPool,
  collectCandidates,
  keyMatch,
  planAutoplay,
  planNextTrack,
  rememberTracks,
  scoreCandidate,
  scoreCandidates,
  sessionTracks,
  tagOverlap,
} from './index'
import type { Candidate } from './types'

/**
 * The autoplay planner.
 *
 * Every test here is arithmetic over an explicit situation: no store, no
 * network, no clock. That is the whole reason the planner takes its context as
 * an argument rather than reading globals.
 */

let counter = 0

function track(overrides: Partial<Track> = {}): Track {
  counter += 1
  const providerId = overrides.providerId ?? `t${counter}`
  const provider = overrides.provider ?? 'audius'
  return {
    id: `${provider}:${providerId}`,
    mediaKind: 'audio',
    provider,
    providerId,
    title: `Track ${providerId}`,
    artistName: 'Some Artist',
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    ...overrides,
    // `id` must stay derived even when the caller overrode provider/providerId.
    ...(overrides.id ? { id: overrides.id } : {}),
  }
}

const seed = (overrides: Partial<Track> = {}) =>
  track({
    providerId: 'seed',
    genre: 'House',
    mood: 'Energizing',
    tags: ['deep', 'club', 'night'],
    bpm: 124,
    musicalKey: 'A minor',
    artistName: 'Seed Artist',
    ...overrides,
  })

const candidate = (t: Track, extra: Partial<Candidate> = {}): Candidate => ({
  track: t,
  source: 'session',
  ...extra,
})

beforeEach(() => {
  counter = 0
  clearSessionPool()
})

describe('similarity signals', () => {
  it('ranks a same-genre track above an unrelated one', () => {
    const base = seed()
    const same = scoreCandidate(base, candidate(track({ genre: 'House' })))
    const other = scoreCandidate(base, candidate(track({ genre: 'Classical' })))
    expect(same.score).toBeGreaterThan(other.score)
    expect(same.reasons).toContain('genre')
  })

  it('rewards overlapping tags', () => {
    const base = seed()
    const shared = scoreCandidate(base, candidate(track({ tags: ['deep', 'club'] })))
    const none = scoreCandidate(base, candidate(track({ tags: ['folk', 'acoustic'] })))
    expect(shared.score).toBeGreaterThan(none.score)
    expect(shared.reasons).toContain('tags')
  })

  it('rewards a matching mood', () => {
    const base = seed()
    const same = scoreCandidate(base, candidate(track({ mood: 'Energizing' })))
    const other = scoreCandidate(base, candidate(track({ mood: 'Sentimental' })))
    expect(same.score).toBeGreaterThan(other.score)
  })

  it('rewards a close tempo and ignores a distant one', () => {
    const base = seed()
    const close = scoreCandidate(base, candidate(track({ bpm: 126 })))
    const far = scoreCandidate(base, candidate(track({ bpm: 180 })))
    expect(close.score).toBeGreaterThan(far.score)
    expect(close.reasons).toContain('bpm')
    expect(far.reasons).not.toContain('bpm')
  })

  it('rewards the same artist, modestly', () => {
    const base = seed()
    const same = scoreCandidate(base, candidate(track({ artistName: 'Seed Artist' })))
    expect(same.reasons).toContain('artist')
  })

  it('uses the provider’s own ordering when it has one', () => {
    const base = seed({ provider: 'jamendo', providerId: 'seed' })
    const first = scoreCandidate(
      base,
      candidate(track({ provider: 'jamendo' }), { source: 'jamendo-similar', providerRank: 0 }),
    )
    const tenth = scoreCandidate(
      base,
      candidate(track({ provider: 'jamendo' }), { source: 'jamendo-similar', providerRank: 10 }),
    )
    expect(first.score).toBeGreaterThan(tenth.score)
    expect(first.reasons).toContain('provider')
  })

  describe('missing metadata is neutral, never a penalty', () => {
    it('does not rank a bare track below one that mismatches on every field', () => {
      const base = seed()
      const bare = scoreCandidate(base, candidate(track({ artistName: 'Nobody' })))
      const mismatched = scoreCandidate(
        base,
        candidate(
          track({
            artistName: 'Nobody',
            genre: 'Classical',
            mood: 'Sentimental',
            tags: ['orchestral'],
            bpm: 60,
            musicalKey: 'F major',
          }),
        ),
      )
      expect(bare.score).toBeGreaterThanOrEqual(mismatched.score)
    })

    it('scores a track that shares its only field highly', () => {
      const base = seed()
      const onlyGenre = scoreCandidate(
        base,
        candidate(track({ genre: 'House', artistName: 'Nobody' })),
      )
      expect(onlyGenre.score).toBeGreaterThan(0.4)
    })
  })

  describe('primitives', () => {
    it('measures tag overlap as a share of the union', () => {
      expect(tagOverlap(['a', 'b'], ['a', 'b'])).toBe(1)
      expect(tagOverlap(['a', 'b'], ['c', 'd'])).toBe(0)
      expect(tagOverlap(['a', 'b'], ['a', 'c'])).toBeCloseTo(1 / 3, 5)
      expect(tagOverlap(undefined, ['a'])).toBe(0)
    })

    it('measures tempo closeness, falling to nothing at the tolerance', () => {
      expect(bpmCloseness(120, 120)).toBe(1)
      expect(bpmCloseness(120, 126)).toBeCloseTo(0.5, 5)
      expect(bpmCloseness(120, 200)).toBe(0)
      expect(bpmCloseness(undefined, 120)).toBe(0)
    })

    it('matches keys exactly or not at all', () => {
      expect(keyMatch('A minor', 'a MINOR')).toBe(1)
      expect(keyMatch('A minor', 'C major')).toBe(0)
      expect(keyMatch(undefined, 'C major')).toBe(0)
    })
  })

  it('is deterministic and ties break stably', () => {
    const base = seed()
    const pool = [candidate(track({ genre: 'House' })), candidate(track({ genre: 'House' }))]
    const first = scoreCandidates(base, pool).map((item) => item.track.id)
    const second = scoreCandidates(base, pool).map((item) => item.track.id)
    expect(first).toEqual(second)
  })
})

describe('consent', () => {
  const base = seed()
  const pool = [candidate(track({ artistName: 'Loved Artist' }))]

  it('ignores the profile when no affinity is supplied', () => {
    const scored = scoreCandidate(base, pool[0])
    expect(scored.reasons).not.toContain('profile')
  })

  it('may use it when the caller supplied one', () => {
    const scored = scoreCandidate(base, pool[0], { artistAffinity: { 'loved artist': 0.5 } })
    expect(scored.reasons).toContain('profile')
  })

  it('never lets affinity outrank genuine similarity', () => {
    const similar = scoreCandidate(base, candidate(track({ genre: 'House', tags: ['deep', 'club'] })), {
      artistAffinity: {},
    })
    const merelyLoved = scoreCandidate(base, candidate(track({ artistName: 'Loved Artist' })), {
      artistAffinity: { 'loved artist': 1 },
    })
    expect(similar.score).toBeGreaterThan(merelyLoved.score)
  })
})

describe('exclusions', () => {
  const base = seed()

  it('never picks the track that just played', () => {
    const plan = planAutoplay({
      seed: base,
      candidates: [candidate(base), candidate(track({ genre: 'House' }))],
      queuedIds: [],
      recentIds: [],
    })
    expect(plan.some((item) => item.track.id === base.id)).toBe(false)
  })

  it('never duplicates something already in the explicit queue', () => {
    const queued = track({ genre: 'House' })
    const plan = planAutoplay({
      seed: base,
      candidates: [candidate(queued), candidate(track({ genre: 'House' }))],
      queuedIds: [queued.id],
      recentIds: [],
    })
    expect(plan.some((item) => item.track.id === queued.id)).toBe(false)
  })

  it('avoids the recently played window', () => {
    const recent = track({ genre: 'House' })
    const plan = planAutoplay({
      seed: base,
      candidates: [candidate(recent), candidate(track({ genre: 'House' }))],
      queuedIds: [],
      recentIds: [recent.id],
    })
    expect(plan.some((item) => item.track.id === recent.id)).toBe(false)
  })

  it('lets a track return once it has fallen out of the recent window', () => {
    const old = track({ genre: 'House' })
    const recentIds = [...Array.from({ length: RECENT_WINDOW }, (_, i) => `audius:r${i}`), old.id]
    const plan = planAutoplay({
      seed: base,
      candidates: [candidate(old)],
      queuedIds: [],
      recentIds,
    })
    expect(plan.some((item) => item.track.id === old.id)).toBe(true)
  })

  it('never offers an unplayable track', () => {
    const plan = planAutoplay({
      seed: base,
      candidates: [candidate(track({ genre: 'House', isStreamable: false }))],
      queuedIds: [],
      recentIds: [],
    })
    expect(plan).toEqual([])
  })

  it('returns nothing rather than something bad when the pool is empty', () => {
    expect(planAutoplay({ seed: base, candidates: [], queuedIds: [], recentIds: [] })).toEqual([])
    expect(planNextTrack({ seed: base, candidates: [], queuedIds: [], recentIds: [] })).toBeNull()
  })
})

describe('diversity', () => {
  const base = seed()

  it('caps one artist inside the next three', () => {
    const pool = Array.from({ length: 10 }, () =>
      candidate(track({ artistName: 'Prolific', genre: 'House' })),
    )
    const plan = planAutoplay({ seed: base, candidates: pool, queuedIds: [], recentIds: [], size: 3 })
    expect(plan.length).toBeLessThanOrEqual(ARTIST_CAP_NEAR + 1)
  })

  it('caps one artist inside the next ten', () => {
    const pool = [
      ...Array.from({ length: 12 }, () => candidate(track({ artistName: 'Prolific', genre: 'House' }))),
      ...Array.from({ length: 12 }, (_, i) =>
        candidate(track({ artistName: `Other ${i}`, genre: 'House' })),
      ),
    ]
    const plan = planAutoplay({ seed: base, candidates: pool, queuedIds: [], recentIds: [], size: 10 })
    const prolific = plan.filter((item) => item.track.artistName === 'Prolific')
    expect(prolific.length).toBeLessThanOrEqual(ARTIST_CAP_FAR)
  })

  it('gives the immediate next slot to the most similar candidate', () => {
    const best = track({ genre: 'House', mood: 'Energizing', tags: ['deep', 'club'], bpm: 124 })
    const pool = [
      ...Array.from({ length: 12 }, (_, i) => candidate(track({ artistName: `Filler ${i}` }))),
      candidate(best),
    ]
    const plan = planAutoplay({ seed: base, candidates: pool, queuedIds: [], recentIds: [] })
    expect(plan[0].track.id).toBe(best.id)
  })

  it('produces the same run for the same inputs', () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      candidate(track({ artistName: `Artist ${i}`, genre: i % 2 ? 'House' : 'Techno' })),
    )
    const first = planAutoplay({ seed: base, candidates: pool, queuedIds: [], recentIds: [] })
    const second = planAutoplay({ seed: base, candidates: pool, queuedIds: [], recentIds: [] })
    expect(first.map((i) => i.track.id)).toEqual(second.map((i) => i.track.id))
  })

  it('never repeats a track within one plan', () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      candidate(track({ artistName: `Artist ${i}`, genre: 'House' })),
    )
    const plan = planAutoplay({ seed: base, candidates: pool, queuedIds: [], recentIds: [] })
    expect(new Set(plan.map((i) => i.track.id)).size).toBe(plan.length)
  })

  it('fills to the buffer target when the pool allows', () => {
    const pool = Array.from({ length: 30 }, (_, i) =>
      candidate(track({ artistName: `Artist ${i}`, genre: 'House' })),
    )
    const plan = planAutoplay({ seed: base, candidates: pool, queuedIds: [], recentIds: [] })
    expect(plan).toHaveLength(BUFFER_TARGET)
  })

  describe('the artist window itself', () => {
    it('permits an unrelated artist', () => {
      expect(artistAllowed([], 'anyone', 0)).toBe(true)
    })

    it('refuses a third in a row', () => {
      const chosen = [
        { track: track({ artistName: 'A' }), source: 'session' as const, score: 1, reasons: [] },
        { track: track({ artistName: 'A' }), source: 'session' as const, score: 1, reasons: [] },
      ]
      expect(artistAllowed(chosen, 'a', 2)).toBe(false)
    })
  })
})

describe('candidate collection budget', () => {
  it('spends no provider request for an Audius seed', async () => {
    const fetchSimilar = vi.fn()
    const pool = await collectCandidates(seed(), {
      session: [track({ genre: 'House' })],
      fetchSimilar: fetchSimilar as never,
    })
    expect(pool.requests).toBe(0)
    expect(fetchSimilar).not.toHaveBeenCalled()
    expect(pool.candidates).toHaveLength(1)
  })

  it('spends exactly one for a Jamendo seed', async () => {
    const similar = track({ provider: 'jamendo', providerId: 's1' })
    const fetchSimilar = vi.fn().mockResolvedValue({ status: 'success', tracks: [similar] })
    const pool = await collectCandidates(seed({ provider: 'jamendo', providerId: 'seed' }), {
      session: [],
      fetchSimilar: fetchSimilar as never,
    })
    expect(pool.requests).toBe(1)
    expect(fetchSimilar).toHaveBeenCalledTimes(1)
    expect(pool.candidates[0]).toMatchObject({ source: 'jamendo-similar', providerRank: 0 })
  })

  it('keeps the provider’s ordering as a signal', async () => {
    const tracks = Array.from({ length: 3 }, (_, i) =>
      track({ provider: 'jamendo', providerId: `s${i}` }),
    )
    const fetchSimilar = vi.fn().mockResolvedValue({ status: 'success', tracks })
    const pool = await collectCandidates(seed({ provider: 'jamendo', providerId: 'seed' }), {
      session: [],
      fetchSimilar: fetchSimilar as never,
    })
    expect(pool.candidates.map((c) => c.providerRank)).toEqual([0, 1, 2])
  })

  it('degrades to session candidates when the provider fails', async () => {
    const fetchSimilar = vi.fn().mockRejectedValue(new Error('offline'))
    const pool = await collectCandidates(seed({ provider: 'jamendo', providerId: 'seed' }), {
      session: [track({ genre: 'House' })],
      fetchSimilar: fetchSimilar as never,
    })
    expect(pool.candidates).toHaveLength(1)
    expect(pool.candidates[0].source).toBe('session')
  })

  it('bounds how much of the session it considers', async () => {
    const many = Array.from({ length: MAX_SESSION_CANDIDATES + 50 }, () => track())
    const pool = await collectCandidates(seed(), { session: many })
    expect(pool.candidates).toHaveLength(MAX_SESSION_CANDIDATES)
  })

  it('never returns the seed itself', async () => {
    const base = seed()
    const pool = await collectCandidates(base, { session: [base, track()] })
    expect(pool.candidates.some((c) => c.track.id === base.id)).toBe(false)
  })
})

describe('the session pool', () => {
  it('remembers streamable tracks, most recent first', () => {
    rememberTracks([track({ providerId: 'a' })])
    rememberTracks([track({ providerId: 'b' })])
    expect(sessionTracks().map((t) => t.providerId)).toEqual(['b', 'a'])
  })

  it('drops unplayable tracks', () => {
    rememberTracks([track({ providerId: 'gated', isStreamable: false })])
    expect(sessionTracks()).toEqual([])
  })

  it('deduplicates rather than growing', () => {
    const one = track({ providerId: 'same' })
    rememberTracks([one])
    rememberTracks([one])
    expect(sessionTracks()).toHaveLength(1)
  })

  it('is bounded', () => {
    rememberTracks(Array.from({ length: 500 }, () => track()))
    expect(sessionTracks().length).toBeLessThanOrEqual(300)
  })
})
