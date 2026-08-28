import { create } from 'zustand'
import {
  clearListeningHistory as clearListening,
  clearSearchHistory as clearSearches,
  markSearchResultPlayed,
  pruneHistory,
  recordPlaySession,
  recordSubmittedSearch,
  removeSubmittedSearch,
  resetRecommendations as resetProfileSignals,
  touchReplayStart,
} from './history'
import type { PlaySession, PlayedItem, SubmittedSearch } from './history'
import { buildProfile, emptyProfile } from './profile'
import type { PersonalizationProfile } from './profile'
import {
  clearStoredState,
  isStorageAvailable,
  readState,
  writeState,
} from './storage'
import { createEmptyState } from './types'
import type { ConsentChoice, PersonalizationState, StorageStatus } from './types'
import { purgeExpiredYouTubeFromState } from './youtube-retention'

/**
 * The single React-facing entry point for personalization.
 *
 * Two disciplines are enforced here rather than left to callers:
 *
 * **Writes happen on meaningful events only.** `commit` is called when a listen
 * qualifies, completes, is skipped or replayed, and when a search is submitted —
 * never on a time update. Playback fires `timeupdate` roughly four times a
 * second; serializing the whole history on each of those would be the one way to
 * make a local-only feature feel slow (STEP 26).
 *
 * **The profile is derived, cached and invalidated by `updatedAt`.** It is
 * recomputed exactly once per state change and shared by every subscriber, so a
 * page with four personalized shelves still folds the history once.
 *
 * When consent is not `granted`, every recording action is a no-op that returns
 * without touching storage. That is STEP 18: search, playback, the queue and the
 * providers all keep working, and nothing is written.
 */

export interface PersonalizationStoreState {
  state: PersonalizationState
  profile: PersonalizationProfile
  status: StorageStatus
  /** True once the persisted state has been read. */
  hydrated: boolean
  /** True when a real write can be performed. */
  storageAvailable: boolean

  hydrate: () => void
  setConsent: (choice: ConsentChoice) => void
  markPromptSeen: () => void
  recordSession: (session: PlaySession) => void
  /**
   * Playback of an item already in history has started: move it to the front of
   * Recently Played now, without crediting a listen.
   *
   * A no-op for an item that is not already in history.
   */
  noteReplayStarted: (item: PlayedItem) => void
  recordSearch: (submitted: SubmittedSearch) => void
  markPlayedFromSearch: (query: string) => void
  /** Removes one submitted search, by its normalized form. */
  removeSearch: (normalizedQuery: string) => void
  dismissItem: (id: string) => void
  clearListeningHistory: () => void
  clearSearchHistory: () => void
  resetRecommendations: () => void
  purgeExpired: () => void
  /** Test seam: replaces state wholesale without persisting. */
  replaceState: (state: PersonalizationState) => void
}

function derive(state: PersonalizationState, enabled: boolean): PersonalizationProfile {
  return enabled ? buildProfile(state) : emptyProfile(state.updatedAt)
}

