import { useEffect, useRef } from 'react'
import type { YouTubeVideoItem } from '@/music/types'
import {
  bindYouTubeEngineEvents,
  consumeYouTubeResume,
  handleDocumentVisibility,
} from '@/player/youtube-actions'
import { MINIMUM_DIMENSION, getYouTubeEngine } from '@/player/youtube-engine'
import { resetYouTubeVisibility, setYouTubeVisibleRatio } from '@/player/youtube-visibility'
import { useYouTubeStore } from '@/player/youtube-store'

/**
 * The one place a YouTube player is ever mounted — inside the expanded sheet.
 *
 * A **stage only**: it owns the embed's lifecycle and its visibility
 * measurement, and it renders no transport of its own. Play, pause, stepping,
 * seeking and the title all live in the shared bar and sheet, which is what
 * makes a video and a track look like the same player.
 *
 * It is an ordinary in-flow element in the sheet's artwork slot. Nothing about
 * it is fixed-position, measured against another element, or moved between
 * parents: the bar shows YouTube's thumbnail like any other cover, so this has
 * exactly one home and never needs to travel to a second one.
 *
 * ## Policy obligations this component owns
 *
 * · **Minimum size.** A hard 200 x 200 floor in the style attribute as well as
 *   the stylesheet, so no future CSS edit can shrink it below the documented
 *   minimum.
 * · **Never hidden.** There is no `display: none`, no zero opacity and no
 *   offscreen parking anywhere in its lifecycle. When the sheet is closed the
 *   component is not rendered *and playback has been paused* — collapsing goes
 *   through `unifiedExpand`, which pauses a playing video on the way down.
 *   There is no state in which a video plays without this element on screen.
 * · **No children but the player.** The mount node holds the API-created iframe
 *   and nothing else. Every control is a sibling below it in the sheet.
 * · **The visibility gate.** The `IntersectionObserver` that authorises scripted
 *   autoplay measures *this* element, so the number `advanceYouTubeSession`
 *   reads is a real measurement of the real player.
 * · **Background playback.** A hidden document pauses, always.
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
     * come back after the sheet was collapsed and this player destroyed. The
     * store still knows which video was loaded and how far in it was, so cue it
     * and restore the position: the alternative is a transport pointing at a
     * player that no longer exists, and a video that silently restarts from zero
     * every time the sheet is reopened.
     *
     * Cue, never play. A remount is not a user gesture.
     */
    if (!engine.getCurrentItem()) {
      const resumeAt = useYouTubeStore.getState().currentTime
      const resume = consumeYouTubeResume()
      void engine.cue(itemRef.current).then(() => {
        if (resumeAt > 0) engine.seek(resumeAt)
        // Only ever true because a real press asked for it, which is what makes
        // this a user-initiated play rather than a scripted autoplay.
        if (resume) engine.resume()
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
