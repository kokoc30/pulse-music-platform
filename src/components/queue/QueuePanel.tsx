import { useEffect, useRef } from 'react'
import { Repeat, Repeat1, Shuffle, X } from 'lucide-react'
import { useUiStore } from '@/app/ui-store'
import { TrackList } from '@/components/track/TrackList'
import { playQueueIndex } from '@/player/player-actions'
import {
  useCurrentTrack,
  useIsPlaying,
  useQueue,
  useQueueContextLabel,
  useRepeatMode,
  useShuffle,
} from '@/player/player-selectors'
import { usePlayerStore } from '@/player/player-store'
import { REPEAT_LABELS } from '@/player/queue-order'

/**
 * Production addition: the reference has no queue UI, but the contract requires
 * working queue behaviour with a visible surface. Built from the player's own
 * surface tokens (docs/reference-deviations.md D-09).
 */
export function QueuePanel() {
  const open = useUiStore((s) => s.queueOpen)
  const setQueueOpen = useUiStore((s) => s.setQueueOpen)
  const queue = useQueue()
  const currentTrack = useCurrentTrack()
  const isPlaying = useIsPlaying()
  const contextLabel = useQueueContextLabel()
  const shuffle = useShuffle()
  const repeatMode = useRepeatMode()
  const setShuffle = usePlayerStore((state) => state.setShuffle)
  const cycleRepeatMode = usePlayerStore((state) => state.cycleRepeatMode)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQueueOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, setQueueOpen])

  if (!open) return null

  return (
    <>
      <button
        type="button"
        className="queue-backdrop"
        aria-label="Close queue"
        tabIndex={-1}
        onClick={() => setQueueOpen(false)}
      />
      <aside className="queue-panel" aria-label="Play queue">
        <div className="queue-head">
          <div>
            <h2>Queue</h2>
            <p>{contextLabel ? `From ${contextLabel}` : 'Up next'}</p>
          </div>
          <button ref={closeRef} type="button" onClick={() => setQueueOpen(false)} aria-label="Close queue">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Shuffle and repeat belong to the queue, and this is the one surface
            that shows the queue on every screen size. Below 560px the reference
            collapses the player to a mini-player and hides everything but
            play/pause, so without this the two controls would be unreachable on
            a phone — which is not an acceptable reading of "professional player
            controls" (agents/45). Same store, same actions as the bar. */}
        <div className="queue-modes">
          <button
            type="button"
            className="player-toggle"
            data-active={shuffle ? 'true' : 'false'}
            aria-pressed={shuffle}
            aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
            onClick={() => setShuffle(!shuffle)}
          >
            <Shuffle size={15} aria-hidden="true" />
            <span>{shuffle ? 'Shuffle on' : 'Shuffle'}</span>
          </button>
          <button
            type="button"
            className="player-toggle"
            data-active={repeatMode === 'off' ? 'false' : 'true'}
            aria-pressed={repeatMode !== 'off'}
            aria-label={REPEAT_LABELS[repeatMode]}
            onClick={cycleRepeatMode}
          >
            {repeatMode === 'one' ? (
              <Repeat1 size={15} aria-hidden="true" />
            ) : (
              <Repeat size={15} aria-hidden="true" />
            )}
            <span>{REPEAT_LABELS[repeatMode]}</span>
          </button>
        </div>
        <div className="queue-body">
          {queue.length ? (
            <TrackList
              tracks={queue}
              compact
              currentTrackId={currentTrack?.id ?? null}
              isPlaying={isPlaying}
              onPlay={(_track, index) => void playQueueIndex(index)}
            />
          ) : (
            <p className="queue-empty">Nothing queued yet. Play a track to build a queue.</p>
          )}
        </div>
      </aside>
    </>
  )
}
