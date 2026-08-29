import { normalizePlaylistDescription, normalizePlaylistName } from './storage'
import { mergeTrackRef } from './track-ref'
import {
  LIBRARY_OK,
  MAX_HIDDEN_KEYS,
  MAX_LIBRARY_TRACKS,
  MAX_LIKED_TRACKS,
  MAX_PLAYLISTS,
  MAX_TRACKS_PER_PLAYLIST,
  libraryFailure,
} from './types'
import type { LibraryResult, LibraryState, LibraryTrackRef, Playlist } from './types'

/**
 * Pure reducers over the library state.
 *
 * Nothing here reads a clock, touches storage or knows about React: every
 * function takes the current state plus a `now` and returns the next state,
 * paired with a result the caller can turn into a toast. That is what makes the
 * caps, the duplicate rule, the reorder arithmetic and the garbage collector
 * testable without a browser, and what keeps one definition of each rule.
 *
 * **Every mutation is complete or absent.** A reducer that would breach a cap or
 * touch something that does not exist returns the *same state instance* with a
 * failure reason. The store then has nothing to write, so a refused mutation
 * cannot leave a partial record behind (agents/41 → "Transactions /
 * consistency").
 */

export interface LibraryMutation {
  state: LibraryState
  result: LibraryResult
}

const unchanged = (state: LibraryState, result: LibraryResult): LibraryMutation => ({
  state,
  result,
})

/** A Pulse-local playlist id. Never a provider id — this list exists nowhere else. */
export function createPlaylistId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `pl_${crypto.randomUUID()}`
    }
  } catch {
    // Falls through to the arithmetic id below.
  }
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/* --------------------------------------------------------------------------
   Track references
   -------------------------------------------------------------------------- */

/**
 * Writes or refreshes one track reference.
 *
 * Saving something already saved refreshes its provider display metadata and
 * keeps the original `addedAt`, because the visitor saved it once. For a YouTube
 * ref that also restarts the 30-day retention clock, which is correct: the
 * metadata was just retrieved again.
 */
function withTrackRef(
  state: LibraryState,
  ref: LibraryTrackRef,
): { tracks: Record<string, LibraryTrackRef> } | null {
  const existing = state.tracks[ref.key]
  if (existing) return { tracks: { ...state.tracks, [ref.key]: mergeTrackRef(existing, ref) } }
  if (Object.keys(state.tracks).length >= MAX_LIBRARY_TRACKS) return null
  return { tracks: { ...state.tracks, [ref.key]: ref } }
}

/**
 * Drops references nothing points at any more.
 *
 * Run after an unlike or a playlist deletion. A reference survives while Liked
 * Songs or any playlist still names it, which is what keeps "deleting a playlist
 * does not unlike its songs" true at the storage layer rather than only in the
 * UI. Hidden keys deliberately do not hold a reference alive: excluding an item
 * from a shelf needs its key, not its cover art.
 */
export function collectGarbage(state: LibraryState): LibraryState {
  const referenced = new Set<string>(state.likedTrackKeys)
  for (const playlist of Object.values(state.playlists)) {
    for (const key of playlist.itemKeys) referenced.add(key)
  }

  const keys = Object.keys(state.tracks)
  if (keys.every((key) => referenced.has(key))) return state

  const tracks: Record<string, LibraryTrackRef> = {}
  for (const key of keys) {
    if (referenced.has(key)) tracks[key] = state.tracks[key]
  }
  return { ...state, tracks }
}

/* --------------------------------------------------------------------------
   Liked Songs
   -------------------------------------------------------------------------- */

/**
 * Adds one item to Liked Songs.
 *
 * Liked Songs is a system collection rather than a playlist object: there is no
 * record to rename or delete, only a membership list, which is exactly why the
 * UI can guarantee it is never renamable (agents/41 → "Liked Songs").
 *
 * Most recently liked first, so the default sort needs no timestamp lookup.
 */
export function likeTrack(
  state: LibraryState,
  ref: LibraryTrackRef,
  now = Date.now(),
): LibraryMutation {
  if (state.likedTrackKeys.includes(ref.key)) return unchanged(state, LIBRARY_OK)
  if (state.likedTrackKeys.length >= MAX_LIKED_TRACKS) {
    return unchanged(state, libraryFailure('library-limit'))
  }

  const withRef = withTrackRef(state, ref)
  if (!withRef) return unchanged(state, libraryFailure('library-limit'))

  return {
    state: {
      ...state,
      ...withRef,
      likedTrackKeys: [ref.key, ...state.likedTrackKeys],
      updatedAt: now,
    },
    result: LIBRARY_OK,
  }
}

/**
 * Removes one item from Liked Songs.
 *
 * Membership only. Listening history is untouched, the provider account is
 * untouched, and no negative preference signal is created — deciding something
 * is no longer a favourite is not the same as disliking it (agents/43 → "remove
 * like … not necessarily a negative").
 */
