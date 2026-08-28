import { describe, expect, it } from 'vitest'
import type { Track } from '@/music/types'
import { DAY, makeEntry, makeSearch, makeState, NOW } from '@/test/fixtures/personalization'
import { MAX_TRACKS_PER_ARTIST, OVERPLAYED_COUNT, SHELF_SIZE } from './config'
import { buildProfile } from './profile'
import { alignmentScore, buildRecommendations, heldBackIds, tracksByArtists } from './recommendations'
import { artistKey } from './profile'

function track(overrides: Partial<Track> & { id: string }): Track {
  return {
    mediaKind: 'audio',
    provider: 'audius',
    providerId: overrides.id,
    title: 'A Song',
    artistName: 'Some Artist',
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    ...overrides,
    id: `audius:${overrides.id}`,
  }
}

const COLD = buildProfile(makeState(), NOW)

describe('alignment score', () => {
  it('is zero against an empty profile', () => {
    expect(alignmentScore(track({ id: '1' }), COLD).score).toBe(0)
  })

  it('rewards a track by an artist in the profile', () => {
    const profile = buildProfile(
      makeState({ listeningHistory: [makeEntry({ id: 'h', artist: 'Nova Sound', playCount: 3 })] }),
      NOW,
    )
    const liked = alignmentScore(track({ id: '1', artistName: 'Nova Sound' }), profile)
    const unknown = alignmentScore(track({ id: '2', artistName: 'Nobody' }), profile)

    expect(liked.score).toBeGreaterThan(unknown.score)
    expect(liked.reasons).toContain('artist')
  })

  it('rewards a matching provider genre', () => {
    const profile = buildProfile(
      makeState({ listeningHistory: [makeEntry({ id: 'h', genre: 'House', playCount: 3 })] }),
      NOW,
    )
    const matching = alignmentScore(track({ id: '1', genre: 'House', artistName: 'X' }), profile)
    const other = alignmentScore(track({ id: '2', genre: 'Ambient', artistName: 'X' }), profile)

    expect(matching.score).toBeGreaterThan(other.score)
    expect(matching.reasons).toContain('genre')
  })

  it('rewards a title that echoes a submitted query', () => {
    const profile = buildProfile(
      makeState({ searchHistory: [makeSearch({ query: 'kosandra', submitCount: 4 })] }),
      NOW,
    )
    const matching = alignmentScore(track({ id: '1', title: 'Kosandra', artistName: 'X' }), profile)
    const other = alignmentScore(track({ id: '2', title: 'Something Else', artistName: 'X' }), profile)

    expect(matching.score).toBeGreaterThan(other.score)
    expect(matching.reasons).toContain('query')
  })

  it('gives a small nudge to the script the visitor keeps searching in', () => {
    const profile = buildProfile(
      makeState({
        searchHistory: [makeSearch({ query: 'кассандра', script: 'cyrillic', submitCount: 5 })],
      }),
      NOW,
    )
    const cyrillic = alignmentScore(track({ id: '1', title: 'Кассандра', artistName: 'Мияги' }), profile)
    const latin = alignmentScore(track({ id: '2', title: 'Plain Title', artistName: 'Someone' }), profile)

    expect(cyrillic.score).toBeGreaterThan(latin.score)
    expect(cyrillic.reasons).toContain('script')
  })
})

describe('held-back items', () => {
  it('holds back something played within the cooldown', () => {
    const held = heldBackIds([makeEntry({ id: 'fresh', daysAgo: 0 })], NOW)
    expect(held.has('audius:fresh')).toBe(true)
  })

  it('releases something played a week ago', () => {
    const held = heldBackIds([makeEntry({ id: 'old', daysAgo: 7, playCount: 1 })], NOW)
    expect(held.has('audius:old')).toBe(false)
  })

  it('holds back something already played many times', () => {
    const held = heldBackIds(
      [makeEntry({ id: 'loop', daysAgo: 30, playCount: OVERPLAYED_COUNT })],
      NOW,
    )
    expect(held.has('audius:loop')).toBe(true)
  })
})

