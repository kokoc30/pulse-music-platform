import { canEmbedYouTubeItem, embedBlockReason } from '@/music/youtube/normalize'
import type { YouTubeVideoItem } from '@/music/types'
import { activateYouTube, releasePlayback } from './playback-coordinator'
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
  activateYouTube()

  try {
    const engine = getYouTubeEngine()
    await engine.play(item, { userInitiated: autoplay })
    // Reflect what the engine actually did rather than what was asked for. The
    // subscription in `bindYouTubeEngineEvents` will keep correcting this, but
    // the store must not be left claiming `loading` if playback is already
    // under way — the surface's own play/pause control reads it.
    if (!autoplay) store.getState().setAwaitingUserPlay(true)
    else if (engine.isPlaying()) store.getState().setStatus('playing')
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
export function handleDocumentVisibility(
  hidden: boolean,
  store: Store = useYouTubeStore,
): void {
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
 */
export async function playYouTubeSessionStep(
  direction: 1 | -1,
  store: Store = useYouTubeStore,
): Promise<boolean> {
  const { sessionItems, sessionIndex } = store.getState()
  const next = nextEligibleIndex(sessionItems, sessionIndex, direction)
  const item = sessionItems[next]
  if (next < 0 || !item) return false
  return playSessionItem(next, item, { userInitiated: true }, store)
}

/** True when a press of Next or Previous would go somewhere. */
export function hasYouTubeSessionStep(
  direction: 1 | -1,
  store: Store = useYouTubeStore,
): boolean {
  const { sessionItems, sessionIndex } = store.getState()
  return nextEligibleIndex(sessionItems, sessionIndex, direction) >= 0
}

/**
 * A video ended naturally. Continue through the results the visitor already has.
 *
 * Three gates, all of which must pass, and each of which is someone else's rule
 * rather than this function's opinion:
 *
 * 1. **Continuous play is on.** The visitor's own setting.
 * 2. **There is a next eligible result.** No request is made to find one; when
 *    the session runs out, playback simply ends and YouTube's replay screen
 *    stands.
 * 3. **`mayAutoplay` agrees.** The document is visible *and* more than half the
 *    player is on screen, measured by a real `IntersectionObserver`. This is
 *    Required Minimum Functionality, and it is checked through the same helper
 *    every other scripted transition uses.
 *
 * Failing (3) is not failure: the next item is **cued** and waits for a press,
 * which is exactly what the policy asks for when visibility is insufficient or
 * unknown. Failing (1) or (2) leaves the ended state alone.
 */
export async function advanceYouTubeSession(store: Store = useYouTubeStore): Promise<boolean> {
  const state = store.getState()
  if (!state.continuousPlay) return false

  const next = nextEligibleIndex(state.sessionItems, state.sessionIndex, 1)
  const item = state.sessionItems[next]
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

/** Engine → store bridge, wired once by the surface component. */
export function bindYouTubeEngineEvents(store: Store = useYouTubeStore): () => void {
  return getYouTubeEngine().subscribe({
    onStateChange: (state) => {
      const current = store.getState()
      switch (state) {
        case 'playing':
          current.setStatus('playing')
          break
        case 'paused':
          current.setStatus('paused')
          break
        case 'ended':
          current.setStatus('ended')
          // Previously the story stopped here, and the visitor was left looking
          // at YouTube's replay screen. Continuation is bounded by the session
          // the visitor already has and by the visibility rule; when either says
          // no, the ended state above is what stands.
          void advanceYouTubeSession(store)
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
    onError: (message) => store.getState().setError(message),
    onAutoplayBlocked: () => {
      // The browser refused; ask for a press rather than retrying, which would
      // be an attempt to work around the block.
      store.getState().setStatus('paused')
      store.getState().setAwaitingUserPlay(true)
    },
  })
}
