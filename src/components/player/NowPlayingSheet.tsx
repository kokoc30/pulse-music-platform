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
import { ProviderCredit } from '@/components/track/ProviderCredit'
import { trackRefFromTrack } from '@/library/track-ref'
import { providerLabel } from '@/music/provider-labels'
import type { Track } from '@/music/types'
import {
  SEEK_STEP_SECONDS,
  playNext,
  playPrevious,
  seekBy,
  togglePlay,
} from '@/player/player-actions'
import {
  useDuration,
  useHasNext,
  useHasPrevious,
  useIsLoading,
  usePlayerError,
  useIsPlaying,
  useRepeatMode,
  useShuffle,
  useVideoSurfaceOpen,
} from '@/player/player-selectors'
import { usePlayerStore } from '@/player/player-store'
import { REPEAT_LABELS } from '@/player/queue-order'
import { PlayerProgress } from './PlayerProgress'
import { useVerticalSwipe } from './swipe'

/**
 * The expanded Now Playing view for Audius and Jamendo.
 *
 * **It owns no playback.** Every control here calls the same action the bottom
 * bar calls — `togglePlay`, `playPrevious`, `playNext`, `seekBy`, `setShuffle`,
 * `cycleRepeatMode` — and every value it shows comes from the same store. There
 * is no second `<audio>`, no second queue, no second progress state and no
 * second "next", which is what makes repeat, shuffle, playlist continuation and
 * Phase 6 autoplay behave identically whether the sheet is open or shut.
 *
 * Expanding and collapsing are therefore *presentation only*. The track is never
 * reloaded, playback never pauses, and closing the sheet does nothing to the
 * engine — the same reason `GlobalPlayer` lives outside the router.
 *
 * **Live by construction.** Because it reads the store rather than a snapshot,
 * an autoplay transition updates the artwork, title, artist, attribution, heart
 * and progress in place. Nothing has to be told the track changed.
 *
 * **Audio only.** YouTube has its own visible surface with its own policy rules,
 * and the two must never compete for the screen: while that surface is open this
 * component renders nothing at all.
 */
export function NowPlayingSheet({ track }: { track: Track }) {
  const open = useUiStore((state) => state.nowPlayingOpen)
  const setOpen = useUiStore((state) => state.setNowPlayingOpen)
  const toggleQueue = useUiStore((state) => state.toggleQueue)

  const isPlaying = useIsPlaying()
  const isLoading = useIsLoading()
  const error = usePlayerError()
  const duration = useDuration()
  const hasNext = useHasNext()
  const hasPrevious = useHasPrevious()
  const shuffle = useShuffle()
  const repeatMode = useRepeatMode()
  const setShuffle = usePlayerStore((state) => state.setShuffle)
  const cycleRepeatMode = usePlayerStore((state) => state.cycleRepeatMode)

  // Two full-screen surfaces must never compete. The embedded video player is
  // the one with policy obligations about being visible and unobscured, so it
  // wins and this sheet stands down.
  const videoOpen = useVideoSurfaceOpen()

  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setOpen(false), [setOpen])
  const swipe = useVerticalSwipe({ onSwipeDown: close })

  /** A video taking the screen collapses this rather than stacking on top of it. */
  useEffect(() => {
    if (videoOpen && open) setOpen(false)
  }, [videoOpen, open, setOpen])

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
    if (!open || typeof document === 'undefined') return
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
  }, [open])

  if (!open || videoOpen) return null

  const seekable = duration > 0
  const label = providerLabel(track.provider)
  const attributed = Boolean(track.attributionRequired && track.sourceUrl)

  return (
    <div className="now-playing-scrim" data-testid="now-playing">
      <section
        className="now-playing"
        role="dialog"
        aria-modal="true"
        aria-label="Now playing"
        ref={sheetRef}
      >
        {/* The grab area, and the only place a downward swipe is read. Keeping
            it to its own strip is what stops a drag on the scrubber below from
            closing the sheet. */}
        <header className="now-playing-head">
          {/* The grab strip is its own element rather than the whole header: a press
              on the collapse button belongs to that button, so a header-wide swipe
              zone would be mostly dead area. */}
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

        <div className="now-playing-art">
          {/* The same component and the same mirror failover every other cover
              uses, asked for the largest safe candidate. No second resolver. */}
          <Artwork artwork={track.artwork} size="large" loading="eager" />
        </div>

        <div className="now-playing-meta">
          <div className="now-playing-titles">
            <h2 title={track.title}>{track.title}</h2>
            <p title={track.artistName}>
              {track.artistName}
              {/* Jamendo's per-item backlink is a licence obligation and is as
                  required here as anywhere else — it does not get dropped for
                  want of room on a phone. */}
              <ProviderCredit track={track} variant="link" />
            </p>
            {attributed ? null : track.permalink ? (
              <a
                className="now-playing-source"
                href={track.permalink}
                target="_blank"
                rel="noopener"
              >
                Open on {label}
              </a>
            ) : null}
          </div>

          <div className="now-playing-actions">
            <LikeButton
              itemKey={track.id}
              title={track.title}
              toRef={() => trackRefFromTrack(track)}
              variant="prominent"
              size={22}
            />
            <TrackMenu
              title={track.title}
              itemKey={track.id}
              toRef={() => trackRefFromTrack(track)}
              queueableTrack={track}
            />
          </div>
        </div>

        {error ? (
          <p className="now-playing-error" role="alert">
            {error}
          </p>
        ) : null}

        <PlayerProgress variant="sheet" />

        <div className="now-playing-transport">
          <button
            type="button"
            className="now-playing-skip"
            onClick={() => seekBy(-SEEK_STEP_SECONDS)}
            disabled={!seekable}
            aria-label={`Seek back ${SEEK_STEP_SECONDS} seconds`}
          >
            <RotateCcw size={20} aria-hidden="true" />
            <span aria-hidden="true">{SEEK_STEP_SECONDS}</span>
          </button>

          <button
            type="button"
            onClick={() => void playPrevious()}
            disabled={!hasPrevious}
            aria-label="Previous track"
          >
            <SkipBack size={22} fill="currentColor" aria-hidden="true" />
          </button>

          <button
            type="button"
            className="now-playing-play"
            onClick={() => void togglePlay()}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isLoading ? (
              <Loader2 size={26} className="spin" aria-hidden="true" />
            ) : isPlaying ? (
              <Pause size={26} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={26} fill="currentColor" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void playNext()}
            disabled={!hasNext}
            aria-label="Next track"
          >
            <SkipForward size={22} fill="currentColor" aria-hidden="true" />
          </button>

          <button
            type="button"
            className="now-playing-skip"
            onClick={() => seekBy(SEEK_STEP_SECONDS)}
            disabled={!seekable}
            aria-label={`Seek forward ${SEEK_STEP_SECONDS} seconds`}
          >
            <RotateCw size={20} aria-hidden="true" />
            <span aria-hidden="true">{SEEK_STEP_SECONDS}</span>
          </button>
        </div>

        <div className="now-playing-secondary">
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

          {/* Reuses the existing panel rather than drawing a second queue: the
              explicit queue and the autoplay buffer stay distinct, and nothing
              here presents a generated candidate as something the visitor
              queued. */}
          <button type="button" className="now-playing-queue" onClick={toggleQueue}>
            <ListMusic size={16} aria-hidden="true" /> Up next
          </button>

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
        </div>
      </section>
    </div>
  )
}
