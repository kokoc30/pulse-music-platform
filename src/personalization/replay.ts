import { showNotice } from '@/app/ui-store'
import { multiProviderSearch } from '@/music/aggregator'
import { getMusicProvider } from '@/music/provider'
import { MusicError } from '@/music/types'
import type { Track, YouTubeVideoItem } from '@/music/types'
import { playTrack } from '@/player/player-actions'
import { playYouTubeVideo } from '@/player/youtube-actions'
import { canReplayStoredYouTubeEntry } from './youtube-retention'
import type { ListenEntry } from './types'

/**
 * Replaying something from Recently Played.
 *
 * The routing rule is the same one the whole app is built on, and it is enforced
 * here too rather than assumed: a catalogue track goes to the single
 * `HTMLAudioElement`, a YouTube video goes to YouTube's own embedded player, and
 * there is no branch that could send one to the other. A YouTube entry is never
 * turned into a `Track`, so it cannot reach `playTrack` even by mistake.
 *
 * **Why history entries are re-resolved rather than replayed from storage.**
 * A stored entry deliberately carries no playable URL. Audius stream URLs are
 * signed and node-specific and expire; Jamendo's are stable but are a `streamUrl`,
 * which STEP 21 forbids persisting outright. So a click re-asks the provider for
 * the item — one request, on an explicit user action, with no fan-out. Nothing
 * is prefetched, and simply *rendering* the shelf costs zero requests.
 */

/** Reconstructs the YouTube item from a retained, still-valid entry. */
export function toYouTubeItem(entry: ListenEntry): YouTubeVideoItem | null {
  if (entry.provider !== 'youtube' || !entry.sourceUrl) return null
  return {
    id: entry.id,
    mediaKind: 'youtube-video',
    provider: 'youtube',
    providerId: entry.providerItemId,
    videoId: entry.providerItemId,
    title: entry.title,
    channelTitle: entry.artist,
    thumbnailUrl: entry.thumbnailUrl ?? '',
    ...(entry.durationSeconds ? { durationSeconds: entry.durationSeconds } : {}),
    sourceUrl: entry.sourceUrl,
    embeddable: entry.embeddable === true,
    madeForKids: entry.madeForKids ?? null,
  }
}

/**
 * Re-resolves a catalogue entry to a playable `Track`.
 *
 * Audius exposes a direct lookup by id. Jamendo's proxy only offers `search`, so
 * the entry is found by re-running one bounded search for its own title and
 * artist and matching on the stored provider id — never on title similarity,
 * which would risk playing a different recording than the one asked for.
 */
export async function resolveHistoryTrack(entry: ListenEntry): Promise<Track | null> {
  if (entry.provider === 'audius') {
    return getMusicProvider().getTrack(entry.providerItemId)
  }

  if (entry.provider === 'jamendo') {
    const result = await multiProviderSearch(`${entry.title} ${entry.artist}`)
    return (
      result.tracks.find(
        (track) => track.provider === 'jamendo' && track.providerId === entry.providerItemId,
      ) ?? null
    )
  }

  return null
}

export interface ReplayContext {
  id: string
  label: string
}

/**
 * Plays one Recently Played entry through the engine that owns its provider.
 *
 * Every failure path ends in a visible, honest notice rather than a silent
 * no-op: an item that has left the catalogue, a YouTube entry whose retention
 * lapsed between render and click, or a provider that is down.
 */
export async function playHistoryEntry(
  entry: ListenEntry,
  context: ReplayContext = { id: 'shelf:recent', label: 'Recently played' },
  now = Date.now(),
): Promise<void> {
  if (entry.provider === 'youtube') {
    // Re-checked at click time, not just at render time: the retention window
    // may have closed while the page sat open.
    if (!canReplayStoredYouTubeEntry(entry, now)) {
      showNotice('That video is no longer available here. Try searching for it again.')
      return
    }
    const item = toYouTubeItem(entry)
    if (!item) {
      showNotice('That video is no longer available here. Try searching for it again.')
      return
    }
    await playYouTubeVideo(item, { userInitiated: true })
    return
  }

  try {
    const track = await resolveHistoryTrack(entry)
    if (!track || !track.isStreamable) {
      showNotice("That track isn't available to stream right now.")
      return
    }
    await playTrack(track, { queue: [track], index: 0, context })
  } catch (error) {
    showNotice(
      error instanceof MusicError ? error.userMessage : 'That track is unavailable right now.',
    )
  }
}
