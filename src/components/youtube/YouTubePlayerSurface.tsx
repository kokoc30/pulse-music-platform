import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { formatDuration } from '@/lib/format'
import {
  bindYouTubeEngineEvents,
  closeYouTubeSurface,
  handleDocumentVisibility,
  hasYouTubeSessionStep,
  playYouTubeSessionStep,
  toggleYouTubePlayback,
} from '@/player/youtube-actions'
import { MINIMUM_DIMENSION, getYouTubeEngine } from '@/player/youtube-engine'
import { resetYouTubeVisibility, setYouTubeVisibleRatio } from '@/player/youtube-visibility'
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
  const sessionItems = useYouTubeStore((state) => state.sessionItems)
  const sessionIndex = useYouTubeStore((state) => state.sessionIndex)
  const continuousPlay = useYouTubeStore((state) => state.continuousPlay)
  const setContinuousPlay = useYouTubeStore((state) => state.setContinuousPlay)
  const pausedForBackgroundPolicy = useYouTubeStore((state) => state.pausedForBackgroundPolicy)
  const setPausedForBackgroundPolicy = useYouTubeStore(
    (state) => state.setPausedForBackgroundPolicy,
  )

  const hostRef = useRef<HTMLDivElement | null>(null)
  const mountRef = useRef<HTMLDivElement | null>(null)
  // Re-rendered only when a step actually becomes possible or impossible.
  const [steps, setSteps] = useState({ next: false, previous: false })

  // Engine events → store. Bound once for the lifetime of the surface.
  useEffect(() => bindYouTubeEngineEvents(), [])

  useEffect(() => {
    setSteps({ next: hasYouTubeSessionStep(1), previous: hasYouTubeSessionStep(-1) })
  }, [sessionItems, sessionIndex])

  /**
   * Tells the page a fixed overlay is covering its lower edge.
   *
   * The surface is `position: fixed`, so on a narrow viewport it sits on top of
   * whatever content happens to be underneath — and that content is not merely
   * hidden, it is unclickable, because the overlay takes the pointer. Adding
   * bottom padding while the player is open means anything in the list can still
   * be scrolled clear of it, which is what keeps the results usable while a
   * video plays.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!surfaceOpen) return
    document.body.dataset.ytSurface = 'open'
    return () => {
      delete document.body.dataset.ytSurface
    }
  }, [surfaceOpen])

  /**
   * How much of the player is on screen, measured rather than assumed.
   *
   * The policy sentence this serves — "must not initiate an automatic playback
   * until the player is visible and more than half of the player is visible" —
   * needs a number at the moment a video ends, which is not a moment React
   * renders. The ratio therefore goes to a module outside React, and
   * `advanceYouTubeSession` reads it synchronously.
   *
   * `threshold` is a fine-grained list so the observer reports crossings around
   * the 0.5 boundary that actually matters, not just enter/exit.
   */
  useEffect(() => {
    const host = hostRef.current
    if (!surfaceOpen || !host) return
    if (typeof IntersectionObserver === 'undefined') {
      // Nothing observed means nothing may auto-advance. Cueing still works.
      resetYouTubeVisibility()
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (entry) setYouTubeVisibleRatio(entry.intersectionRatio)
      },
      { threshold: [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1] },
    )
    observer.observe(host)

    return () => {
      observer.disconnect()
      resetYouTubeVisibility()
    }
  }, [surfaceOpen])

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

      {/* Everything below is a sibling of the stage, never an overlay on it. */}
      <footer className="yt-surface-foot">
        <button
          type="button"
          className="yt-surface-step"
          onClick={() => void playYouTubeSessionStep(-1)}
          aria-label="Previous YouTube result"
          disabled={!steps.previous}
        >
          <SkipBack size={15} fill="currentColor" aria-hidden="true" />
        </button>
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
        <button
          type="button"
          className="yt-surface-step"
          onClick={() => void playYouTubeSessionStep(1)}
          aria-label="Next YouTube result"
          disabled={!steps.next}
        >
          <SkipForward size={15} fill="currentColor" aria-hidden="true" />
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

        {/* Continuous play governs one thing only: moving to the next result the
            search already returned, while this player is on screen. It grants
            nothing in the background and causes no request.

            It sits *inside* the existing footer row rather than on a line of its
            own, and that is a layout decision with a real consequence: the
            surface is a fixed overlay, so every extra row of chrome is a row of
            the results list it covers and makes unclickable on a phone. */}
        {sessionItems.length > 1 ? (
          <label
            className="yt-surface-continuous"
            title={`Plays the next of ${sessionItems.length} results while this player is visible. Never in the background.`}
          >
            <input
              type="checkbox"
              checked={continuousPlay}
              // Explicit, because the visible words are hidden on a phone to keep
              // the footer to one line — the control must still name itself.
              aria-label="Continuous play"
              onChange={(event) => setContinuousPlay(event.target.checked)}
            />
            <span aria-hidden="true">Continuous play</span>
          </label>
        ) : null}
      </footer>

      {/* Shown once, after the fact, and dismissible. Not a toast on every
          visibility change, and not framed as a fault: it is what the YouTube
          developer policies require of an embedded player. */}
      {pausedForBackgroundPolicy && !playing ? (
        <p className="yt-surface-policy" role="status">
          <span>
            YouTube playback pauses when Pulse is in the background. Audius and Jamendo tracks keep
            playing.
          </span>
          <button
            type="button"
            onClick={() => setPausedForBackgroundPolicy(false)}
            aria-label="Dismiss the background playback explanation"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </p>
      ) : null}
    </section>
  )
}
