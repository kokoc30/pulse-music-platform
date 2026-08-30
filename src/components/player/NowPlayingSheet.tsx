import {
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
import {
  isPlaybackDebugEnabled,
  lastTraceDetail,
  tracedSteps,
  tracedValues,
} from '@/player/playback-trace'
import { usePlayerStore } from '@/player/player-store'
import { REPEAT_LABELS } from '@/player/queue-order'
import {
  SEEK_STEP_SECONDS,
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

/**
 * The expanded Now Playing composition. **One sheet, every provider.**
 *
 * Everything below the primary media region: the title cluster, the heart and
 * the menu, the scrubber, the transport, and the secondary row of settings. The
 * media region itself is above it — a large cover for a track, drawn here, and
 * for a video the one live official player, which is a sibling owned by
 * `GlobalPlayer` because an iframe cannot be reparented without reloading.
 *
 * **This is now the *only* transport on screen while it is open.** It used to
 * sit above a bottom bar that carried a complete second one: its own Play, its
 * own Next and Previous, its own heart, its own progress rail, and — for a video
 * — the live player itself, 200px of it, directly underneath this panel. That
 * arrangement was forced by where the stage lived, and it is what a real phone
 * showed: two of every control, stacked. The shell renders one presentation at a
 * time now, so the duplication is gone by construction rather than by hiding
 * anything.
 *
 * **It owns no playback.** Every control calls the same `unified*` action the
 * mini-player calls, and every value it shows comes from the same snapshot.
 * There is no second engine, no second queue, no second progress state and no
 * second "next", which is what makes repeat, shuffle, playlist continuation and
 * autoplay behave identically whichever presentation is up.
 */
export function NowPlayingSheet({ snapshot }: { snapshot: PlaybackSnapshot }) {
  const toggleQueue = useUiStore((state) => state.toggleQueue)
  const { capabilities: can } = snapshot

  if (snapshot.engine === 'none') return null

  const playing = snapshot.status === 'playing'
  const busy = snapshot.status === 'buffering'
  const seekable = can.seek && snapshot.duration > 0

  return (
    <div className="now-playing-body" data-testid="now-playing">
      {/* The primary media region for a track. A video's is the stable stage
          `GlobalPlayer` keeps mounted above this panel — the same visual slot,
          filled by a live player instead of a still, which is why nothing here
          draws a placeholder cover for one. */}
      {snapshot.isEmbeddedStage ? null : (
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
            {/* The required per-item backlink rides on the credit itself, so it
                is present at every size — the same arrangement the mini-player
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

      <AutoplayBlockedNotice />

      <PlaybackDebugReadout />

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
    </div>
  )
}

/**
 * One quiet line, for the one case the visitor cannot otherwise make sense of.
 *
 * A video sitting on a thumbnail looks identical whether this application chose
 * not to start it or the browser refused to let it. Those need different words,
 * and only one of them needs any:
 *
 * · **Visibility, a hidden document, a player that never became usable** — the
 *   app's own decisions, taken while the visitor was elsewhere or the player was
 *   not really on screen. A Play button is a complete answer; a sentence
 *   explaining an internal rule would be noise.
 * · **The browser refused a play this app did issue** — a saved list moved on,
 *   the player is right there, and pressing Play is the only thing that will
 *   work. Saying so is the difference between a considered design and something
 *   that looks broken.
 *
 * Deliberately not an error, and deliberately not phrased as a failure: nothing
 * went wrong, and nothing in this codebase should try to work around it.
 */
function AutoplayBlockedNotice() {
  const reason = useYouTubeStore((state) => state.awaitingUserPlayReason)
  const awaiting = useYouTubeStore((state) => state.awaitingUserPlay)

  if (!awaiting || reason !== 'autoplay-blocked') return null

  return (
    <p className="now-playing-hint" role="status">
      Your browser asked for a tap before playing this video.
    </p>
  )
}

/**
 * The diagnostic readout, for a debug build and for nothing else.
 *
 * A physical phone is the one place the reported failure reproduces and the one
 * place a debugger is least useful, so the trace the transition already records
 * is shown on the device that produced it. It says which of the two candidate
 * causes actually happened — a ratio that never cleared the bar, or a play
 * command the browser refused — which is the whole question.
 *
 * Off unless `?debugPlayback=1` or the matching `localStorage` key is set, and
 * it renders nothing at all otherwise. It shows the app's own measurements: no
 * keys, no identifiers, nothing from a provider payload.
 */
function PlaybackDebugReadout() {
  const reason = useYouTubeStore((state) => state.awaitingUserPlayReason)
  const status = useYouTubeStore((state) => state.status)

  if (!isPlaybackDebugEnabled()) return null

  const decision = lastTraceDetail('decide:result') ?? {}
  const measurement = lastTraceDetail('visibility:resolved') ?? {}

  /**
   * Rendered as text, so anything that is not already a primitive becomes a
   * dash rather than `[object Object]` — a readout nobody can act on is worse
   * than an absent one. The trace's details are `unknown` by design: it records
   * what happened, and it is not the trace's job to know how this draws it.
   */
  const show = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return '—'
  }

  const measured = lastTraceDetail('decide:measured') ?? {}

  const rows: [string, unknown][] = [
    ['status', status],
    ['ratio', decision.visibleRatio],
    ['measured', decision.measured],
    ['waited (ms)', decision.waitedMs],
    ['wait ended', measurement.outcome],
    ['player ready', measured.playerReady],
    // The configuration fact, read from the real generated frame. If this is
    // false a scripted start cannot succeed however visible the player is, and
    // the fix is a permission rather than a timing.
    ['iframe autoplay', measured.iframeAllowsAutoplay],
    ['decision', decision.mode],
    ['withheld', decision.withheld],
    ['commands', tracedValues('engine:command', 'command').join(' → ')],
    ['states', tracedValues('engine:state', 'state').join(' → ')],
    ['outcome', lastTraceDetail('engine:outcome')?.outcome],
    ['blocked', tracedSteps().includes('engine:autoplay-blocked')],
    ['awaiting', reason],
  ]

  return (
    <dl className="playback-debug" aria-label="Playback diagnostics">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{show(value)}</dd>
        </div>
      ))}
    </dl>
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
 * A video playing from a saved list never reaches it: `sessionItems` is cleared
 * when a collection routes an item here, and a collection continues on its own
 * terms whatever this switch says.
 */
function ContinuousPlayToggle() {
  const continuousPlay = useYouTubeStore((state) => state.continuousPlay)
  const setContinuousPlay = useYouTubeStore((state) => state.setContinuousPlay)
  // Only for the label. Whether this control exists at all is `can.continuous`,
  // which is where "a standalone video has nothing to continue into" is decided
  // — the component used to decide it a second time and return null, leaving the
  // row above it drawing an empty divider.
  const sessionCount = useYouTubeStore((state) => state.sessionItems.length)

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
