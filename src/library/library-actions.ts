import { showNotice } from '@/app/ui-store'
import { multiProviderSearch } from '@/music/aggregator'
import { getMusicProvider } from '@/music/provider'
import { MusicError } from '@/music/types'
import type { MediaItem, Track } from '@/music/types'
import { usePersonalizationStore } from '@/personalization/store'
import { usePlayerStore } from '@/player/player-store'
import { unifiedPlay } from '@/player/unified-actions'
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

/**
 * How many saved items one Play may resolve.
 *
 * A saved reference deliberately carries no playable URL, so starting a playlist
 * means asking the providers for its tracks again. That is bounded here and it
 * happens only on an explicit Play — rendering the library costs zero requests
 * (agents/44 → "Opening Library … no background API storm"). A longer playlist
 * plays its first hundred; the rest stay visible and are reachable by starting
 * from a later row.
 */
export const MAX_PLAYLIST_QUEUE = 100

/** Simultaneous provider lookups. Enough to feel instant, small enough to be polite. */
export const RESOLVE_CONCURRENCY = 4

/**
 * Consecutive unavailable items Play will step over before giving up.
 *
 * A withdrawn track must not end the session, and it must not become a retry
 * loop either (agents/45 → "skip it during Play All after one bounded attempt").
 */
export const MAX_UNAVAILABLE_SKIPS = 5

/* --------------------------------------------------------------------------
   Resolution
   -------------------------------------------------------------------------- */

/**
 * Re-resolves one saved reference to a playable `Track`.
 *
 * The same strategy Recently Played uses, and for the same reason: Audius stream
 * URLs are signed, node-specific and expiring, and Jamendo's are `streamUrl`s
 * that may not be persisted at all. So a saved item is re-asked for at play
 * time. Audius has a lookup by id; Jamendo's proxy exposes only search, so the
 * item is found by one bounded search and matched on its *provider id* — never
 * on title similarity, which would risk playing a different recording than the
 * one that was saved.
 */
export async function resolveLibraryTrack(ref: LibraryTrackRef): Promise<Track | null> {
  if (ref.provider === 'audius') {
    return getMusicProvider().getTrack(ref.providerItemId)
  }
  if (ref.provider === 'jamendo') {
    const result = await multiProviderSearch(`${ref.title} ${ref.artist}`)
    return (
      result.tracks.find(
        (track) => track.provider === 'jamendo' && track.providerId === ref.providerItemId,
      ) ?? null
    )
  }
  // A YouTube reference is never a `Track`. It plays in YouTube's own embedded
  // player or not at all, which is what keeps it off the audio element.
  return null
}

async function resolveQuietly(ref: LibraryTrackRef): Promise<Track | null> {
  try {
    const track = await resolveLibraryTrack(ref)
    return track?.isStreamable ? track : null
  } catch {
    // One item that has left the catalogue must not fail the whole playlist.
    return null
  }
}

/** Resolves many references, preserving order, with bounded concurrency. */
async function resolveMany(refs: readonly LibraryTrackRef[]): Promise<(Track | null)[]> {
  const results: (Track | null)[] = refs.map(() => null)
  let cursor = 0

  const worker = async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= refs.length) return
      results[index] = await resolveQuietly(refs[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(RESOLVE_CONCURRENCY, refs.length) }, () => worker()),
  )
  return results
}

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
 * Two phases, because a visitor should hear something before the whole list has
 * been re-resolved:
 *
 * 1. Walk forward from the chosen row until something actually plays, skipping a
 *    bounded number of unavailable items, and start it immediately.
 * 2. Resolve the remainder and hand the player the full continuation.
 *
 * The list becomes the *explicit* queue, which is what makes it outrank Phase 6
 * autoplay: `playNext` consults the queue before it ever asks the autoplay
 * planner, so a generated track cannot appear until the saved list is exhausted
 * (agents/45 → "Autoplay transition").
 *
 * A visitor who navigates or presses Next during phase 2 keeps control: the
 * continuation is applied only while the track started in phase 1 is still the
 * one loaded.
 */
export async function playPlaylist(
  refs: readonly LibraryTrackRef[],
  startIndex: number,
  context: LibraryPlayContext,
): Promise<void> {
  const playable = refs.slice(0, MAX_PLAYLIST_QUEUE)
  if (playable.length === 0) return

  const from = Math.min(Math.max(startIndex, 0), playable.length - 1)
  const ordered = [...playable.slice(from), ...playable.slice(0, from)]

  // A YouTube item cannot join an audio queue, so starting a saved list *on* one
  // plays just that item in its own player and leaves the queue alone.
  const head = ordered[0]
  if (head.provider === 'youtube') {
    await playLibraryRef(head, context)
    return
  }

  const audioRefs = ordered.filter((ref) => ref.provider !== 'youtube')
  if (audioRefs.length === 0) {
    showNotice('Nothing in this list can play through the audio player.')
    return
  }

  let first: Track | null = null
  let firstAt = 0
  for (; firstAt < Math.min(audioRefs.length, MAX_UNAVAILABLE_SKIPS); firstAt += 1) {
    first = await resolveQuietly(audioRefs[firstAt])
    if (first) break
  }

  if (!first) {
    showNotice("These tracks aren't available to stream right now.")
    return
  }

  await unifiedPlay(first, context)

  const remaining = audioRefs.slice(firstAt + 1)
  if (remaining.length === 0) return

  const resolved = await resolveMany(remaining)
  const queue = [first, ...resolved.filter((track): track is Track => track !== null)]

  // Still the same track the visitor started? If they have moved on, their
  // choice wins and the continuation is dropped rather than forced.
  const player = usePlayerStore.getState()
  if (player.currentTrack?.id !== first.id) return
  player.setQueue(queue, 0, context)
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
  showNotice(
    libraryMessage(result, `Added to ${playlist?.name ?? 'playlist'}`),
  )
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
