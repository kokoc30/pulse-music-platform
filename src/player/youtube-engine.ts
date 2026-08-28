import { isYouTubeVideoItem } from '@/music/types'
import type { MediaItem, YouTubeVideoItem } from '@/music/types'
import { officialYouTubePlayerFactory } from './youtube/iframe-adapter'
import type { YouTubePlaybackState, YouTubePlayerFactory, YouTubePlayerHandle } from './youtube/iframe-adapter'

/**
 * The single YouTube playback engine.
 *
 * Exactly one embedded player instance exists for the whole application and is
 * reused for every YouTube item, mirroring how one `HTMLAudioElement` serves
 * Audius and Jamendo (agents/24 → "Architecture", "YouTube -> YouTube").
 *
 * What this engine deliberately cannot do:
 *
 * · accept anything that is not a `YouTubeVideoItem` — the guard is a real
 *   runtime check, not just a type,
 * · play while its container is not on screen,
 * · exist at all before the visitor asks for YouTube: the container is attached
 *   by the surface component, and the official script is fetched on first play.
 */

/** Recommended 16:9 size from the IFrame API reference; the floor is 200×200. */
export const RECOMMENDED_WIDTH = 480
export const RECOMMENDED_HEIGHT = 270
export const MINIMUM_DIMENSION = 200

export interface YouTubeEngineEvents {
  onStateChange?: (state: YouTubePlaybackState) => void
  onReady?: () => void
  onError?: (message: string) => void
  onAutoplayBlocked?: () => void
  onTimeUpdate?: (currentTime: number, duration: number) => void
}

export interface PlayOptions {
  /**
   * True only for a direct user gesture. A scripted transition must pass false,
   * which cues the video and leaves it to an explicit play press unless the
   * caller has separately confirmed the player is more than half visible
   * (docs/youtube-policy-audit.md §5).
   */
  userInitiated: boolean
}

export interface YouTubeEngine {
  /** Gives the engine the on-screen element the player will occupy. */
  attach(container: HTMLElement): void
  detach(): void
  hasContainer(): boolean
  /** Cues without playing. Always safe, never counts as automatic playback. */
  cue(item: MediaItem): Promise<void>
  play(item: MediaItem, options: PlayOptions): Promise<void>
  resume(): void
  pause(): void
  stop(): void
  getCurrentItem(): YouTubeVideoItem | null
  isPlaying(): boolean
  subscribe(events: YouTubeEngineEvents): () => void
  destroy(): void
}

/** How often app UI reads the player clock, and only while it is playing. */
export const PROGRESS_POLL_MS = 1_000

export interface EngineOptions {
  factory?: YouTubePlayerFactory
  origin?: string
  /** Test seam for the progress timer. */
  scheduler?: {
    setInterval: (fn: () => void, ms: number) => number
    clearInterval: (handle: number) => void
  }
}

function requireYouTubeItem(item: MediaItem): YouTubeVideoItem {
  if (!isYouTubeVideoItem(item)) {
    // The mirror image of `assertAudioTrack`: an audio track must never reach
    // the iframe engine any more than a video may reach the audio element
    // (agents/28 → "Audio providers never enter YouTube engine").
    throw new Error('The YouTube engine only accepts YouTube video items.')
  }
  return item
}

