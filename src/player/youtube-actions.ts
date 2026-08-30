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
import { getYouTubeEngine } from './youtube-engine'
import { documentHidden as isDocumentHidden, youTubeVisibleRatio } from './youtube-visibility'
import { useYouTubeStore } from './youtube-store'
import type { YouTubePlaybackState, YouTubeStatus } from './youtube-store'

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
 * Where the player is revealed, now that nothing has to reveal it.
 *
 * There used to be a `revealYouTubePlayer()` here, and every function that
 * loaded a video called it first: the embed lived in the expanded sheet and
 * nowhere else, so "put the player on screen" and "open the sheet" were the same
 * act. That is what made a YouTube result behave unlike every other result —
 * press one and a full-screen sheet took over, where an Audius result simply
 * started playing in the bar.
 *
 * The stage moved to the bar, so opening the bar *is* revealing the player.
 * `openWith` already does that by giving the read model an item, which is what
 * mounts the stage and flushes the engine's deferred request. The ordering
 * agents/24 specifies — render the visible surface, then wait for readiness,
 * then load — still holds; it is simply the bar that renders now, and the sheet
 * has gone back to being what its name says it is.
 */

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
   * Latest `IntersectionObserver` ratio for the player surface. `undefined`
   * means "not observed yet", which is treated as not-visible-enough.
   */
  visibleRatio?: number
  /** Defaults to the live document. */
  documentHidden?: boolean
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
 * Opens the surface for an item and, when allowed, plays it.
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

  const hidden = documentIsHidden(options.documentHidden)
  const autoplay = mayAutoplay({ ...options, documentHidden: hidden })

  // Giving the read model an item is what mounts the stage in the bar, and that
  // is where the player is revealed — before anything is asked to play, which is
  // the ordering agents/24 → "Audio -> YouTube" step 2 specifies. Nothing here
  // opens the sheet.
  store.getState().openWith(item, autoplay ? 'loading' : 'cued')
  activateYouTube()
  notePlayed(item.id)

  try {
    const engine = getYouTubeEngine()
    await engine.play(item, { userInitiated: autoplay })
    // Reflect what the engine actually did rather than what was asked for. The
    // subscription in `bindYouTubeEngineEvents` will keep correcting this, but
    // the store must not be left claiming `loading` if playback is already
    // under way — the surface's own play/pause control reads it.
    if (!autoplay) store.getState().setAwaitingUserPlay(true)
    else if (engine.isPlaying()) store.getState().setStatus('playing')
    void ensureYouTubeSessionDepth(store)
    return true
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : 'YouTube could not play this video.'
    store.getState().setError(message)
    return false
  }
}

/** Cues without playing — the safe path for any automatic queue transition. */
export async function cueYouTubeVideo(
  item: YouTubeVideoItem,
  store: Store = useYouTubeStore,
): Promise<boolean> {
  if (!canEmbedYouTubeItem(item)) {
    store.getState().setError(embedBlockReason(item) ?? 'This video cannot be played here.')
    return false
  }
  store.getState().openWith(item, 'cued')
  activateYouTube()
  try {
    await getYouTubeEngine().cue(item)
    store.getState().setAwaitingUserPlay(true)
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
  return playSessionItem(index >= 0 ? index : -1, item, { userInitiated: true }, store)
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

  const hidden = documentIsHidden(options.documentHidden)
  const autoplay = mayAutoplay({ ...options, documentHidden: hidden })

  store.getState().openWith(item, autoplay ? 'loading' : 'cued')
  if (index >= 0) store.getState().setSessionIndex(index)
  activateYouTube()

  try {
    const engine = getYouTubeEngine()
    await engine.play(item, { userInitiated: autoplay })
    if (!autoplay) store.getState().setAwaitingUserPlay(true)
    else if (engine.isPlaying()) store.getState().setStatus('playing')
    // Not awaited: the video is already running, and the session is topped up
    // over it rather than in the silence after it.
    void ensureYouTubeSessionDepth(store)
    return true
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : 'YouTube could not play this video.'
    store.getState().setError(message)
    return false
  }
}

/** Cues one session item without playing it, keeping the session intact. */
async function cueSessionItem(
  index: number,
  item: YouTubeVideoItem,
  store: Store,
): Promise<boolean> {
  store.getState().openWith(item, 'cued')
  store.getState().setSessionIndex(index)
  activateYouTube()
  try {
    await getYouTubeEngine().cue(item)
    store.getState().setAwaitingUserPlay(true)
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
    onAutoplayBlocked: () => {
      // The browser refused; ask for a press rather than retrying, which would
      // be an attempt to work around the block.
      store.getState().setStatus('paused')
      store.getState().setAwaitingUserPlay(true)
    },
  })
}
