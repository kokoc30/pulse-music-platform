/**
 * Smart-search layer. UI and feature code import from here, never from the
 * Audius SDK (agents/03_ARCHITECTURE.md → "Provider Boundary").
 */
export { smartSearchTracks, MAX_PROVIDER_REQUESTS, MAX_VARIANT_REQUESTS } from './smart-search'
export type { SearchOutcome, SmartSearchResult, SmartSearchOptions } from './smart-search'
export { expandQuery, MAX_QUERY_VARIANTS } from './expand'
export type { QueryVariant } from './expand'
export { normalizeText, normalizeForProvider, detectScript } from './text'
export type { NormalizedText, Script } from './text'
export {
  MIN_RELEVANCE,
  STRONG_RELEVANCE,
  STRONG_ARTIST_RELEVANCE,
  scoreTrack,
  scoreArtist,
} from './relevance'
export { PHRASE_ALIASES, TOKEN_ALIASES } from './aliases'
