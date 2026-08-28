import { MS_PER_DAY, YOUTUBE_RETENTION_DAYS } from './config'
import type { ListenEntry, PersonalizationState } from './types'

/**
 * Retention and deletion for locally stored YouTube API metadata.
 *
 * The governing rule is YouTube API Services Developer Policies §III.E.4.d:
 * an API Client "may temporarily store limited amounts of Non-Authorized Data …
 * but not longer than 30 calendar days". Public `search.list` / `videos.list`
 * metadata for a video the visitor played is Non-Authorized Data, so it may be
 * kept — briefly, in limited amounts — and must then be deleted.
 *
 * That single rule produces every behaviour in this file:
 *
 * · **A hard ceiling, not a target.** `YOUTUBE_RETENTION_DAYS` is 30 and cannot
 *   be raised without breaching the policy. Catalogue history uses its own,
 *   entirely separate 180-day rule; the two never share a code path.
 * · **Expiry is enforced on read, not only on write.** `purgeExpiredYouTube` runs
 *   at start-up, before every recommendation pass, and before Recently Played is
 *   rendered. A tab left open for a month therefore cannot surface a stale entry,
 *   and neither can a hand-restored `localStorage` backup.
 * · **The clock is `storedAt`, refreshed on each real play.** Playing a video
 *   again is a fresh, permitted retrieval of that metadata, so its 30 days start
 *   again from that moment. Nothing extends the window without a real play.
 * · **No statistics, ever.** View counts, likes, ratings and engagement metrics
 *   are never requested, never normalized into `YouTubeVideoItem`, and could not
 *   be persisted even if they were — `toPersisted` has no field for them.
 *
 * See docs/youtube-personalization-policy-audit.md for the full audit.
 */

/** Epoch milliseconds before which YouTube metadata must no longer exist. */
export function youtubeExpiryCutoff(now = Date.now()): number {
  return now - YOUTUBE_RETENTION_DAYS * MS_PER_DAY
}

/** True when this entry is YouTube metadata that has outlived its retention. */
export function isExpiredYouTubeEntry(entry: ListenEntry, now = Date.now()): boolean {
  if (entry.provider !== 'youtube') return false
  return entry.storedAt <= youtubeExpiryCutoff(now)
}

/**
 * Whether a retained YouTube entry may still be offered for playback.
 *
 * Mirrors `canEmbedYouTubeItem` for stored rows: a video YouTube reported as
 * non-embeddable or made-for-kids is never handed to the embedded player, and
 * an entry whose retention has lapsed is not offered at all. `madeForKids` of
 * `null` means YouTube did not report it, which is not the explicit `false` the
 * policy audit requires (docs/youtube-policy-audit.md §9).
 */
export function canReplayStoredYouTubeEntry(entry: ListenEntry, now = Date.now()): boolean {
  if (entry.provider !== 'youtube') return false
  if (isExpiredYouTubeEntry(entry, now)) return false
  if (entry.embeddable !== true) return false
  return entry.madeForKids === false
}

/**
 * Drops every YouTube row past its retention limit.
 *
 * Returns the same array instance when nothing expired, so callers can use
 * identity to skip a pointless write.
 */
export function purgeExpiredYouTube(entries: ListenEntry[], now = Date.now()): ListenEntry[] {
  const kept = entries.filter((entry) => !isExpiredYouTubeEntry(entry, now))
  return kept.length === entries.length ? entries : kept
}

/** State-level purge, used at start-up and on the periodic sweep. */
export function purgeExpiredYouTubeFromState(
  state: PersonalizationState,
  now = Date.now(),
): PersonalizationState {
  const listeningHistory = purgeExpiredYouTube(state.listeningHistory, now)
  if (listeningHistory === state.listeningHistory) return state
  return { ...state, listeningHistory, updatedAt: now }
}

/**
 * How often the app re-runs the purge while a tab stays open.
 *
 * Six hours is far below the 30-day limit and costs one array filter, so a
 * long-lived tab can never drift past the retention window.
 */
export const YOUTUBE_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000
