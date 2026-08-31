import { YT_STATE, describePlayerError } from './iframe-adapter'
import type {
  CreatePlayerOptions,
  YouTubePlayerFactory,
  YouTubePlayerHandle,
} from './iframe-adapter'

/**
 * Deterministic stand-in for the official IFrame player.
 *
 * jsdom cannot run the YouTube player, and the normal test suites must never
 * touch a real iframe or the live network (agents/24 → "Testability",
 * agents/27 → "Normal E2E must not use live YouTube"). Tests drive this
 * instead of weakening the production adapter.
 */

export interface FakeYouTubePlayer extends YouTubePlayerHandle {
  readonly videoId: string | null
  readonly playing: boolean
  readonly cued: boolean
  readonly destroyed: boolean
  readonly playCalls: number
  /** How many times the unified seek rail drove this player. */
  readonly seekCalls: number
  /** The seconds argument of the most recent `seekTo`, before clamping. */
  readonly lastSeek: number | null
  readonly container: HTMLElement
  readonly options: CreatePlayerOptions
  /** Drive the documented events from a test. */
  emitState(state: number): void
  emitError(code: number): void
  emitAutoplayBlocked(): void
  setCurrentTime(seconds: number): void
  setDuration(seconds: number): void
}

export interface FakeYouTubeFactory extends YouTubePlayerFactory {
  /**
   * Called with every player the moment it is built, before its `onReady`.
   *
   * The seam a test needs now that a player is only constructed once there is a
   * video to construct it around: there is no instance to reach for in advance,
   * so a test that wants to change how a player behaves has to be handed it.
   */
  onCreate: ((player: FakeYouTubePlayer) => void) | null
  /** How many times the script preload was asked for. */
  readonly apiPrepared: number
  /**
   * Hold the next `create()` open: the player is built, and its `onReady` — and
   * therefore the promise the engine is waiting on — is withheld until released.
   *
   * The behaviour a physical device showed, and the one the whole recovery path
   * exists for. Left unreleased it never settles at all, which is the failure
   * itself; released after the engine has moved on, it is the *late* arrival
   * that must not be allowed to replace a working player.
   */
  deferNextCreate(): void
  /** Lets every held construction complete, however late. */
  releaseDeferredCreates(): void
  /** How many constructions are still being held. */
  readonly deferredCreates: number
  /**
   * The `allow` attribute the doubled API puts on the iframe it builds.
   *
   * A real `YT.Player` sets one, and whether it includes `autoplay` decides
   * whether a browser will let a scripted start succeed at all. Making it
   * settable is what lets a test cover both the version that includes the token
   * and a version that does not, rather than assuming either.
   */
  allowAttribute: string
  /** Every player this factory built — the single-instance assertion. */
  readonly players: FakeYouTubePlayer[]
  readonly created: number
  /** The live player, or null once destroyed. */
  current(): FakeYouTubePlayer | null
  /** Make the next `create()` reject, as a failed script load would. */
  failNextCreate(message: string): void
  reset(): void
}

/** What a current official IFrame API build puts on the iframe it creates. */
export const DEFAULT_IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'

