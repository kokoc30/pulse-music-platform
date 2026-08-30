import { useEffect, useRef } from 'react'
import type { YouTubeVideoItem } from '@/music/types'
import { bindYouTubeEngineEvents, handleDocumentVisibility } from '@/player/youtube-actions'
import { MINIMUM_DIMENSION, getYouTubeEngine } from '@/player/youtube-engine'
import {
  registerYouTubeStageElement,
  resetYouTubeVisibility,
  setYouTubeVisibleRatio,
} from '@/player/youtube-visibility'
import { useYouTubeStore } from '@/player/youtube-store'

/**
 * The one place a YouTube player is ever mounted — a stable child of the player
 * shell.
 *
 * A **stage only**: it owns the embed's lifecycle and its visibility
 * measurement, and it renders no transport of its own. Play, pause, stepping,
 * seeking and the title all live in the shared mini-player and expanded view,
 * which is what makes a video and a track look like the same player.
 *
 * ## Where it lives, and why it is nowhere else
 *
 * It has been in two wrong homes. In the expanded sheet, which is closed most of
 * the time, so the sheet had to be *forced open* for a video to play at all. Then
 * in the bottom bar's artwork slot, which made the bar 216px of black video card
 * on a phone and left the expanded sheet stacked on top of a bar that still
 * carried its own complete transport — two Play buttons over one video.
 *
 * It belongs to neither, so it is a sibling of both, mounted by `GlobalPlayer`
 * and never moved: the collapsed and expanded presentations are alternatives
 * rendered in the same slot beside it, and only the stage's *box* changes
 * between them, in CSS. Reparenting an iframe reloads it, and a video that
 * restarted every time the view changed would be a worse bug than either of the
 * two this replaces.
 *
 * ## Policy obligations this component owns
 *
 * · **Minimum size.** A hard 200 x 200 floor in the style attribute as well as
 *   the stylesheet, so no future CSS edit can shrink it below the documented
 *   minimum — in the docked geometry as well as the expanded one.
 * · **Never hidden.** There is no `display: none`, no zero opacity and no
 *   offscreen parking anywhere in its lifecycle. It is rendered for exactly as
 *   long as YouTube is the engine holding the claim, and the shell it sits in is
 *   `position: fixed` and always on screen in both presentations. There is no
 *   state in which a video plays without this element displayed.
 * · **No children but the player.** The mount node holds the API-created iframe
 *   and nothing else. Every control is a sibling beside or below it.
 * · **The visibility gate.** The `IntersectionObserver` that authorises scripted
 *   autoplay measures *this* element — the one that contains the live player —
 *   so every number `mayAutoplay` sees is a real measurement of the real player,
 *   in the geometry it actually has. When the shell moves the stage from docked
 *   to expanded, the observer re-reports on its own, which is what makes the
 *   reveal-then-measure hand-off in `playYouTubeVideo` work without anything
 *   polling or guessing.
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
   * A hidden document pauses YouTube, and a visible one picks it up again.
   *
   * The pause is the background-playback rule and it is not optional — it
   * applies whatever caused the tab to go away. The resume is the other half of
   * the same rule rather than an exception to it: an app switch or a locked
   * screen is not a decision to stop listening, and coming back to a silent
   * video the visitor never paused is the behaviour that was reported. Only a
   * pause this rule caused is ever undone; `handleDocumentVisibility` owns that
   * distinction.
   *
   * Two events, because they answer different questions and neither covers the
   * other. `visibilitychange` is what a phone sends when the app is backgrounded
   * or the screen locks. `focus` is what a desktop sends when the window comes
   * forward from behind another one, which can happen with no visibility change
   * at all — and is harmless when nothing was paused, since the handler then
   * finds no background pause to undo.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibilityChange = () => handleDocumentVisibility(document.visibilityState === 'hidden')
    const onFocus = () => handleDocumentVisibility(false)

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  /**
   * How much of the player is on screen, measured rather than assumed.
   *
   * "An API Client must not initiate an automatic playback until the player is
   * visible and more than half of the player is visible" needs a number at the
   * moment a video ends, which is not a moment React renders. The ratio goes to
   * a module outside React; `advanceYouTubeSession` reads it synchronously, and
   * `playYouTubeVideo` *waits* for it when the player it is about to start has
   * only just been revealed.
   *
   * `threshold` is fine-grained around the 0.5 boundary that actually matters,
   * rather than a bare enter/exit. The observer is created once and follows the
   * element for the stage's whole life, so a change of geometry — docked to
   * expanded — is reported by the browser rather than re-derived by us.
   */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Registered before anything is observed, so "is there a real, laid-out
    // player yet?" is answerable during the very frames the reveal is still
    // settling. A waiter uses it to tell "no player" from "player off screen",
    // which are the same zero and must not resolve the same way.
    registerYouTubeStageElement(host)

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
     * Cue, never play. A remount is not a user gesture, and it is not an
     * authorised automatic start either — nothing has measured anything.
     *
     * It rarely runs now, and that is deliberate. A transition that is about to
     * play cues the item itself during phase 1, which sets the engine's current
     * item before this effect ever sees it. The restore path is therefore back
     * to being what its name says — a restore — rather than a second request
     * racing the first, which is how a cue once landed on top of a play and
     * stopped a video that had just started.
     */
    if (!engine.getCurrentItem()) {
      const resumeAt = useYouTubeStore.getState().currentTime
      void engine.start(itemRef.current, { mode: 'cue' }).then(() => {
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
