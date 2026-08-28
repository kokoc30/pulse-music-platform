import { describe, expect, it } from 'vitest'
import { DAY, makeEntry, makePlayedItem, makeSearch, makeSession, makeState, NOW } from '@/test/fixtures/personalization'
import { MAX_HISTORY_DAYS, MAX_HISTORY_ITEMS, MAX_SEARCH_HISTORY } from './config'
import {
  clearListeningHistory,
  clearSearchHistory,
  dayKey,
  markSearchResultPlayed,
  pruneHistory,
  qualifiedListenCount,
  recentlyPlayed,
  recordPlaySession,
  recordSubmittedSearch,
  resetRecommendations,
} from './history'

describe('listening history', () => {
  describe('recording a play', () => {
    it('creates one row for a qualified listen', () => {
      const history = recordPlaySession([], makeSession({ playedSeconds: 60 }), NOW)

      expect(history).toHaveLength(1)
      expect(history[0].id).toBe('audius:trk1')
      expect(history[0].playCount).toBe(1)
      expect(history[0].qualifiedAt).toBe(NOW)
      expect(history[0].playedSeconds).toBe(60)
    })

    it('records an unqualified play without counting it as a listen', () => {
      const history = recordPlaySession([], makeSession({ playedSeconds: 5 }), NOW)

      expect(history).toHaveLength(1)
      expect(history[0].playCount).toBe(0)
      expect(history[0].qualifiedAt).toBeNull()
      expect(history[0].skipCount).toBe(1)
    })

    it('increments the play count on a genuine repeat', () => {
      const first = recordPlaySession([], makeSession({ playedSeconds: 60 }), NOW)
      const second = recordPlaySession(first, makeSession({ playedSeconds: 60 }), NOW + DAY)

      expect(second).toHaveLength(1)
      expect(second[0].playCount).toBe(2)
      expect(second[0].playedSeconds).toBe(120)
      // The first qualification timestamp is the one that is kept.
      expect(second[0].qualifiedAt).toBe(NOW)
    })

    it('does not count the same play twice when it is committed twice', () => {
      const item = makePlayedItem({ durationSeconds: 240 })
      const atQualification = recordPlaySession(
        [],
        makeSession({ item, playedSeconds: 30, creditedSeconds: 0 }),
        NOW,
      )
      const atEnd = recordPlaySession(
        atQualification,
        makeSession({ item, playedSeconds: 240, creditedSeconds: 30, completed: true }),
        NOW,
      )

      expect(atEnd[0].playCount).toBe(1)
      expect(atEnd[0].playedSeconds).toBe(240)
      expect(atEnd[0].completionRatio).toBe(1)
    })

    it('does not count a finished short item as a skip', () => {
      const history = recordPlaySession(
        [],
        makeSession({
          item: makePlayedItem({ durationSeconds: 6 }),
          playedSeconds: 6,
          completed: true,
        }),
        NOW,
      )
      expect(history[0].skipCount).toBe(0)
      expect(history[0].completionRatio).toBe(1)
    })

    it('records distinct days only for qualified plays', () => {
      const day1 = recordPlaySession([], makeSession({ playedSeconds: 60, endedAt: NOW }), NOW)
      const day2 = recordPlaySession(
        day1,
        makeSession({ playedSeconds: 60, endedAt: NOW + 3 * DAY }),
        NOW + 3 * DAY,
      )
      // A three-second play on a fourth day adds no day, because it is not a
      // listen.
      const brief = recordPlaySession(
        day2,
        makeSession({ playedSeconds: 3, endedAt: NOW + 6 * DAY }),
        NOW + 6 * DAY,
      )

      expect(new Set(day1[0].playedDays).size).toBe(1)
      expect(new Set(day2[0].playedDays).size).toBe(2)
      expect(new Set(brief[0].playedDays).size).toBe(2)
    })

    it('keeps the best completion ratio ever observed', () => {
      const strong = recordPlaySession(
        [],
        makeSession({ playedSeconds: 220, reachedSeconds: 220 }),
        NOW,
      )
      const weak = recordPlaySession(
        strong,
        makeSession({ playedSeconds: 40, reachedSeconds: 40 }),
        NOW,
      )
      expect(weak[0].completionRatio).toBeCloseTo(220 / 240, 3)
    })

    it('keeps the original discovery query rather than overwriting it', () => {
      const discovered = recordPlaySession(
        [],
        makeSession({
          item: makePlayedItem({ context: 'search', searchQuery: 'kosandra' }),
          playedSeconds: 60,
        }),
        NOW,
      )
      const replayed = recordPlaySession(
        discovered,
        makeSession({ item: makePlayedItem({ context: 'recent' }), playedSeconds: 60 }),
        NOW,
      )
      expect(replayed[0].searchQuery).toBe('kosandra')
    })

    it('moves a replayed item to the front of the history', () => {
      let history = recordPlaySession(
        [],
        makeSession({ item: makePlayedItem({ providerItemId: 'a' }), endedAt: NOW - 2 * DAY }),
        NOW - 2 * DAY,
      )
      history = recordPlaySession(
        history,
        makeSession({ item: makePlayedItem({ providerItemId: 'b' }), endedAt: NOW - DAY }),
        NOW - DAY,
      )
      expect(history.map((entry) => entry.providerItemId)).toEqual(['b', 'a'])

      history = recordPlaySession(
        history,
        makeSession({ item: makePlayedItem({ providerItemId: 'a' }), endedAt: NOW }),
        NOW,
      )

      expect(history.map((entry) => entry.providerItemId)).toEqual(['a', 'b'])
    })
  })

  describe('deduplication is provider-scoped (STEP 22)', () => {
    it('keeps two recordings of the same song from different catalogues', () => {
      let history = recordPlaySession(
        [],
        makeSession({ item: makePlayedItem({ provider: 'audius', providerItemId: '1' }) }),
        NOW,
      )
      history = recordPlaySession(
        history,
        makeSession({
          item: makePlayedItem({ provider: 'jamendo', providerItemId: '1' }),
        }),
        NOW,
      )

      expect(history).toHaveLength(2)
      expect(history.map((entry) => entry.id).sort()).toEqual(['audius:1', 'jamendo:1'])
    })

    it('never merges two items on title similarity alone', () => {
      let history = recordPlaySession(
        [],
        makeSession({
          item: makePlayedItem({ providerItemId: 'x', title: 'Kosandra' }),
        }),
        NOW,
      )
      history = recordPlaySession(
        history,
        makeSession({
          item: makePlayedItem({ providerItemId: 'y', title: 'Kosandra' }),
        }),
        NOW,
      )
      expect(history).toHaveLength(2)
    })
  })

  describe('retention', () => {
    it('drops rows older than the age cap', () => {
      const history = [
        makeEntry({ id: 'fresh', daysAgo: 10 }),
        makeEntry({ id: 'stale', daysAgo: MAX_HISTORY_DAYS + 1 }),
      ]
      expect(pruneHistory(history, NOW).map((entry) => entry.providerItemId)).toEqual(['fresh'])
    })

    it('trims to the item cap, dropping the least recent', () => {
      const history = Array.from({ length: MAX_HISTORY_ITEMS + 5 }, (_, index) =>
        makeEntry({ id: `t${index}`, daysAgo: index * 0.1 }),
      )
      const pruned = pruneHistory(history, NOW)
      expect(pruned).toHaveLength(MAX_HISTORY_ITEMS)
      expect(pruned[0].providerItemId).toBe('t0')
      expect(pruned.at(-1)?.providerItemId).toBe(`t${MAX_HISTORY_ITEMS - 1}`)
    })

    it('orders recently played most-recent-first', () => {
      const history = [
        makeEntry({ id: 'old', daysAgo: 5 }),
        makeEntry({ id: 'new', daysAgo: 0 }),
        makeEntry({ id: 'mid', daysAgo: 2 }),
      ]
      expect(recentlyPlayed(history, NOW).map((entry) => entry.providerItemId)).toEqual([
        'new',
        'mid',
        'old',
      ])
    })

    it('counts qualified listens across every row', () => {
      expect(
        qualifiedListenCount([
          makeEntry({ id: 'a', playCount: 3 }),
          makeEntry({ id: 'b', playCount: 2 }),
          makeEntry({ id: 'c', playCount: 0 }),
        ]),
      ).toBe(5)
    })
  })

  it('produces a stable local day key', () => {
    expect(dayKey(Date.parse('2026-06-15T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dayKey(NOW)).toBe(dayKey(NOW + 1000))
  })
})

describe('search history', () => {
  it('records a submitted query', () => {
    const searches = recordSubmittedSearch([], { query: 'kosandra' }, NOW)
    expect(searches).toHaveLength(1)
    expect(searches[0].query).toBe('kosandra')
    expect(searches[0].submitCount).toBe(1)
    expect(searches[0].script).toBe('latin')
  })

  it('deduplicates an identical normalized query and counts the repeat', () => {
    let searches = recordSubmittedSearch([], { query: 'Kosandra' }, NOW)
    searches = recordSubmittedSearch(searches, { query: '  kosandra!  ' }, NOW + 1000)

    expect(searches).toHaveLength(1)
    expect(searches[0].submitCount).toBe(2)
    expect(searches[0].submittedAt).toBe(NOW + 1000)
  })

  it('ignores an empty or whitespace-only submission', () => {
    expect(recordSubmittedSearch([], { query: '   ' }, NOW)).toEqual([])
    expect(recordSubmittedSearch([], { query: '' }, NOW)).toEqual([])
  })

  it('caps the list and keeps the most recent', () => {
    let searches: ReturnType<typeof recordSubmittedSearch> = []
    for (let index = 0; index < MAX_SEARCH_HISTORY + 10; index += 1) {
      searches = recordSubmittedSearch(searches, { query: `query ${index}` }, NOW + index)
    }
    expect(searches).toHaveLength(MAX_SEARCH_HISTORY)
    expect(searches[0].query).toBe(`query ${MAX_SEARCH_HISTORY + 9}`)
  })

  it('merges the providers that answered across repeats', () => {
    let searches = recordSubmittedSearch([], { query: 'night', providers: ['audius'] }, NOW)
    searches = recordSubmittedSearch(searches, { query: 'night', providers: ['jamendo'] }, NOW)
    expect(searches[0].providers.sort()).toEqual(['audius', 'jamendo'])
  })

  describe('non-Latin queries survive intact', () => {
    const cases: Array<[string, string, string]> = [
      ['Arabic', 'سارية السواس', 'arabic'],
      ['Armenian', 'Արամ Ասատրյան', 'armenian'],
      ['Cyrillic', 'Кино Группа крови', 'cyrillic'],
      ['Latin', 'Miyagi Andy Panda', 'latin'],
    ]

    for (const [label, query, script] of cases) {
      it(`stores a ${label} query byte-for-byte and tags its script`, () => {
        const searches = recordSubmittedSearch([], { query }, NOW)
        expect(searches[0].query).toBe(query)
        expect(searches[0].script).toBe(script)
      })
    }

    it('does not collapse a Cyrillic query into a Latin one', () => {
      let searches = recordSubmittedSearch([], { query: 'кассандра' }, NOW)
      searches = recordSubmittedSearch(searches, { query: 'kassandra' }, NOW)
      expect(searches).toHaveLength(2)
    })
  })

  it('marks a query as having produced a play', () => {
    const searches = recordSubmittedSearch([], { query: 'kosandra' }, NOW)
    const marked = markSearchResultPlayed(searches, 'Kosandra')
    expect(marked[0].resultWasPlayed).toBe(true)
    // Idempotent: marking again returns the same array instance.
    expect(markSearchResultPlayed(marked, 'kosandra')).toBe(marked)
  })
})

describe('clear operations', () => {
  const populated = makeState({
    listeningHistory: [makeEntry({ id: 'a' })],
    searchHistory: [makeSearch({ query: 'q' })],
    dismissedItems: ['audius:x'],
  })

  it('clear listening history removes listens and dismissals, keeping searches', () => {
    const next = clearListeningHistory(populated, NOW)
    expect(next.listeningHistory).toEqual([])
    expect(next.dismissedItems).toEqual([])
    expect(next.searchHistory).toHaveLength(1)
    expect(next.consent).toBe('granted')
  })

  it('clear search history removes searches, keeping listens', () => {
    const next = clearSearchHistory(populated, NOW)
    expect(next.searchHistory).toEqual([])
    expect(next.listeningHistory).toHaveLength(1)
  })

  it('reset recommendations clears every signal but keeps the consent choice', () => {
    const next = resetRecommendations(populated, NOW)
    expect(next.listeningHistory).toEqual([])
    expect(next.searchHistory).toEqual([])
    expect(next.dismissedItems).toEqual([])
    expect(next.consent).toBe('granted')
    expect(next.preferences.promptSeen).toBe(true)
  })
})
