import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { YouTubeVideoItem } from '@/music/types'
import { bindYouTubeEngineEvents, handleDocumentVisibility } from '@/player/youtube-actions'
import { MINIMUM_DIMENSION, getYouTubeEngine } from '@/player/youtube-engine'
import { resetYouTubeVisibility, setYouTubeVisibleRatio } from '@/player/youtube-visibility'

/**
 * The one place a YouTube player is ever mounted.
 *
 * A **stage only**: it owns the embed's lifecycle and its visibility
 * measurement, and it renders no transport of its own. Play, pause, stepping,
 * seeking and the title all live in the unified bar and sheet now, which is what
 * makes a video and a track look like the same player.
 *
 * ## Why one instance with a `placement`, rather than one per surface
 *
 * The obvious shape — the bar renders a stage, the sheet renders a stage — is
 * wrong for a reason that is a browser fact rather than a preference: **moving
 * an `<iframe>` to a new parent reloads it.** Rendering a second stage on expand
 * (or portalling one node between two parents) would restart the video from zero
 * every time the sheet opened or closed.
 *
 * So this component is mounted exactly once, by `GlobalPlayer`, and *both*
 * placements are `position: fixed` geometry on the same never-reparented
 * element. Expanding the sheet moves the stage by changing one attribute; the
 * iframe's parent never changes, and playback is undisturbed.
 *
 * ## Policy obligations this component owns
 *
 * · **Minimum size.** A hard 200 × 200 floor in both placements, in the style
 *   attribute as well as the stylesheet, so no future CSS edit can shrink it
 *   below the documented minimum.
 * · **Never hidden.** There is no `display: none`, no zero opacity and no
 *   offscreen parking anywhere in its lifecycle: when there is no video the
 *   component is not rendered at all, and when there is one it is laid out and
 *   on screen. It also sits *above* the expanded sheet in the stacking order, so
 *   the sheet cannot become an overlay in front of the player.
 * · **No children but the player.** The mount node holds the API-created iframe
 *   and nothing else. Every control is a sibling somewhere else in the tree.
 * · **The visibility gate.** The `IntersectionObserver` that authorises scripted
 *   autoplay measures *this* element, so the number `advanceYouTubeSession`
 *   reads is a real measurement of the real player.
 * · **Background playback.** A hidden document pauses, wherever the stage is.
 *
 * React never owns the element the IFrame API replaces: the API swaps the node
 * it is given for its own iframe, and handing it a React-rendered node would
 * corrupt React's tree on unmount. A plain `div` is created imperatively inside
 * the React-owned host and handed over instead.
 */
/**
 * Where the stage should be, in viewport coordinates.
 *
 * Both surfaces render a *slot* — an empty, `aria-hidden` box carrying
 * `data-stage-slot` — and the stage overlays whichever slot is on screen. That
 * indirection is what lets one never-reparented element appear to live in two
 * different layouts: the bar and the sheet each reserve room in their own normal
 * flow, at their own breakpoints, and the stage follows the room they reserved
 * rather than guessing at coordinates that would drift the moment either layout
 * changed.
 */
interface StageBox {
  left: number
  top: number
  width: number
  height: number
}

/** The documented floor, applied to the measurement itself, not just the CSS. */
function clampToMinimum(box: StageBox): StageBox {
  return {
    ...box,
    width: Math.max(box.width, MINIMUM_DIMENSION),
    height: Math.max(box.height, MINIMUM_DIMENSION),
  }
}

export function YouTubeStageHost({
  item,
  placement,
}: {
  item: YouTubeVideoItem
  placement: 'bar' | 'sheet'
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<StageBox | null>(null)
  // Read inside the mount effect without making the item a dependency of it:
  // re-attaching on every item change would destroy and rebuild the player that
  // the engine is in the middle of loading the new video into.
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

  /**
   * Tells the page a fixed player is covering its lower edge, so a list can
   * still be scrolled clear of it. The stage takes the pointer where it sits,
   * and content underneath would otherwise be unreachable rather than merely
   * hidden.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.dataset.ytStage = placement
    return () => {
      delete document.body.dataset.ytStage
    }
  }, [placement])

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
     * come back after the audio engine took the claim and this player was
     * destroyed. The store still knows which video was loaded, so cue it: the
     * alternative is a transport pointing at a player that no longer exists,
     * where pressing play would do nothing at all.
     *
     * Cue, never play. A remount is not a user gesture.
     */
    if (!engine.getCurrentItem()) void engine.cue(itemRef.current)

    return () => {
      // Detach destroys the player and its iframe. Playback cannot outlive the
      // stage, which is the point.
      engine.detach()
      mount.remove()
    }
  }, [])

  /**
   * Track the slot the current placement reserved.
   *
   * Measured rather than hard-coded, and re-measured on everything that can move
   * it: the placement changing, the window resizing, the slot itself resizing,
   * and any scroll (captured, because the sheet is its own scroll container).
   * The alternative — two sets of fixed coordinates — would silently drift out of
   * register with the layouts the moment either one changed, and a stage that is
   * *nearly* over its slot is a stage that overlaps the controls beside it.
   */
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return

    const measure = () => {
      const slot = document.querySelector<HTMLElement>(`[data-stage-slot="${placement}"]`)
      if (!slot) return
      const rect = slot.getBoundingClientRect()
      const next = clampToMinimum({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      })
      setBox((current) =>
        current &&
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next,
      )
    }

    measure()

    const slot = document.querySelector<HTMLElement>(`[data-stage-slot="${placement}"]`)
    const observer =
      typeof ResizeObserver === 'undefined' || !slot ? null : new ResizeObserver(measure)
    observer?.observe(slot as HTMLElement)

    window.addEventListener('resize', measure)
    // Capture phase, so a scroll inside the sheet is seen as well as the page's.
    window.addEventListener('scroll', measure, true)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [placement])

  return (
    <div
      ref={hostRef}
      className="yt-stage"
      data-placement={placement}
      data-testid="youtube-stage"
      style={{
        // The documented hard floor, restated here so it survives any stylesheet.
        minWidth: MINIMUM_DIMENSION,
        minHeight: MINIMUM_DIMENSION,
        ...(box
          ? { left: box.left, top: box.top, width: box.width, height: box.height }
          : // Before the first measurement, park it at a compliant size in the
            // bottom-left rather than at 0×0 — there is no state in which this
            // element is allowed to be smaller than the minimum.
            { left: 12, bottom: 12, width: MINIMUM_DIMENSION, height: MINIMUM_DIMENSION }),
      }}
      // The player carries its own accessible controls; this box is scenery.
      aria-label={`YouTube player: ${item.title}`}
    />
  )
}
