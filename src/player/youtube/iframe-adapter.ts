/**
 * Typed wrapper around the official YouTube IFrame Player API.
 *
 * The global `YT` object is untyped and loaded by a script tag, which is
 * unusable directly from strict TypeScript and untestable in jsdom. Everything
 * the app does to a YouTube player goes through `YouTubePlayerHandle` instead,
 * and `YouTubePlayerFactory` is the seam a test replaces with a fake
 * (agents/24_YOUTUBE_PLAYBACK_ENGINE.md → "Official IFrame API", "Testability").
 *
 * Only documented API surface is used: the constructor's `width`/`height`/
 * `videoId`/`playerVars`/`events`, and the documented player methods. No
 * undocumented option (there is no documented `host` option, so none is passed)
 * and no direct DOM manipulation of the generated iframe
 * (docs/youtube-policy-audit.md §9).
 */

/** Documented `YT.PlayerState` values. */
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const

export type YouTubePlaybackState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued'

export function describePlayerState(state: number): YouTubePlaybackState {
  switch (state) {
    case YT_STATE.ENDED:
      return 'ended'
    case YT_STATE.PLAYING:
      return 'playing'
    case YT_STATE.PAUSED:
      return 'paused'
    case YT_STATE.BUFFERING:
      return 'buffering'
    case YT_STATE.CUED:
      return 'cued'
    default:
      return 'unstarted'
  }
}

/**
 * Documented `onError` codes, mapped to copy that says what the visitor can do.
 * A failed video is never silently swapped for "a mirror copy" — that is
 * explicitly out of bounds (agents/24 → "Errors").
 */
export function describePlayerError(code: number): string {
  switch (code) {
    case 2:
      return 'YouTube rejected that video id.'
    case 5:
      return 'This video cannot be played in an embedded player here.'
    case 100:
      return 'That video is unavailable — it may have been removed or made private.'
    case 101:
    case 150:
      return 'The uploader does not allow this video to be played outside YouTube.'
    default:
      return 'YouTube could not play this video.'
  }
}

export interface YouTubePlayerEvents {
  onReady?: () => void
  onStateChange?: (state: YouTubePlaybackState) => void
  onError?: (message: string) => void
  /** Documented `onAutoplayBlocked`: the browser refused a scripted play. */
  onAutoplayBlocked?: () => void
}

export interface CreatePlayerOptions {
  videoId: string
  width: number
  height: number
  origin: string
  events: YouTubePlayerEvents
}

/** Everything the app is allowed to ask of a YouTube player. */
export interface YouTubePlayerHandle {
  cueVideoById(videoId: string): void
  loadVideoById(videoId: string): void
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  /**
   * Documented `seekTo(seconds, allowSeekAhead)`.
   *
   * Using it is not a workaround and does not touch YouTube's own controls: it
   * is first-class published API surface, and the unified seek rail drives the
   * player through it exactly as the native scrubber would. Nothing is drawn
   * over the iframe to provide it (docs/youtube-policy-audit.md §6 — overlays).
   *
   * `allowSeekAhead` defaults to `true`, the documented behaviour for a seek
   * the visitor has committed to: it lets the player request the unbuffered
   * segment rather than snapping to the nearest keyframe it already holds.
   */
  seekTo(seconds: number, allowSeekAhead?: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  getIframe(): HTMLIFrameElement | null
  destroy(): void
}

export interface YouTubePlayerFactory {
  create(container: HTMLElement, options: CreatePlayerOptions): Promise<YouTubePlayerHandle>
}

// --- The real, official implementation ------------------------------------

interface YtPlayerInstance {
  cueVideoById: (videoId: string) => void
  loadVideoById: (videoId: string) => void
  playVideo: () => void
  pauseVideo: () => void
  stopVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  getIframe: () => HTMLIFrameElement
  destroy: () => void
}

interface YtNamespace {
  Player: new (element: HTMLElement, config: Record<string, unknown>) => YtPlayerInstance
}

interface YouTubeGlobals {
  YT?: YtNamespace
  onYouTubeIframeAPIReady?: () => void
}

export const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'

let apiPromise: Promise<YtNamespace> | null = null

/** Test seam: forget the cached script load between suites. */
export function resetIframeApiLoader(): void {
  apiPromise = null
}

/**
 * Injects the official IFrame API script, once, lazily.
 *
 * Lazily matters for policy as much as for weight: nothing YouTube-related may
 * run before the visitor asks for it, so this is not called on page load, not
 * on search, and not on render — only when a YouTube item is actually played
 * (agents/26 → "Autoplay").
 */
export function loadYouTubeIframeApi(): Promise<YtNamespace> {
  const globals = globalThis as unknown as YouTubeGlobals
  if (globals.YT?.Player) return Promise.resolve(globals.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise<YtNamespace>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('The YouTube player needs a document.'))
      return
    }

