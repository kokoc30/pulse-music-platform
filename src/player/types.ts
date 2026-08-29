import type { PlayerStatus } from './player-store'
import type { YouTubeStatus } from './youtube-store'

/**
 * One vocabulary for "what is this player doing", across both engines.
 *
 * The audio element and the YouTube embed describe themselves differently —
 * five states against seven, with `cued` and `ended` existing on only one side —
 * and until now every component that wanted to draw a play button had to know
 * which of the two it was looking at. That is the whole reason the bottom bar
 * existed twice.
 *
 * This enum is deliberately **presentational**. It answers exactly the questions
 * a transport control asks: which icon, and is the control usable. It is not a
 * replacement for either engine's own status, and neither `PlayerStatus` nor
 * `YouTubeStatus` is modified — both remain the truth for the engine that owns
 * them, and both mappers are one-way.
 */
export type UnifiedStatus =
  /** Nothing is loaded. */
  | 'idle'
  /** Loaded but not yet playable — the control shows a spinner and waits. */
  | 'buffering'
  | 'playing'
  /** Loaded, playable, not running. The control shows Play and is pressable. */
  | 'paused'
  | 'ended'

/**
 * `error` maps to `paused`, not to `idle`.
 *
 * A failed track is still *loaded* — `currentTrack` survives — and `togglePlay`
 * answers a press on it by re-resolving the stream and trying again. So the
 * honest control is an enabled Play button, which is what `paused` renders. The
 * error text itself reaches the UI through its own field, not through status.
 */
export function mapAudioStatus(status: PlayerStatus): UnifiedStatus {
  switch (status) {
    case 'idle':
      return 'idle'
    case 'loading':
      return 'buffering'
    case 'playing':
      return 'playing'
    case 'paused':
    case 'error':
      return 'paused'
  }
}

/**
 * `cued` maps to `paused`, and that is a deliberate departure from treating it
 * as a loading state.
 *
 * A cued video is not busy — it is *ready and waiting for a press*, which is the
 * exact state the Required Minimum Functionality visibility rule produces on
 * purpose: when a scripted transition may not autoplay, the item is cued and an
 * explicit play action is required. Rendering that as `buffering` would disable
 * the one control the policy exists to insist on, so the state that means "press
 * play" is mapped to the state that draws a pressable Play button.
 *
 * `loading` — a real buffering report from the embed — still maps to
 * `buffering`, so a genuinely busy player still shows a spinner.
 */
export function mapYouTubeStatus(status: YouTubeStatus): UnifiedStatus {
  switch (status) {
    case 'idle':
      return 'idle'
    case 'loading':
      return 'buffering'
    case 'playing':
      return 'playing'
    case 'cued':
    case 'paused':
    case 'error':
      return 'paused'
    case 'ended':
      return 'ended'
  }
}
