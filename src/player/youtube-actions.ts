import { useUiStore } from '@/app/ui-store'
import { canEmbedYouTubeItem, embedBlockReason } from '@/music/youtube/normalize'
import { isYouTubeVideoItem } from '@/music/types'
import type { YouTubeVideoItem } from '@/music/types'
import {
  advanceCollection,
  collectionOwnsItemKey,
  collectionSession,
  nextCollectionPosition,
  previousCollectionPosition,
  retreatCollection,
} from './collection-session'
import { activateYouTube, activeEngine, releasePlayback } from './playback-coordinator'
import { usePlayerStore } from './player-store'
import {
  NO_MORE_TRACKS_MESSAGE,
  RELATED_RETRY_DELAY_MS,
  describeSeed,
  fetchRelated,
  notePlayed,
} from './related-fetcher'
import { beginPlaybackTrace, tracePlayback } from './playback-trace'
import { getYouTubeEngine } from './youtube-engine'
import type { PlaybackStartMode } from './youtube-engine'
import {
  hasMeasuredYouTubeVisibility,
  documentHidden as isDocumentHidden,
  waitForYouTubeVisibility,
  youTubeVisibilitySnapshot,
  youTubeVisibleRatio,
} from './youtube-visibility'
import { useYouTubeStore } from './youtube-store'
import type { AwaitingPlayReason, YouTubePlaybackState, YouTubeStatus } from './youtube-store'

/**
 * Every way YouTube playback can start, change or stop.
 *
 * The policy rules live here rather than in a component so they hold whichever
 * surface calls them:
 *
 * · an item that may not be embedded never reaches the engine at all,
 * · a scripted (non-gesture) transition cues and waits, unless the caller has
 *   confirmed the player is more than half visible,
 * · a hidden document pauses,
 * · closing the surface stops playback.
 */

type Store = typeof useYouTubeStore

/**
 * Why a video reaches the screen, and what that means for the presentation.
 *
 * Not every route into YouTube deserves the same surface. A visitor pressing a
 * video, and a saved list arriving at one on its own, both need the official
 * player to become the thing on screen — the video *is* the content, and leaving
 * it docked at the bottom of the page while the title changes underneath is the
 * defect this exists to close. A step *within* an open player is different: the
 * surface is already whatever the visitor last chose, and changing it under them
 * would be the app overruling a decision they made a moment ago.
 *
 * `'restore'` is the fourth case and the reason this is an enum rather than a
 * boolean: a remount or an internal store change must move nothing at all.
 */
export type YouTubePresentationReason =
  'user-selection' | 'collection-transition' | 'session-step' | 'restore'

/**
 * The one place the YouTube player's surface is prepared, for every caller.
 *
 * Two things happen, in this order, and the order is the fix rather than a
 * detail: the engine claim is taken, and — for a route that warrants it — the
 * expanded view is opened. Only after both is anything measured or played, which
 * is the ordering agents/24 specifies (render the visible surface, *then* wait
 * for readiness, *then* load).
 *
 * It is a single exported action instead of `setNowPlayingOpen(true)` scattered
 * through the call sites for the reason agents/32 gives: presentation decisions
 * that live in ten files become ten slightly different decisions. The library
 * layer asks for a *reason*; what that reason does to the screen is decided
 * here, once.
 */
export function prepareYouTubePlaybackSurface(
  reason: YouTubePresentationReason = 'user-selection',
): void {
  activateYouTube()
  if (reason === 'user-selection' || reason === 'collection-transition') {
    useUiStore.getState().setNowPlayingOpen(true)
  }
}

/**
 * How visible the player must be before *scripted* playback may begin.
 *
 * "An API Client must not initiate an automatic playback until the player is
 * visible and more than half of the player is visible on the page or screen."
 * — Required Minimum Functionality. "More than half" is `> 0.5`, so the
 * comparison is strict.
 */
export const AUTOPLAY_VISIBILITY_RATIO = 0.5

export interface StartOptions {
  /** True only when called straight from a real user gesture. */
  userInitiated: boolean
  /**
   * A ratio the caller has *already measured* for a player that already exists.
   *
   * Supplying it opts out of the reveal-then-measure sequence below, which is
   * right for a transition inside a running player — `advanceYouTubeSession`
   * reads the live observer synchronously at the instant a video ends, and there
   * is nothing to wait for. Leaving it out is what a caller does when the player
   * is about to be built: see `playYouTubeVideo`.
   *
   * `undefined` therefore no longer means "assume not visible". It means "you
   * measure it", which is the distinction Bug A turned on.
   */
  visibleRatio?: number
  /** Defaults to the live document. */
  documentHidden?: boolean
  /** How this playback was reached. Decides the surface, never the policy. */
  reason?: YouTubePresentationReason
}

/**
 * Whether a scripted transition is allowed to start playback on its own.
 *
 * Every unknown resolves to `false`. That is the whole point: the requirement
 * is not "autoplay unless we know it is hidden", it is "do not autoplay until
 * we know it is visible" (agents/21 → "If uncertain, cue ... and require an
 * explicit play action").
 */
export function mayAutoplay(options: StartOptions): boolean {
  if (options.userInitiated) return true
  if (options.documentHidden) return false
  if (typeof options.visibleRatio !== 'number') return false
  return options.visibleRatio > AUTOPLAY_VISIBILITY_RATIO
}

