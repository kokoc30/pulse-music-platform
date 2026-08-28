/**
 * Server-only Jamendo module. Nothing under `src/` may import from here — the
 * credential lives in this tree and `VITE_`-free variables are not available to
 * the browser bundle (agents/16_JAMENDO_SERVERLESS_SECURITY.md).
 */
export { handleJamendoRequest, handleJamendoRequestSafely } from './handler'
export type { HandlerOptions, JamendoErrorBody, JamendoSearchBody } from './handler'
export { readJamendoEnv } from './env'
export { sanitizeJamendoTrack, sanitizeJamendoTracks, PAYLOAD_KEYS, FORBIDDEN_KEYS } from './sanitize'
export type { JamendoTrackPayload } from './sanitize'
export { buildSearchUrl, clampLimit, searchJamendo, JAMENDO_TRACKS_ENDPOINT, MAX_LIMIT } from './upstream'
export { redactSecrets, redactLiteral, containsSecret } from './redact'
