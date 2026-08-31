import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useUiStore } from '@/app/ui-store'
import { YouTubeStageHost } from '@/components/youtube/YouTubeStageHost'
import { unifiedExpand } from '@/player/unified-actions'
import { usePlaybackSnapshot } from '@/player/use-playback-snapshot'
import { JoinStrip } from './JoinStrip'
import { NowPlayingSheet } from './NowPlayingSheet'
import { PlayerBar } from './PlayerBar'
import { useVerticalSwipe } from './swipe'

/**
 * The player shell: **one surface, two presentations, one player.**
 *
 * Rendered once in the app shell, outside the router, so navigating never
 * remounts it (agents/07_PLAYER_BEHAVIOR.md → "Navigation Persistence").
 *
 * ## What this component is for
 *
 * The application has two playback engines and keeps them entirely separate —
 * separate stores, separate types, separate actions, arbitrated by
 * `playback-coordinator`. What it must not have is two *presentations* of them,
 * and for a while it had three: a bottom bar, an expanded sheet, and — because
 * the YouTube player has to be mounted somewhere permanent — a 200px live video
 * inside the bar's artwork slot. Expanding a video then put the sheet's full
 * transport *on top of* a bar that still carried its own, so a phone showed two
 * Play buttons, two Next buttons, two hearts and two progress rails over one
 * video. That is the arrangement this shell replaces.
 *
 * ## Collapsed and expanded are alternatives, not layers
 *
 * `data-mode` says which presentation is on screen, and exactly one of the two
 * subtrees below is rendered at a time. Not hidden — **not rendered** — so there
 * is nothing underneath the expanded view to duplicate a control, catch a Tab or
 * appear in the accessibility tree. It is the same rule `capabilities` applies
 * to individual controls, applied to the presentation as a whole.
 *
 * ## The player exists only while the expanded view is open
 *
 * A YouTube player must be mounted and at least 200 x 200 while it plays, and
 * for a while that requirement was met by *docking* the stage beside the
 * mini-player: a 356 x 200 video card floating above the bottom-right corner,
 * on screen the whole time the bar was. It satisfied the policy and it looked
 * like two players — a Pulse bar, and a separate YouTube box beside it — where
 * an audio track showed one compact row. That is the report this arrangement
 * answers.
 *
 * So the stage is mounted **only when `nowPlayingOpen` is true**. Collapsed,
 * both engines are one bottom bar and nothing else: a video shows its own
 * thumbnail in the same 56px slot a cover occupies, and there is no iframe on
 * the page at all.
 *
 * **Not hidden — absent.** `opacity: 0`, `visibility: hidden` and offscreen
 * parking would each leave a live player running where the visitor cannot see
 * it, which is precisely the background playback the developer policies
 * prohibit. Unmounting is the only answer that is true.
 *
 * The cost is real and is paid deliberately: the iframe is destroyed on
 * collapse and rebuilt on expand, because reparenting or remounting one reloads
 * it. `YouTubeStageHost` pauses and publishes the exact position on the way
 * down, and restores the video and that position on the way back up, so what
 * the visitor loses is a moment of loading rather than their place.
 *
 * The collapse handle is rendered before the stage so the grab strip and the
 * chevron sit above the video in the expanded layout.
 */