function documentIsHidden(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * Two separate facts about one transition, deliberately not one boolean.
 *
 * `directUserGesture` answers "did a human just press something". `mode` answers
 * "is the engine to play this or merely cue it". They are related but not the
 * same, and collapsing them is what made an authorised automatic start have to
 * describe itself to the engine as a click. `reason` is why the decision came
 * out as it did, which is the thing the reported failure needed and nobody had.
 */
export interface StartDecision {
  mode: PlaybackStartMode
  directUserGesture: boolean
  /** Null when the answer was `'play'`; otherwise why it was not. */
  withheld: AwaitingPlayReason | null
  /** The ratio the decision was actually made on, for the trace. */
  visibleRatio: number
  measured: boolean
  waitedMs: number
}

/**
 * Phase 2: decide what the revealed player is allowed to do, and prove it can.
 *
 * Four routes, and only the last one waits for anything:
 *
 * · **A gesture** needs no measurement. `mayAutoplay` has always said so, and
 *   the visibility sentence is about *automatic* playback.
 * · **A hidden document** is refused outright, before any wait. There is nothing
 *   an observer could report that would make playing into a locked screen
 *   acceptable, and waiting to reach the same answer would only delay the cue.
 * · **A caller holding a measurement** — a transition inside an already-open
 *   player — uses it and skips the wait entirely.
 * · **Anything else** waits, bounded, for the real observer on the stage phase 1
 *   has just revealed, and then for the player to actually become usable.
 *
 * **Readiness is part of the decision, not an afterthought.** Visibility and
 * readiness are independent: the box can be laid out and measured a second or
 * more before the IFrame API script has loaded and built a player inside it.
 * Deciding to autoplay on the strength of visibility alone, and then issuing the
 * command into a player that does not exist, is a command that does nothing —
 * the video sits on a thumbnail with the store insisting it is loading. So the
 * two waits run together and the decision is taken after both.
 *
 * Nothing here manufactures a ratio. The number that reaches `mayAutoplay` is
 * either one the caller measured or one an `IntersectionObserver` reported on
 * the real stage element; a wait that ends without one carries `measured:
 * false`, which resolves to *cue and ask for a press*.
 */
async function decideStart(options: StartOptions): Promise<StartDecision> {
  const base = { directUserGesture: options.userInitiated }

  if (options.userInitiated) {
    tracePlayback('decide:gesture')
    return { ...base, mode: 'play', withheld: null, visibleRatio: 1, measured: true, waitedMs: 0 }
  }

  if (documentIsHidden(options.documentHidden)) {
    tracePlayback('decide:document-hidden')
    return {
      ...base,
      mode: 'cue',
      withheld: 'document-hidden',
      visibleRatio: youTubeVisibleRatio(),
      measured: hasMeasuredYouTubeVisibility(),
      waitedMs: 0,
    }
  }

  if (typeof options.visibleRatio === 'number') {
    const allowed = mayAutoplay({ ...options, documentHidden: false })
    tracePlayback('decide:caller-measured', { ratio: options.visibleRatio, allowed })
    return {
      ...base,
      mode: allowed ? 'play' : 'cue',
      withheld: allowed ? null : 'visibility',
      visibleRatio: options.visibleRatio,
      measured: true,
      waitedMs: 0,
    }
  }

  tracePlayback('decide:waiting', youTubeVisibilitySnapshot())
  const engine = getYouTubeEngine()
  const [measurement, ready] = await Promise.all([
    waitForYouTubeVisibility({ minimumRatio: AUTOPLAY_VISIBILITY_RATIO }),
    engine.whenReady(),
  ])
  const iframe = engine.describeIframe()
  tracePlayback('decide:measured', {
    ...measurement,
    playerReady: ready,
    // The configuration fact that decides whether a scripted start could ever
    // succeed, read from the real generated frame rather than assumed.
    iframeAllowsAutoplay: iframe?.allowsAutoplay ?? null,
    iframeAllow: iframe?.allow ?? null,
  })

  // Re-read the document rather than trusting the value from before the wait:
  // the visitor may have switched away while the surface was being revealed, and
  // starting a video into that is exactly what the background rule forbids.
  const hidden = documentIsHidden(options.documentHidden)
  const allowed = mayAutoplay({
    userInitiated: false,
    visibleRatio: measurement.ratio,
    documentHidden: hidden,
  })

  const withheld: AwaitingPlayReason | null = hidden
    ? 'document-hidden'
    : !allowed
      ? 'visibility'
      : !ready
        ? 'player-not-ready'
        : null

  return {
    ...base,
    // A player that never became usable is cued rather than played: issuing a
    // start into nothing would leave the store claiming `loading` for ever.
    mode: allowed && ready ? 'play' : 'cue',
    withheld,
    visibleRatio: measurement.ratio,
    measured: measurement.measured,
    waitedMs: measurement.elapsedMs,
  }
}

/**
 * Reveals the player for an item and, once it is genuinely visible, plays it.
 *
 * **Three phases, and the order is the whole of the fix for Bug A.**
 *
 * 1. **Reveal.** The read model is given the item — which is what mounts the
 *    stage — the engine claim is taken, and the expanded view is opened when the
 *    route calls for one. Nothing has been asked to play yet.
 * 2. **Measure.** For a scripted transition, the *real* `IntersectionObserver`
 *    on the stage that has just appeared is waited for, bounded. This is the
 *    step that did not exist: the previous implementation read
 *    `youTubeVisibleRatio()` at the moment the collection decided the video was
 *    next, which is *before* any of phase 1 has rendered. For an Audio → YouTube
 *    hand-off there was no player at all at that instant, the ratio was the
 *    module's initial zero, and `mayAutoplay` correctly refused it — so every
 *    automatic hand-off into a saved video cued and waited for a press.
 * 3. **Start or cue.** With a measurement in hand, `mayAutoplay` decides. Its
 *    rules are untouched: a hidden document never plays, and an unmeasured or
 *    insufficiently visible player is cued and waits for an explicit press.
 *
 * A blocked item — embedding disabled, made for kids, live broadcast — is never
 * handed to the engine. `false` comes back so the caller can fall back to the
 * external *Watch on YouTube* affordance (docs/youtube-policy-audit.md §9).
 */
export async function playYouTubeVideo(
  item: YouTubeVideoItem,
  options: StartOptions,
  store: Store = useYouTubeStore,
): Promise<boolean> {
  /**
   * A one-off play ends any result session.
   *
   * Recently Played and the saved library both open a single video through this
   * function. Leaving a previous search session in place would mean a video
   * played from the library silently continuing into results from an unrelated
   * search — a continuation the visitor never asked for. Playback *within* a
   * session goes through `playSessionItem`, which keeps it.
   */
  const { sessionItems, sessionIndex } = store.getState()
  if (sessionItems[sessionIndex]?.id !== item.id) store.getState().clearSession()

  if (!canEmbedYouTubeItem(item)) {
    store.getState().setError(embedBlockReason(item) ?? 'This video cannot be played here.')
    return false
  }

  return runStartSequence(item, options, store, () => {
    void ensureYouTubeSessionDepth(store)
  })
}

/**
 * How long an issued play command has to reach `playing` before it is treated as
 * having been declined.
 *
 * Longer than it once was, and deliberately: success now requires *playing*
 * rather than merely *buffering*, and a real buffer on a phone on a slow
 * connection legitimately takes seconds. This bound is a backstop rather than
 * the usual exit — a refusal announces itself by dropping back to `cued`, which
 * ends the wait at once, and a success announces itself by playing.
 */
export const START_CONFIRMATION_MS = 6_000

/**
 * What became of an authorised automatic start.
 *
 * `'started'` means one thing only: the player reached `playing`. It used to
 * also mean "reached `buffering`", and that was a false positive with real
 * consequences — a physical phone reported
 * `unstarted → buffering → unstarted → cued` while the diagnostic panel said
 * `outcome: started` beside `status: cued`, two statements that cannot both be
 * true. A diagnostic that contradicts itself is worse than none, because it
 * sends the next person to the wrong layer.
 */
export type StartOutcome =
  | 'started'
  | 'blocked'
  | 'error'
  /** Buffering began and the player then fell back to a cued/unstarted state. */
  | 'returned-to-cued'
  | 'timeout'

/**
 * Watches YouTube's own state events for the answer to "did it actually start".
 *
 * **`buffering` is an intermediate state, not an outcome.** It is the player
 * saying it accepted the command and went to fetch content; whether it then
 * plays is a different question, and on a real device the answer was no. So a
 * buffer is recorded and the watch continues.
 *
 * The sequences and what they mean:
 *
 * · `… → playing` — started. The only success.
 * · `… → buffering → cued` / `→ unstarted` — the player took the command, began,
 *   and was stopped. A silent refusal: no error, no `onAutoplayBlocked`, and
 *   from the store indistinguishable from a start still in flight. Resolved
 *   immediately, because there is nothing left to wait for.
 * · `onAutoplayBlocked` — a refusal the browser announced.
 * · `onError` — the video itself failed.
 * · nothing at all inside the bound — timed out.
 *
 * A `cued` or `unstarted` event *before* any buffering is the player settling
 * after the command and is ignored: the real trace opens with `unstarted`, and
 * treating that as a refusal would fail every start instantly.
 */
async function confirmPlaybackStarted(
  engine: ReturnType<typeof getYouTubeEngine>,
  timeoutMs = START_CONFIRMATION_MS,
): Promise<StartOutcome> {
  if (engine.isPlaying()) return 'started'

  return await new Promise<StartOutcome>((resolve) => {
    let settled = false
    let buffered = false

    const finish = (outcome: StartOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(outcome)
    }

    const unsubscribe = engine.subscribe({
      onStateChange: (state) => {
        if (state === 'playing') {
          finish('started')
          return
        }
        if (state === 'buffering') {
          // Progress, not success. Recorded so a later fall-back to a cued state
          // can be told from the player merely settling before it ever began.
          buffered = true
          tracePlayback('confirm:buffering')
          return
        }
        if (buffered && (state === 'cued' || state === 'unstarted')) {
          finish('returned-to-cued')
        }
      },
      onAutoplayBlocked: () => finish('blocked'),
      onError: () => finish('error'),
    })

    const timer = setTimeout(() => finish('timeout'), timeoutMs)
  })
}

/**
 * The newest start sequence wins, and older ones stop writing.
 *
 * A sequence now spans two bounded waits — the visibility measurement and the
 * confirmation that playback really began — so it can be in flight for seconds,
 * and in those seconds the visitor can press Next, open something else, or let
 * the collection move on. Whatever it eventually concludes is then a conclusion
 * about a video nobody is listening to any more, and writing it to the shared
 * store would overwrite the truth with stale news: a `cued` status and a "press
 * play" prompt landing on top of a track that is already playing.
 *
 * The engine solved the same problem for player commands with a request token.
 * This is that discipline applied one layer up, to the store writes — because
 * dropping the command is not enough if the *conclusion* still lands.
 */
let latestStart = 0

/**
 * Invalidates every start sequence currently in flight.
 *
 * Bumps rather than zeroes, and the difference is the whole point: setting the
 * counter back to zero would make a *stale* sequence's token match the next
 * one's, so an abandoned transition would come back to life and write its
 * conclusion into a player it no longer has anything to do with. A monotonic
 * counter can only ever invalidate.
 */
export function resetYouTubeStartGuard(): void {
  latestStart += 1
}

/**
 * Reveal, decide, start — the three phases, in one place for both entry points.
 *
 * `playYouTubeVideo` and `playSessionItem` differ only in what they do to the
 * session around this, so the sequence itself lives here rather than being
 * written twice and drifting.
 */
async function runStartSequence(
  item: YouTubeVideoItem,
  options: StartOptions,
  store: Store,
  afterStart: () => void,
): Promise<boolean> {
  const token = (latestStart += 1)
  /** True while this sequence is still the one the visitor is waiting on. */
  const current = () => token === latestStart

  beginPlaybackTrace(`youtube:${item.videoId}`)
  tracePlayback('reveal:begin', {
    reason: options.reason ?? 'user-selection',
    userInitiated: options.userInitiated,
    documentHidden: documentIsHidden(options.documentHidden),
    nowPlayingOpen: useUiStore.getState().nowPlayingOpen,
  })

  // PHASE 1 — REVEAL. Giving the read model an item mounts the stage; preparing
  // the surface takes the engine claim and, for a real playback route into
  // YouTube, opens the expanded view the player belongs in.
  store.getState().openWith(item, options.userInitiated ? 'loading' : 'cued')
  prepareYouTubePlaybackSurface(options.reason)
  notePlayed(item.id)

  const engine = getYouTubeEngine()

  /**
   * A transition that is going to wait builds the *player* while it waits — and
   * loads nothing into it.
   *
   * This used to issue a `cue`, on the reasoning that cueing is the documented
   * way to line an item up without initiating playback. That is true, and it was
   * still the wrong instrument: it meant an authorised automatic start sent two
   * media commands, `cue` then `loadVideoById`, at a player the constructor had
   * already been given the same id for. A physical device then reported the
   * load beginning and falling straight back to a cued state —
   * `unstarted → buffering → unstarted → cued`.
   *
   * `prepare` does the part that was actually wanted and none of the part that
   * was not: fetch the IFrame API script, construct an empty player, delegate
   * the autoplay permission on its iframe. No media, no thumbnail, no Data API
   * request. The script fetch and the iframe construction still overlap the
   * visibility measurement — which was the whole point — and the authorised
   * start is then a single `loadVideoById`, the one authoritative media command.
   *
   * It also keeps the race closed: `prepare` records the requested item, so the
   * stage's remount-restore branch finds one and stays quiet.
   *
   * Two callers skip it, and both would be paying for nothing:
   *
   * · **A direct gesture** goes straight to a play command. Inserting an extra
   *   round trip into a human's press is the one case where this costs.
   * · **A caller that already holds a measurement** — a step inside an open
   *   player — is not going to wait either, and its player is already built.
   */
  const willWait = !options.userInitiated && typeof options.visibleRatio !== 'number'
  if (willWait) {
    tracePlayback('prepare:player')
    void engine.prepare(item).catch(() => {
      // A failure here is reported by the play attempt that follows it.
    })
  }

  // PHASE 2 — DECIDE. Visibility and player readiness, together, bounded.
  const decision = await decideStart(options)
  tracePlayback('decide:result', { ...decision })

  /**
   * Something newer took over while this was measuring, so this sequence stops
   * acting — and reports **success**.
   *
   * That return value is not a formality. `advanceCollection` reads `false` as
   * *this saved item could not be played* and steps past it, so returning false
   * here would make a superseded transition silently skip a song. Being
   * overtaken is not the same as being unplayable: the item is fine, and the
   * newer sequence owns what happens to it now.
   */
  if (!current()) {
    tracePlayback('superseded', { at: 'decide' })
    return true
  }

  // PHASE 3 — START OR CUE.
  if (decision.mode === 'play' && store.getState().status === 'cued') {
    store.getState().setStatus('loading')
  }

  try {
    await engine.start(item, { mode: decision.mode })
    tracePlayback('engine:started', { mode: decision.mode, isPlaying: engine.isPlaying() })

    if (decision.mode === 'cue') {
      store.getState().setAwaitingUserPlay(true, decision.withheld ?? 'visibility')
      afterStart()
      return true
    }

    /**
     * Did the command actually start anything?
     *
     * `engine.isPlaying()` is not the authority here and never was — it is this
     * application's own mirror of the last state event, and at this instant the
     * player may simply not have reported yet. The authority is YouTube's own
     * state sequence, and a start that works produces one:
     * `cued`/`unstarted` → `buffering` → `playing`.
     *
     * What a real phone reported is the sequence that does *not*: the right
     * video loaded, a play command issued, no error, no `onAutoplayBlocked` —
     * and the player still sitting on its thumbnail behind YouTube's own red
     * overlay. A browser can decline a scripted start without saying so, and
     * from the store that is indistinguishable from a start still in flight.
     *
     * **Watched in the background, and deliberately not awaited.** The caller's
     * question is "was this item started", and it has been answered the moment
     * the command goes out; whether the player then honours it is a correction
     * that arrives seconds later. Blocking on it would hold up everything behind
     * this — `advanceCollection` would not return until playback was confirmed,
     * and the collection's own bookkeeping would sit behind a network buffer.
     *
     * One attempt either way: this never re-issues the command, because a
     * refusal repeated is still a refusal and a loop of `playVideo()` is exactly
     * the pestering an autoplay policy exists to stop.
     */
    void confirmPlaybackStarted(engine).then((outcome) => {
      tracePlayback('engine:outcome', { outcome })

      // The confirmation is the longest wait in the sequence, so this is the
      // guard that matters most: a six-second-old conclusion must never
      // overwrite whatever the visitor is actually listening to now.
      if (!current()) {
        tracePlayback('superseded', { at: 'confirm' })
        return
      }

      if (outcome === 'started') {
        store.getState().setStatus('playing')
        return
      }

      /**
       * Every remaining outcome ends the same way for the visitor — a cued,
       * visible player and one Play button — and differently for a diagnosis.
       *
       * `blocked` and `error` are already reported by the engine subscription,
       * which owns those two events and the reasons that go with them; touching
       * the store here would replace a specific answer with a vaguer one.
       */
      if (outcome === 'returned-to-cued' || outcome === 'timeout') {
        store.getState().setStatus('cued')
        store
          .getState()
          .setAwaitingUserPlay(
            true,
            outcome === 'returned-to-cued' ? 'player-returned-to-cued' : 'player-command-no-start',
          )
      }
    })

    afterStart()
    return true
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : 'YouTube could not play this video.'
    tracePlayback('engine:error', { message })
    store.getState().setError(message)
    return false
  }
}

/** Cues without playing — the safe path for any automatic queue transition. */
export async function cueYouTubeVideo(
  item: YouTubeVideoItem,
  store: Store = useYouTubeStore,
  reason: YouTubePresentationReason = 'restore',
): Promise<boolean> {
  if (!canEmbedYouTubeItem(item)) {
    store.getState().setError(embedBlockReason(item) ?? 'This video cannot be played here.')
    return false
  }
  store.getState().openWith(item, 'cued')
  prepareYouTubePlaybackSurface(reason)
  try {
    await getYouTubeEngine().start(item, { mode: 'cue' })
    store.getState().setAwaitingUserPlay(true, 'visibility')
    return true
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : 'YouTube could not load this video.'
    store.getState().setError(message)
    return false
  }
}

/**
 * Moves the playhead of the loaded video.
 *
 * Deliberately shaped exactly like `seek()` in `player-actions.ts` — same
 * guards, same clamp, same "write the position back to the store" ending — so
 * the one seek rail behind `unifiedSeek` cannot behave differently depending on
 * which engine is live. A request that cannot be honoured is simply not
 * honoured, as on the audio side.
 *
 * Nothing here is an overlay, a replacement control, or a modification of the
 * player: it calls YouTube's own published `seekTo` (docs/youtube-policy-audit.md
 * §6 — the prohibition is on obscuring native controls, not on driving the
 * documented API).
 */
export function seekYouTube(seconds: number, store: Store = useYouTubeStore): void {
  const state = store.getState()
  if (!state.item || !Number.isFinite(seconds)) return
  const { duration } = state
  if (duration <= 0) return
  const clamped = Math.min(Math.max(seconds, 0), duration)
  getYouTubeEngine().seek(clamped)
  state.setProgress(clamped, duration)
}

/**
 * The raw half of the unified playback snapshot, for the YouTube engine.
 *
 * Reads the **store** rather than the live player, and that is the point: the
 * store is already kept in step with the player by `bindYouTubeEngineEvents`,
 * and a store read is reactive where a `player.getCurrentTime()` read is not.
 * A hook built on the latter would render once and then sit still.
 *
 * The state argument exists so `usePlaybackSnapshot` can hand in the slice it
 * has already subscribed to, and so this is testable without a live engine.
 */
export interface YouTubeSnapshotRaw {
  currentTime: number
  duration: number
  status: YouTubeStatus
  title: string
  subtitle: string
  artworkUrl: string
}

export function getYouTubeSnapshot(
  state: YouTubePlaybackState = useYouTubeStore.getState(),
): YouTubeSnapshotRaw {
  const { item } = state
  return {
    currentTime: state.currentTime,
    duration: state.duration || item?.durationSeconds || 0,
    status: state.status,
    title: item?.title ?? '',
    // The channel, never relabelled as an artist: a YouTube uploader is not a
    // credited performer and the app does not claim otherwise (agents/25).
    subtitle: item?.channelTitle ?? '',
    artworkUrl: item?.thumbnailUrl ?? '',
  }
}

/**
 * Gone with the layout that needed them: `hasLiveYouTubePlayer`,
 * `requestYouTubeResume` and `consumeYouTubeResume`.
 *
 * All three existed to paper over one thing — the embed was destroyed whenever
 * the expanded sheet closed, so "there is a video loaded" and "there is a player
 * to talk to" were two different questions, and a press of play had to be
 * carried across a remount as a one-shot intent.
 *
 * The stage lives in the bar and is torn down only when YouTube stops being the
 * active engine, at which point there is nothing to resume anyway. The two
 * questions have become one again, so the answer is no longer worth a function.
 * Deleted rather than left in place: a helper whose name still describes the old
 * arrangement is how the next reader learns something untrue.
 */

/** The surface's own play/pause control. Always a direct user gesture. */
export function toggleYouTubePlayback(store: Store = useYouTubeStore): void {
  const state = store.getState()
  if (!state.item) return
  const engine = getYouTubeEngine()
  if (state.status === 'playing') {
    engine.pause()
    state.setStatus('paused')
    // A pause the visitor asked for is not one to undo on the way back.
    noteExplicitPause()
    return
  }
  activateYouTube()
  engine.resume()
  state.setAwaitingUserPlay(false)
}

/**
 * Closing the visible surface stops playback outright.
 *
 * Stop rather than pause: a paused player the visitor has dismissed is still a
 * player they cannot see, and "the player is not displayed in the page, tab, or
 * screen that the user is viewing" is the background-player definition the
 * developer policies prohibit.
 */
export function closeYouTubeSurface(store: Store = useYouTubeStore): void {
  const engine = getYouTubeEngine()
  engine.stop()
  // A dismissed video has nothing to come back to.
  noteExplicitPause()
  releasePlayback('youtube')
  store.getState().close()
  // The expanded view *is* the player's surface, so dismissing the video closes
  // it too. Leaving it open would strand the visitor in a full-screen sheet that
  // has silently become a view of the audio track underneath.
  useUiStore.getState().setNowPlayingOpen(false)
}

/**
 * Whether the *background rule* is what stopped the video.
 *
 * Not "was it playing" — "did this application stop it because the app went
 * away". That distinction is the whole of the auto-resume rule below: a video
 * the visitor paused themselves must stay paused when they come back, and a
 * video the policy paused for them should not need a second press to undo
 * something they never asked for.
 *
 * Module-level and deliberately not in the store: it is not state any surface
 * renders, and it must not be persisted. A reload has no video to resume.
 */
let pausedByBackgroundRule = false

/**
 * Set wherever the visitor's own intent stops playback, so the rule above can
 * tell the two kinds of pause apart.
 */
function noteExplicitPause(): void {
  pausedByBackgroundRule = false
}

/** True while a background-paused video is waiting to be resumed. Tests. */
export function isPausedByBackgroundRule(): boolean {
  return pausedByBackgroundRule
}

/** Test seam. */
export function resetBackgroundPause(): void {
  pausedByBackgroundRule = false
}

/**
 * `visibilitychange` and `focus` handler: pause on the way out, resume on the
 * way back.
 *
 * **The pause is not optional and has not changed.** The developer policies
 * prohibit an API client from allowing the player to continue when its window is
 * closed or minimised, so a hidden document stops the video. That is the
 * behaviour, not a limitation to be worked around, and nothing here weakens it.
 *
 * **The resume is the fix.** What the reports described is coming back to the
 * app and finding the audio still going and the video silently stopped — an
 * asymmetry that reads as a bug, because from the visitor's side it is one: they
 * never pressed pause. Restarting a video whose player is on screen, in a
 * document that is visible, is not background playback; it is the end of a
 * background pause. The prohibition is about what happens while the app is away,
 * and this happens only once it is back.
 *
 * Three conditions, all of which say the same thing — *undo what the rule did,
 * and nothing else*:
 *
 * · The background rule is what paused it. A video the visitor paused stays
 *   paused, which is why every explicit pause clears the flag.
 * · YouTube still holds the engine claim. If a track took over while the app was
 *   away, the video is not what the visitor is listening to.
 * · There is still an item loaded, and it is not already playing.
 *
 * The browser may still refuse the play. That is not worked around either: the
 * engine reports it through `onAutoplayBlocked`, which asks for a press.
 */
export function handleDocumentVisibility(hidden: boolean, store: Store = useYouTubeStore): void {
  const state = store.getState()

  if (hidden) {
    if (state.status !== 'playing') return
    getYouTubeEngine().pause()
    state.setStatus('paused')
    state.setPausedForBackgroundPolicy(true)
    pausedByBackgroundRule = true
    return
  }

  if (!pausedByBackgroundRule) return
  pausedByBackgroundRule = false
  if (!state.item || state.status === 'playing') return
  if (activeEngine() !== 'youtube') return

  /**
   * Cleared before the attempt rather than after it.
   *
   * The flag drives an explanation of why playback stopped, and the resume takes
   * a few hundred milliseconds to be reflected in the player's own state — so
   * leaving it set would flash that explanation on screen every single time the
   * app is reopened, to explain something that is in the middle of being undone.
   * If the browser refuses the play, `onAutoplayBlocked` asks for a press, which
   * is the honest affordance for that case.
   */
  state.setPausedForBackgroundPolicy(false)
  getYouTubeEngine().resume()
}

/* --------------------------------------------------------------------------
   Result sessions

   Continuing through the results the visitor already has. Every function below
   reads `sessionItems` and nothing else: there is no code path here that can
   reach `/api/youtube`, spend `search.list` or `videos.list` quota, or ask for
   "related" videos — `relatedToVideoId` has been unsupported since August 2023
   and is not used anywhere in this application.
   -------------------------------------------------------------------------- */

/**
 * The next index in the session that Pulse is actually allowed to embed.
 *
 * Reuses `canEmbedYouTubeItem`, the same predicate the rows and the player use,
 * so a made-for-kids or embedding-disabled result is skipped by exactly the rule
 * that stopped it being playable in the first place. There is no second copy of
 * that policy check.
 */
export function nextEligibleIndex(
  items: readonly YouTubeVideoItem[],
  from: number,
  direction: 1 | -1 = 1,
): number {
  for (let index = from + direction; index >= 0 && index < items.length; index += direction) {
    const candidate = items[index]
    if (candidate && canEmbedYouTubeItem(candidate)) return index
  }
  return -1
}

/**
 * Starts playback from an already-fetched result list.
 *
 * The list is adopted as the session exactly as the search returned it —
 * relevance order, untouched. Nothing is re-ranked: deriving an order from view
 * counts, likes, duration or channel popularity would be creating a new metric
 * from API Data, which §III.E.4.h prohibits and which this project has avoided
 * since Phase 3.
 */
export async function playYouTubeResult(
  items: readonly YouTubeVideoItem[],
  item: YouTubeVideoItem,
  query: string | null = null,
  store: Store = useYouTubeStore,
): Promise<boolean> {
  const index = items.findIndex((candidate) => candidate.id === item.id)
  store.getState().startSession([...items], index, query)
  // A press on a result is a direct choice of *this video*, so the official
  // player becomes the thing on screen rather than a 200px box docked under the
  // page the visitor is no longer reading.
  return playSessionItem(
    index >= 0 ? index : -1,
    item,
    { userInitiated: true, reason: 'user-selection' },
    store,
  )
}

/** Plays one item of the current session, keeping the session intact. */
async function playSessionItem(
  index: number,
  item: YouTubeVideoItem,
  options: StartOptions,
  store: Store,
): Promise<boolean> {
  if (index >= 0) store.getState().setSessionIndex(index)
  notePlayed(item.id)

  if (!canEmbedYouTubeItem(item)) {
    store.getState().setError(embedBlockReason(item) ?? 'This video cannot be played here.')
    return false
  }

  // The same reveal → decide → start sequence `playYouTubeVideo` performs, and
  // for the same reason: the ratio must describe the player as it is now, not as
  // it was before this transition began. Inside a running session it costs
  // nothing — `advanceYouTubeSession` supplies its own measurement, so there is
  // no wait at all, and the stage and player already exist.
  const started = await runStartSequence(
    item,
    { ...options, reason: options.reason ?? 'session-step' },
    store,
    () => {
      // Not awaited: the video is already running, and the session is topped up
      // over it rather than in the silence after it.
      void ensureYouTubeSessionDepth(store)
    },
  )
  if (index >= 0) store.getState().setSessionIndex(index)
  return started
}

/** Cues one session item without playing it, keeping the session intact. */
async function cueSessionItem(
  index: number,
  item: YouTubeVideoItem,
  store: Store,
): Promise<boolean> {
  store.getState().openWith(item, 'cued')
  store.getState().setSessionIndex(index)
  prepareYouTubePlaybackSurface('session-step')
  try {
    await getYouTubeEngine().start(item, { mode: 'cue' })
    store.getState().setAwaitingUserPlay(true, 'visibility')
    return true
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : 'YouTube could not load this video.'
    store.getState().setError(message)
    return false
  }
}

/**
 * Step through the session from a real button press.
 *
 * `userInitiated: true`, because it is — which is the one condition under which
 * `mayAutoplay` does not need a visibility measurement.
 *
 * A press of **Next** at the end of the session extends it rather than doing
 * nothing, for the same reason `selectCanSkipNext` was written on the audio
 * side: a control and the action behind it must agree about what is possible.
 * Previous does not — there is no such thing as searching for the video that
 * came before.
 *
 * No delayed retry here. Someone holding a button does not want a two-second
 * pause; they can press it again.
 */
export async function playYouTubeSessionStep(
  direction: 1 | -1,
  store: Store = useYouTubeStore,
): Promise<boolean> {
  // A video playing because a saved list routed it here belongs to that list,
  // not to whatever search was open before. Its Next is the next *saved item* —
  // which may well be a catalogue track, on the other engine entirely.
  if (collectionOwnsCurrentVideo(store)) return stepCollectionFromVideo(direction)

  let next = nextEligibleIndex(
    store.getState().sessionItems,
    store.getState().sessionIndex,
    direction,
  )

  if (next < 0 && direction === 1) {
    if ((await extendYouTubeSession(store)) === 0) {
      useUiStore.getState().showNotice(NO_MORE_TRACKS_MESSAGE)
      return false
    }
    next = nextEligibleIndex(store.getState().sessionItems, store.getState().sessionIndex, 1)
  }

  const item = store.getState().sessionItems[next]
  if (next < 0 || !item) return false
  return playSessionItem(next, item, { userInitiated: true }, store)
}

/* --------------------------------------------------------------------------
   Collection origin

   The same video reached from two places is two different things. From a search
   it is one of a page of results and Next means the next result; from Liked
   Songs or a playlist it is one item of a saved list and Next means the next
   saved item. Origin decides, and these three functions are where it does.
   -------------------------------------------------------------------------- */

/** True when the loaded video is the saved item a collection session is on. */
export function collectionOwnsCurrentVideo(store: Store = useYouTubeStore): boolean {
  const item = store.getState().item
  return item !== null && collectionOwnsItemKey(item.id)
}

/**
 * Steps the *collection* while a video is on screen.
 *
 * Nothing here can reach `/api/youtube`: a saved list is a list the visitor
 * already has, so a transition inside one never spends a `search.list` and never
 * asks for related videos. When the list has no more to give, the bar says so
 * rather than quietly extending the session with results nobody asked for.
 */
async function stepCollectionFromVideo(direction: 1 | -1): Promise<boolean> {
  const { repeatMode } = usePlayerStore.getState()
  const moved =
    direction === 1
      ? await advanceCollection({ reason: 'user', repeatMode, userInitiated: true })
      : await retreatCollection({ repeatMode })
  if (!moved && direction === 1) useUiStore.getState().showNotice(NO_MORE_TRACKS_MESSAGE)
  return moved
}

/**
 * True when a press of Next or Previous would go somewhere.
 *
 * Next also answers yes when the session could be *extended* — a video is
 * loaded, continuous play is on, and the sitting has searches left. Anything
 * else would grey out a control whose action is perfectly able to answer it,
 * which is the exact defect `useHasNext` was deleted for on the audio side.
 */
export function hasYouTubeSessionStep(direction: 1 | -1, store: Store = useYouTubeStore): boolean {
  const state = store.getState()
  if (collectionOwnsCurrentVideo(store)) {
    const session = collectionSession()
    const { repeatMode } = usePlayerStore.getState()
    return direction === 1
      ? nextCollectionPosition(session, repeatMode, 'user') !== null
      : previousCollectionPosition(session, repeatMode) !== null
  }
  if (nextEligibleIndex(state.sessionItems, state.sessionIndex, direction) >= 0) return true
  if (direction === -1) return false
  return (
    state.item !== null &&
    state.continuousPlay &&
    relatedSearchesSpent < MAX_SESSION_RELATED_SEARCHES
  )
}

/* --------------------------------------------------------------------------
   Keeping the session from running out

   The one place in the application where next-track logic may cause a YouTube
   search, and the constants below are what make that defensible.
   -------------------------------------------------------------------------- */

/**
 * Related searches one sitting may spend.
 *
 * **This is a quota decision, not a UX one.** `search.list` costs 100 units and
 * the whole deployment is allowed 10,000 units a day — one hundred searches for
 * *every visitor combined* (agents/22 → "Quota Constraint"). Continuation is
 * worth spending some of that on; letting a single tab left playing overnight
 * spend all of it is not, because the next visitor's explicit search is what
 * would fail.
 *
 * Six, with `YOUTUBE_PREFETCH_DEPTH` triggering each one and ten results back,
 * covers roughly sixty videos in a sitting before the bar has to say it is out.
 * The cap is per page load and is not persisted: it bounds a runaway session,
 * not a person.
 */
export const MAX_SESSION_RELATED_SEARCHES = 6

let relatedSearchesSpent = 0

/** How many related searches this sitting has spent. Tests and diagnostics. */
export function youTubeRelatedSearchesSpent(): number {
  return relatedSearchesSpent
}

/** Test seam, and the reset a fresh app instance performs. */
export function resetYouTubeRelatedBudget(): void {
  relatedSearchesSpent = 0
}

/** One extension in flight at a time: two would double the quota spend. */
let extending: Promise<number> | null = null

/**
 * Asks YouTube for more videos like the one playing, and appends them.
 *
 * Returns how many genuinely new items were added, so the caller can tell
 * "nothing came back" from "the session grew". Never throws: `fetchRelated`
 * answers every failure — network, quota, an empty result — with an empty array.
 *
 * The query is the act and the language, never the video's title (see
 * `relatedQuery`). It excludes the session's own ids and everything this sitting
 * has already played, so an extension cannot hand back the video that just
 * ended — the behaviour that made the replay screen look like a bug.
 */
export async function extendYouTubeSession(store: Store = useYouTubeStore): Promise<number> {
  if (extending) return extending
  const seedItem = store.getState().item
  if (!seedItem) return 0
  if (relatedSearchesSpent >= MAX_SESSION_RELATED_SEARCHES) return 0

  relatedSearchesSpent += 1
  extending = (async () => {
    const { sessionItems } = store.getState()
    const found = await fetchRelated(describeSeed(seedItem), {
      exclude: sessionItems.map((item) => item.id),
    })
    // `fetchRelated` returns the union both engines share; only the video half
    // can enter a YouTube session, and the guard is a real runtime check rather
    // than a cast (agents/28 → "Audio providers never enter YouTube engine").
    const videos = found.filter(isYouTubeVideoItem)
    if (!videos.length) return 0

    const before = store.getState().sessionItems.length
    store.getState().appendSessionItems(videos)
    return store.getState().sessionItems.length - before
  })().finally(() => {
    extending = null
  })

  return extending
}

/**
 * How thin the session may get before the next video is looked up.
 *
 * The audio side keeps three ahead (`MIN_QUEUE_DEPTH`) because an Audius or
 * Jamendo search is an ordinary request. A YouTube search is a hundredth of the
 * whole deployment's day, and the two rules that make three right for audio
 * pull opposite ways here:
 *
 * · **One search returns ten videos.** Extending on the *last* one still spends
 *   about one search per ten videos played, so a listener never waits.
 * · **Extending at three would spend one search per video**, because each seed
 *   is a different act and so a different query. A sitting would exhaust its
 *   allowance in six videos and the day's in a hundred.
 *
 * One, then: the lookup runs while the final video of the session is playing,
 * which is early enough to be inaudible and late enough to be affordable.
 */
export const YOUTUBE_PREFETCH_DEPTH = 1

/**
 * Keeps a playable video standing ahead of the listener.
 *
 * Called when a video *starts*, so the search runs over the video already
 * playing rather than in the pause after it. Counting only *eligible* items is
 * what makes the depth honest: a session whose remaining entries are all
 * made-for-kids has nothing ahead of it at all.
 */
export async function ensureYouTubeSessionDepth(store: Store = useYouTubeStore): Promise<void> {
  const state = store.getState()
  if (!state.continuousPlay || !state.item) return

  // A video playing from a saved list never prefetches: the list is already on
  // the device, and its continuation costs no YouTube quota at all. The
  // `sessionItems.length` guard below would catch this too — a collection clears
  // the session — but the rule is worth stating where it is decided.
  if (collectionOwnsCurrentVideo(store)) return

  /**
   * A single video opened from Recently Played or the library gets no lookahead.
   *
   * It still continues — `advanceYouTubeSession` searches when it ends — but the
   * search is spent then rather than now. The difference is who pays: a listener
   * who opens a saved video and skips away from it after ten seconds would
   * otherwise have spent one of the deployment's hundred daily searches on a
   * continuation nobody reached. Inside a session there is a list being worked
   * through and the lookahead is nearly certain to be used, so it runs early
   * enough to be inaudible; here it waits until it is certainly wanted.
   */
  if (state.sessionItems.length === 0) return

  let ahead = 0
  let index = state.sessionIndex
  while (ahead < YOUTUBE_PREFETCH_DEPTH) {
    index = nextEligibleIndex(state.sessionItems, index, 1)
    if (index < 0) break
    ahead += 1
  }
  if (ahead >= YOUTUBE_PREFETCH_DEPTH) return

  await extendYouTubeSession(store)
}

/**
 * A video ended naturally. Play the next one — from the session, or from a
 * search when the session has run out.
 *
 * The gates that remain are the ones that are somebody else's rule rather than
 * this function's opinion:
 *
 * 1. **Continuous play is on.** The visitor's own setting.
 * 2. **`mayAutoplay` agrees.** The document is visible *and* more than half the
 *    player is on screen, measured by a real `IntersectionObserver`. This is
 *    Required Minimum Functionality, and it is checked through the same helper
 *    every other scripted transition uses. Failing it is not failure: the next
 *    item is **cued** and waits for a press, which is what the policy asks for
 *    when visibility is insufficient or unknown.
 *
 * The gate that is gone is "there is a next eligible result". It used to end the
 * story: the session ran out, playback stopped, and the visitor was left looking
 * at YouTube's replay screen with no way onward but to search again. Now an
 * exhausted session is extended — once per end, bounded by
 * `MAX_SESSION_RELATED_SEARCHES`, with one delayed retry for a connection that
 * dropped mid-video — and only when *that* comes back empty does the bar say so.
 *
 * What never happens, under any of these branches, is the video that just ended
 * starting again.
 */
export async function advanceYouTubeSession(store: Store = useYouTubeStore): Promise<boolean> {
  // Nothing loaded means nothing to be related *to* — after the surface was
  // closed, for instance. There is no continuation to attempt and no request to
  // make for one.
  if (!store.getState().item) return false

  /**
   * A saved list continues before anything else is considered, and it is not
   * gated by `continuousPlay`.
   *
   * That setting answers "should the next *search result* follow this one", and
   * a collection is not a search result — the visitor asked for this list by
   * opening it and pressing a row. The next item is routed to whichever engine
   * owns it, so a video ending inside Liked Songs can hand straight back to the
   * audio element.
   *
   * Repeat is deliberately not consulted for a video beyond the wrap
   * `advanceCollection` already performs: the YouTube surface offers no repeat
   * control (`capabilities.repeat` is false), so honouring Repeat one here would
   * act on a setting the visitor cannot see from this player.
   */
  if (collectionOwnsCurrentVideo(store)) {
    const { repeatMode } = usePlayerStore.getState()
    const moved = await advanceCollection({ reason: 'ended', repeatMode, userInitiated: false })
    if (!moved) useUiStore.getState().showNotice(NO_MORE_TRACKS_MESSAGE)
    return moved
  }

  if (!store.getState().continuousPlay) return false

  let next = nextEligibleIndex(store.getState().sessionItems, store.getState().sessionIndex, 1)

  if (next < 0) {
    // The prefetch on start should have covered this; arriving here means it
    // failed, was blocked, or the session was a single video all along.
    if ((await extendYouTubeSession(store)) === 0) {
      // One delayed retry, and only while there is budget left to spend on it —
      // waiting two seconds to re-discover that the allowance is gone helps
      // nobody.
      const retryable = relatedSearchesSpent < MAX_SESSION_RELATED_SEARCHES
      if (retryable) await delay(RELATED_RETRY_DELAY_MS)
      if (!retryable || (await extendYouTubeSession(store)) === 0) {
        useUiStore.getState().showNotice(NO_MORE_TRACKS_MESSAGE)
        return false
      }
    }
    next = nextEligibleIndex(store.getState().sessionItems, store.getState().sessionIndex, 1)
  }

  const item = store.getState().sessionItems[next]
  if (next < 0 || !item) return false

  const hidden = isDocumentHidden()
  const visibleRatio = youTubeVisibleRatio()

  if (!mayAutoplay({ userInitiated: false, visibleRatio, documentHidden: hidden })) {
    // Ready and waiting, never started on its own.
    await cueSessionItem(next, item, store)
    return false
  }

  return playSessionItem(next, item, { userInitiated: false, visibleRatio }, store)
}

/** Isolated so tests can drive it with fake timers. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * One advance at a time.
 *
 * `ENDED` can arrive twice for one video, and a video that fails after ending
 * would otherwise produce a second advance on top of the first — skipping an
 * item, and spending a second search to do it. The concurrent call is dropped
 * rather than queued: the advance already running answers the same question.
 */
let advancing: Promise<boolean> | null = null

function advanceOnce(store: Store): void {
  if (advancing) return
  advancing = advanceYouTubeSession(store).finally(() => {
    advancing = null
  })
}

/** True while an advance is in flight. Tests and diagnostics. */
export function isYouTubeAdvancing(): boolean {
  return advancing !== null
}

/** Test seam. */
export function resetYouTubeAdvanceGuard(): void {
  advancing = null
}

/**
 * Consecutive videos that may fail before the session is allowed to stop.
 *
 * A video pulled down, made private or blocked in the region is a dead end, not
 * the end of the music — so it is treated exactly as an ending and the next one
 * plays. Bounded so a run of them stops cleanly instead of walking the session
 * at speed.
 */
export const MAX_CONSECUTIVE_VIDEO_FAILURES = 3
let consecutiveFailures = 0

/** Test seam. */
export function resetYouTubeFailureStreak(): void {
  consecutiveFailures = 0
}

/** Engine → store bridge, wired once by the surface component. */
export function bindYouTubeEngineEvents(store: Store = useYouTubeStore): () => void {
  return getYouTubeEngine().subscribe({
    onStateChange: (state) => {
      // The provider's own sequence, recorded as a history. A start that worked
      // reads `cued → buffering → playing`; the reported failure reads the same
      // commands against a sequence that stops at `cued`, and only the pair of
      // histories together says which happened.
      tracePlayback('engine:state', { state })
      const current = store.getState()
      switch (state) {
        case 'playing':
          current.setStatus('playing')
          // Real playback is the only proof the embed is reachable, so it is the
          // only thing that clears the streak the error branch counts.
          consecutiveFailures = 0
          break
        case 'paused':
          current.setStatus('paused')
          break
        case 'ended':
          current.setStatus('ended')
          // Previously the story stopped here, and the visitor was left looking
          // at YouTube's replay screen. Now an exhausted session is extended
          // rather than ended; only the visibility rule and the visitor's own
          // continuous-play setting can still say no.
          advanceOnce(store)
          break
        case 'cued':
          current.setStatus('cued')
          break
        case 'buffering':
          current.setStatus('loading')
          break
        default:
          break
      }
    },
    onTimeUpdate: (currentTime, duration) => store.getState().setProgress(currentTime, duration),
    /**
     * A video that will not play is treated as one that ended.
     *
     * The IFrame API reports a removed, private or region-blocked video through
     * this event, and in every one of those cases stopping the music is the
     * wrong answer — the next video is. The error is still recorded, because
     * something did go wrong; it simply no longer ends the sitting.
     */
    onError: (message) => {
      store.getState().setError(message)
      consecutiveFailures += 1
      if (consecutiveFailures > MAX_CONSECUTIVE_VIDEO_FAILURES) return
      // A saved list continues over a dead item whatever the result-session
      // setting says, for the same reason it continues over a withdrawn track.
      if (!store.getState().continuousPlay && !collectionOwnsCurrentVideo(store)) return
      advanceOnce(store)
    },
    /**
     * The browser or the provider refused a play this application did issue.
     *
     * Recorded as its own reason rather than folded into the generic "waiting
     * for a press", because it is the one outcome that is **not** an
     * application decision: the visibility rule passed, the player was ready,
     * the command went out, and the refusal came back. Reporting it as an
     * ordinary cue is what made the reported failure impossible to place from
     * the outside.
     *
     * One attempt per transition, and that is the whole of the response. There
     * is no retry, no timer, no second `playVideo`, and none of the tricks that
     * would amount to working around an autoplay policy — a muted start, a
     * synthetic gesture, a hidden element. The honest affordance for a refusal
     * is a Play button, and the visitor already has exactly one.
     */
    onAutoplayBlocked: () => {
      tracePlayback('engine:autoplay-blocked')
      store.getState().setStatus('paused')
      store.getState().setAwaitingUserPlay(true, 'autoplay-blocked')
    },
    onCommand: (command, videoId) => tracePlayback('engine:command', { command, videoId }),
  })
}
