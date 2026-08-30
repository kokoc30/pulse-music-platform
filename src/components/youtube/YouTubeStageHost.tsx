import { useEffect, useRef } from 'react'
import type { YouTubeVideoItem } from '@/music/types'
import { bindYouTubeEngineEvents, handleDocumentVisibility } from '@/player/youtube-actions'
import { MINIMUM_DIMENSION, getYouTubeEngine } from '@/player/youtube-engine'
import { resetYouTubeVisibility, setYouTubeVisibleRatio } from '@/player/youtube-visibility'
import { useYouTubeStore } from '@/player/youtube-store'

/**
 * The one place a YouTube player is ever mounted — in the bottom bar's slot.
 *
 * A **stage only**: it owns the embed's lifecycle and its visibility
 * measurement, and it renders no transport of its own. Play, pause, stepping,
 * seeking and the title all live in the shared bar and sheet, which is what
 * makes a video and a track look like the same player.
 *
 * It used to live in the expanded sheet, and that was the wrong home for one
 * decisive reason: the sheet is closed most of the time, so the sheet had to be
 * *forced open* for a video to play at all. Pressing a YouTube result took over
 * the screen where pressing an Audius result simply started the bar. The stage
 * moved into the bar's artwork slot, in place of the 56px cover, and the sheet
 * went back to being an optional detail view.
 *
 * It is still an ordinary in-flow element with exactly one home. Nothing about
 * it is fixed-position, measured against another element, or moved between
 * parents — the sheet renders no second stage and is laid out above the bar
 * rather than over it, so the one player stays on screen either way. Reparenting
 * an iframe reloads it, and a video that restarted every time the sheet opened
 * would be a worse bug than the one this replaces.
 *
 * ## Policy obligations this component owns
 *
 * · **Minimum size.** A hard 200 x 200 floor in the style attribute as well as
 *   the stylesheet, so no future CSS edit can shrink it below the documented
 *   minimum.
 * · **Never hidden.** There is no `display: none`, no zero opacity and no
 *   offscreen parking anywhere in its lifecycle. It is rendered for exactly as
 *   long as YouTube is the engine holding the claim, and the bar it sits in is
 *   `position: fixed` and always on screen. There is no state in which a video
 *   plays without this element displayed.
 * · **No children but the player.** The mount node holds the API-created iframe
 *   and nothing else. Every control is a sibling beside or below it.
 * · **The visibility gate.** The `IntersectionObserver` that authorises scripted
 *   autoplay measures *this* element, so the number `advanceYouTubeSession`
 *   reads is a real measurement of the real player.
 * · **Background playback.** A hidden document pauses, always — and, since the
 *   player is on screen again the moment the app is, it resumes.
 *
 * React never owns the element the IFrame API replaces: the API swaps the node
 * it is given for its own iframe, and handing it a React-rendered node would
 * corrupt React's tree on unmount. A plain `div` is created imperatively inside
 * the React-owned host and handed over instead.
 */
export function YouTubeStageHost({ item }: { item: YouTubeVideoItem }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // Read inside the mount effect without making the item a dependency of it:
  // re-attaching on every item change would destroy and rebuild the player the
  // engine is in the middle of loading the new video into.
  const itemRef = useRef(item)
  itemRef.current = item

  // Engine events → store. Bound for the lifetime of the stage, which is the
  // lifetime of the player it describes.
  useEffect(() => bindYouTubeEngineEvents(), [])

  /**
   * A hidden document pauses YouTube. This is the background-playback rule and
   * it is not optional — it applies whatever caused the tab to go away.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibilityChange = () => handleDocumentVisibility(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  /**
   * How much of the player is on screen, measured rather than assumed.
   *
   * "An API Client must not initiate an automatic playback until the player is
   * visible and more than half of the player is visible" needs a number at the
   * moment a video ends, which is not a moment React renders. The ratio goes to
   * a module outside React and `advanceYouTubeSession` reads it synchronously.
   *
   * `threshold` is fine-grained around the 0.5 boundary that actually matters,
   * rather than a bare enter/exit.
   */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
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
  }, [])

  // Hand the engine a plain node inside the React-owned host.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const mount = host.ownerDocument.createElement('div')
    mount.className = 'yt-stage-mount'
    host.appendChild(mount)

    const engine = getYouTubeEngine()
    engine.attach(mount)

    /**
     * A stage that mounts with the engine holding nothing is a stage that has
     * come back after YouTube lost the engine claim to an audio track and this
     * player was destroyed. The store still knows which video was loaded and how
     * far in it was, so cue it and restore the position: the alternative is a
     * transport pointing at a player that no longer exists, and a video that
     * silently restarts from zero.
     *
     * Cue, never play. A remount is not a user gesture.
     */
    if (!engine.getCurrentItem()) {
      const resumeAt = useYouTubeStore.getState().currentTime
      void engine.cue(itemRef.current).then(() => {
        if (resumeAt > 0) engine.seek(resumeAt)
      })
    }

    return () => {
      // Detach destroys the player and its iframe. Playback cannot outlive the
      // stage, which is the point.
      engine.detach()
      mount.remove()
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className="yt-stage"
      data-testid="youtube-stage"
      // The documented hard floor, restated here so it survives any stylesheet.
      style={{ minWidth: MINIMUM_DIMENSION, minHeight: MINIMUM_DIMENSION }}
      // The player carries its own accessible controls; this box is scenery.
      aria-label={`YouTube player: ${item.title}`}
    />
  )
}
