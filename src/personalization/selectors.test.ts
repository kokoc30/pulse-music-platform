import { describe, expect, it } from 'vitest'
import { makeEntry, makeState, NOW } from '@/test/fixtures/personalization'
import type { ProfileStage } from './profile'
import {
  HOME_SECTION_COUNT,
  hasRecentlyPlayed,
  planHomeSections,
  recentShelf,
} from './selectors'
import type { HomePlanInput } from './selectors'

function plan(stage: ProfileStage, overrides: Partial<HomePlanInput> = {}) {
  return planHomeSections({
    stage,
    hasRecommendations: true,
    hasRecent: true,
    hasBecause: true,
    hasArtistShelf: true,
    ...overrides,
  })
}

describe('home dashboard plan', () => {
  describe('the page never changes size', () => {
    const stages: ProfileStage[] = ['cold', 'early', 'warm', 'mature']

    for (const stage of stages) {
      it(`renders exactly ${HOME_SECTION_COUNT} shelves at the ${stage} stage`, () => {
        expect(plan(stage)).toHaveLength(HOME_SECTION_COUNT)
      })
    }

    it('still renders five shelves when nothing personalized can be filled', () => {
      const empty = {
        hasRecommendations: false,
        hasRecent: false,
        hasBecause: false,
        hasArtistShelf: false,
      }
      for (const stage of stages) {
        expect(plan(stage, empty)).toHaveLength(HOME_SECTION_COUNT)
      }
    })

    it('always closes with the charts shelf, as the reference does', () => {
      for (const stage of stages) {
        expect(plan(stage).at(-1)).toBe('charts')
      }
    })

    it('never repeats a shelf', () => {
      for (const stage of stages) {
        const sections = plan(stage)
        expect(new Set(sections).size).toBe(sections.length)
      }
    })
  })

  describe('cold start', () => {
    it('is exactly the pre-Phase-4 discovery page', () => {
      expect(plan('cold', { hasRecent: false })).toEqual([
        'trending',
        'popular-artists',
        'month',
        'stations',
        'charts',
      ])
    })

    it('shows no recommendation shelf even if one could be filled', () => {
      const sections = plan('cold')
      expect(sections).not.toContain('recommended')
      expect(sections).not.toContain('because')
      expect(sections).not.toContain('artists')
    })

    it('is pure discovery for a browser with nothing played at all', () => {
      expect(plan('cold', { hasRecent: false })).toEqual([
        'trending',
        'popular-artists',
        'month',
        'stations',
        'charts',
      ])
    })

    it('still offers Recently played when the only history is YouTube', () => {
      // A YouTube-only listener has a cold *profile* — YouTube may not feed a
      // preference score — but has demonstrably played something, and saying so
      // is not a derived metric.
      const sections = plan('cold', { hasRecent: true })
      expect(sections[0]).toBe('recent')
      expect(sections).not.toContain('recommended')
      expect(sections).not.toContain('because')
    })
  })

  describe('early profile', () => {
    it('offers Recently played, but never claims to have recommendations', () => {
      const sections = plan('early')
      expect(sections[0]).toBe('recent')
      expect(sections).not.toContain('recommended')
      expect(sections).not.toContain('because')
      expect(sections).toContain('trending')
    })

    it('falls back to pure discovery when there is nothing recent to show', () => {
      expect(plan('early', { hasRecent: false })).toEqual([
        'trending',
        'popular-artists',
        'month',
        'stations',
        'charts',
      ])
    })
  })

  describe('warm profile', () => {
    it('leads with recommendations and keeps discovery as a fallback', () => {
      const sections = plan('warm')
      expect(sections.slice(0, 3)).toEqual(['recommended', 'recent', 'artists'])
      expect(sections).toContain('trending')
      expect(sections).not.toContain('because')
    })

    it('gives the slot back to discovery when recommendations came up short', () => {
      const sections = plan('warm', { hasRecommendations: false })
      expect(sections).not.toContain('recommended')
      expect(sections).toEqual(['recent', 'artists', 'trending', 'popular-artists', 'charts'])
    })
  })

  describe('mature profile', () => {
    it('is personalized throughout, with discovery only as the closing chart shelf', () => {
      expect(plan('mature')).toEqual(['recommended', 'recent', 'because', 'artists', 'charts'])
    })

    it('demotes trending and popular artists out of the page', () => {
      const sections = plan('mature')
      expect(sections).not.toContain('trending')
      expect(sections).not.toContain('popular-artists')
      expect(sections).not.toContain('month')
    })

    it('omits "Because you listened to" when there is no defensible seed', () => {
      const sections = plan('mature', { hasBecause: false })
      expect(sections).not.toContain('because')
      expect(sections).toEqual(['recommended', 'recent', 'artists', 'trending', 'charts'])
    })

    it('brings discovery back when personalization cannot fill the page', () => {
      const sections = plan('mature', {
        hasRecommendations: false,
        hasBecause: false,
        hasArtistShelf: false,
      })
      expect(sections).toEqual(['recent', 'trending', 'popular-artists', 'month', 'charts'])
    })
  })
})

describe('recently played shelf', () => {
  it('is empty for a browser with no history', () => {
    expect(recentShelf(makeState(), NOW)).toEqual([])
    expect(hasRecentlyPlayed(makeState(), NOW)).toBe(false)
  })

  it('orders most recent first', () => {
    const state = makeState({
      listeningHistory: [
        makeEntry({ id: 'old', daysAgo: 3 }),
        makeEntry({ id: 'newest', daysAgo: 0 }),
        makeEntry({ id: 'mid', daysAgo: 1 }),
      ],
    })
    expect(recentShelf(state, NOW).map((entry) => entry.providerItemId)).toEqual([
      'newest',
      'mid',
      'old',
    ])
  })

  it('respects the shelf size', () => {
    const state = makeState({
      listeningHistory: Array.from({ length: 10 }, (_, index) =>
        makeEntry({ id: `t${index}`, daysAgo: index }),
      ),
    })
    expect(recentShelf(state, NOW)).toHaveLength(4)
    expect(recentShelf(state, NOW, 2)).toHaveLength(2)
  })

  it('shows one row per item, however many times it was played', () => {
    const state = makeState({
      listeningHistory: [makeEntry({ id: 'looped', playCount: 40, daysAgo: 0 })],
    })
    expect(recentShelf(state, NOW)).toHaveLength(1)
  })

  it('shows catalogue and YouTube items together, ordered by recency', () => {
    const state = makeState({
      listeningHistory: [
        makeEntry({ id: 'song', provider: 'audius', daysAgo: 1 }),
        makeEntry({ id: 'vid', provider: 'youtube', daysAgo: 0 }),
      ],
    })
    expect(recentShelf(state, NOW).map((entry) => entry.provider)).toEqual(['youtube', 'audius'])
  })
})