export function unlikeTrack(
  state: LibraryState,
  key: string,
  now = Date.now(),
): LibraryMutation {
  if (!state.likedTrackKeys.includes(key)) return unchanged(state, libraryFailure('not-found'))
  const next: LibraryState = {
    ...state,
    likedTrackKeys: state.likedTrackKeys.filter((candidate) => candidate !== key),
    updatedAt: now,
  }
  return { state: collectGarbage(next), result: LIBRARY_OK }
}

export function toggleLike(
  state: LibraryState,
  ref: LibraryTrackRef,
  now = Date.now(),
): LibraryMutation {
  return state.likedTrackKeys.includes(ref.key)
    ? unlikeTrack(state, ref.key, now)
    : likeTrack(state, ref, now)
}

/* --------------------------------------------------------------------------
   Playlists
   -------------------------------------------------------------------------- */

export interface CreatePlaylistInput {
  name: string
  description?: string
  /** Optional first track, so "create and add" is one atomic mutation. */
  track?: LibraryTrackRef
  /** Injected in tests so a created playlist has a predictable id. */
  id?: string
}

export function createPlaylist(
  state: LibraryState,
  input: CreatePlaylistInput,
  now = Date.now(),
): LibraryMutation {
  const name = normalizePlaylistName(input.name)
  if (!name) return unchanged(state, libraryFailure('invalid-name'))
  if (state.playlistOrder.length >= MAX_PLAYLISTS) {
    return unchanged(state, libraryFailure('playlist-limit'))
  }

  const id = input.id ?? createPlaylistId()
  const playlist: Playlist = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    itemKeys: [],
    coverMode: 'auto',
  }
  const description = normalizePlaylistDescription(input.description)
  if (description) playlist.description = description

  let tracks = state.tracks
  if (input.track) {
    const withRef = withTrackRef(state, input.track)
    if (!withRef) return unchanged(state, libraryFailure('library-limit'))
    tracks = withRef.tracks
    playlist.itemKeys = [input.track.key]
  }

  return {
    state: {
      ...state,
      tracks,
      playlists: { ...state.playlists, [id]: playlist },
      // Newest first: the list a visitor is most likely to want next.
      playlistOrder: [id, ...state.playlistOrder],
      updatedAt: now,
    },
    result: { ok: true, playlistId: id },
  }
}

export function renamePlaylist(
  state: LibraryState,
  id: string,
  rawName: string,
  now = Date.now(),
): LibraryMutation {
  const playlist = state.playlists[id]
  if (!playlist) return unchanged(state, libraryFailure('not-found'))
  const name = normalizePlaylistName(rawName)
  if (!name) return unchanged(state, libraryFailure('invalid-name'))
  if (name === playlist.name) return unchanged(state, LIBRARY_OK)

  return {
    state: {
      ...state,
      playlists: { ...state.playlists, [id]: { ...playlist, name, updatedAt: now } },
      updatedAt: now,
    },
    result: LIBRARY_OK,
  }
}

export function setPlaylistDescription(
  state: LibraryState,
  id: string,
  rawDescription: string,
  now = Date.now(),
): LibraryMutation {
  const playlist = state.playlists[id]
  if (!playlist) return unchanged(state, libraryFailure('not-found'))

  const description = normalizePlaylistDescription(rawDescription)
  if (description === playlist.description) return unchanged(state, LIBRARY_OK)

  const next: Playlist = { ...playlist, updatedAt: now }
  if (description) next.description = description
  else delete next.description

  return {
    state: { ...state, playlists: { ...state.playlists, [id]: next }, updatedAt: now },
    result: LIBRARY_OK,
  }
}

/**
 * Deletes a playlist.
 *
 * Only the list goes. Its tracks stay liked if they were liked, stay in other
 * playlists if they were in them, and stay in listening history either way —
 * the garbage collector removes a reference only once genuinely nothing points
 * at it (agents/42 → "Delete playlist").
 */
export function deletePlaylist(
  state: LibraryState,
  id: string,
  now = Date.now(),
): LibraryMutation {
  if (!state.playlists[id]) return unchanged(state, libraryFailure('not-found'))

  const playlists = { ...state.playlists }
  delete playlists[id]

  const next: LibraryState = {
    ...state,
    playlists,
    playlistOrder: state.playlistOrder.filter((candidate) => candidate !== id),
    updatedAt: now,
  }
  return { state: collectGarbage(next), result: LIBRARY_OK }
}

/**
 * Appends one track to a playlist.
 *
 * Duplicates are refused by default: adding the same song twice is almost always
 * a mis-click, and the caller reports it as *Already in this playlist* rather
 * than silently doing nothing (agents/42 → "Add to playlist").
 */
