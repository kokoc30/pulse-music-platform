import type { YouTubeVideoItem } from '@/music/types'
import type { YouTubeVideoPayload } from './wire'

/**
 * Wire payload → the app's `YouTubeVideoItem`.
 *
 * Nothing about a YouTube result is coerced into the audio `Track` shape: there
 * is no artwork object, no `isStreamable`, no stream URL and no play count,
 * because YouTube gives none of those and pretending otherwise is exactly the
 * failure mode agents/21 → "Domain Model" exists to prevent.
 */

export const YOUTUBE_ID_PREFIX = 'youtube:'
export const YOUTUBE_WATCH_BASE = 'https://www.youtube.com/watch'

/** The public watch page for a video — the backlink YouTube branding requires. */
export function youtubeWatchUrl(videoId: string): string {
  const url = new URL(YOUTUBE_WATCH_BASE)
  url.searchParams.set('v', videoId)
  return url.toString()
}

/**
 * Whether the app may put this item into its embedded player at all.
 *
 * Three independent reasons to refuse, all of which leave the result visible
 * and openable on YouTube itself:
 *
 * · `embeddable === false` — the uploader disabled embedding.
 * · `madeForKids !== false` — child-directed, or not stated. The documented
 *   obligation is to "turn off tracking and make sure that all data collection,
 *   with respect to that player, is compliant with applicable laws, including
 *   COPPA", and no documented IFrame API mechanism lets this application
 *   discharge that. Not-stated is treated the same as true, because "unknown"
 *   is not "safe" (docs/youtube-policy-audit.md §9).
 * · a live or upcoming broadcast — not a music track, and its behaviour in an
 *   embedded player is not something this app models.
 */
export function canEmbedYouTubeItem(item: YouTubeVideoItem): boolean {
  if (!item.embeddable) return false
  if (item.madeForKids !== false) return false
  if (item.liveBroadcast) return false
  return true
}

/** Human-readable reason an item is external-only, or `null` when it is fine. */
export function embedBlockReason(item: YouTubeVideoItem): string | null {
  if (!item.embeddable) return 'The uploader has turned off embedding for this video.'
  if (item.madeForKids !== false) {
    return "This video is marked as made for kids, so it plays on YouTube rather than here."
  }
  if (item.liveBroadcast) return 'Live broadcasts play on YouTube rather than here.'
  return null
}

export function normalizeYouTubeVideo(payload: YouTubeVideoPayload): YouTubeVideoItem {
  return {
    id: `${YOUTUBE_ID_PREFIX}${payload.videoId}`,
    mediaKind: 'youtube-video',
    provider: 'youtube',
    providerId: payload.videoId,
    videoId: payload.videoId,
    title: payload.title,
    channelTitle: payload.channelTitle || 'YouTube',
    ...(payload.channelId ? { channelId: payload.channelId } : {}),
    thumbnailUrl: payload.thumbnailUrl,
    ...(payload.thumbnailWidth !== undefined ? { thumbnailWidth: payload.thumbnailWidth } : {}),
    ...(payload.thumbnailHeight !== undefined ? { thumbnailHeight: payload.thumbnailHeight } : {}),
    ...(payload.durationSeconds !== undefined ? { durationSeconds: payload.durationSeconds } : {}),
    ...(payload.publishedAt ? { publishedAt: payload.publishedAt } : {}),
    sourceUrl: youtubeWatchUrl(payload.videoId),
    embeddable: payload.embeddable,
    madeForKids: payload.madeForKids,
    ...(payload.liveBroadcast ? { liveBroadcast: payload.liveBroadcast } : {}),
  }
}

export function normalizeYouTubeVideos(payloads: readonly YouTubeVideoPayload[]): YouTubeVideoItem[] {
  return payloads.map(normalizeYouTubeVideo)
}