export function createFakeYouTubeFactory(): FakeYouTubeFactory {
  const players: FakeYouTubePlayer[] = []
  let failNext: string | null = null
  let deferNext = false
  const deferred: (() => void)[] = []
  let apiPrepared = 0

  const factory: FakeYouTubeFactory = {
    players,
    allowAttribute: DEFAULT_IFRAME_ALLOW,
    onCreate: null,
    get apiPrepared() {
      return apiPrepared
    },
    deferNextCreate() {
      deferNext = true
    },
    releaseDeferredCreates() {
      const held = deferred.splice(0, deferred.length)
      for (const release of held) release()
    },
    get deferredCreates() {
      return deferred.length
    },
    prepareApi() {
      apiPrepared += 1
      return Promise.resolve()
    },
    get created() {
      return players.length
    },
    current() {
      const last = players[players.length - 1]
      return last && !last.destroyed ? last : null
    },
    failNextCreate(message) {
      failNext = message
    },
    reset() {
      players.length = 0
      failNext = null
      deferNext = false
      deferred.length = 0
      apiPrepared = 0
      factory.onCreate = null
    },
    create(container, options) {
      if (failNext) {
        const message = failNext
        failNext = null
        return Promise.reject(new Error(message))
      }

      let videoId: string | null = options.videoId || null
      let playing = false
      let cued = Boolean(options.videoId)
      let destroyed = false
      let playCalls = 0
      let seekCalls = 0
      let lastSeek: number | null = null
      let currentTime = 0
      let duration = 0
      let state: number = YT_STATE.UNSTARTED

      const player: FakeYouTubePlayer = {
        get videoId() {
          return videoId
        },
        get playing() {
          return playing
        },
        get cued() {
          return cued
        },
        get destroyed() {
          return destroyed
        },
        get playCalls() {
          return playCalls
        },
        get seekCalls() {
          return seekCalls
        },
        get lastSeek() {
          return lastSeek
        },
        container,
        options,

        cueVideoById(next) {
          videoId = next
          cued = true
          playing = false
          state = YT_STATE.CUED
          options.events.onStateChange?.('cued')
        },
        loadVideoById(next) {
          videoId = next
          cued = true
          playing = true
          playCalls += 1
          state = YT_STATE.PLAYING
          options.events.onStateChange?.('playing')
        },
        playVideo() {
          playCalls += 1
          playing = true
          state = YT_STATE.PLAYING
          options.events.onStateChange?.('playing')
        },
        pauseVideo() {
          playing = false
          state = YT_STATE.PAUSED
          options.events.onStateChange?.('paused')
        },
        stopVideo() {
          playing = false
          currentTime = 0
          state = YT_STATE.UNSTARTED
          options.events.onStateChange?.('unstarted')
        },
        // The real player clamps to the video and reports the new position on
        // its next clock read; the fake mirrors that so a seek is observable
        // through `getCurrentTime` exactly as it is in production.
        seekTo(seconds) {
          if (!Number.isFinite(seconds)) return
          seekCalls += 1
          lastSeek = Math.max(seconds, 0)
          currentTime = duration > 0 ? Math.min(lastSeek, duration) : lastSeek
        },
        getCurrentTime: () => currentTime,
        getDuration: () => duration,
        getPlayerState: () => state,
        getIframe: () => container.querySelector('iframe'),
        destroy() {
          destroyed = true
          playing = false
          container.replaceChildren()
        },

        emitState(next) {
          state = next
          playing = next === YT_STATE.PLAYING
          const named =
            next === YT_STATE.PLAYING
              ? 'playing'
              : next === YT_STATE.PAUSED
                ? 'paused'
                : next === YT_STATE.ENDED
                  ? 'ended'
                  : next === YT_STATE.BUFFERING
                    ? 'buffering'
                    : next === YT_STATE.CUED
                      ? 'cued'
                      : 'unstarted'
          options.events.onStateChange?.(named)
        },
        emitError(code) {
          options.events.onError?.(describePlayerError(code))
        },
        emitAutoplayBlocked() {
          playing = false
          options.events.onAutoplayBlocked?.()
        },
        setCurrentTime(seconds) {
          currentTime = seconds
        },
        setDuration(seconds) {
          duration = seconds
        },
      }

      players.push(player)
      factory.onCreate?.(player)
      // The real API creates the iframe itself; the fake mirrors that so
      // "the container holds exactly one iframe and nothing else" is testable.
      const iframe = container.ownerDocument.createElement('iframe')
      iframe.title = 'YouTube video player'
      if (factory.allowAttribute) iframe.setAttribute('allow', factory.allowAttribute)
      container.replaceChildren(iframe)

      if (deferNext) {
        deferNext = false
        // Built, but silent: no `onReady`, and nothing resolves. Exactly the
        // shape of the construction that stalled on a real device.
        return new Promise<YouTubePlayerHandle>((resolve) => {
          deferred.push(() => {
            options.events.onReady?.()
            resolve(player)
          })
        })
      }

      options.events.onReady?.()
      return Promise.resolve(player)
    },
  }

  return factory
}
