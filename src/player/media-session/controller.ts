import type { Track } from '@/music/types'
import { sessionMetadataFor } from './metadata'

/**
 * The bridge between Pulse's audio player and the operating system's media
 * controls — the lock screen, the notification shade, headset buttons and
 * Bluetooth transport keys.
 *
 * Three rules shape it:
 *
 * **Audio only.** It is wired to the single `HTMLAudioElement` that plays Audius
 * and Jamendo, and to nothing else. YouTube is never represented here: current
 * YouTube API policy prohibits background play while the client window is
 * closed or minimised, and an OS Next button that could restart a hidden video
 * is exactly the mechanism that would breach it (agents/33). When YouTube takes
 * the engine, this session is cleared outright.
 *
 * **It owns no playback.** Every handler calls an existing player action, so the
 * lock screen's Next and the on-page Next are literally the same code path
 * (agents/34). Nothing about the queue is reimplemented here.
 *
 * **Everything is optional.** Support varies by browser, by version and by
 * action; `setActionHandler` throws for actions a browser does not know. Each
 * registration is attempted independently, so one unsupported action cannot
 * take the others down with it.
 */

/** The actions Pulse offers, in the order it registers them. */
export const SESSION_ACTIONS = [
  'play',
  'pause',
  'stop',
  'previoustrack',
  'nexttrack',
  'seekto',
  'seekbackward',
  'seekforward',
] as const

export type SessionAction = (typeof SESSION_ACTIONS)[number]

/** Default jump for `seekbackward` / `seekforward` when the OS sends no offset. */
export const DEFAULT_SEEK_OFFSET_SECONDS = 10

/**
 * Minimum gap between `setPositionState` writes.
 *
 * `timeupdate` fires about four times a second; the OS needs a progress bar, not
 * a stream. One write per second keeps the lock screen honest at a fraction of
 * the cost (agents/31 → "Throttle position updates").
 */
export const POSITION_THROTTLE_MS = 1_000

export type SessionPlaybackState = 'none' | 'paused' | 'playing'

/** The player actions the session drives. Injected, so tests need no globals. */
export interface SessionHandlers {
  play: () => void
  pause: () => void
  stop: () => void
  previousTrack: () => void
  nextTrack: () => void
  seekTo: (seconds: number) => void
  seekBy: (offsetSeconds: number) => void
}

export interface PositionSnapshot {
  duration: number
  position: number
  playbackRate?: number
}

/**
 * The slice of `navigator.mediaSession` this module uses.
 *
 * Declared structurally rather than relying on the DOM lib, because the shape a
 * given TypeScript DOM version exposes differs and the tests supply a double.
 */
export interface MediaSessionLike {
  metadata: unknown
  playbackState: SessionPlaybackState
  setActionHandler: (action: string, handler: ((details: unknown) => void) | null) => void
  setPositionState?: (state?: { duration: number; playbackRate: number; position: number }) => void
}

export interface MediaSessionEnvironment {
  session?: MediaSessionLike
  /** `window.MediaMetadata`. Absent on browsers with a partial implementation. */
  MediaMetadata?: new (init: Record<string, unknown>) => unknown
  now?: () => number
}

/** Reads the real environment, tolerating every partial implementation. */
export function detectEnvironment(): MediaSessionEnvironment {
  if (typeof navigator === 'undefined') return {}
  const session = (navigator as Navigator & { mediaSession?: MediaSessionLike }).mediaSession
  if (!session || typeof session.setActionHandler !== 'function') return {}
  const ctor =
    typeof window !== 'undefined'
      ? (window as unknown as { MediaMetadata?: new (init: Record<string, unknown>) => unknown })
          .MediaMetadata
      : undefined
  return { session, ...(ctor ? { MediaMetadata: ctor } : {}) }
}

export interface MediaSessionController {
  /** True when this browser exposes enough of the API to be worth using. */
  readonly supported: boolean
  /** Registers the handlers. Idempotent — never leaves duplicates behind. */
  activate: (handlers: SessionHandlers) => void
  /** Removes every handler and clears metadata. Used when YouTube takes over. */
  deactivate: () => void
  setTrack: (track: Track | null) => void
  setPlaybackState: (state: SessionPlaybackState) => void
  setPosition: (snapshot: PositionSnapshot) => void
  /** Actions successfully registered on this browser. For tests and reporting. */
  registeredActions: () => SessionAction[]
}

