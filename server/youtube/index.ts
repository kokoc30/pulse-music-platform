/**
 * Server-only YouTube module. Nothing under `src/` may import from here — the
 * API key lives in this tree and `VITE_`-free variables are not available to
 * the browser bundle (agents/23_YOUTUBE_SERVERLESS_SECURITY.md).
 */
export { handleYouTubeRequest, handleYouTubeRequestSafely, ALLOWED_PARAMS } from './handler.js'
export type { HandlerOptions, YouTubeErrorBody, YouTubeSearchBody, YouTubeErrorCode } from './handler.js'
export { readYouTubeEnv } from './env.js'
export type { EnvSource, YouTubeEnv, YouTubeEnvResult } from './env.js'
export {
  sanitizeYouTubeVideo,
  sanitizeYouTubeVideos,
  decodeHtmlEntities,
  parseIso8601Duration,
  pickThumbnail,
  readVideoId,
  PAYLOAD_KEYS,
  FORBIDDEN_KEYS,
} from './sanitize.js'
export type { YouTubeVideoPayload } from './sanitize.js'
export {
  buildSearchUrl,
  buildVideosUrl,
  classifyGoogleError,
  detectRelevanceLanguage,
  searchYouTube,
  MUSIC_CATEGORY_ID,
  RESULT_COUNT,
  YOUTUBE_SEARCH_ENDPOINT,
  YOUTUBE_VIDEOS_ENDPOINT,
} from './upstream.js'
export { createYouTubeMiddleware, YOUTUBE_ROUTE } from './node-adapter.js'
