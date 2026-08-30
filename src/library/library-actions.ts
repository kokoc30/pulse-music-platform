import { showNotice } from '@/app/ui-store'
import { MusicError } from '@/music/types'
import type { MediaItem } from '@/music/types'
import { usePersonalizationStore } from '@/personalization/store'
import { unifiedPlay } from '@/player/unified-actions'
import { playCollection } from './collection-playback'
import { resolveLibraryTrack } from './resolve'

/**
 * Re-exported so `resolveLibraryTrack` keeps its one public address while the
 * implementation lives beside the other resolution helpers in `resolve.ts`.
 */
export { resolveLibraryTrack }
import { trackRefFromMediaItem, youTubeItemFromRef } from './track-ref'
import { useLibraryStore } from './store'
import { LIKE_ADDED_MESSAGE, LIKE_REMOVED_MESSAGE } from './types'
import type { LibraryResult, LibraryTrackRef } from './types'
import { canPlaySavedYouTubeRef } from './youtube-policy'

/**
 * Imperative library operations, for code that is not a component.
 *
 * Two jobs: turning a saved *reference* back into something playable, and
 * pairing every mutation with the honest sentence that describes it. The store
 * holds the rules; this file holds the wording and the playback routing.
 */

export const LIBRARY_ROUTES = {
  library: '/library',
  liked: '/library/liked',
  playlist: (id: string) => `/playlist/${encodeURIComponent(id)}`,
} as const

/* --------------------------------------------------------------------------
   Playback
   -------------------------------------------------------------------------- */

export interface LibraryPlayContext {
  id: string
  label: string
}

/**
 * Plays one saved item through the engine that owns its provider.
 *
 * The routing rule the whole app is built on, enforced here too rather than
 * assumed: a catalogue reference goes to the single `HTMLAudioElement`, a
 * YouTube reference goes to YouTube's own embedded player, and no branch could
 * send one to the other.
 */
export async function playLibraryRef(
  ref: LibraryTrackRef,
  context: LibraryPlayContext,
  now = Date.now(),
): Promise<void> {
  if (ref.provider === 'youtube') {
    // Re-checked at click time, not only at render time: the retention window
    // may have closed while the page sat open.
    const item = canPlaySavedYouTubeRef(ref, now) ? youTubeItemFromRef(ref) : null
    if (!item) {
      showNotice('That video is no longer saved here. Search for it again to play it.')
      return
    }
    await unifiedPlay(item)
    return
  }

  try {
    const track = await resolveLibraryTrack(ref)
    if (!track || !track.isStreamable) {
      showNotice("That track isn't available to stream right now.")
      return
    }
    await unifiedPlay(track, context)
  } catch (error) {
    showNotice(
      error instanceof MusicError ? error.userMessage : 'That track is unavailable right now.',
    )
  }
}

/**
 * Plays a saved list from a chosen position.
 *
 * The whole of it now lives in `collection-playback.ts`, over the session in
 * `player/collection-session.ts`, and the difference that matters is what the
 * list *is*:
 *
 * · It used to become the audio queue, which meant it had to be something the
 *   audio engine could hold. Every YouTube item was filtered out of the middle
 *   of the list, and starting on one threw the rest of the list away.
 * · It is now a session of saved *references* that outranks generated autoplay
 *   in its own right, materializing into the audio queue only as far as the
 *   audio engine can reach, and routing each item to whichever engine owns it.
 *
 * Two more corrections travel with that. The list no longer rotates — Repeat off
 * started at C runs C, D, E and stops, instead of quietly wrapping round to A —
 * and the whole list is no longer resolved up front, only a bounded look-ahead
 * that is topped back up as playback advances.
 *
 * `refs` is the collection **as the visitor can see it**: the page applies its
 * sort and its filter first, and that order is what plays.
 */
export async function playPlaylist(
  refs: readonly LibraryTrackRef[],
  startIndex: number,
  context: LibraryPlayContext,
): Promise<void> {
  await playCollection(refs, startIndex, context)
}

/* --------------------------------------------------------------------------
   Mutations with feedback
   -------------------------------------------------------------------------- */

