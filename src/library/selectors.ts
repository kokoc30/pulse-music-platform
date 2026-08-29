import { normalizeText } from '@/music/search/text'
import type { ExplicitIntent, ExplicitItem } from '@/personalization/explicit-intent'
import { isCatalogKey } from './track-ref'
import { canPlaySavedYouTubeRef } from './youtube-policy'
import { COVER_COLLAGE_SIZE } from './types'
import type { LibraryState, LibraryTrackRef, Playlist, SafeArtworkRef } from './types'

/**
 * Derived views over the library.
 *
 * Pure functions of state, so a component never folds the whole store itself and
 * a test never needs a rendered tree to check an ordering rule. React callers go
 * through `hooks.ts`, which memoizes each of these on the store's `updatedAt`
 * token — the library is read on nearly every surface in the app, so re-deriving
 * a sorted list on every keystroke or `timeupdate` is exactly the cost agents/41
 * asks to avoid.
 */

/* --------------------------------------------------------------------------
   Liked Songs
   -------------------------------------------------------------------------- */

export type LikedSort = 'recent' | 'title' | 'artist'

export const LIKED_SORT_LABELS: Record<LikedSort, string> = {
  recent: 'Recently liked',
  title: 'Title',
  artist: 'Artist',
}

/** True when this exact provider item is in Liked Songs. */
export function isLiked(state: LibraryState, key: string): boolean {
  return state.likedTrackKeys.includes(key)
}

/**
 * Liked Songs, resolved to references.
 *
 * `likedTrackKeys` is already most-recently-liked first, so `'recent'` is the
 * stored order rather than a sort. Ties in the text sorts break on the stored
 * order, which keeps the list stable between renders.
 */
export function likedTracks(state: LibraryState, sort: LikedSort = 'recent'): LibraryTrackRef[] {
  const refs = state.likedTrackKeys
    .map((key) => state.tracks[key])
    .filter((ref): ref is LibraryTrackRef => Boolean(ref))

  if (sort === 'recent') return refs
  const compare = sort === 'title' ? byTitle : byArtist
  return [...refs].sort(compare)
}

const byTitle = (a: LibraryTrackRef, b: LibraryTrackRef) =>
  a.title.localeCompare(b.title) || a.artist.localeCompare(b.artist)

const byArtist = (a: LibraryTrackRef, b: LibraryTrackRef) =>
  a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)

/* --------------------------------------------------------------------------
   Playlists
   -------------------------------------------------------------------------- */

export type PlaylistSort = 'updated' | 'name' | 'created'

export const PLAYLIST_SORT_LABELS: Record<PlaylistSort, string> = {
  updated: 'Recently updated',
  name: 'Name',
  created: 'Recently created',
}

export interface PlaylistSummary {
  playlist: Playlist
  trackCount: number
  /**
   * Total run time, or `undefined` when at least one item never reported one.
   *
   * Reported as approximate rather than exact, because a saved reference keeps
   * the duration the provider gave at save time.
   */
  durationSeconds: number | undefined
  /** Up to four artwork references, for the generated cover. */
  cover: CoverArt
}

export function playlistSummaries(
  state: LibraryState,
  sort: PlaylistSort = 'updated',
): PlaylistSummary[] {
  const summaries = state.playlistOrder
    .map((id) => state.playlists[id])
    .filter((playlist): playlist is Playlist => Boolean(playlist))
    .map((playlist) => summarizePlaylist(state, playlist))

  if (sort === 'created') {
    return [...summaries].sort((a, b) => b.playlist.createdAt - a.playlist.createdAt)
  }
  if (sort === 'name') {
    return [...summaries].sort((a, b) => a.playlist.name.localeCompare(b.playlist.name))
  }
  return [...summaries].sort((a, b) => b.playlist.updatedAt - a.playlist.updatedAt)
}

export function summarizePlaylist(state: LibraryState, playlist: Playlist): PlaylistSummary {
  const refs = playlistTracks(state, playlist.id)
  let total = 0
  let complete = true
  for (const ref of refs) {
    if (ref.durationSeconds && ref.durationSeconds > 0) total += ref.durationSeconds
    else complete = false
  }
  return {
    playlist,
    trackCount: refs.length,
    durationSeconds: complete && refs.length > 0 ? total : undefined,
    cover: coverArtFor(refs),
  }
}

/** A playlist's tracks in its own custom order. Dangling keys cannot occur. */
export function playlistTracks(state: LibraryState, playlistId: string): LibraryTrackRef[] {
  const playlist = state.playlists[playlistId]
  if (!playlist) return []
  return playlist.itemKeys
    .map((key) => state.tracks[key])
    .filter((ref): ref is LibraryTrackRef => Boolean(ref))
}

/* --------------------------------------------------------------------------
   Cover collage
   -------------------------------------------------------------------------- */

/**
 * Artwork references for a generated playlist cover.
 *
 * No image is created, composited or persisted: this returns up to four
 * addresses the UI arranges in a grid, and each one fails over through the same
 * mirror list every other card uses. A YouTube item's thumbnail is deliberately
 * excluded — a 16:9 video still cropped into a quarter of a square cover would
 * present a video as album art, which the app has avoided since Phase 3
 * (agents/42 → "Cover collage").
 */
