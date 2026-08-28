/**
 * The YouTube fallback provider, browser side.
 *
 * Metadata only. Nothing here touches audio, and nothing here holds a
 * credential — every request goes to the same-origin `/api/youtube` route
 * (agents/23_YOUTUBE_SERVERLESS_SECURITY.md).
 */
export {
  searchYouTubeVideos,
  clearYouTubeSessionCache,
  youTubeSessionCacheSize,
  youtubeRequestUrl,
  YOUTUBE_API_PATH,
  YOUTUBE_TIMEOUT_MS,
} from './client'
export type { YouTubeSearchOptions, YouTubeSearchResult, YouTubeStatus } from './client'
export {
  normalizeYouTubeVideo,
  normalizeYouTubeVideos,
  canEmbedYouTubeItem,
  embedBlockReason,
  youtubeWatchUrl,
  YOUTUBE_ID_PREFIX,
  YOUTUBE_WATCH_BASE,
} from './normalize'
export { parseYouTubeSearchPayload, parseYouTubeVideoPayload, WIRE_KEYS } from './wire'
export type { YouTubeVideoPayload } from './wire'
