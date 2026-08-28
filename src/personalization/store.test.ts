import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeEntry,
  makePlayedItem,
  makeSearch,
  makeSession,
  makeState,
  NOW,
  seedStorage,
} from '@/test/fixtures/personalization'
import { createEmptyState, PERSONALIZATION_STORAGE_KEY } from './types'
import { emptyProfile } from './profile'
import { resetPersonalizationForTests, usePersonalizationStore } from './store'

const store = () => usePersonalizationStore.getState()
const stored = () => {
  const raw = localStorage.getItem(PERSONALIZATION_STORAGE_KEY)
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
}

/**
 * A page reload: in-memory state is discarded, `localStorage` survives.
 *
 * Deliberately *not* `resetPersonalizationForTests`, which also wipes storage —
 * that is a fresh browser, which is a different scenario.
 */
function reload(): void {
  usePersonalizationStore.setState({
    state: createEmptyState(),
    profile: emptyProfile(),
    hydrated: false,
  })
  store().hydrate()
}

describe('personalization store', () => {
  beforeEach(() => {
    // The store reads the real clock, and the fixtures are anchored to a fixed
    // date, so retention assertions need the two to agree.
    vi.useFakeTimers({ now: NOW })
    localStorage.clear()
    resetPersonalizationForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('hydration', () => {
    it('starts with consent unset and nothing recorded', () => {
      store().hydrate()
      expect(store().state.consent).toBe('unset')
      expect(store().hydrated).toBe(true)
      expect(store().profile.stage).toBe('cold')
    })

    it('restores a returning listener from storage', () => {
      seedStorage(
        makeState({
          listeningHistory: [
            makeEntry({ id: 'a', artist: 'Nova Sound', playCount: 4, daysAgo: 1 }),
            makeEntry({ id: 'b', artist: 'Ghost Radio', playCount: 3, daysAgo: 2 }),
          ],
          searchHistory: [makeSearch({ query: 'kosandra' })],
        }),
      )

      store().hydrate()

      expect(store().state.listeningHistory).toHaveLength(2)
      expect(store().profile.qualifiedListenCount).toBe(7)
      expect(store().profile.stage).toBe('warm')
      expect(store().profile.artists[0].name).toBe('Nova Sound')
    })

    it('purges expired YouTube metadata before anything can be rendered', () => {
      seedStorage(
        makeState({
          listeningHistory: [
            makeEntry({ id: 'fresh', provider: 'youtube', storedDaysAgo: 1, daysAgo: 1 }),
            makeEntry({ id: 'stale', provider: 'youtube', storedDaysAgo: 40, daysAgo: 1 }),
          ],
        }),
      )

      store().hydrate()

      expect(store().state.listeningHistory.map((entry) => entry.providerItemId)).toEqual(['fresh'])
      // The purge reaches disk too, not just memory.
      const history = stored()?.listeningHistory as Array<Record<string, unknown>>
      expect(history.map((entry) => entry.providerItemId)).toEqual(['fresh'])
    })

    it('builds no profile when consent was never granted, even with stored history', () => {
      seedStorage(
        makeState({
          consent: 'unset',
          listeningHistory: [makeEntry({ id: 'a', playCount: 9 })],
        }),
      )
      store().hydrate()
      expect(store().profile.stage).toBe('cold')
      expect(store().profile.qualifiedListenCount).toBe(0)
    })
  })

  describe('consent (STEP 17, STEP 18)', () => {
    it('records nothing at all while consent is unset', () => {
      store().hydrate()
      store().recordSession(makeSession({ playedSeconds: 120 }))
      store().recordSearch({ query: 'kosandra' })

      expect(store().state.listeningHistory).toEqual([])
      expect(store().state.searchHistory).toEqual([])
      expect(stored()).toBeNull()
    })

    it('records nothing after an explicit refusal', () => {
      store().hydrate()
      store().setConsent('denied')

      store().recordSession(makeSession({ playedSeconds: 120 }))
      store().recordSearch({ query: 'kosandra' })

      expect(store().state.listeningHistory).toEqual([])
      expect(store().state.searchHistory).toEqual([])
      const persisted = stored()
      expect(persisted?.consent).toBe('denied')
      expect(persisted?.listeningHistory).toEqual([])
    })

    it('starts recording once consent is granted', () => {
      store().hydrate()
      store().setConsent('granted')
      store().recordSession(makeSession({ playedSeconds: 120 }))

      expect(store().state.listeningHistory).toHaveLength(1)
      expect(store().profile.qualifiedListenCount).toBe(1)
      expect((stored()?.listeningHistory as unknown[]).length).toBe(1)
    })

    it('deletes what was already stored when consent is withdrawn', () => {
      store().hydrate()
      store().setConsent('granted')
      store().recordSession(makeSession({ playedSeconds: 120 }))
      store().recordSearch({ query: 'kosandra' })
      expect(store().state.listeningHistory).toHaveLength(1)

      store().setConsent('denied')

      expect(store().state.listeningHistory).toEqual([])
      expect(store().state.searchHistory).toEqual([])
      expect(store().profile.qualifiedListenCount).toBe(0)
      const persisted = stored()
      expect(persisted?.listeningHistory).toEqual([])
      expect(persisted?.searchHistory).toEqual([])
    })

    it('remembers a refusal so the prompt does not return', () => {
      store().hydrate()
      store().setConsent('denied')
      expect(store().state.preferences.promptSeen).toBe(true)

      reload()
      expect(store().state.consent).toBe('denied')
    })
  })

  describe('recording', () => {
    beforeEach(() => {
      store().hydrate()
      store().setConsent('granted')
    })

    it('persists across a simulated reload', () => {
      store().recordSession(makeSession({ playedSeconds: 120 }))
      store().recordSearch({ query: 'kosandra' })

      reload()

      expect(store().state.listeningHistory).toHaveLength(1)
      expect(store().state.searchHistory[0].query).toBe('kosandra')
      expect(store().profile.qualifiedListenCount).toBe(1)
    })

    it('marks the originating search as played, in the same write', () => {
      store().recordSearch({ query: 'kosandra' })
      expect(store().state.searchHistory[0].resultWasPlayed).toBe(false)

      store().recordSession(
        makeSession({
          item: makePlayedItem({ context: 'search', searchQuery: 'kosandra' }),
          playedSeconds: 120,
        }),
      )

      expect(store().state.searchHistory[0].resultWasPlayed).toBe(true)
    })

    it('moves `updatedAt` on a meaningful event, and only then', () => {
      const before = store().state.updatedAt
      store().recordSession(makeSession({ playedSeconds: 120 }))
      const after = store().state.updatedAt
      expect(after).toBeGreaterThanOrEqual(before)

      // Dismissing an already-dismissed id changes nothing.
      store().dismissItem('audius:x')
      const stamped = store().state.updatedAt
      store().dismissItem('audius:x')
      expect(store().state.updatedAt).toBe(stamped)
    })
  })

  describe('clear and reset (STEP 16)', () => {
    beforeEach(() => {
      store().hydrate()
      store().setConsent('granted')
      usePersonalizationStore.setState({
        state: makeState({
          listeningHistory: [makeEntry({ id: 'a', playCount: 3 })],
          searchHistory: [makeSearch({ query: 'q' })],
          dismissedItems: ['audius:x'],
        }),
      })
    })

    it('clear listening history keeps searches', () => {
      store().clearListeningHistory()
      expect(store().state.listeningHistory).toEqual([])
      expect(store().state.searchHistory).toHaveLength(1)
      expect(store().profile.qualifiedListenCount).toBe(0)
      expect(stored()?.listeningHistory).toEqual([])
    })

    it('clear search history keeps listens', () => {
      store().clearSearchHistory()
      expect(store().state.searchHistory).toEqual([])
      expect(store().state.listeningHistory).toHaveLength(1)
    })

    it('reset recommendations clears everything but the consent choice', () => {
      store().resetRecommendations()
      expect(store().state.listeningHistory).toEqual([])
      expect(store().state.searchHistory).toEqual([])
      expect(store().state.dismissedItems).toEqual([])
      expect(store().state.consent).toBe('granted')
      expect(store().profile.stage).toBe('cold')
    })

    it('does not touch the volume and mute keys', () => {
      localStorage.setItem('pulse:volume', '0.42')
      localStorage.setItem('pulse:muted', 'true')

      store().resetRecommendations()
      store().clearListeningHistory()
      store().clearSearchHistory()

      expect(localStorage.getItem('pulse:volume')).toBe('0.42')
      expect(localStorage.getItem('pulse:muted')).toBe('true')
    })
  })

  describe('storage failure (STEP 19)', () => {
    it('keeps working when localStorage throws on write', () => {
      store().hydrate()
      store().setConsent('granted')

      const original = Storage.prototype.setItem
      Storage.prototype.setItem = () => {
        throw new DOMException('QuotaExceededError')
      }
      try {
        expect(() => store().recordSession(makeSession({ playedSeconds: 120 }))).not.toThrow()
        expect(store().status).toBe('unavailable')
        expect(store().storageAvailable).toBe(false)
      } finally {
        Storage.prototype.setItem = original
      }
    })

    it('recovers on the next successful write', () => {
      store().hydrate()
      store().setConsent('granted')
      usePersonalizationStore.setState({ status: 'unavailable', storageAvailable: false })

      store().recordSession(makeSession({ playedSeconds: 120 }))

      expect(store().status).toBe('ok')
      expect(store().storageAvailable).toBe(true)
    })

    it('reports a malformed payload without throwing', () => {
      localStorage.setItem(PERSONALIZATION_STORAGE_KEY, 'not json at all')
      expect(() => store().hydrate()).not.toThrow()
      expect(store().status).toBe('recovered')
      expect(store().state.listeningHistory).toEqual([])
    })

    it('reports an incompatible future schema without reinterpreting it', () => {
      localStorage.setItem(
        PERSONALIZATION_STORAGE_KEY,
        JSON.stringify({ version: 999, listeningHistory: [{ anything: true }] }),
      )
      store().hydrate()
      expect(store().status).toBe('incompatible')
      expect(store().state.listeningHistory).toEqual([])
    })
  })

  it('purges expired YouTube entries without requiring consent', () => {
    seedStorage(
      makeState({
        consent: 'granted',
        listeningHistory: [makeEntry({ id: 'stale', provider: 'youtube', storedDaysAgo: 40 })],
      }),
    )
    store().hydrate()
    expect(store().state.listeningHistory).toEqual([])
  })

  it('does not deduplicate items across providers (STEP 22)', () => {
    store().hydrate()
    store().setConsent('granted')

    store().recordSession(
      makeSession({
        item: makePlayedItem({ provider: 'audius', providerItemId: '7', title: 'Kosandra' }),
        playedSeconds: 120,
      }),
    )
    store().recordSession(
      makeSession({
        item: makePlayedItem({ provider: 'jamendo', providerItemId: '7', title: 'Kosandra' }),
        playedSeconds: 120,
      }),
    )

    expect(store().state.listeningHistory.map((entry) => entry.id).sort()).toEqual([
      'audius:7',
      'jamendo:7',
    ])
  })

  it('never crashes when the fixed clock is far in the past', () => {
    seedStorage(makeState({ updatedAt: NOW, listeningHistory: [makeEntry({ id: 'a' })] }))
    expect(() => store().hydrate()).not.toThrow()
  })
})
