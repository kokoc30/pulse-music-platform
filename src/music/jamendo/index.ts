/**
 * Browser-side Jamendo provider. Reaches Jamendo only through the same-origin
 * `/api/jamendo` route (agents/16_JAMENDO_SERVERLESS_SECURITY.md).
 */
export {
  searchJamendoTracks,
  fetchSimilarJamendoTracks,
  JAMENDO_API_PATH,
  JAMENDO_TIMEOUT_MS,
} from './client'
export type { JamendoSearchOptions, JamendoSearchResult, JamendoStatus } from './client'
export { normalizeJamendoTrack, normalizeJamendoTracks, toJamendoProviderId } from './normalize'
export {
  parseJamendoTrack,
  parseJamendoSearchPayload,
  parseJamendoSimilarPayload,
  WIRE_KEYS,
} from './wire'
export type { JamendoTrackPayload } from './wire'
