/**
 * Local, on-device personalization.
 *
 * Everything under `src/personalization/` is client-side and stays in this
 * browser: there is no account, no server profile and no synchronization. The
 * public surface is deliberately narrow — feature code imports from here, never
 * from a module inside the folder, so the storage layer stays the only thing
 * that touches `localStorage` (STEP 2).
 */

export {
  PERSONALIZATION_STORAGE_KEY,
  PERSONALIZATION_VERSION,
  createEmptyState,
} from './types'
export type {
  ConsentChoice,
  ListenContext,
  ListenEntry,
  PersonalizationState,
  SearchEntry,
  StorageStatus,
} from './types'

export {
  COMPLETION_RATIO,
  EARLY_SKIP_SECONDS,
  MAX_HISTORY_DAYS,
  MAX_HISTORY_ITEMS,
  MAX_SEARCH_HISTORY,
  MAX_TRACKS_PER_ARTIST,
  RECENT_SHELF_SIZE,
  SHELF_SIZE,
  YOUTUBE_RETENTION_DAYS,
} from './config'

export {
  completionRatioFor,
  isCompletion,
  isEarlySkip,
  isQualifiedListen,
  qualifyThresholdSeconds,
} from './qualification'

export {
  clearListeningHistory,
  clearSearchHistory,
  dayKey,
  displayRecency,
  entryIdFor,
  markSearchResultPlayed,
  pruneHistory,
  qualifiedListenCount,
  recentlyPlayed,
  recordPlaySession,
  recordSubmittedSearch,
  removeSubmittedSearch,
  resetRecommendations,
  touchReplayStart,
} from './history'
export type { PlaySession, PlayedItem, SubmittedSearch } from './history'

export { createListenTracker, MAX_TICK_SECONDS } from './listen-tracker'
export type { ListenTracker } from './listen-tracker'

export {
  artistKey,
  buildProfile,
  catalogEntries,
  emptyProfile,
  seedArtist,
  stageFor,
} from './profile'
export type { ArtistAffinity, PersonalizationProfile, ProfileStage } from './profile'

export {
  effectiveWeight,
  interactionWeight,
  normalizeWeights,
  recencyDecay,
  repeatFactor,
  topKeys,
} from './scoring'
export type { WeightMap } from './scoring'

export {
  alignmentScore,
  buildRecommendations,
  heldBackIds,
  tracksByArtists,
} from './recommendations'
export type { RecommendationReason, ScoredTrack } from './recommendations'

export {
  filterRecentSearches,
  recentSearches,
  recentlyPlayedSuggestions,
} from './search-suggestions'
export {
  RECENT_PLAYED_SUGGESTIONS,
  RECENT_SEARCH_SUGGESTIONS,
} from './config'

export {
  HOME_SECTION_ANCHORS,
  HOME_SECTION_COUNT,
  HOME_SECTION_TITLES,
  hasRecentlyPlayed,
  planHomeSections,
  recentShelf,
} from './selectors'
export type { HomePlanInput, HomeSectionId } from './selectors'

export {
  isStorageAvailable,
  readState,
  sanitizeState,
  toPersisted,
  writeState,
} from './storage'

export {
  canReplayStoredYouTubeEntry,
  isExpiredYouTubeEntry,
  purgeExpiredYouTube,
  purgeExpiredYouTubeFromState,
  YOUTUBE_PURGE_INTERVAL_MS,
  youtubeExpiryCutoff,
} from './youtube-retention'

export { playHistoryEntry, resolveHistoryTrack, toYouTubeItem } from './replay'

export {
  personalizationEnabled,
  recordPlaySessionNow,
  recordSubmittedSearchNow,
  resetPersonalizationForTests,
  usePersonalizationStore,
} from './store'
export type { PersonalizationStoreState } from './store'
