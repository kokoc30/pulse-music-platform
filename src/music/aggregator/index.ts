/**
 * Multi-provider search aggregation. Feature code imports from here; the
 * Audius-only `@/music/search` entry point stays exactly as it was
 * (agents/15_MULTI_PROVIDER_SEARCH.md → "Preserve Existing Smart Search").
 */
export { multiProviderSearch } from './multi-provider-search'
export type {
  MultiProviderSearchOptions,
  MultiProviderSearchResult,
  ProviderOutcome,
} from './multi-provider-search'
export {
  dedupeAcrossProviders,
  isSameRecording,
  pickWinner,
  versionMarkers,
  MIN_TITLE_SIMILARITY,
  MIN_ARTIST_SIMILARITY,
  MAX_DURATION_DRIFT_SECONDS,
} from './cross-provider-dedupe'
export {
  MAX_JAMENDO_REQUESTS,
  selectJamendoFallback,
  shouldSpendJamendoFallback,
} from './provider-budget'