export interface CoverArt {
  artworks: SafeArtworkRef[]
  /** True when the playlist holds items but none of them offered usable art. */
  empty: boolean
}

export function coverArtFor(refs: readonly LibraryTrackRef[]): CoverArt {
  const artworks: SafeArtworkRef[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (artworks.length >= COVER_COLLAGE_SIZE) break
    if (ref.provider === 'youtube') continue
    const artwork = ref.artwork
    if (!artwork?.url || seen.has(artwork.url)) continue
    seen.add(artwork.url)
    artworks.push(artwork)
  }
  return { artworks, empty: artworks.length === 0 }
}

/* --------------------------------------------------------------------------
   Local search
   -------------------------------------------------------------------------- */

/**
 * Filters saved items by title or artist, locally.
 *
 * No provider is contacted: this reads the metadata already on the device, which
 * is the whole point of a library search (agents/42 → "Search within library").
 * Matching is accent- and case-insensitive through the same normalizer the
 * catalogue search uses, so "bjork" finds "Björk".
 */
export function filterTrackRefs(
  refs: readonly LibraryTrackRef[],
  query: string,
): LibraryTrackRef[] {
  const needle = normalizeText(query).folded.trim()
  if (!needle) return [...refs]
  return refs.filter((ref) => {
    const haystack = normalizeText(`${ref.title} ${ref.artist}`).folded
    return haystack.includes(needle)
  })
}

export function filterPlaylistSummaries(
  summaries: readonly PlaylistSummary[],
  query: string,
): PlaylistSummary[] {
  const needle = normalizeText(query).folded.trim()
  if (!needle) return [...summaries]
  return summaries.filter((summary) => {
    const haystack = normalizeText(
      `${summary.playlist.name} ${summary.playlist.description ?? ''}`,
    ).folded
    return haystack.includes(needle)
  })
}

/* --------------------------------------------------------------------------
   Playability
   -------------------------------------------------------------------------- */

/**
 * Whether a saved reference may be offered for playback right now.
 *
 * A catalogue reference always may — whether the item still exists is only
 * knowable by asking the provider, which happens at click time. A YouTube
 * reference must additionally still be inside its retention window and still
 * carry the two status flags the embed requires.
 */
export function canOfferForPlayback(ref: LibraryTrackRef, now = Date.now()): boolean {
  if (ref.provider !== 'youtube') return true
  return canPlaySavedYouTubeRef(ref, now)
}

/* --------------------------------------------------------------------------
   Explicit intent, for recommendations
   -------------------------------------------------------------------------- */

/**
 * The library's contribution to the preference profile.
 *
 * **Catalogue only.** YouTube references are skipped here, at the source, so no
 * YouTube API metadata can reach an artist weight, a genre weight, a similarity
 * score or a mix — the cross-platform derived metric YouTube Developer Policies
 * §III.E.4.h prohibits (agents/44 → "YouTube recommendation exclusion"). The
 * `ExplicitItem.provider` type cannot even express `'youtube'`, so the exclusion
 * survives a future edit to this function.
 *
 * **One item per track, never one per membership.** A track carries `liked` and
 * `inPlaylist` as booleans. How many playlists hold it is deliberately never
 * computed, which is what makes "five playlists must not multiply the signal"
 * structural rather than a rule the scorer has to remember.
 *
 * Hidden keys are *not* filtered by provider: they are an exclusion list for
 * shelves, and a shelf can carry a YouTube row.
 */
export function explicitIntentFrom(state: LibraryState): ExplicitIntent {
  const liked = new Set(state.likedTrackKeys)
  const playlisted = new Set<string>()
  for (const playlist of Object.values(state.playlists)) {
    for (const key of playlist.itemKeys) playlisted.add(key)
  }

  const items: ExplicitItem[] = []
  for (const key of new Set([...liked, ...playlisted])) {
    if (!isCatalogKey(key)) continue
    const ref = state.tracks[key]
    if (!ref || ref.provider === 'youtube') continue
    const item: ExplicitItem = {
      key: ref.key,
      provider: ref.provider,
      title: ref.title,
      artist: ref.artist,
      liked: liked.has(key),
      inPlaylist: playlisted.has(key),
      savedAt: ref.addedAt,
    }
    if (ref.artistId) item.artistId = ref.artistId
    if (ref.genre) item.genre = ref.genre
    items.push(item)
  }

  return { items, hiddenKeys: [...state.hiddenRecommendationKeys] }
}

/** Catalogue references the mix builder may seed from. Never YouTube. */
export function catalogLibraryRefs(state: LibraryState): LibraryTrackRef[] {
  const refs: LibraryTrackRef[] = []
  const seen = new Set<string>()
  const push = (key: string) => {
    if (seen.has(key) || !isCatalogKey(key)) return
    const ref = state.tracks[key]
    if (!ref) return
    seen.add(key)
    refs.push(ref)
  }
  for (const key of state.likedTrackKeys) push(key)
  for (const playlist of Object.values(state.playlists)) {
    for (const key of playlist.itemKeys) push(key)
  }
  return refs
}

/** Total distinct saved items, for the Settings summary. */
export function libraryItemCount(state: LibraryState): number {
  return Object.keys(state.tracks).length
}