    // The documented handshake: the API script calls this global when ready.
    // Any previously registered callback is preserved rather than clobbered.
    const previous = globals.onYouTubeIframeAPIReady
    globals.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (globals.YT?.Player) resolve(globals.YT)
      else reject(new Error('The YouTube player script loaded without an API.'))
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${IFRAME_API_SRC}"]`)
    if (existing) return

    const script = document.createElement('script')
    script.src = IFRAME_API_SRC
    script.async = true
    script.onerror = () => {
      apiPromise = null
      reject(new Error('The YouTube player script could not be loaded.'))
    }
    document.head.appendChild(script)
  })

  return apiPromise
}

/**
 * The production factory.
 *
 * `playerVars` are exactly the documented ones this app needs, and no more:
 *
 * · `autoplay: 0` — nothing plays until asked. Also the documented default.
 * · `controls: 1` — native controls stay visible and usable. Required.
 * · `playsinline: 1` — inline playback on iOS instead of a forced takeover,
 *   which is what keeps the player *visible in the page* while it plays.
 * · `enablejsapi: 1` + `origin` — the documented pairing; the reference says to
 *   "always specify your domain as the origin parameter value" when using the
 *   IFrame API.
 *
 * `modestbranding` is deliberately absent: it is documented as deprecated with
 * no effect. `rel` is absent for the same kind of reason — since 2018 it no
 * longer disables related videos.
 */
export const officialYouTubePlayerFactory: YouTubePlayerFactory = {
  async create(container, options) {
    const YT = await loadYouTubeIframeApi()

    return await new Promise<YouTubePlayerHandle>((resolve, reject) => {
      let settled = false
      const player = new YT.Player(container, {
        width: options.width,
        height: options.height,
        videoId: options.videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          playsinline: 1,
          enablejsapi: 1,
          origin: options.origin,
        },
        events: {
          onReady: () => {
            options.events.onReady?.()
            if (!settled) {
              settled = true
              resolve(wrap(player))
            }
          },
          onStateChange: (event: { data?: unknown }) => {
            const data = typeof event?.data === 'number' ? event.data : YT_STATE.UNSTARTED
            options.events.onStateChange?.(describePlayerState(data))
          },
          onError: (event: { data?: unknown }) => {
            const code = typeof event?.data === 'number' ? event.data : 0
            options.events.onError?.(describePlayerError(code))
            if (!settled) {
              settled = true
              reject(new Error(describePlayerError(code)))
            }
          },
          onAutoplayBlocked: () => options.events.onAutoplayBlocked?.(),
        },
      })
    })
  },
}

function wrap(player: YtPlayerInstance): YouTubePlayerHandle {
  // Every call is defensive: the IFrame API throws if a method is invoked
  // against a player whose iframe has already gone away, and a torn-down
  // player must not be able to break the page around it.
  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn()
    } catch {
      return fallback
    }
  }
  return {
    cueVideoById: (videoId) => safe(() => player.cueVideoById(videoId), undefined),
    loadVideoById: (videoId) => safe(() => player.loadVideoById(videoId), undefined),
    playVideo: () => safe(() => player.playVideo(), undefined),
    pauseVideo: () => safe(() => player.pauseVideo(), undefined),
    stopVideo: () => safe(() => player.stopVideo(), undefined),
    seekTo: (seconds, allowSeekAhead = true) =>
      safe(() => player.seekTo(seconds, allowSeekAhead), undefined),
    getCurrentTime: () => safe(() => player.getCurrentTime(), 0),
    getDuration: () => safe(() => player.getDuration(), 0),
    getPlayerState: () => safe(() => player.getPlayerState(), YT_STATE.UNSTARTED),
    getIframe: () => safe(() => player.getIframe(), null),
    destroy: () => safe(() => player.destroy(), undefined),
  }
}
