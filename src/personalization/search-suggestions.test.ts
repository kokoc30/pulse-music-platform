import { describe, expect, it } from 'vitest'
import { makeEntry, makeSearch, makeState, NOW } from '@/test/fixtures/personalization'
import { RECENT_PLAYED_SUGGESTIONS, RECENT_SEARCH_SUGGESTIONS } from './config'
import {
  filterRecentSearches,
  recentSearches,
  recentlyPlayedSuggestions,
} from './search-suggestions'
import { recentShelf } from './selectors'

describe('recent searches for the dropdown', () => {
  it('orders most recently submitted first', () => {
    const state = makeState({
      searchHistory: [
        makeSearch({ query: 'old', daysAgo: 5 }),
        makeSearch({ query: 'newest', daysAgo: 0 }),
        makeSearch({ query: 'middle', daysAgo: 2 }),
      ],
    })
    expect(recentSearches(state).map((entry) => entry.query)).toEqual([
      'newest',
      'middle',
      'old',
    ])
  })

  it('bounds the list for display without touching what is stored', () => {
    const searchHistory = Array.from({ length: 40 }, (_, index) =>
      makeSearch({ query: `q${index}`, daysAgo: index }),
    )
    const state = makeState({ searchHistory })
    expect(recentSearches(state)).toHaveLength(RECENT_SEARCH_SUGGESTIONS)
    expect(state.searchHistory).toHaveLength(40)
  })

  it('is empty for a browser with no searches', () => {
    expect(recentSearches(makeState())).toEqual([])
  })
})

describe('filtering recent searches locally', () => {
  const entries = [
    makeSearch({ query: 'Adele Hello' }),
    makeSearch({ query: 'aram asatryan' }),
    makeSearch({ query: 'sara al sawas' }),
    makeSearch({ query: 'Кино Группа крови', script: 'cyrillic' }),
    makeSearch({ query: 'سارة السواس', script: 'arabic' }),
  ]

  const matches = (term: string) => filterRecentSearches(entries, term).map((e) => e.query)

  it('returns everything for an empty term', () => {
    expect(matches('')).toHaveLength(entries.length)
    expect(matches('   ')).toHaveLength(entries.length)
  })

  it('matches anywhere in the query, not only at the start', () => {
    expect(matches('ara')).toEqual(['aram asatryan', 'sara al sawas'])
  })

  it('ignores case', () => {
    expect(matches('ADELE')).toEqual(['Adele Hello'])
    expect(matches('adele')).toEqual(['Adele Hello'])
  })

  it('matches across spacing, so `alswas` finds `sara al sawas`', () => {
    expect(matches('alsawas')).toEqual(['sara al sawas'])
  })

  it('keeps scripts apart rather than transliterating', () => {
    expect(matches('Кино')).toEqual(['Кино Группа крови'])
    expect(matches('kino')).toEqual([])
  })

  it('matches Arabic input against an Arabic query', () => {
    expect(matches('السواس')).toEqual(['سارة السواس'])
  })

  it('returns nothing when nothing matches', () => {
    expect(matches('zzzzzz')).toEqual([])
  })

  it('respects the display bound', () => {
    const many = Array.from({ length: 30 }, (_, index) => makeSearch({ query: `match ${index}` }))
    expect(filterRecentSearches(many, 'match')).toHaveLength(RECENT_SEARCH_SUGGESTIONS)
  })
})

describe('recently played for the dropdown', () => {
  const state = makeState({
    listeningHistory: [
      makeEntry({ id: 'old', title: 'Old', daysAgo: 5 }),
      makeEntry({ id: 'newest', title: 'Newest', daysAgo: 0 }),
      makeEntry({ id: 'middle', title: 'Middle', daysAgo: 2 }),
    ],
  })

  it('orders most recently played first', () => {
    expect(recentlyPlayedSuggestions(state, NOW).map((entry) => entry.title)).toEqual([
      'Newest',
      'Middle',
      'Old',
    ])
  })

  it('is bounded', () => {
    const many = makeState({
      listeningHistory: Array.from({ length: 20 }, (_, index) =>
        makeEntry({ id: `t${index}`, daysAgo: index }),
      ),
    })
    expect(recentlyPlayedSuggestions(many, NOW)).toHaveLength(RECENT_PLAYED_SUGGESTIONS)
  })

  it('is the same canonical selector the home shelf renders', () => {
    // Both surfaces must agree on ordering *and* on eligibility, so the
    // dropdown differs from the shelf only in how many rows it takes.
    const shelf = recentShelf(state, NOW, RECENT_PLAYED_SUGGESTIONS)
    expect(recentlyPlayedSuggestions(state, NOW)).toEqual(shelf)
  })

  it('inherits the YouTube eligibility rules from that selector', () => {
    const mixed = makeState({
      listeningHistory: [
        makeEntry({ id: 'kids', provider: 'youtube', madeForKids: true, daysAgo: 0 }),
        makeEntry({ id: 'blocked', provider: 'youtube', embeddable: false, daysAgo: 1 }),
        makeEntry({ id: 'expired', provider: 'youtube', daysAgo: 2, storedDaysAgo: 45 }),
        makeEntry({ id: 'ok', provider: 'youtube', daysAgo: 3 }),
        makeEntry({ id: 'song', daysAgo: 4 }),
      ],
    })
    expect(recentlyPlayedSuggestions(mixed, NOW).map((entry) => entry.providerItemId)).toEqual([
      'ok',
      'song',
    ])
  })

  it('is empty for a browser with no listening history', () => {
    expect(recentlyPlayedSuggestions(makeState(), NOW)).toEqual([])
  })
})
