/**
 * Your Library — Liked Songs and local playlists.
 *
 * Everything under `src/library/` is client-side and stays in this browser:
 * there is no Pulse account, no server and no synchronization. The public
 * surface is deliberately narrow — feature code imports from here, never from a
 * module inside the folder, so `storage.ts` stays the only thing that touches
 * IndexedDB.
 *
 * The library is **separate from personalization** and from any provider
 * account. A Pulse Like is a Pulse Like: it does not favourite the track on
 * Audius, does not like it on Jamendo, and does not touch a YouTube account.
 * There is no provider OAuth in this phase, and the UI says "in Pulse"
 * everywhere it could be misread (agents/44).
 */

export {
  LIBRARY_DB_NAME,
  LIBRARY_STORE_NAME,
  LIBRARY_VERSION,
  COVER_COLLAGE_SIZE,
  MAX_HIDDEN_KEYS,
  MAX_LIBRARY_TRACKS,
  MAX_LIKED_TRACKS,
  MAX_PLAYLISTS,
  MAX_PLAYLIST_DESCRIPTION_LENGTH,
  MAX_PLAYLIST_NAME_LENGTH,
  MAX_TRACKS_PER_PLAYLIST,
  createEmptyLibrary,
} from './types'
export type {
  LibraryFailureReason,
  LibraryProvider,
  LibraryResult,
  LibraryState,
  LibraryStorageStatus,
  LibraryTrackRef,
  Playlist,
  SafeArtworkRef,
} from './types'

export {
  addTrackToPlaylist,
  collectGarbage,
  createPlaylist,
  createPlaylistId,
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
export type { CreatePlaylistInput, LibraryMutation } from './actions'

export {
  isCatalogKey,
  isYouTubeKey,
  libraryKey,
  mergeTrackRef,
  parseLibraryKey,
  trackRefFromListenEntry,
  trackRefFromMediaItem,
  trackRefFromTrack,
  trackRefFromYouTube,
  youTubeItemFromRef,
} from './track-ref'

export {
  createIndexedDbLibraryRepository,
  createLibraryRepository,
  createMemoryLibraryRepository,
  isIndexedDbAvailable,
  normalizePlaylistDescription,
  normalizePlaylistName,
  sanitizeLibrary,
  sanitizeTrackRef,
  toPersistedLibrary,
} from './storage'
export type { LibraryReadResult, LibraryRepository } from './storage'

export { migrateLibrary } from './migrations'

export {
  LIKED_SORT_LABELS,
  PLAYLIST_SORT_LABELS,
  canOfferForPlayback,
  catalogLibraryRefs,
  coverArtFor,
  explicitIntentFrom,
  filterPlaylistSummaries,
  filterTrackRefs,
  isLiked,
  libraryItemCount,
  likedTracks,
  playlistSummaries,
  playlistTracks,
  summarizePlaylist,
} from './selectors'
export type { CoverArt, LikedSort, PlaylistSort, PlaylistSummary } from './selectors'

export {
  LIBRARY_PURGE_INTERVAL_MS,
  canPlaySavedYouTubeRef,
  isExpiredYouTubeRef,
  purgeExpiredYouTubeFromLibrary,
  youtubeExpiryFor,
} from './youtube-policy'

export {
  getLibraryRepository,
  libraryState,
  onLibraryChange,
  resetLibraryForTests,
  setLibraryRepository,
  useLibraryStore,
} from './store'
export type { LibraryStoreState } from './store'

export {
  libraryExplicitIntent,
  libraryHiddenKeys,
  libraryLikedKeys,
  libraryPlaylistedKeys,
  useCoverArt,
  useHiddenKeys,
  useIsHidden,
  useIsInAnyPlaylist,
  useIsLiked,
  useLibraryState,
  useLibraryStatus,
  useLikedCount,
  useLikedTracks,
  usePlaylist,
  usePlaylistSummaries,
  usePlaylistSummary,
  usePlaylistTracks,
} from './hooks'
export type { LibraryStatus } from './hooks'

export { connectLibraryToPersonalization } from './bridge'

export {
  LIBRARY_ROUTES,
  addRefToPlaylist,
  clearLibrary,
  createPlaylistWithTrack,
  markNotInterested,
  playLibraryRef,
  libraryMessage,
  playPlaylist,
  resolveLibraryTrack,
  toggleLibraryLike,
  toggleLibraryLikeRef,
  undoNotInterested,
} from './library-actions'