export function createYouTubeIframeEngine(options: EngineOptions = {}): YouTubeEngine {
  const factory = options.factory ?? officialYouTubePlayerFactory
  const scheduler = options.scheduler ?? {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms) as unknown as number,
    clearInterval: (handle) => globalThis.clearInterval(handle),
  }

  const listeners = new Set<YouTubeEngineEvents>()
  let container: HTMLElement | null = null
  let player: YouTubePlayerHandle | null = null
  let creating: Promise<YouTubePlayerHandle> | null = null
  let current: YouTubeVideoItem | null = null
  let playing = false
  let progressTimer: number | null = null
  /**
   * A request that arrived before the visible surface existed.
   *
   * This is the correct order of operations, not a workaround: the surface is
   * opened first and the player is only built once it is on screen
   * (agents/24 → "Audio -> YouTube": render visible surface, *then* wait for
   * player readiness, *then* load). A click therefore lands here for the few
   * milliseconds React needs to mount the surface, and `attach()` flushes it.
   */
  let pending: { item: YouTubeVideoItem; mode: 'cue' | 'play'; userInitiated: boolean } | null = null

  const emit = (fn: (events: YouTubeEngineEvents) => void) => {
    for (const listener of listeners) fn(listener)
  }

  const stopProgress = () => {
    if (progressTimer !== null) {
      scheduler.clearInterval(progressTimer)
      progressTimer = null
    }
  }

  /** One modest timer, alive only while the player is actually playing. */
  const startProgress = () => {
    if (progressTimer !== null) return
    progressTimer = scheduler.setInterval(() => {
      if (!player) return
      emit((events) => events.onTimeUpdate?.(player?.getCurrentTime() ?? 0, player?.getDuration() ?? 0))
    }, PROGRESS_POLL_MS)
  }

  const handleState = (state: YouTubePlaybackState) => {
    playing = state === 'playing'
    if (playing) startProgress()
    else stopProgress()
    emit((events) => events.onStateChange?.(state))
  }

  async function ensurePlayer(item: YouTubeVideoItem): Promise<YouTubePlayerHandle> {
    if (player) return player
    if (!container) throw new Error('The YouTube player has no visible container yet.')
    // Concurrent calls share one creation: two clicks must not build two
    // players (agents/28 → "One YouTube player instance").
    creating ??= factory
      .create(container, {
        videoId: item.videoId,
        width: RECOMMENDED_WIDTH,
        height: RECOMMENDED_HEIGHT,
        origin: options.origin ?? (typeof window === 'undefined' ? '' : window.location.origin),
        events: {
          onReady: () => emit((events) => events.onReady?.()),
          onStateChange: handleState,
          onError: (message) => {
            playing = false
            stopProgress()
            emit((events) => events.onError?.(message))
          },
          onAutoplayBlocked: () => {
            playing = false
            stopProgress()
            emit((events) => events.onAutoplayBlocked?.())
          },
        },
      })
      .then((created) => {
        player = created
        creating = null
        return created
      })
      .catch((error: unknown) => {
        creating = null
        throw error
      })

    return await creating
  }

  async function perform(
    video: YouTubeVideoItem,
    mode: 'cue' | 'play',
    userInitiated: boolean,
  ): Promise<void> {
    const sameVideo = current?.videoId === video.videoId && player !== null
    const instance = await ensurePlayer(video)
    current = video

    if (mode === 'cue' || !userInitiated) {
      playing = false
      stopProgress()
      // `cueVideoById` loads the video's thumbnail and prepares the player
      // without fetching content until play — the documented way to line an
      // item up without initiating playback (agents/21 → "Automatic Playback";
      // the uncertain case must resolve to "do not autoplay").
      instance.cueVideoById(video.videoId)
      return
    }

    // Same video: resume where it was. Different video: load and play.
    if (sameVideo) instance.playVideo()
    else instance.loadVideoById(video.videoId)
  }

  function defer(video: YouTubeVideoItem, mode: 'cue' | 'play', userInitiated: boolean): void {
    current = video
    pending = { item: video, mode, userInitiated }
  }

  return {
    attach(next) {
      container = next
      const request = pending
      pending = null
      if (!request) return
      // A failure here has no caller left to reject: report it the way any
      // other player failure is reported.
      void perform(request.item, request.mode, request.userInitiated).catch((error: unknown) => {
        const message =
          error instanceof Error && error.message ? error.message : 'YouTube could not play this video.'
        emit((events) => events.onError?.(message))
      })
    },

    detach() {
      stopProgress()
      playing = false
      player?.destroy()
      player = null
      creating = null
      container = null
      current = null
      pending = null
    },

    hasContainer: () => container !== null,

    async cue(item) {
      const video = requireYouTubeItem(item)
      if (!container) {
        defer(video, 'cue', false)
        return
      }
      await perform(video, 'cue', false)
    },

    async play(item, playOptions) {
      const video = requireYouTubeItem(item)
      if (!container) {
        defer(video, 'play', playOptions.userInitiated)
        return
      }
      await perform(video, 'play', playOptions.userInitiated)
    },

    resume() {
      player?.playVideo()
    },

    pause() {
      playing = false
      stopProgress()
      player?.pauseVideo()
    },

    stop() {
      playing = false
      stopProgress()
      player?.stopVideo()
    },

    getCurrentItem: () => current,
    isPlaying: () => playing,

    subscribe(events) {
      listeners.add(events)
      return () => {
        listeners.delete(events)
      }
    },

    destroy() {
      stopProgress()
      listeners.clear()
      player?.destroy()
      player = null
      creating = null
      container = null
      current = null
      pending = null
      playing = false
    },
  }
}

let engine: YouTubeEngine | null = null

/** Lazily created so importing this module never touches the DOM or network. */
export function getYouTubeEngine(): YouTubeEngine {
  engine ??= createYouTubeIframeEngine()
  return engine
}

/** Test seam, and the HMR teardown hook. */
export function setYouTubeEngine(next: YouTubeEngine | null): void {
  if (engine && engine !== next) engine.destroy()
  engine = next
}

/** True when a YouTube player exists at all — used to avoid pointless work. */
export function hasYouTubeEngine(): boolean {
  return engine !== null
}