export function GlobalPlayer() {
  const snapshot = usePlaybackSnapshot()
  const expanded = useUiStore((state) => state.nowPlayingOpen)

  if (snapshot.engine === 'none') return <JoinStrip />

  /**
   * The item the live player should host, or null for "no player on the page".
   *
   * Two conditions, and neither is an engine branch: *this item is hosted by an
   * embedded player* (a property of the loaded item, answered once by the read
   * model) and *the expanded view is open*. Collapsed, this is null for every
   * provider, and the bar draws the item's artwork exactly as it does for a
   * track.
   */
  const stageItem = expanded && snapshot.isEmbeddedStage ? snapshot.stageItem : null

  return (
    <ExpandedSurface expanded={expanded}>
      <div
        className="player-shell"
        data-mode={expanded ? 'expanded' : 'collapsed'}
        data-engine={snapshot.engine}
        data-stage={stageItem ? 'youtube' : 'artwork'}
        {...(expanded ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Now playing' } : {})}
      >
        {expanded ? <CollapseHandle /> : null}

        {stageItem ? (
          <div className="yt-stage-frame">
            <YouTubeStageHost item={stageItem} />
          </div>
        ) : null}

        {expanded ? <NowPlayingSheet snapshot={snapshot} /> : <PlayerBar snapshot={snapshot} />}
      </div>
    </ExpandedSurface>
  )
}

/**
 * The scrim and the scroll lock — the parts of "expanded" that are behaviour
 * rather than layout.
 *
 * They live in a wrapper rather than in the sheet because the sheet is no longer
 * the whole of the expanded view: the collapse handle and the video are siblings
 * of it now. Wrapping keeps the shell in one stable slot, so mounting and
 * unmounting the scrim beside it cannot disturb the stage inside it.
 *
 * **Both apply to a video too, and that is the change.** They used to be
 * withheld for one, because the player lived in the bar and the sheet was laid
 * out above it — the page behind had to stay usable, since the bar was still the
 * thing holding the video. Expanding now *replaces* the mini-player rather than
 * stacking over it, so the expanded view is genuinely modal for either engine
 * and can say so honestly.
 */
function ExpandedSurface({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  /**
   * Where the keyboard ends up on the way down.
   *
   * The chevron that opened the expanded view is unmounted while it is open, so
   * the element `CollapseHandle` remembered is gone by the time it tries to hand
   * focus back — and a keyboard visitor would be dropped on `<body>`, at the top
   * of the page, every time they collapsed the player. The mini-player's own
   * expand control is that element's replacement, so focus goes there.
   *
   * Only when nothing else has claimed it: opening from the track text, or from
   * a control that does survive, is still restored by `CollapseHandle`, and this
   * must not overrule it.
   */
  const wasExpanded = useRef(expanded)
  useEffect(() => {
    const collapsing = wasExpanded.current && !expanded
    wasExpanded.current = expanded
    if (!collapsing || typeof document === 'undefined') return
    if (document.activeElement !== document.body) return
    document.querySelector<HTMLElement>('.music-player .player-expand')?.focus()
  }, [expanded])

  /**
   * The page behind a full-screen surface must not scroll, and must not lose its
   * place doing so.
   *
   * `overflow: hidden` on the body alone would leave the page where it was; the
   * usual `position: fixed` trick scrolls it to the top instead. So the offset
   * is captured, applied as a negative inset, and restored on the way out — the
   * visitor comes back to the row they were looking at.
   */
  useEffect(() => {
    if (!expanded || typeof document === 'undefined') return
    const { body } = document
    const scrollY = window.scrollY
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    }

    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'

    return () => {
      body.style.position = previous.position
      body.style.top = previous.top
      body.style.width = previous.width
      body.style.overflow = previous.overflow
      window.scrollTo(0, scrollY)
    }
  }, [expanded])

  return (
    <>
      {expanded ? <div className="now-playing-scrim" aria-hidden="true" /> : null}
      {children}
    </>
  )
}

/**
 * The grab strip and the chevron, above the primary media region.
 *
 * A real button rather than a gesture alone: swiping is additive, and an
 * affordance only a touch screen can reach is not an affordance. The strip is
 * the only place a downward swipe is read, which is what stops a drag on the
 * scrubber below from collapsing the view.
 *
 * It is a **collapse**, never a dismiss. Coming down returns to the mini-player
 * with the same item, the same position, the same collection session and the
 * same engine still running; stopping a video and handing the bar back to the
 * audio track underneath is a different act with a different control, on the bar
 * (`unifiedDismiss`). A chevron where a cross belongs — or the reverse — is how
 * a visitor loses their place by pressing the obvious thing.
 *
 * Focus moves here on open and back to wherever it came from on close, because
 * the view can be opened from the chevron, from the track text, by a swipe, or
 * by a saved list arriving at a video with nobody touching anything at all.
 */
function CollapseHandle() {
  const closeRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => unifiedExpand(false), [])
  const swipe = useVerticalSwipe({ onSwipeDown: close })

  useEffect(() => {
    const returnTo = document.activeElement
    closeRef.current?.focus()
    return () => {
      if (returnTo instanceof HTMLElement && document.contains(returnTo)) returnTo.focus()
      // Focus came from a control that no longer exists — which is the ordinary
      // case, not an edge one, because the expanded view replaces the
      // mini-player rather than covering it. `ExpandedSurface` picks that up.
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close])

  return (
    <header className="now-playing-head">
      <div className="now-playing-grab" {...swipe}>
        <span className="now-playing-grip" aria-hidden="true" />
      </div>
      <button
        ref={closeRef}
        type="button"
        className="now-playing-collapse"
        onClick={close}
        aria-label="Collapse Now Playing"
      >
        <ChevronDown size={22} aria-hidden="true" />
      </button>
    </header>
  )
}