export function createMediaSessionController(
  environment: MediaSessionEnvironment = detectEnvironment(),
): MediaSessionController {
  const session = environment.session
  const now = environment.now ?? (() => Date.now())

  let registered: SessionAction[] = []
  let lastPositionAt = 0
  let currentTrackId: string | null = null

  const supported = Boolean(session)

  /**
   * Registers one handler, tolerating a browser that does not know the action.
   *
   * The spec says an unsupported action throws `NotSupportedError`, and browsers
   * differ on which they implement — `stop` and `seekto` most of all. Each is
   * therefore attempted on its own.
   */
  function register(action: SessionAction, handler: (details: unknown) => void): void {
    if (!session) return
    try {
      session.setActionHandler(action, handler)
      registered.push(action)
    } catch {
      // Unsupported here. The others are unaffected.
    }
  }

  function clearHandlers(): void {
    if (!session) return
    for (const action of SESSION_ACTIONS) {
      try {
        session.setActionHandler(action, null)
      } catch {
        // Never registered, or no longer supported. Nothing to undo.
      }
    }
    registered = []
  }

  return {
    supported,

    activate(handlers) {
      if (!session) return
      // Clear first: activating twice must not leave two generations of
      // closures bound to the same action.
      clearHandlers()

      register('play', () => handlers.play())
      register('pause', () => handlers.pause())
      register('stop', () => handlers.stop())
      register('previoustrack', () => handlers.previousTrack())
      register('nexttrack', () => handlers.nextTrack())
      register('seekto', (details) => {
        const seekTime = (details as { seekTime?: unknown } | undefined)?.seekTime
        if (typeof seekTime === 'number' && Number.isFinite(seekTime)) handlers.seekTo(seekTime)
      })
      register('seekbackward', (details) => {
        const offset = (details as { seekOffset?: unknown } | undefined)?.seekOffset
        const seconds = typeof offset === 'number' && offset > 0 ? offset : DEFAULT_SEEK_OFFSET_SECONDS
        handlers.seekBy(-seconds)
      })
      register('seekforward', (details) => {
        const offset = (details as { seekOffset?: unknown } | undefined)?.seekOffset
        const seconds = typeof offset === 'number' && offset > 0 ? offset : DEFAULT_SEEK_OFFSET_SECONDS
        handlers.seekBy(seconds)
      })
    },

    deactivate() {
      if (!session) return
      clearHandlers()
      session.metadata = null
      session.playbackState = 'none'
      currentTrackId = null
      lastPositionAt = 0
      // Clearing position state is optional and unsupported in places; a stale
      // progress bar on a dismissed session is harmless, a thrown error is not.
      try {
        session.setPositionState?.()
      } catch {
        // Ignored deliberately.
      }
    },

    setTrack(track) {
      if (!session) return
      if (!track) {
        session.metadata = null
        currentTrackId = null
        return
      }
      // Rebuilding identical metadata makes some platforms flicker the
      // notification, so the same track is written once.
      if (track.id === currentTrackId) return
      currentTrackId = track.id
      lastPositionAt = 0

      const Ctor = environment.MediaMetadata
      if (!Ctor) return
      try {
        session.metadata = new Ctor(sessionMetadataFor(track))
      } catch {
        // A browser that exposes the constructor but rejects the init is not
        // worth failing playback over.
      }
    },

    setPlaybackState(state) {
      if (!session) return
      try {
        session.playbackState = state
      } catch {
        // Read-only in some partial implementations.
      }
    },

    setPosition(snapshot) {
      if (!session?.setPositionState) return
      const { duration, position } = snapshot
      // The spec rejects a position past the duration, and a duration of zero
      // or NaN — both of which occur normally before metadata has loaded.
      if (!Number.isFinite(duration) || duration <= 0) return
      if (!Number.isFinite(position) || position < 0) return

      const timestamp = now()
      if (timestamp - lastPositionAt < POSITION_THROTTLE_MS) return
      lastPositionAt = timestamp

      try {
        session.setPositionState({
          duration,
          playbackRate: snapshot.playbackRate ?? 1,
          position: Math.min(position, duration),
        })
      } catch {
        // A rejected position state must never interrupt playback.
      }
    },

    registeredActions: () => [...registered],
  }
}
