import { getMusicProvider } from '@/music/provider'
import { MusicError } from '@/music/types'
import type { Track } from '@/music/types'
import { showNotice } from '@/app/ui-store'
import { playTrack } from '@/player/player-actions'
import type { ChartShelfItem } from './shelves'
import { SHELF_QUEUE_SIZE } from './shelves'

/**
 * Two ways playback can start, and the difference between them is the visitor's
 * intent rather than the code path's convenience.
 *
 * **Collection playback** — `playFromShelf` below. The visitor asked for a
 * *list*: a playlist, a chart, a genre station, a curated shelf. The whole list
 * becomes the explicit queue and plays in order, and Phase 6 autoplay only ever
 * speaks once that list is exhausted.
 *
 * **Seed playback** — `playSeedTrack`. The visitor asked for *one song*. A click
 * on a search row means "play this", not "play this and then the fourteen other
 * things that happened to match my query". The queue is that single track, so
 * when it ends the autoplay planner is consulted and answers with something
 * musically similar — which is the whole point of having a planner.
 *
 * Search rows used to take the collection path, which is why autoplay never ran
 * after a search: every sibling result counted as something the visitor had
 * explicitly queued, and the queue always wins over anything generated.
 */

/**
 * Plays exactly one track, as a seed for autoplay.
 *
 * The single-item queue is explicit and **must** stay explicit. `playTrack`
 * falls back to the store's existing queue when it is given none, so omitting it
 * here would let a stale queue — the last playlist, the last chart — survive and
 * silently continue after a search click. Passing `[track]` is what makes this a
 * genuinely new one-track session.
 */
export async function playSeedTrack(
  track: Track,
  context: { id: string; label: string },
): Promise<void> {
  if (!track.isStreamable) {
    showNotice("This track isn't available to stream.")
    return
  }
  await playTrack(track, { queue: [track], index: 0, context })
}

/**
 * Starts playback from a shelf: the whole shelf becomes the queue and the chosen
 * track becomes the current index (agents/07_PLAYER_BEHAVIOR.md → "Queue Semantics").
 */
export async function playFromShelf(
  tracks: Track[],
  index: number,
  context: { id: string; label: string },
): Promise<void> {
  const streamable = tracks.filter((track) => track.isStreamable)
  const target = tracks[index]
  if (!target) return

  if (!target.isStreamable) {
    showNotice("This track isn't available to stream.")
    return
  }

  const queue = streamable.length ? streamable : [target]
  const queueIndex = Math.max(
    queue.findIndex((track) => track.id === target.id),
    0,
  )
  await playTrack(target, { queue, index: queueIndex, context })
}

/** Chart tiles fetch on demand — nothing is prefetched for them at page load. */
export async function playChart(chart: ChartShelfItem): Promise<void> {
  const provider = getMusicProvider()
  try {
    const tracks =
      chart.source.kind === 'underground'
        ? await provider.getUndergroundTrendingTracks({ limit: SHELF_QUEUE_SIZE })
        : await provider.getTrendingTracks({ limit: SHELF_QUEUE_SIZE, time: chart.source.time })

    if (!tracks.length) {
      showNotice('That chart is empty right now.')
      return
    }
    await playFromShelf(tracks, 0, {
      id: `chart:${chart.id}`,
      label: chart.titleLines.join(' '),
    })
  } catch (error) {
    showNotice(
      error instanceof MusicError ? error.userMessage : 'That chart is unavailable right now.',
    )
  }
}

/** Sidebar shortcut: play the underground trending queue. */
export async function playUnderground(): Promise<void> {
  try {
    const tracks = await getMusicProvider().getUndergroundTrendingTracks({
      limit: SHELF_QUEUE_SIZE,
    })
    if (!tracks.length) {
      showNotice('Underground trending is empty right now.')
      return
    }
    await playFromShelf(tracks, 0, { id: 'chart:underground', label: 'Underground trending' })
  } catch (error) {
    showNotice(
      error instanceof MusicError ? error.userMessage : 'Underground is unavailable right now.',
    )
  }
}
