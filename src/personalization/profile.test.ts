import { describe, expect, it } from 'vitest'
import { DAY, makeEntry, makeSearch, makeState, NOW } from '@/test/fixtures/personalization'
import { MAX_REPEAT_FACTOR, RECENCY_HALF_LIFE_DAYS } from './config'
import { artistKey, buildProfile, catalogEntries, seedArtist, stageFor } from './profile'
import { effectiveWeight, interactionWeight, recencyDecay, repeatFactor } from './scoring'

describe('scoring', () => {
  describe('interaction weight', () => {
    it('values a qualified listen far above a bare click', () => {
      const listened = interactionWeight(makeEntry({ playCount: 1 }))
      const clicked = interactionWeight(makeEntry({ playCount: 0, qualified: false }))
      expect(listened).toBe(1)
      expect(clicked).toBe(0.05)
      expect(listened / clicked).toBe(20)
    })

    it('rewards a high completion', () => {
      const partial = interactionWeight(makeEntry({ completionRatio: 0.4 }))
      const finished = interactionWeight(makeEntry({ completionRatio: 0.95 }))
      expect(finished).toBeGreaterThan(partial)
      expect(finished - partial).toBe(0.5)
    })

    it('rewards coming back on another day', () => {
      const oneDay = interactionWeight(makeEntry({ playedDays: ['2026-06-15'] }))
      const twoDays = interactionWeight(makeEntry({ playedDays: ['2026-06-14', '2026-06-15'] }))
      expect(twoDays - oneDay).toBe(0.5)
    })

    it('penalises early skips, and floors at zero', () => {
      expect(interactionWeight(makeEntry({ playCount: 1, skipCount: 1 }))).toBeCloseTo(0.75, 5)
      expect(interactionWeight(makeEntry({ playCount: 0, qualified: false, skipCount: 8 }))).toBe(0)
    })
  })

  describe('recency decay', () => {
    it('is one for something played right now', () => {
      expect(recencyDecay(NOW, NOW)).toBe(1)
    })

    it('halves over the half-life', () => {
      expect(recencyDecay(NOW - RECENCY_HALF_LIFE_DAYS * DAY, NOW)).toBeCloseTo(0.5, 6)
      expect(recencyDecay(NOW - 2 * RECENCY_HALF_LIFE_DAYS * DAY, NOW)).toBeCloseTo(0.25, 6)
    })

    it('never reaches zero, however old', () => {
      expect(recencyDecay(NOW - 3650 * DAY, NOW)).toBeGreaterThan(0)
    })

    it('makes recent listening outweigh older listening', () => {
      const fresh = effectiveWeight(makeEntry({ daysAgo: 0 }), NOW)
      const old = effectiveWeight(makeEntry({ daysAgo: 180 }), NOW)
      expect(fresh).toBeGreaterThan(old * 5)
    })
  })

  describe('repeat factor', () => {
    it('is neutral for a single listen', () => {
      expect(repeatFactor(1)).toBe(1)
      expect(repeatFactor(0)).toBe(1)
    })

    it('grows with repeats but is capped', () => {
      expect(repeatFactor(2)).toBeGreaterThan(1)
      expect(repeatFactor(10)).toBeGreaterThan(repeatFactor(2))
      expect(repeatFactor(10_000)).toBe(MAX_REPEAT_FACTOR)
    })

    it('does not let one obsessively repeated track dominate the profile', () => {
      const obsessed = makeEntry({ id: 'a', artist: 'One Artist', playCount: 500 })
      const others = Array.from({ length: 6 }, (_, index) =>
        makeEntry({ id: `o${index}`, artist: `Artist ${index}`, playCount: 1 }),
      )
      const profile = buildProfile(
        makeState({ listeningHistory: [obsessed, ...others] }),
        NOW,
      )
      expect(profile.artistWeights[artistKey('One Artist')]).toBeLessThan(0.6)
    })
  })
})

