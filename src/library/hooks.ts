import { useMemo } from 'react'
import {
  coverArtFor,
  explicitIntentFrom,
  likedTracks,
  playlistSummaries,
  playlistTracks,
  summarizePlaylist,
} from './selectors'
import type { CoverArt, LikedSort, PlaylistSort, PlaylistSummary } from './selectors'
import { useLibraryStore } from './store'
import type { LibraryState, LibraryTrackRef, Playlist } from './types'

/**
 * React bindings for the library.
 *
 * Every hook here is memoized on the store's state identity, which only changes
 * when a mutation actually commits. That is the whole performance contract of
 * this phase: the heart on a search row, the playlist menu and the library page
 * all read the same store, and a `timeupdate` at 4 Hz or a keystroke in the
 * search field must not re-sort a thousand liked songs (agents/41 →
 * "Use selectors/memoization").
 *
 * Membership lookups additionally share one derived `Set` per state, cached at
 * module level, so a page of fifty rows performs one pass over the liked list
 * rather than fifty.
 */

/** Caches one derivation per state instance. Recomputes on the next mutation. */
function memoOne<T>(derive: (state: LibraryState) => T): (state: LibraryState) => T {
  let lastInput: LibraryState | null = null
  let lastOutput: T
  return (state) => {
    if (state !== lastInput) {
      lastInput = state
      lastOutput = derive(state)
    }
    return lastOutput
  }
}

const likedKeySet = memoOne((state) => new Set(state.likedTrackKeys))

const playlistedKeySet = memoOne((state) => {
  const keys = new Set<string>()
  for (const playlist of Object.values(state.playlists)) {
    for (const key of playlist.itemKeys) keys.add(key)
  }
  return keys
})

const hiddenKeySet = memoOne((state) => new Set(state.hiddenRecommendationKeys))

export const libraryLikedKeys = likedKeySet
export const libraryPlaylistedKeys = playlistedKeySet
export const libraryHiddenKeys = hiddenKeySet

/* --------------------------------------------------------------------------
   Membership
   -------------------------------------------------------------------------- */

/** True while this exact provider item is in Liked Songs. */
export function useIsLiked(key: string): boolean {
  return useLibraryStore((store) => likedKeySet(store.state).has(key))
}

/** True while this exact provider item sits in at least one playlist. */
export function useIsInAnyPlaylist(key: string): boolean {
  return useLibraryStore((store) => playlistedKeySet(store.state).has(key))
}

export function useHiddenKeys(): ReadonlySet<string> {
  return useLibraryStore((store) => hiddenKeySet(store.state))
}

export function useIsHidden(key: string): boolean {
  return useLibraryStore((store) => hiddenKeySet(store.state).has(key))
}

/* --------------------------------------------------------------------------
   Collections
   -------------------------------------------------------------------------- */

export function useLibraryState(): LibraryState {
  return useLibraryStore((store) => store.state)
}

export function useLikedTracks(sort: LikedSort = 'recent'): LibraryTrackRef[] {
  const state = useLibraryState()
  return useMemo(() => likedTracks(state, sort), [state, sort])
}

export function useLikedCount(): number {
  return useLibraryStore((store) => store.state.likedTrackKeys.length)
}

export function usePlaylistSummaries(sort: PlaylistSort = 'updated'): PlaylistSummary[] {
  const state = useLibraryState()
  return useMemo(() => playlistSummaries(state, sort), [state, sort])
}

export function usePlaylist(playlistId: string | undefined): Playlist | null {
  return useLibraryStore((store) => (playlistId ? (store.state.playlists[playlistId] ?? null) : null))
}

export function usePlaylistTracks(playlistId: string | undefined): LibraryTrackRef[] {
  const state = useLibraryState()
  return useMemo(() => (playlistId ? playlistTracks(state, playlistId) : []), [state, playlistId])
}

export function usePlaylistSummary(playlistId: string | undefined): PlaylistSummary | null {
  const state = useLibraryState()
  return useMemo(() => {
    if (!playlistId) return null
    const playlist = state.playlists[playlistId]
    return playlist ? summarizePlaylist(state, playlist) : null
  }, [state, playlistId])
}

/** Cover artwork for an arbitrary list of references, e.g. Liked Songs. */
export function useCoverArt(refs: readonly LibraryTrackRef[]): CoverArt {
  return useMemo(() => coverArtFor(refs), [refs])
}

/* --------------------------------------------------------------------------
   Status
   -------------------------------------------------------------------------- */

export interface LibraryStatus {
  hydrated: boolean
  storageAvailable: boolean
  /** True when the library is running in memory and will not survive a reload. */
  ephemeral: boolean
}

export function useLibraryStatus(): LibraryStatus {
  const hydrated = useLibraryStore((store) => store.hydrated)
  const storageAvailable = useLibraryStore((store) => store.storageAvailable)
  return { hydrated, storageAvailable, ephemeral: hydrated && !storageAvailable }
}

/** The library's contribution to recommendations, memoized per state. */
export const libraryExplicitIntent = memoOne(explicitIntentFrom)
