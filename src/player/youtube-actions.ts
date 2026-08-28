import { canEmbedYouTubeItem, embedBlockReason } from '@/music/youtube/normalize'
import type { YouTubeVideoItem } from '@/music/types'
import { activateYouTube, releasePlayback } from './playback-coordinator'
import { getYouTubeEngine } from './youtube-engine'
import { useYouTubeStore } from './youtube-store'

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