export const usePersonalizationStore = create<PersonalizationStoreState>((set, get) => {
  /**
   * Applies a reducer, recomputes the profile and persists — in that order, and
   * only when personalization is on. A failed write flips `storageAvailable`
   * off rather than throwing or retrying.
   */
  const commit = (
    reducer: (state: PersonalizationState) => PersonalizationState,
    options: { persist?: boolean; requireConsent?: boolean } = {},
  ) => {
    const { persist = true, requireConsent = true } = options
    const current = get()
    if (requireConsent && current.state.consent !== 'granted') return

    const next = reducer(current.state)
    if (next === current.state) return

    const enabled = next.consent === 'granted'
    let status = current.status
    let storageAvailable = current.storageAvailable

    if (persist) {
      const outcome = writeState(next)
      if (outcome === 'unavailable') {
        storageAvailable = false
        status = 'unavailable'
      } else if (status === 'unavailable') {
        storageAvailable = true
        status = 'ok'
      }
    }

    set({ state: next, profile: derive(next, enabled), status, storageAvailable })
  }

  return {
    state: createEmptyState(),
    profile: emptyProfile(),
    status: 'ok',
    hydrated: false,
    storageAvailable: false,

    hydrate: () => {
      const { state, status } = readState()
      // The retention sweep runs before anything is rendered, so an expired
      // YouTube row can never reach a shelf even for one frame.
      const purged = purgeExpiredYouTubeFromState(state)
      const pruned =
        purged.listeningHistory.length === state.listeningHistory.length
          ? purged
          : { ...purged, listeningHistory: pruneHistory(purged.listeningHistory) }

      const storageAvailable = status !== 'unavailable' && isStorageAvailable()
      const enabled = pruned.consent === 'granted'

      set({
        state: pruned,
        profile: derive(pruned, enabled),
        status,
        hydrated: true,
        storageAvailable,
      })

      // Persist the purge so the expired rows are gone from disk too, not just
      // from memory.
      if (enabled && storageAvailable && pruned !== state) writeState(pruned)
    },

    setConsent: (choice) => {
      const now = Date.now()
      const current = get().state
      // Declining is not merely "stop recording": anything already gathered is
      // removed, because keeping it would be personalization without consent.
      const next: PersonalizationState =
        choice === 'granted'
          ? {
              ...current,
              consent: 'granted',
              consentUpdatedAt: now,
              preferences: { ...current.preferences, promptSeen: true },
              updatedAt: now,
            }
          : {
              ...createEmptyState(now),
              consent: choice,
              consentUpdatedAt: now,
              preferences: { promptSeen: true },
            }

      if (choice === 'granted') {
        const outcome = writeState(next)
        set({
          state: next,
          profile: derive(next, true),
          storageAvailable: outcome === 'written',
          status: outcome === 'written' ? 'ok' : 'unavailable',
        })
        return
      }

      // A refusal is itself worth remembering, so the prompt does not return on
      // every visit — but it is the only thing left behind.
      const outcome = writeState(next)
      set({
        state: next,
        profile: emptyProfile(now),
        storageAvailable: outcome === 'written',
        status: outcome === 'written' ? 'ok' : 'unavailable',
      })
    },

    markPromptSeen: () =>
      commit(
        (state) =>
          state.preferences.promptSeen
            ? state
            : { ...state, preferences: { ...state.preferences, promptSeen: true } },
        { requireConsent: false },
      ),

    recordSession: (session) =>
      commit((state) => {
        const now = Date.now()
        // A search that led to a real listen is stronger evidence than one that
        // was only typed, so the two facts are recorded together rather than
        // needing a second write.
        const searchHistory =
          session.item.context === 'search' && session.item.searchQuery
            ? markSearchResultPlayed(state.searchHistory, session.item.searchQuery)
            : state.searchHistory
        return {
          ...state,
          listeningHistory: recordPlaySession(state.listeningHistory, session, now),
          searchHistory,
          updatedAt: now,
        }
      }),

    noteReplayStarted: (item) =>
      commit((state) => {
        const listeningHistory = touchReplayStart(state.listeningHistory, item)
        return listeningHistory === state.listeningHistory
          ? state
          : { ...state, listeningHistory, updatedAt: Date.now() }
      }),

    recordSearch: (submitted) =>
      commit((state) => ({
        ...state,
        searchHistory: recordSubmittedSearch(state.searchHistory, submitted),
        updatedAt: Date.now(),
      })),

    markPlayedFromSearch: (query) =>
      commit((state) => {
        const searchHistory = markSearchResultPlayed(state.searchHistory, query)
        return searchHistory === state.searchHistory
          ? state
          : { ...state, searchHistory, updatedAt: Date.now() }
      }),

    removeSearch: (normalizedQuery) =>
      commit((state) => {
        const searchHistory = removeSubmittedSearch(state.searchHistory, normalizedQuery)
        return searchHistory === state.searchHistory
          ? state
          : { ...state, searchHistory, updatedAt: Date.now() }
      }),

    dismissItem: (id) =>
      commit((state) =>
        state.dismissedItems.includes(id)
          ? state
          : { ...state, dismissedItems: [id, ...state.dismissedItems], updatedAt: Date.now() },
      ),

    clearListeningHistory: () => commit((state) => clearListening(state)),
    clearSearchHistory: () => commit((state) => clearSearches(state)),
    resetRecommendations: () => commit((state) => resetProfileSignals(state)),

    purgeExpired: () =>
      commit((state) => purgeExpiredYouTubeFromState(state), { requireConsent: false }),

    replaceState: (state) => set({ state, profile: derive(state, state.consent === 'granted') }),
  }
})

/* --------------------------------------------------------------------------
   Imperative helpers, for code outside React
   -------------------------------------------------------------------------- */

export function personalizationEnabled(): boolean {
  return usePersonalizationStore.getState().state.consent === 'granted'
}

export function recordPlaySessionNow(session: PlaySession): void {
  usePersonalizationStore.getState().recordSession(session)
}

export function recordSubmittedSearchNow(submitted: SubmittedSearch): void {
  usePersonalizationStore.getState().recordSearch(submitted)
}

/** Wipes both memory and disk. Used by tests and by the reset controls. */
export function resetPersonalizationForTests(): void {
  clearStoredState()
  const empty = createEmptyState()
  usePersonalizationStore.setState({
    state: empty,
    profile: emptyProfile(empty.updatedAt),
    status: 'ok',
    hydrated: false,
    storageAvailable: false,
  })
}
