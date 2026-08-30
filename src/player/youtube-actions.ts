import { useUiStore } from '@/app/ui-store'
import { canEmbedYouTubeItem, embedBlockReason } from '@/music/youtube/normalize'
import { isYouTubeVideoItem } from '@/music/types'
import type { YouTubeVideoItem } from '@/music/types'
import { activateYouTube, releasePlayback } from './playback-coordinator'
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
 * Puts the player on screen, before anything is asked to load or play.
 *
 * The embed is mounted by the expanded Now Playing view and by nothing else, so
 * "reveal the player" and "expand the sheet" are now the same act. Every
 * function below that loads a video calls this *first*, which is the ordering
 * agents/24 has always specified — render the visible surface, then wait for
 * player readiness, then load — and which the Required Minimum Functionality
 * visibility rule depends on.
 *
 * It is also what makes the deferral in `youtube-engine` resolve: a video asked
 * to play before its container exists is held, and flushed the moment the stage
 * attaches. Without this the request would be held forever.
 */
function revealYouTubePlayer(): void {
  useUiStore.getState().setNowPlayingOpen(true)
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

  // The surface is opened *first*, so the player is on screen before anything
  // is asked to play. `agents/24` → "Audio -> YouTube" step 2.
  store.getState().openWith(item, autoplay ? 'loading' : 'cued')
  revealYouTubePlayer()
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
  revealYouTubePlayer()
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
 * Whether a player actually exists behind the store's item.
 *
 * The embed is destroyed whenever the expanded sheet closes, because that sheet
 * is the only place it is ever mounted. The store keeps the item, the position
 * and the session across that, so "there is a video loaded" and "there is a
 * player to talk to" became two different questions, and a transport that
 * confused them would press play against nothing.
 */
export function hasLiveYouTubePlayer(): boolean {
  return getYouTubeEngine().getCurrentItem() !== null
}

/**
 * One-shot intent: the visitor pressed play while the player did not exist.
 *
 * Lives outside React and outside the store — the store's shape is a public
 * contract and this is a message between two moments of one gesture, not state
 * anybody renders. The bar sets it and expands the sheet; the stage consumes it
 * once it has mounted, cued and restored the position.
 *
 * It is only ever set from a real press, which is what makes the play that
 * follows a user-initiated one rather than a scripted autoplay.
 */
let resumeOnAttach = false

export function requestYouTubeResume(): void {
  resumeOnAttach = true
}

export function consumeYouTubeResume(): boolean {
  const requested = resumeOnAttach
  resumeOnAttach = false
  return requested
}

/** The surface's own play/pause control. Always a direct user gesture. */
export function toggleYouTubePlayback(store: Store = useYouTubeStore): void {
  const state = store.getState()
  if (!state.item) return
  const engine = getYouTubeEngine()
  if (state.status === 'playing') {
    engine.pause()
    state.setStatus('paused')
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
  releasePlayback('youtube')
  store.getState().close()
  // The expanded view *is* the player's surface, so dismissing the video closes
  // it too. Leaving it open would strand the visitor in a full-screen sheet that
  // has silently become a view of the audio track underneath.
  useUiStore.getState().setNowPlayingOpen(false)
}

/**
 * `document.visibilitychange` handler. A hidden document pauses YouTube — this
 * is the background-playback rule, and it is not optional.
 *
 * The developer policies prohibit an API client from allowing the player to
 * continue when the client's window is closed or minimised, so this is the
 * behaviour rather than a limitation to be worked around. What Phase 8 adds is
 * only an *explanation*: a flag the surface can read to tell the visitor why the
 * video stopped, and that Audius and Jamendo do not have this restriction.
 */
export function handleDocumentVisibility(hidden: boolean, store: Store = useYouTubeStore): void {
  if (!hidden) return
  const state = store.getState()
  if (state.status !== 'playing') return
  getYouTubeEngine().pause()
  state.setStatus('paused')
  state.setPausedForBackgroundPolicy(true)
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
  revealYouTubePlayer()
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
  revealYouTubePlayer()
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
  if (!store.getState().continuousPlay) return false
  // Nothing loaded means nothing to be related *to* — after the surface was
  // closed, for instance. There is no continuation to attempt and no request to
  // make for one.
  if (!store.getState().item) return false

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
      if (!store.getState().continuousPlay) return
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