export function addTrackToPlaylist(
  state: LibraryState,
  id: string,
  ref: LibraryTrackRef,
  now = Date.now(),
): LibraryMutation {
  const playlist = state.playlists[id]
  if (!playlist) return unchanged(state, libraryFailure('not-found'))
  if (playlist.itemKeys.includes(ref.key)) return unchanged(state, libraryFailure('duplicate'))
  if (playlist.itemKeys.length >= MAX_TRACKS_PER_PLAYLIST) {
    return unchanged(state, libraryFailure('playlist-track-limit'))
  }

  const withRef = withTrackRef(state, ref)
  if (!withRef) return unchanged(state, libraryFailure('library-limit'))

  return {
    state: {
      ...state,
      ...withRef,
      playlists: {
        ...state.playlists,
        [id]: { ...playlist, itemKeys: [...playlist.itemKeys, ref.key], updatedAt: now },
      },
      updatedAt: now,
    },
    result: LIBRARY_OK,
  }
}

export function removeTrackFromPlaylist(
  state: LibraryState,
  id: string,
  key: string,
  now = Date.now(),
): LibraryMutation {
  const playlist = state.playlists[id]
  if (!playlist || !playlist.itemKeys.includes(key)) {
    return unchanged(state, libraryFailure('not-found'))
  }

  const next: LibraryState = {
    ...state,
    playlists: {
      ...state.playlists,
      [id]: {
        ...playlist,
        itemKeys: playlist.itemKeys.filter((candidate) => candidate !== key),
        updatedAt: now,
      },
    },
    updatedAt: now,
  }
  return { state: collectGarbage(next), result: LIBRARY_OK }
}

/**
 * Moves one item to a new position, clamping rather than refusing.
 *
 * *Move to top* and *Move to bottom* pass 0 and a large index, so clamping is
 * the behaviour those controls need rather than a tolerance for bad input. The
 * order is the playlist's own and is persisted immediately; shuffling playback
 * never reaches it (agents/45 → "Do not mutate persisted playlist order").
 */
export function movePlaylistItem(
  state: LibraryState,
  id: string,
  from: number,
  to: number,
  now = Date.now(),
): LibraryMutation {
  const playlist = state.playlists[id]
  if (!playlist) return unchanged(state, libraryFailure('not-found'))

  const size = playlist.itemKeys.length
  if (!Number.isInteger(from) || from < 0 || from >= size) {
    return unchanged(state, libraryFailure('not-found'))
  }

  const target = Math.min(Math.max(Math.trunc(to), 0), size - 1)
  if (target === from) return unchanged(state, LIBRARY_OK)

  const itemKeys = [...playlist.itemKeys]
  const [moved] = itemKeys.splice(from, 1)
  itemKeys.splice(target, 0, moved)

  return {
    state: {
      ...state,
      playlists: { ...state.playlists, [id]: { ...playlist, itemKeys, updatedAt: now } },
      updatedAt: now,
    },
    result: LIBRARY_OK,
  }
}

/* --------------------------------------------------------------------------
   Not interested
   -------------------------------------------------------------------------- */

/**
 * Hides one item from generated recommendation surfaces.
 *
 * Only the key is kept. There is no reason, no category and no inference: the
 * record says "do not show me this item again", which is the whole of what the
 * visitor expressed (agents/43 → "Do not infer sensitive attributes").
 *
 * Nothing here touches a provider account or listening history, and it is
 * reversible from the toast.
 */
export function hideRecommendation(
  state: LibraryState,
  key: string,
  now = Date.now(),
): LibraryMutation {
  if (state.hiddenRecommendationKeys.includes(key)) return unchanged(state, LIBRARY_OK)
  return {
    state: {
      ...state,
      hiddenRecommendationKeys: [key, ...state.hiddenRecommendationKeys].slice(0, MAX_HIDDEN_KEYS),
      updatedAt: now,
    },
    result: LIBRARY_OK,
  }
}

export function unhideRecommendation(
  state: LibraryState,
  key: string,
  now = Date.now(),
): LibraryMutation {
  if (!state.hiddenRecommendationKeys.includes(key)) return unchanged(state, LIBRARY_OK)
  return {
    state: {
      ...state,
      hiddenRecommendationKeys: state.hiddenRecommendationKeys.filter(
        (candidate) => candidate !== key,
      ),
      updatedAt: now,
    },
    result: LIBRARY_OK,
  }
}

export function resetHiddenRecommendations(
  state: LibraryState,
  now = Date.now(),
): LibraryMutation {
  if (state.hiddenRecommendationKeys.length === 0) return unchanged(state, LIBRARY_OK)
  return {
    state: { ...state, hiddenRecommendationKeys: [], updatedAt: now },
    result: LIBRARY_OK,
  }
}
