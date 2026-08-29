import { create } from 'zustand'
import {
  addTrackToPlaylist,
  collectGarbage,
  createPlaylist,
  deletePlaylist,
  hideRecommendation,
  likeTrack,
  movePlaylistItem,
  removeTrackFromPlaylist,
  renamePlaylist,
  resetHiddenRecommendations,
  setPlaylistDescription,
  toggleLike,
  unhideRecommendation,
  unlikeTrack,
} from './actions'
import type { CreatePlaylistInput, LibraryMutation } from './actions'
import { createLibraryRepository } from './storage'
import type { LibraryRepository } from './storage'
import { createEmptyLibrary } from './types'
import type {
  LibraryResult,
  LibraryState,
  LibraryStorageStatus,
  LibraryTrackRef,
} from './types'
import { purgeExpiredYouTubeFromLibrary } from './youtube-policy'

/**
 * The single React-facing entry point for the library.
 *
 * Three disciplines are enforced here rather than left to callers:
 *
 * **Components never touch storage.** No component imports IndexedDB, and none
 * imports `storage.ts`. Every mutation goes through an action on this store,
 * which applies a pure reducer and then persists — so there is exactly one place
 * where "what the visitor did" becomes "what is on disk" (agents/41 → "Do not
 * access IndexedDB directly from React components").
 *
 * **A refused mutation writes nothing.** The reducers return the same state
 * instance when they decline, and `commit` compares by identity before it
 * persists. A cap breach or a duplicate therefore cannot produce a write at all,
 * let alone a partial one.
 *
 * **The library does not depend on personalization consent.** Saving something
 * is an explicit act, not behavioural tracking, so likes and playlists work
 * identically whether personalization is on, off or never answered. What consent
 * gates is the *other* direction: whether those saves are allowed to influence
 * recommendations. That gate lives in the personalization store, which asks for
 * explicit intent only while it is enabled (agents/43 → "Consent denied").
 */

/** Notified after every committed change, so the profile can be recomputed. */
type ChangeListener = (state: LibraryState) => void

const listeners = new Set<ChangeListener>()