describe('building a recommendation shelf', () => {
  const profile = buildProfile(
    makeState({
      listeningHistory: [
        makeEntry({ id: 'h1', artist: 'Nova Sound', genre: 'House', playCount: 4, daysAgo: 3 }),
        makeEntry({ id: 'h2', artist: 'Ghost Radio', genre: 'House', playCount: 2, daysAgo: 4 }),
      ],
    }),
    NOW,
  )

  const pool = [
    track({ id: 'p1', artistName: 'Nova Sound', genre: 'House' }),
    track({ id: 'p2', artistName: 'Nova Sound', genre: 'House' }),
    track({ id: 'p3', artistName: 'Nova Sound', genre: 'House' }),
    track({ id: 'p4', artistName: 'Nova Sound', genre: 'House' }),
    track({ id: 'p5', artistName: 'Ghost Radio', genre: 'House' }),
    track({ id: 'p6', artistName: 'Stranger', genre: 'Ambient' }),
    track({ id: 'p7', artistName: 'Newcomer', genre: 'Jazz' }),
  ]

  it('fills the shelf', () => {
    const shelf = buildRecommendations(pool, profile, { size: SHELF_SIZE, now: NOW })
    expect(shelf).toHaveLength(SHELF_SIZE)
  })

  it('caps one artist at two rows', () => {
    const shelf = buildRecommendations(pool, profile, { size: SHELF_SIZE, now: NOW })
    const novaRows = shelf.filter((item) => artistKey(item.track.artistName) === artistKey('Nova Sound'))
    expect(novaRows.length).toBeLessThanOrEqual(MAX_TRACKS_PER_ARTIST)
  })

  it('never shows the same artist eight times, even with a pool of only that artist', () => {
    const monoculture = Array.from({ length: 8 }, (_, index) =>
      track({ id: `m${index}`, artistName: 'Nova Sound', genre: 'House' }),
    )
    const shelf = buildRecommendations(monoculture, profile, { size: 8, now: NOW })
    expect(shelf.length).toBeLessThanOrEqual(MAX_TRACKS_PER_ARTIST)
  })

  it('reserves room for exploration outside the profile', () => {
    const shelf = buildRecommendations(pool, profile, { size: SHELF_SIZE, now: NOW })
    const known = new Set(Object.keys(profile.artistWeights))
    const explored = shelf.filter((item) => !known.has(artistKey(item.track.artistName)))
    expect(explored.length).toBeGreaterThan(0)
  })

  it('does not produce a filter bubble from a skewed script profile', () => {
    // 70% Cyrillic-leaning history. The shelf must not be 100% Cyrillic.
    const skewed = buildProfile(
      makeState({
        searchHistory: [
          makeSearch({ query: 'кассандра', script: 'cyrillic', submitCount: 7 }),
          makeSearch({ query: 'hello', script: 'latin', submitCount: 3 }),
        ],
      }),
      NOW,
    )
    const mixed = [
      track({ id: 'c1', title: 'Кассандра', artistName: 'Мияги' }),
      track({ id: 'c2', title: 'Группа крови', artistName: 'Кино' }),
      track({ id: 'c3', title: 'Мама', artistName: 'Лето' }),
      track({ id: 'c4', title: 'Небо', artistName: 'Звезда' }),
      track({ id: 'l1', title: 'Hello', artistName: 'Adele' }),
      track({ id: 'l2', title: 'Skyfall', artistName: 'Adele' }),
    ]
    const shelf = buildRecommendations(mixed, skewed, { size: SHELF_SIZE, now: NOW })
    const latinRows = shelf.filter((item) => /^[\x20-\x7E]+$/.test(item.track.title))
    expect(latinRows.length).toBeGreaterThan(0)
  })

  it('excludes items played in the last day', () => {
    const shelf = buildRecommendations(pool, profile, {
      size: SHELF_SIZE,
      now: NOW,
      history: [{ ...makeEntry({ id: 'p1', daysAgo: 0 }) }],
    })
    expect(shelf.some((item) => item.track.id === 'audius:p1')).toBe(false)
  })

  it('excludes dismissed items', () => {
    const shelf = buildRecommendations(pool, profile, {
      size: SHELF_SIZE,
      now: NOW,
      dismissed: ['audius:p1', 'audius:p2'],
    })
    expect(shelf.some((item) => ['audius:p1', 'audius:p2'].includes(item.track.id))).toBe(false)
  })

  it('excludes items another shelf already used', () => {
    const shelf = buildRecommendations(pool, profile, {
      size: SHELF_SIZE,
      now: NOW,
      exclude: ['audius:p1'],
    })
    expect(shelf.some((item) => item.track.id === 'audius:p1')).toBe(false)
  })

  it('never offers a non-streamable track', () => {
    const shelf = buildRecommendations(
      [...pool, track({ id: 'gated', isStreamable: false, artistName: 'Nova Sound' })],
      profile,
      { size: SHELF_SIZE, now: NOW },
    )
    expect(shelf.every((item) => item.track.isStreamable)).toBe(true)
  })

  it('never repeats a track within a shelf', () => {
    const shelf = buildRecommendations([...pool, ...pool], profile, { size: SHELF_SIZE, now: NOW })
    expect(new Set(shelf.map((item) => item.track.id)).size).toBe(shelf.length)
  })

  it('returns fewer rows rather than inventing them when the pool is small', () => {
    const shelf = buildRecommendations([pool[0]], profile, { size: SHELF_SIZE, now: NOW })
    expect(shelf).toHaveLength(1)
  })

  it('returns nothing for an empty pool', () => {
    expect(buildRecommendations([], profile, { size: SHELF_SIZE, now: NOW })).toEqual([])
  })

  it('is deterministic across repeated calls', () => {
    const first = buildRecommendations(pool, profile, { size: SHELF_SIZE, now: NOW })
    const second = buildRecommendations(pool, profile, { size: SHELF_SIZE, now: NOW })
    expect(first.map((item) => item.track.id)).toEqual(second.map((item) => item.track.id))
  })

  it('still fills the shelf for a profile with no artist overlap at all', () => {
    const unrelated = [
      track({ id: 'u1', artistName: 'One' }),
      track({ id: 'u2', artistName: 'Two' }),
      track({ id: 'u3', artistName: 'Three' }),
      track({ id: 'u4', artistName: 'Four' }),
    ]
    expect(buildRecommendations(unrelated, profile, { size: SHELF_SIZE, now: NOW })).toHaveLength(4)
  })
})

