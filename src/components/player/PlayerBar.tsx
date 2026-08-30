import { useCallback, useEffect, useRef } from 'react'
import {
  ChevronUp,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react'
import { LikeButton } from '@/components/library/LikeButton'
import { Artwork } from '@/components/track/Artwork'
import { YouTubeStageHost } from '@/components/youtube/YouTubeStageHost'
import { usePlayerStore } from '@/player/player-store'
import { REPEAT_LABELS } from '@/player/queue-order'
import {
  unifiedDismiss,
  unifiedExpand,
  unifiedNext,
  unifiedPlayPause,
  unifiedPrev,
} from '@/player/unified-actions'
import type { PlaybackSnapshot } from '@/player/use-playback-snapshot'
import { useYouTubeStore } from '@/player/youtube-store'
import { PlayerProgress } from './PlayerProgress'
import { VolumeControl } from './VolumeControl'
import { isInteractiveTarget, useVerticalSwipe } from './swipe'

/**
 * The bottom bar. **One component, every provider.**
 *
 * An Audius track, a Jamendo track and a YouTube video render the same DOM tree
 * through the same code path here — the same title cluster, the same heart, the
 * same seek rail, the same transport, the same expand affordance, in the same
 * order, at the same sizes.
 *
 * **The live player is here, in the artwork slot.** That is the one thing a
 * video changes about this bar, and it is forced by a policy rather than
 * chosen: the embed must be mounted and at least 200 x 200 while it plays, so
 * it cannot live inside a sheet that is closed most of the time. Putting it in
 * the slot a cover occupies makes the bar the playback surface for every
 * provider — press a result, the bar appears and plays, and the sheet stays shut
 * until it is asked for.
 *
 * So the slot is 56px of artwork for a track and a 200px stage for a video, and
 * the bar is correspondingly taller for one. **Nothing else differs**: not the
 * controls, not their order, not their sizes, not the spacing around them.
 *
 * **It still does not know which engine is playing.** There is no `engine ===
 * 'youtube'` in this file. The slot asks `isEmbeddedStage` — a property of the
 * item, answered once by the read model — and every control asks the snapshot's
 * `capabilities` whether it can honestly be offered, then presses a `unified*`
 * action that does the dispatching. That is the mechanism that stops the bar
 * drifting back into two implementations: the previous split existed precisely
 * because the *container* branched, and each branch then grew its own copy of
 * every affordance.
 *
 * A control the active item cannot support is **not rendered**, rather than
 * rendered disabled. A YouTube result session has no running order, so a shuffle
 * button over it would be a promise the app cannot keep; an absent control is
 * honest where a dead one is just confusing.
 */
export function PlayerBar({ snapshot }: { snapshot: PlaybackSnapshot }) {
  const { capabilities: can } = snapshot
  const expand = useCallback(() => unifiedExpand(true), [])
  const barRef = usePublishedBarHeight()

  /**
   * Swiping up on the info region opens Now Playing.
   *
   * `useVerticalSwipe` ignores a gesture that starts on a control, so the heart,
   * the backlink and the transport keep their own presses. The swipe is
   * additive: the chevron and a click on the text do the same thing, which keeps
   * this reachable by keyboard and on a desktop.
   */
  const swipe = useVerticalSwipe({ onSwipeUp: can.expand ? expand : undefined })

  const playing = snapshot.status === 'playing'
  const busy = snapshot.status === 'buffering'

  // Not an engine branch — a "nothing is loaded" guard. A bar with no item is
  // not a different presentation, it is the absence of one.
  if (snapshot.engine === 'none') return null

  return (
    <section
      ref={barRef}
      className="music-player"
      aria-label="Now playing"
      // A presentational hook for styling and test targeting only. Nothing in
      // this component branches on it, and nothing in the stylesheet changes the
      // bar's layout, controls or spacing because of it.
      data-engine={snapshot.engine}
    >
      <div className="player-track" {...swipe}>
        {can.expand ? (
          // A real button rather than a handler on the row: the expansion has to
          // be reachable by keyboard and announceable, and the row also contains
          // a link and a heart that must keep their own activation.
          <button
            type="button"
            className="player-expand"
            onClick={expand}
            aria-label="Open Now Playing"
          >
            <ChevronUp size={16} aria-hidden="true" />
          </button>
        ) : null}

        {/* The slot, and the only thing in this bar a video changes.
            A track gets its 56px cover; a video gets the live player at the
            documented 200px floor. Both are the first element after the expand
            button, both are `flex: 0 0 auto`, and everything after them is
            byte-for-byte the same tree. */}
        {snapshot.isEmbeddedStage && snapshot.stageItem ? (
          <div className="player-stage">
            <YouTubeStageHost item={snapshot.stageItem} />
          </div>
        ) : (
          <Artwork artwork={snapshot.artwork ?? {}} size="small" loading="eager" />
        )}

        {/* Mouse convenience only, the same arrangement `TrackRow` uses: the
            keyboard and assistive-technology route is the real button above, so
            this handler is not the only way in and needs no key handling of its
            own. The guard keeps the backlink inside it clickable — it must open
            its own page, not the sheet. */}
        <div
          className="player-track-text"
          onClick={(event) => {
            if (!can.expand || isInteractiveTarget(event.target)) return
            expand()
          }}
        >
          <b title={snapshot.title}>{snapshot.title}</b>
          <span title={snapshot.subtitle}>
            {snapshot.subtitle}
            <PlayerCredit snapshot={snapshot} />
          </span>
        </div>

        {can.like && snapshot.toLibraryRef ? (
          <LikeButton
            itemKey={snapshot.libraryKey}
            title={snapshot.title}
            toRef={snapshot.toLibraryRef}
            variant="prominent"
            size={18}
          />
        ) : null}

        {/* The icon link is the *convenience* route, and the reference hides
            `.player-track > a` below 560px. That is fine for an Audius
            permalink and unacceptable for a required backlink, so an attributed
            item carries its link on the credit above — inside the
            always-visible artist line — and drops this icon rather than linking
            to the same page twice
            (agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md; agents/18 → "mobile
            attribution"). */}
        {!snapshot.attributionRequired && snapshot.sourceUrl ? (
          <a
            className="player-source"
            href={snapshot.sourceUrl}
            target="_blank"
            rel={snapshot.sourceRel}
            aria-label={`Open ${snapshot.title} on ${snapshot.providerLabel}`}
          >
            <ExternalLink size={18} aria-hidden="true" />
          </a>
        ) : null}
      </div>

      <div className="player-controls">
        <div>
          {can.shuffle ? <ShuffleToggle /> : null}

          <button
            type="button"
            onClick={unifiedPrev}
            disabled={!snapshot.canPrevious}
            aria-label="Previous track"
          >
            <SkipBack size={18} fill="currentColor" aria-hidden="true" />
          </button>

          <button
            type="button"
            className="round-play"
            onClick={unifiedPlayPause}
            disabled={busy}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {busy ? (
              <Loader2 size={19} className="spin" aria-hidden="true" />
            ) : playing ? (
              <Pause size={19} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={19} fill="currentColor" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={unifiedNext}
            disabled={!snapshot.canNext}
            aria-label="Next track"
          >
            <SkipForward size={18} fill="currentColor" aria-hidden="true" />
          </button>

          {can.repeat ? <RepeatToggle /> : null}
        </div>

        <PlayerProgress
          currentTime={snapshot.currentTime}
          duration={snapshot.duration}
          seekable={can.seek}
        />
      </div>

      <div className="player-aside">
        {can.volume ? <VolumeControl /> : null}
        {/* Dismissing stops playback and hands the bar back to the audio track
            that was preserved underneath, paused and showing Play. Without it
            the only way out of a docked player is to start something else. */}
        {can.dismiss ? (
          <button
            type="button"
            className="player-dismiss"
            onClick={unifiedDismiss}
            aria-label="Close the YouTube player and stop playback"
          >
            <X size={17} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Self-gating, and therefore not a branch: it draws nothing unless the
          hidden-document rule actually paused something, and only an embedded
          player is ever paused by that rule. It lives on the bar rather than in
          the expanded sheet because the visitor comes back to a paused video
          without necessarily expanding anything, and an explanation they have to
          go looking for is not an explanation. */}
      <BackgroundPolicyNotice />
    </section>
  )
}

/**
 * Publishes the bar's real height as `--player-bar-height`.
 *
 * The bar is `position: fixed` at the bottom, so anything that must not cover it
 * needs to know how tall it is — and it now has two heights, because a video's
 * slot is a 200px player where a track's is a 56px cover. The expanded sheet is
 * the one consumer: for a video it sits *above* the bar rather than over it,
 * since covering the bar would hide the very player the policies require to stay
 * visible.
 *
 * Measured rather than computed from tokens. The alternative is a constant that
 * has to be kept in step with the stage size, the padding, the border and two
 * breakpoints — four ways to be silently wrong, against one `ResizeObserver`.
 */
function usePublishedBarHeight() {
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const bar = ref.current
    if (!bar || typeof ResizeObserver === 'undefined') return

    const root = bar.ownerDocument.documentElement
    const publish = () => {
      root.style.setProperty('--player-bar-height', `${Math.round(bar.offsetHeight)}px`)
    }
    publish()

    const observer = new ResizeObserver(publish)
    observer.observe(bar)
    return () => {
      observer.disconnect()
      // A bar that is gone has no height, and a stale value would leave the next
      // sheet floating above nothing.
      root.style.removeProperty('--player-bar-height')
    }
  }, [])

  return ref
}

/**
 * Why the video stopped when the tab went away.
 *
 * Shown once, after the fact, and dismissible. Not a toast on every visibility
 * change, and not framed as a fault: it is what the YouTube developer policies
 * require of an embedded player, and saying so is more useful than letting the
 * visitor conclude the app broke.
 */
function BackgroundPolicyNotice() {
  const paused = useYouTubeStore((state) => state.pausedForBackgroundPolicy)
  const status = useYouTubeStore((state) => state.status)
  const dismiss = useYouTubeStore((state) => state.setPausedForBackgroundPolicy)

  if (!paused || status === 'playing') return null

  return (
    <p className="player-policy" role="status">
      <span>
        YouTube playback pauses when Pulse is in the background. Audius and Jamendo tracks keep
        playing.
      </span>
      <button
        type="button"
        onClick={() => dismiss(false)}
        aria-label="Dismiss the background playback explanation"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </p>
  )
}

/**
 * Source attribution, in the always-visible artist line.
 *
 * The rule it enforces is the one `ProviderCredit` enforces for rows and cards,
 * expressed against the snapshot instead of against a `Track` so it can serve a
 * video too: **an item whose provider requires a backlink gets a real anchor,
 * every time, at every breakpoint.** Jamendo's API terms require crediting the
 * artist, crediting Jamendo, and linking each displayed item to its own Jamendo
 * page; YouTube's Required Minimum Functionality requires a link to the watch
 * page. Audius asks for none of that, so an Audius credit is plain text and its
 * permalink stays a dismissible convenience.
 *
 * `noreferrer` is deliberately absent for YouTube — those same rules forbid
 * suppressing the referrer — and present for the catalogues, which have no such
 * requirement.
 */
export function PlayerCredit({ snapshot }: { snapshot: PlaybackSnapshot }) {
  if (!snapshot.providerLabel) return null

  if (snapshot.attributionRequired && snapshot.sourceUrl) {
    return (
      <span className="provider-credit">
        <span aria-hidden="true">·</span>{' '}
        <a
          className="provider-credit-link"
          href={snapshot.sourceUrl}
          target="_blank"
          rel={snapshot.sourceRel}
          // Stops the backlink from also expanding the sheet.
          onClick={(event) => event.stopPropagation()}
          aria-label={`View “${snapshot.title}” on ${snapshot.providerLabel}`}
        >
          {snapshot.providerLabel}
        </a>
      </span>
    )
  }

  return (
    <span className="provider-credit">
      <span aria-hidden="true">·</span> <span>{snapshot.providerLabel}</span>
    </span>
  )
}

/**
 * Shuffle and repeat read and write the audio store directly, and that is
 * correct rather than a leak: they are *audio queue settings*, not transport
 * commands, and they are only ever mounted when `capabilities` has already said
 * this item has a queue to order. Routing a preference through the unified
 * transport would imply YouTube has an answer for it, and it does not.
 */
function ShuffleToggle() {
  const shuffle = usePlayerStore((state) => state.shuffle)
  const setShuffle = usePlayerStore((state) => state.setShuffle)

  return (
    <button
      type="button"
      className="player-toggle"
      data-active={shuffle ? 'true' : 'false'}
      aria-pressed={shuffle}
      aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
      title={shuffle ? 'Shuffle on' : 'Shuffle off'}
      onClick={() => setShuffle(!shuffle)}
    >
      <Shuffle size={16} aria-hidden="true" />
    </button>
  )
}

function RepeatToggle() {
  const repeatMode = usePlayerStore((state) => state.repeatMode)
  const cycleRepeatMode = usePlayerStore((state) => state.cycleRepeatMode)

  return (
    <button
      type="button"
      className="player-toggle"
      data-active={repeatMode === 'off' ? 'false' : 'true'}
      aria-pressed={repeatMode !== 'off'}
      aria-label={REPEAT_LABELS[repeatMode]}
      title={REPEAT_LABELS[repeatMode]}
      onClick={cycleRepeatMode}
    >
      {repeatMode === 'one' ? (
        <Repeat1 size={16} aria-hidden="true" />
      ) : (
        <Repeat size={16} aria-hidden="true" />
      )}
    </button>
  )
}
