import { getMusicProvider } from '@/music/provider'
import { MusicError } from '@/music/types'
import type { Track } from '@/music/types'
import { showNotice } from '@/app/ui-store'
import { playTrack } from '@/player/player-actions'
import type { ChartShelfItem } from './shelves'
import { SHELF_QUEUE_SIZE } from './shelves'

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