describe('tracks by liked artists', () => {
  const pool = [
    track({ id: 'a1', artistName: 'Nova Sound' }),
    track({ id: 'a2', artistName: 'Nova Sound' }),
    track({ id: 'a3', artistName: 'Nova Sound' }),
    track({ id: 'b1', artistName: 'Ghost Radio' }),
    track({ id: 'c1', artistName: 'Nobody' }),
  ]

  it('returns only tracks by the requested artists', () => {
    const rows = tracksByArtists(pool, [artistKey('Nova Sound')], { size: 4, now: NOW })
    expect(rows.every((row) => row.artistName === 'Nova Sound')).toBe(true)
  })

  it('applies the same per-artist cap', () => {
    const rows = tracksByArtists(pool, [artistKey('Nova Sound')], { size: 4, now: NOW })
    expect(rows).toHaveLength(MAX_TRACKS_PER_ARTIST)
  })

  it('holds back what was just played', () => {
    const rows = tracksByArtists(pool, [artistKey('Nova Sound')], {
      size: 4,
      now: NOW,
      history: [makeEntry({ id: 'a1', daysAgo: 0 })],
    })
    expect(rows.some((row) => row.id === 'audius:a1')).toBe(false)
  })

  it('returns nothing when the pool has no matching artist', () => {
    expect(tracksByArtists(pool, [artistKey('Unknown')], { size: 4, now: NOW })).toEqual([])
  })

  it('spans several liked artists', () => {
    const rows = tracksByArtists(pool, [artistKey('Nova Sound'), artistKey('Ghost Radio')], {
      size: 4,
      now: NOW,
    })
    expect(new Set(rows.map((row) => row.artistName))).toEqual(
      new Set(['Nova Sound', 'Ghost Radio']),
    )
  })
})

describe('performance', () => {
  it('ranks a full history against a large pool in a few milliseconds', () => {
    const history = Array.from({ length: 250 }, (_, index) =>
      makeEntry({ id: `h${index}`, artist: `Artist ${index % 40}`, daysAgo: index % 120 }),
    )
    const searches = Array.from({ length: 50 }, (_, index) =>
      makeSearch({ query: `query number ${index}`, daysAgo: index }),
    )
    const pool = Array.from({ length: 200 }, (_, index) =>
      track({ id: `p${index}`, artistName: `Artist ${index % 60}` }),
    )

    const started = performance.now()
    const profile = buildProfile(makeState({ listeningHistory: history, searchHistory: searches }), NOW)
    buildRecommendations(pool, profile, { size: SHELF_SIZE, now: NOW, history })
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(150)
  })

  it('decays a six-month-old profile without error', () => {
    const ancient = Array.from({ length: 20 }, (_, index) =>
      makeEntry({ id: `a${index}`, daysAgo: 179, playCount: 2 }),
    )
    const profile = buildProfile(makeState({ listeningHistory: ancient }), NOW + 5 * DAY)
    expect(Number.isFinite(profile.artistWeights[artistKey('Nova Sound')])).toBe(true)
  })
})
