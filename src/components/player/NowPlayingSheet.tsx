import { useCallback, useEffect, useRef } from 'react'
import {
  ChevronDown,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  RotateCw,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import { useUiStore } from '@/app/ui-store'
import { LikeButton } from '@/components/library/LikeButton'
import { TrackMenu } from '@/components/library/TrackMenu'
import { Artwork } from '@/components/track/Artwork'
import { YouTubeStageHost } from '@/components/youtube/YouTubeStageHost'
import { usePlayerStore } from '@/player/player-store'
import { REPEAT_LABELS } from '@/player/queue-order'
import {
  SEEK_STEP_SECONDS,
  unifiedExpand,
  unifiedNext,
  unifiedPlayPause,
  unifiedPrev,
  unifiedSeekBy,
} from '@/player/unified-actions'
import type { PlaybackSnapshot } from '@/player/use-playback-snapshot'
import { useYouTubeStore } from '@/player/youtube-store'
import { PlayerCredit } from './PlayerBar'
import { PlayerProgress } from './PlayerProgress'
import { VolumeControl } from './VolumeControl'
import { useVerticalSwipe } from './swipe'

/**
 * The expanded Now Playing view. **One sheet, every provider.**
 *
 * It used to stand down entirely while a video was on screen — `return null` —
 * because the video had its own floating surface with its own controls, and two
 * full-screen surfaces would have fought for the screen. That surface is gone,
 * and this sheet is now the expanded view for all three providers: same layout,
 * same transport, same heart, same scrubber. A YouTube item differs in one
 * visible way, that the artwork slot holds a live player.
 *
 * **This is the only place an embed is ever mounted.** The bottom bar shows
 * YouTube's own thumbnail in its ordinary 56px cover slot, exactly as it shows a
 * track's artwork, so the bar is byte-for-byte the same shape for every
 * provider. Because the player exists only while this sheet is open, collapsing
 * pauses it — see `unifiedExpand`. There is no state in which a video plays
 * without its player on screen.
 *
 * **It owns no playback.** Every control calls the same `unified*` action the
 * bottom bar calls, and every value it shows comes from the same snapshot. There
 * is no second engine, no second queue, no second progress state and no second
 * "next", which is what makes repeat, shuffle, playlist continuation and
 * autoplay behave identically whether the sheet is open or shut.
 *
 * Every control is a sibling *below* the stage, never an overlay over it, which
 * is the layout rule the developer policies actually impose.
 */
export function NowPlayingSheet({ snapshot }: { snapshot: PlaybackSnapshot }) {
  const open = useUiStore((state) => state.nowPlayingOpen)
  const toggleQueue = useUiStore((state) => state.toggleQueue)
  const { capabilities: can } = snapshot

  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  /**
   * Collapsing goes through the unified action rather than straight to the UI
   * store, because for a video it is not only a change of view: this panel is
   * where the player lives, so collapsing takes it off the page. The action
   * pauses YouTube on the way down. Audio is untouched by it — there, collapsing
   * really is only a change of view over a running `HTMLAudioElement`.
   */
  const close = useCallback(() => unifiedExpand(false), [])
  const swipe = useVerticalSwipe({ onSwipeDown: close })

  /**
   * Focus moves in on open and back out on close.
   *
   * The element that had focus is remembered rather than assumed, because the
   * sheet can be opened from the expand button, from the track info region, or
   * by a swipe — and focus must return wherever it actually came from.
   */
  useEffect(() => {
    if (!open) return
    const returnTo = document.activeElement
    closeRef.current?.focus()
    return () => {
      if (returnTo instanceof HTMLElement && document.contains(returnTo)) returnTo.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  /**
   * The page behind a full-screen sheet must not scroll, and must not lose its
   * place doing so.
   *
   * `overflow: hidden` on the body alone would leave the page where it was; the
   * usual `position: fixed` trick scrolls it to the top instead. So the offset
   * is captured, applied as a negative inset, and restored on the way out — the
   * visitor comes back to the row they were looking at.
   */
  useEffect(() => {
    // A video panel is not modal and does not lock anything: the point of it is
    // that the page behind stays readable and usable while a video plays.
    if (!open || snapshot.isEmbeddedStage || typeof document === 'undefined') return
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
  }, [open, snapshot.isEmbeddedStage])

  if (!open || snapshot.engine === 'none') return null

  const playing = snapshot.status === 'playing'
  const busy = snapshot.status === 'buffering'
  const seekable = can.seek && snapshot.duration > 0

  return (
    <div className="now-playing-scrim" data-testid="now-playing" data-engine={snapshot.engine}>
      <section
        className="now-playing"
        role="dialog"
        // A video panel is deliberately *not* modal. It sits above the bar with
        // the page still visible and clickable behind it, so declaring it modal
        // would be a lie to assistive technology about what is reachable.
        aria-modal={snapshot.isEmbeddedStage ? undefined : true}
        aria-label="Now playing"
        ref={sheetRef}
      >
        {/* The grab area, and the only place a downward swipe is read. Keeping
            it to its own strip is what stops a drag on the scrubber below from
            closing the sheet. */}
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

        {snapshot.isEmbeddedStage && snapshot.stageItem ? (
          /* The live player, in the slot a track's cover occupies — full width,
             16:9, and the only place in the application an embed is ever
             mounted. Every control is a sibling *below* it, never an overlay
             over it, which is the rule the whole layout answers to. */
          <div className="now-playing-stage">
            <YouTubeStageHost item={snapshot.stageItem} />
          </div>
        ) : (
          <div className="now-playing-art">
            {/* The same component and the same mirror failover every other cover
                uses, asked for the largest safe candidate. No second resolver. */}
            <Artwork artwork={snapshot.artwork ?? {}} size="large" loading="eager" />
          </div>
        )}

        <div className="now-playing-meta">
          <div className="now-playing-titles">
            <h2 title={snapshot.title}>{snapshot.title}</h2>
            <p title={snapshot.subtitle}>
              {snapshot.subtitle}
              {/* The required per-item backlink rides on the credit itself, so
                  it is present at every size — the same arrangement the bar
                  uses, and the same one `ProviderCredit` gives every row. */}
              <PlayerCredit snapshot={snapshot} />
            </p>
            {/* The convenience link, for a provider that requires none. An
                attributed item already has its anchor above and does not link to
                the same page twice. */}
            {!snapshot.attributionRequired && snapshot.sourceUrl ? (
              <a
                className="now-playing-source"
                href={snapshot.sourceUrl}
                target="_blank"
                rel={snapshot.sourceRel}
              >
                Open on {snapshot.providerLabel}
              </a>
            ) : null}
          </div>

          <div className="now-playing-actions">
            {can.like && snapshot.toLibraryRef ? (
              <LikeButton
                itemKey={snapshot.libraryKey}
                title={snapshot.title}
                toRef={snapshot.toLibraryRef}
                variant="prominent"
                size={22}
              />
            ) : null}
            {snapshot.toLibraryRef ? (
              <TrackMenu
                title={snapshot.title}
                itemKey={snapshot.libraryKey}
                toRef={snapshot.toLibraryRef}
                {...(snapshot.queueableTrack ? { queueableTrack: snapshot.queueableTrack } : {})}
              />
            ) : null}
          </div>
        </div>

        {snapshot.error ? (
          <p className="now-playing-error" role="alert">
            {snapshot.error}
          </p>
        ) : null}

        <PlayerProgress
          currentTime={snapshot.currentTime}
          duration={snapshot.duration}
          seekable={can.seek}
          variant="sheet"
        />

        <div className="now-playing-transport">
          {/* Relative skip stays an audio affordance. It is the one control here
              whose action is genuinely engine-specific — YouTube's own player
              carries its own ±10s gestures, inside the frame, where a visitor
              already reaches for them. */}
          {can.queue ? (
            <button
              type="button"
              className="now-playing-skip"
              onClick={() => unifiedSeekBy(-SEEK_STEP_SECONDS)}
              disabled={!seekable}
              aria-label={`Seek back ${SEEK_STEP_SECONDS} seconds`}
            >
              <RotateCcw size={20} aria-hidden="true" />
              <span aria-hidden="true">{SEEK_STEP_SECONDS}</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={unifiedPrev}
            disabled={!snapshot.canPrevious}
            aria-label="Previous track"
          >
            <SkipBack size={22} fill="currentColor" aria-hidden="true" />
          </button>

          <button
            type="button"
            className="now-playing-play"
            onClick={unifiedPlayPause}
            disabled={busy}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {busy ? (
              <Loader2 size={26} className="spin" aria-hidden="true" />
            ) : playing ? (
              <Pause size={26} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={26} fill="currentColor" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={unifiedNext}
            disabled={!snapshot.canNext}
            aria-label="Next track"
          >
            <SkipForward size={22} fill="currentColor" aria-hidden="true" />
          </button>

          {can.queue ? (
            <button
              type="button"
              className="now-playing-skip"
              onClick={() => unifiedSeekBy(SEEK_STEP_SECONDS)}
              disabled={!seekable}
              aria-label={`Seek forward ${SEEK_STEP_SECONDS} seconds`}
            >
              <RotateCw size={20} aria-hidden="true" />
              <span aria-hidden="true">{SEEK_STEP_SECONDS}</span>
            </button>
          ) : null}
        </div>

        {can.shuffle || can.queue || can.repeat || can.volume || can.continuous ? (
          <div className="now-playing-secondary">
            {can.shuffle ? <SheetShuffleToggle /> : null}

            {/* Reuses the existing panel rather than drawing a second queue: the
                explicit queue and the autoplay buffer stay distinct, and nothing
                here presents a generated candidate as something the visitor
                queued. */}
            {can.queue ? (
              <button type="button" className="now-playing-queue" onClick={toggleQueue}>
                <ListMusic size={16} aria-hidden="true" /> Up next
              </button>
            ) : null}

            {can.repeat ? <SheetRepeatToggle /> : null}
            {can.volume ? <VolumeControl /> : null}
            {can.continuous ? <ContinuousPlayToggle /> : null}
          </div>
        ) : null}

      </section>
    </div>
  )
}

/**
 * Continue into the next already-fetched result when this one ends.
 *
 * It governs that and nothing else: advancing through results the visitor
 * already has, while the player is on screen. It grants nothing in the
 * background and causes no request — no `search.list`, no `videos.list`, no
 * related-video lookup.
 *
 * It lived on the floating player before that surface was removed, and it moved
 * here rather than being dropped: it is the visitor's own setting, and the
 * expanded view is where a setting belongs now that there is one player.
 */
function ContinuousPlayToggle() {
  const continuousPlay = useYouTubeStore((state) => state.continuousPlay)
  const setContinuousPlay = useYouTubeStore((state) => state.setContinuousPlay)
  const sessionCount = useYouTubeStore((state) => state.sessionItems.length)

  // A standalone video has nothing to continue into, so the switch would be
  // decoration. The rule matches the one the step controls already follow.
  if (sessionCount < 2) return null

  return (
    <label
      className="now-playing-continuous"
      title={`Plays the next of ${sessionCount} results while this player is visible. Never in the background.`}
    >
      <input
        type="checkbox"
        checked={continuousPlay}
        aria-label="Continuous play"
        onChange={(event) => setContinuousPlay(event.target.checked)}
      />
      <span aria-hidden="true">Continuous play</span>
    </label>
  )
}

/**
 * Queue settings, not transport commands — mounted only once `capabilities` has
 * said this item has a running order to reorder. See `PlayerBar` for the same
 * pair and the same reasoning.
 */
function SheetShuffleToggle() {
  const shuffle = usePlayerStore((state) => state.shuffle)
  const setShuffle = usePlayerStore((state) => state.setShuffle)

  return (
    <button
      type="button"
      className="player-toggle"
      data-active={shuffle ? 'true' : 'false'}
      aria-pressed={shuffle}
      aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
      onClick={() => setShuffle(!shuffle)}
    >
      <Shuffle size={17} aria-hidden="true" />
    </button>
  )
}

function SheetRepeatToggle() {
  const repeatMode = usePlayerStore((state) => state.repeatMode)
  const cycleRepeatMode = usePlayerStore((state) => state.cycleRepeatMode)

  return (
    <button
      type="button"
      className="player-toggle"
      data-active={repeatMode === 'off' ? 'false' : 'true'}
      aria-pressed={repeatMode !== 'off'}
      aria-label={REPEAT_LABELS[repeatMode]}
      onClick={cycleRepeatMode}
    >
      {repeatMode === 'one' ? (
        <Repeat1 size={17} aria-hidden="true" />
      ) : (
        <Repeat size={17} aria-hidden="true" />
      )}
    </button>
  )
}