/** Subscribe to committed library changes. Returns an unsubscribe function. */
export function onLibraryChange(listener: ChangeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface LibraryStoreState {
  state: LibraryState
  status: LibraryStorageStatus
  /** True once the persisted library has been read. */
  hydrated: boolean
  /** True when a real, durable write can be performed. */
  storageAvailable: boolean

  hydrate: () => Promise<void>
  like: (ref: LibraryTrackRef) => LibraryResult
  unlike: (key: string) => LibraryResult
  toggleLiked: (ref: LibraryTrackRef) => LibraryResult
  createPlaylist: (input: CreatePlaylistInput) => LibraryResult
  renamePlaylist: (id: string, name: string) => LibraryResult
  describePlaylist: (id: string, description: string) => LibraryResult
  deletePlaylist: (id: string) => LibraryResult
  addToPlaylist: (id: string, ref: LibraryTrackRef) => LibraryResult
  removeFromPlaylist: (id: string, key: string) => LibraryResult
  moveInPlaylist: (id: string, from: number, to: number) => LibraryResult
  hide: (key: string) => LibraryResult
  unhide: (key: string) => LibraryResult
  resetHidden: () => LibraryResult
  /** Deletes the entire library. Nothing outside this domain is touched. */
  clearLibrary: () => Promise<void>
  /** Removes YouTube references past their retention window. */
  purgeExpired: () => void
  /** Test seam: replaces state wholesale without persisting. */
  replaceState: (state: LibraryState) => void
}

/**
 * The repository, resolved once.
 *
 * A module-level singleton rather than a store field so tests can swap it before
 * the store is first read, and so a remount cannot open a second connection.
 */
let repository: LibraryRepository = createLibraryRepository()

export function setLibraryRepository(next: LibraryRepository): void {
  repository = next
}

export function getLibraryRepository(): LibraryRepository {
  return repository
}

export const useLibraryStore = create<LibraryStoreState>((set, get) => {
  /**
   * Applies a mutation and persists it.
   *
   * The write is deliberately not awaited: a heart must fill the moment it is
   * clicked, and IndexedDB is asynchronous. Memory is the source of truth for
   * the frame; disk catches up a tick later, and a failure flips
   * `storageAvailable` off rather than throwing or retrying in a loop.
   */
  const commit = (mutate: (state: LibraryState) => LibraryMutation): LibraryResult => {
    const current = get().state
    const { state: next, result } = mutate(current)
    if (next === current) {
      // Nothing changed — a duplicate, a cap breach, or a no-op. No write.
      return result
    }

    set({ state: next })
    for (const listener of listeners) listener(next)

    void repository.write(next).then((outcome) => {
      const available = outcome === 'written'
      const store = get()
      if (store.storageAvailable === available) return
      set({
        storageAvailable: available,
        status: available ? 'ok' : 'unavailable',
      })
    })

    return result
  }

  return {
    state: createEmptyLibrary(),
    status: 'ok',
    hydrated: false,
    storageAvailable: false,

    hydrate: async () => {
      const { state, status } = await repository.read()

      // The retention sweep runs before anything is rendered, so an expired
      // YouTube reference can never reach a library row even for one frame.
      const purged = purgeExpiredYouTubeFromLibrary(state)
      // A purge can orphan references; collect them in the same pass so the
      // first write after hydration is already consistent.
      const cleaned = purged === state ? state : collectGarbage(purged)
      const storageAvailable = status === 'ok' || status === 'recovered'

      set({ state: cleaned, status, hydrated: true, storageAvailable })
      for (const listener of listeners) listener(cleaned)

      // Persist the purge so the expired rows are gone from disk too, not just
      // from memory. An `incompatible` record belongs to a newer build and is
      // deliberately left exactly as it was found.
      if (cleaned !== state && status !== 'incompatible') void repository.write(cleaned)
    },

    like: (ref) => commit((state) => likeTrack(state, ref)),
    unlike: (key) => commit((state) => unlikeTrack(state, key)),
    toggleLiked: (ref) => commit((state) => toggleLike(state, ref)),

    createPlaylist: (input) => commit((state) => createPlaylist(state, input)),
    renamePlaylist: (id, name) => commit((state) => renamePlaylist(state, id, name)),
    describePlaylist: (id, description) =>
      commit((state) => setPlaylistDescription(state, id, description)),
    deletePlaylist: (id) => commit((state) => deletePlaylist(state, id)),
    addToPlaylist: (id, ref) => commit((state) => addTrackToPlaylist(state, id, ref)),
    removeFromPlaylist: (id, key) => commit((state) => removeTrackFromPlaylist(state, id, key)),
    moveInPlaylist: (id, from, to) => commit((state) => movePlaylistItem(state, id, from, to)),

    hide: (key) => commit((state) => hideRecommendation(state, key)),
    unhide: (key) => commit((state) => unhideRecommendation(state, key)),
    resetHidden: () => commit((state) => resetHiddenRecommendations(state)),

    clearLibrary: async () => {
      const empty = createEmptyLibrary()
      set({ state: empty })
      for (const listener of listeners) listener(empty)
      await repository.clear()
    },

    purgeExpired: () =>
      commit((state) => {
        const purged = purgeExpiredYouTubeFromLibrary(state)
        return { state: purged === state ? state : collectGarbage(purged), result: { ok: true } }
      }),

    replaceState: (state) => {
      set({ state })
      for (const listener of listeners) listener(state)
    },
  }
})

/* --------------------------------------------------------------------------
   Imperative helpers, for code outside React
   -------------------------------------------------------------------------- */

export function libraryState(): LibraryState {
  return useLibraryStore.getState().state
}

/** Wipes memory and disk. Used by tests and by the Settings control. */
export function resetLibraryForTests(): void {
  const empty = createEmptyLibrary()
  useLibraryStore.setState({
    state: empty,
    status: 'ok',
    hydrated: false,
    storageAvailable: false,
  })
  void repository.clear()
  for (const listener of listeners) listener(empty)
}
