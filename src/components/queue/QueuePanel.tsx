import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useUiStore } from '@/app/ui-store'
import { TrackList } from '@/components/track/TrackList'
import { playQueueIndex } from '@/player/player-actions'
import {
  useCurrentTrack,
  useIsPlaying,
  useQueue,
  useQueueContextLabel,
} from '@/player/player-selectors'

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