describe('profile', () => {
  it('is empty for a browser with no history', () => {
    const profile = buildProfile(makeState(), NOW)
    expect(profile.stage).toBe('cold')
    expect(profile.qualifiedListenCount).toBe(0)
    expect(profile.artists).toEqual([])
    expect(profile.artistWeights).toEqual({})
  })

  describe('stages', () => {
    it('maps qualified listens onto the four stages', () => {
      expect(stageFor(0)).toBe('cold')
      expect(stageFor(1)).toBe('early')
      expect(stageFor(2)).toBe('early')
      expect(stageFor(3)).toBe('warm')
      expect(stageFor(7)).toBe('warm')
      expect(stageFor(8)).toBe('mature')
      expect(stageFor(400)).toBe('mature')
    })

    it('counts qualified listens, not rows', () => {
      const profile = buildProfile(
        makeState({
          listeningHistory: [
            makeEntry({ id: 'a', playCount: 3 }),
            makeEntry({ id: 'b', playCount: 0, qualified: false }),
          ],
        }),
        NOW,
      )
      expect(profile.qualifiedListenCount).toBe(3)
      expect(profile.qualifiedItemCount).toBe(1)
      expect(profile.stage).toBe('warm')
    })
  })

  describe('artist preference', () => {
    it('ranks a repeatedly played artist above a single listen', () => {
      const profile = buildProfile(
        makeState({
          listeningHistory: [
            makeEntry({ id: 'a1', artist: 'Nova Sound', playCount: 4 }),
            makeEntry({ id: 'b1', artist: 'Ghost Radio', playCount: 1 }),
          ],
        }),
        NOW,
      )
      expect(profile.artists[0].name).toBe('Nova Sound')
      expect(profile.artistWeights[artistKey('Nova Sound')]).toBeGreaterThan(
        profile.artistWeights[artistKey('Ghost Radio')],
      )
    })

    it('sums plays across an artist and keeps the provider artist id', () => {
      const profile = buildProfile(
        makeState({
          listeningHistory: [
            makeEntry({ id: 'a1', artist: 'Nova Sound', artistId: 'usr1', playCount: 2 }),
            makeEntry({ id: 'a2', artist: 'Nova Sound', artistId: 'usr1', playCount: 3 }),
          ],
        }),
        NOW,
      )
      expect(profile.artists[0].plays).toBe(5)
      expect(profile.artists[0].artistId).toBe('usr1')
    })

    it('normalizes weights so they sum to one', () => {
      const profile = buildProfile(
        makeState({
          listeningHistory: [
            makeEntry({ id: 'a', artist: 'A' }),
            makeEntry({ id: 'b', artist: 'B' }),
            makeEntry({ id: 'c', artist: 'C' }),
          ],
        }),
        NOW,
      )
      const total = Object.values(profile.artistWeights).reduce((sum, value) => sum + value, 0)
      expect(total).toBeCloseTo(1, 6)
    })
  })

  it('weights provider-supplied genres', () => {
    const profile = buildProfile(
      makeState({
        listeningHistory: [
          makeEntry({ id: 'a', genre: 'House', playCount: 3 }),
          makeEntry({ id: 'b', genre: 'Ambient', playCount: 1 }),
        ],
      }),
      NOW,
    )
    expect(profile.genreWeights.house).toBeGreaterThan(profile.genreWeights.ambient)
  })

  describe('search preference', () => {
    it('weights tokens from submitted queries', () => {
      const profile = buildProfile(
        makeState({ searchHistory: [makeSearch({ query: 'kosandra', submitCount: 3 })] }),
        NOW,
      )
      expect(profile.tokenWeights.kosandra).toBeGreaterThan(0)
    })

    it('weights a repeated query above a one-off', () => {
      const repeated = buildProfile(
        makeState({ searchHistory: [makeSearch({ query: 'alpha', submitCount: 5 })] }),
        NOW,
      ).tokenWeights.alpha

      const once = buildProfile(
        makeState({
          searchHistory: [
            makeSearch({ query: 'alpha', submitCount: 1 }),
            makeSearch({ query: 'beta', submitCount: 1 }),
          ],
        }),
        NOW,
      ).tokenWeights.alpha

      expect(repeated).toBeGreaterThan(once)
    })

    it('decays an old search relative to a fresh one', () => {
      const profile = buildProfile(
        makeState({
          searchHistory: [
            makeSearch({ query: 'fresh', daysAgo: 0 }),
            makeSearch({ query: 'ancient', daysAgo: 150 }),
          ],
        }),
        NOW,
      )
      expect(profile.tokenWeights.fresh).toBeGreaterThan(profile.tokenWeights.ancient)
    })
  })

  describe('script signals are content signals, never identity', () => {
    it('reflects the script of submitted searches', () => {
      const profile = buildProfile(
        makeState({
          searchHistory: [
            makeSearch({ query: 'سارية السواس', script: 'arabic', submitCount: 3 }),
            makeSearch({ query: 'Adele Hello', script: 'latin' }),
          ],
        }),
        NOW,
      )
      expect(profile.scriptWeights.arabic).toBeGreaterThan(profile.scriptWeights.latin)
      expect(profile.scriptWeights.arabic).toBeLessThanOrEqual(1)
    })

    it('reflects Armenian and Cyrillic listening independently', () => {
      const armenian = buildProfile(
        makeState({ searchHistory: [makeSearch({ query: 'Սիրուշո', script: 'armenian' })] }),
        NOW,
      )
      const cyrillic = buildProfile(
        makeState({ searchHistory: [makeSearch({ query: 'кассандра', script: 'cyrillic' })] }),
        NOW,
      )
      expect(armenian.scriptWeights.armenian).toBeGreaterThan(0)
      expect(armenian.scriptWeights.cyrillic).toBe(0)
      expect(cyrillic.scriptWeights.cyrillic).toBeGreaterThan(0)
      expect(cyrillic.scriptWeights.armenian).toBe(0)
    })

    it('normalizes script weights to a distribution', () => {
      const profile = buildProfile(
        makeState({
          searchHistory: [
            makeSearch({ query: 'а', script: 'cyrillic' }),
            makeSearch({ query: 'b', script: 'latin' }),
          ],
        }),
        NOW,
      )
      const total = Object.values(profile.scriptWeights).reduce((sum, value) => sum + value, 0)
      expect(total).toBeCloseTo(1, 6)
    })
  })

  describe('YouTube is excluded from every weight (policy §III.E.4.h)', () => {
    const state = makeState({
      listeningHistory: [
        makeEntry({ id: 'a', provider: 'audius', artist: 'Nova Sound', playCount: 1 }),
        makeEntry({ id: 'vid1', provider: 'youtube', artist: 'Some Channel', playCount: 10 }),
        makeEntry({ id: 'vid2', provider: 'youtube', artist: 'Another Channel', playCount: 10 }),
      ],
    })

    it('never lets a YouTube channel become an artist preference', () => {
      const profile = buildProfile(state, NOW)
      expect(profile.artists.map((artist) => artist.name)).toEqual(['Nova Sound'])
      expect(profile.artistWeights[artistKey('Some Channel')]).toBeUndefined()
    })

    it('does not count YouTube plays toward the profile stage', () => {
      // Twenty YouTube plays plus one catalogue listen is still an early profile.
      expect(buildProfile(state, NOW).qualifiedListenCount).toBe(1)
      expect(buildProfile(state, NOW).stage).toBe('early')
    })

    it('filters YouTube rows out before any weight is computed', () => {
      expect(catalogEntries(state.listeningHistory).map((entry) => entry.provider)).toEqual([
        'audius',
      ])
    })

    it('still lets the visitor’s own typed query influence the profile', () => {
      // The query is first-party input. It counts even though the visitor
      // ultimately played the YouTube result.
      const profile = buildProfile(
        makeState({
          listeningHistory: [makeEntry({ id: 'v', provider: 'youtube' })],
          searchHistory: [makeSearch({ query: 'سارية السواس', script: 'arabic' })],
        }),
        NOW,
      )
      expect(profile.scriptWeights.arabic).toBeGreaterThan(0)
    })
  })

  describe('"Because you listened to" seeds', () => {
    it('has no seed for a cold or early profile', () => {
      expect(seedArtist(buildProfile(makeState(), NOW))).toBeNull()
      expect(
        seedArtist(
          buildProfile(
            makeState({ listeningHistory: [makeEntry({ id: 'a', playCount: 1 })] }),
            NOW,
          ),
        ),
      ).toBeNull()
    })

    it('names an artist with a clear, repeated share of the profile', () => {
      const profile = buildProfile(
        makeState({
          listeningHistory: [
            makeEntry({ id: 'a', artist: 'Nova Sound', playCount: 5 }),
            makeEntry({ id: 'b', artist: 'Ghost Radio', playCount: 1 }),
          ],
        }),
        NOW,
      )
      expect(seedArtist(profile)?.name).toBe('Nova Sound')
    })

    it('omits the section when no artist stands out', () => {
      const spread = Array.from({ length: 12 }, (_, index) =>
        makeEntry({ id: `t${index}`, artist: `Artist ${index}`, playCount: 1 }),
      )
      const profile = buildProfile(makeState({ listeningHistory: spread }), NOW)
      expect(profile.stage).toBe('mature')
      expect(seedArtist(profile)).toBeNull()
    })

    it('omits the section for an artist played only once, however dominant', () => {
      const profile = buildProfile(
        makeState({
          listeningHistory: [
            makeEntry({ id: 'a', artist: 'Nova Sound', playCount: 1, daysAgo: 0 }),
            makeEntry({ id: 'b', artist: 'B', playCount: 1, daysAgo: 90 }),
            makeEntry({ id: 'c', artist: 'C', playCount: 1, daysAgo: 90 }),
          ],
        }),
        NOW,
      )
      expect(profile.artists[0].name).toBe('Nova Sound')
      expect(seedArtist(profile)).toBeNull()
    })
  })

  it('is deterministic: the same state always produces the same profile', () => {
    const state = makeState({
      listeningHistory: [
        makeEntry({ id: 'a', artist: 'A', playCount: 2 }),
        makeEntry({ id: 'b', artist: 'B', playCount: 2 }),
      ],
      searchHistory: [makeSearch({ query: 'one' }), makeSearch({ query: 'two' })],
    })
    expect(buildProfile(state, NOW)).toEqual(buildProfile(state, NOW))
  })
})