const FAILURE_MESSAGES: Record<string, string> = {
  'playlist-limit': 'You have reached the maximum number of playlists on this device.',
  'playlist-track-limit': 'This playlist is full.',
  'library-limit': 'Your library is full on this device.',
  duplicate: 'Already in this playlist.',
  'not-found': 'That item is no longer in your library.',
  'invalid-name': 'Give the playlist a name.',
  'storage-unavailable': 'This browser is not letting Pulse save your library.',
}

export function libraryMessage(result: LibraryResult, success: string): string {
  if (result.ok) return success
  return FAILURE_MESSAGES[result.reason ?? ''] ?? 'That could not be saved.'
}

/**
 * Toggles Liked Songs membership for anything playable, with a toast.
 *
 * The wording says **in Pulse** every time. Pulse has no provider OAuth, so a
 * heart here changes nothing on Audius, Jamendo or YouTube, and copy that
 * implied otherwise would be a straightforwardly false claim about someone
 * else's service (agents/44 → "Clear disclosure").
 */
export function toggleLibraryLike(item: MediaItem): LibraryResult {
  const ref = trackRefFromMediaItem(item)
  return toggleLibraryLikeRef(ref)
}

export function toggleLibraryLikeRef(ref: LibraryTrackRef): LibraryResult {
  const store = useLibraryStore.getState()
  const wasLiked = store.state.likedTrackKeys.includes(ref.key)
  const result = store.toggleLiked(ref)
  showNotice(libraryMessage(result, wasLiked ? LIKE_REMOVED_MESSAGE : LIKE_ADDED_MESSAGE))
  return result
}

export function addRefToPlaylist(playlistId: string, ref: LibraryTrackRef): LibraryResult {
  const store = useLibraryStore.getState()
  const playlist = store.state.playlists[playlistId]
  const result = store.addToPlaylist(playlistId, ref)
  showNotice(libraryMessage(result, `Added to ${playlist?.name ?? 'playlist'}`))
  return result
}

export function createPlaylistWithTrack(
  name: string,
  ref?: LibraryTrackRef,
  description?: string,
): LibraryResult {
  const store = useLibraryStore.getState()
  const result = store.createPlaylist({
    name,
    ...(description ? { description } : {}),
    ...(ref ? { track: ref } : {}),
  })
  showNotice(libraryMessage(result, `Playlist “${name.trim()}” created`))
  return result
}

/* --------------------------------------------------------------------------
   Not interested
   -------------------------------------------------------------------------- */

/**
 * Hides one recommendation.
 *
 * Deliberately narrow: it removes this item from generated shelves and nothing
 * else. Listening history is untouched, no provider account is contacted, and
 * the profile gains an exclusion rather than a negative opinion about the artist
 * or genre — one refusal is not evidence about a category (agents/43).
 *
 * The undo lives on the toast, so a mis-tap costs one click to reverse.
 */
export function markNotInterested(key: string): LibraryResult {
  const result = useLibraryStore.getState().hide(key)
  if (result.ok) {
    // The profile's exclusion list is one of its inputs, so it has to be rebuilt
    // for the shelves to react — but only where consent allows a profile at all.
    usePersonalizationStore.getState().refreshProfile()
  }
  return result
}

export function undoNotInterested(key: string): LibraryResult {
  const result = useLibraryStore.getState().unhide(key)
  if (result.ok) usePersonalizationStore.getState().refreshProfile()
  return result
}

/* --------------------------------------------------------------------------
   Clear
   -------------------------------------------------------------------------- */

/**
 * Deletes the whole local library.
 *
 * Exactly and only the library: Liked Songs, playlists, saved track references
 * and hidden-recommendation keys. Volume, mute, autoplay and repeat live under
 * separate `localStorage` keys and are not touched; listening and search history
 * live in `pulse.personalization.v1` and are not touched either, so a visitor
 * who wanted to drop their playlists does not silently lose Recently Played
 * (agents/44 → "It must not silently clear unrelated volume/UI settings").
 *
 * What it *does* remove, necessarily, is the recommendation signal that came
 * from library actions: likes and playlist membership are the signal, not a
 * separate copy of it, so clearing them clears their influence. The profile is
 * rebuilt from listening history alone.
 */
export async function clearLibrary(): Promise<void> {
  await useLibraryStore.getState().clearLibrary()
  usePersonalizationStore.getState().refreshProfile()
}
