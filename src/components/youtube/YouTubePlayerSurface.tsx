import { useEffect, useRef } from 'react'
import { ExternalLink, Pause, Play, X } from 'lucide-react'
import { formatDuration } from '@/lib/format'
import {
  bindYouTubeEngineEvents,
  closeYouTubeSurface,
  handleDocumentVisibility,
  toggleYouTubePlayback,
} from '@/player/youtube-actions'
import { MINIMUM_DIMENSION, getYouTubeEngine } from '@/player/youtube-engine'
import { useYouTubeStore } from '@/player/youtube-store'

/**
 * The one visible YouTube player surface.
 *
 * Mounted once in the app shell, above the router, so navigating between pages
 * cannot unmount it mid-playback — the player stays *displayed in the page the
 * user is viewing*, which is what separates a compliant embed from the
 * background player the developer policies prohibit
 * (agents/25 → "Visible Player Surface").
 *
 * Layout rules that are policy, not taste:
 *
 * · `.yt-surface-stage` contains the iframe **and nothing else**. Title, channel,
 *   attribution, play/pause and close all live in sibling elements above and
 *   below it. Nothing is positioned over the iframe, at any breakpoint.
 * · The stage is 480 × 270 on desktop — the size the IFrame API reference
 *   recommends for 16:9 — and never smaller than 200 × 200 anywhere.
 * · `display: none`, zero opacity, offscreen positioning and collapsed
 *   dimensions are all absent by construction: when there is no item the whole
 *   component returns `null`, and when there is one it is laid out normally.
 *
 * React never owns the element the IFrame API replaces. The API swaps the node
 * it is given for its own `<iframe>`; handing it a React-rendered node would
 * corrupt React's tree on unmount. So a plain `div` is created imperatively
 * inside the React-owned host and handed over instead.
 */
export function YouTubePlayerSurface() {
  const item = useYouTubeStore((state) => state.item)
  const status = useYouTubeStore((state) => state.status)
  const surfaceOpen = useYouTubeStore((state) => state.surfaceOpen)
  const awaitingUserPlay = useYouTubeStore((state) => state.awaitingUserPlay)
  const currentTime = useYouTubeStore((state) => state.currentTime)
  const duration = useYouTubeStore((state) => state.duration)
  const error = useYouTubeStore((state) => state.error)

  const hostRef = useRef<HTMLDivElement | null>(null)
  const mountRef = useRef<HTMLDivElement | null>(null)

  // Engine events → store. Bound once for the lifetime of the surface.
  useEffect(() => bindYouTubeEngineEvents(), [])

  /**
   * A hidden document pauses YouTube. This is the background-playback rule and
   * it applies whatever caused the tab to go away — switching tabs, minimising,
   * locking the screen.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibilityChange = () => handleDocumentVisibility(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  // Hand the engine a plain node inside the React-owned host.
  useEffect(() => {
    const host = hostRef.current
    if (!surfaceOpen || !host) return

    const mount = host.ownerDocument.createElement('div')
    mount.className = 'yt-surface-mount'
    host.appendChild(mount)
    mountRef.current = mount
    getYouTubeEngine().attach(mount)

    return () => {
      // Detach destroys the player and its iframe. Playback cannot outlive the
      // surface, which is the point.
      getYouTubeEngine().detach()
      mountRef.current = null
      mount.remove()
    }
  }, [surfaceOpen])

  if (!surfaceOpen || !item) return null

  const playing = status === 'playing'
  const busy = status === 'loading'

  return (
    <section
      className="yt-surface"
      aria-label="YouTube player"
      data-status={status}
      data-testid="youtube-surface"
    >
      <header className="yt-surface-head">
        <div className="yt-surface-title">
          <b title={item.title}>{item.title}</b>
          <small>
            <span>{item.channelTitle}</span>
            <span aria-hidden="true"> · </span>
            <a
              className="yt-source-link"
              href={item.sourceUrl}
              target="_blank"
              rel="noopener"
              aria-label={`Watch ${item.title} on YouTube`}
            >
              YouTube <ExternalLink size={11} aria-hidden="true" />
            </a>
          </small>
        </div>
        <button
          type="button"
          className="yt-surface-close"
          onClick={() => closeYouTubeSurface()}
          aria-label="Close the YouTube player and stop playback"
        >
          <X size={17} aria-hidden="true" />
        </button>
      </header>

      {/* The iframe's only container. No siblings, no overlay, no decoration. */}
      <div
        className="yt-surface-stage"
        ref={hostRef}
        style={{ minWidth: MINIMUM_DIMENSION, minHeight: MINIMUM_DIMENSION }}
        data-testid="youtube-stage"
      />

      <footer className="yt-surface-foot">
        <button
          type="button"
          className="yt-surface-toggle"
          onClick={() => toggleYouTubePlayback()}
          aria-label={playing ? 'Pause the YouTube video' : 'Play the YouTube video'}
          disabled={busy}
        >
          {playing ? (
            <Pause size={16} fill="currentColor" aria-hidden="true" />
          ) : (
            <Play size={16} fill="currentColor" aria-hidden="true" />
          )}
        </button>
        <span className="yt-surface-time" aria-live="off">
          {formatDuration(currentTime)} / {formatDuration(duration || item.durationSeconds || 0)}
        </span>
        <span className="yt-surface-status" role="status">
          {error
            ? error
            : awaitingUserPlay
              ? 'Ready — press play to start.'
              : playing
                ? 'Playing on YouTube'
                : busy
                  ? 'Loading…'
                  : 'Paused'}
        </span>
      </footer>
    </section>
  )
}
