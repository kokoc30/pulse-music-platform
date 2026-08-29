/**
 * How much of the YouTube player is actually on screen.
 *
 * This exists because one policy sentence needs a real measurement rather than
 * an assumption: *"An API Client must not initiate an automatic playback until
 * the player is visible and more than half of the player is visible on the page
 * or screen."* Deciding that from React state would be both slower and wrong —
 * an `IntersectionObserver` callback fires far more often than a render should,
 * and the value is needed at the instant a video ends, not at the instant the
 * component last rendered.
 *
 * So the ratio lives here, outside React: the surface writes it from its
 * observer, and `youtube-actions` reads it synchronously when it has to decide
 * whether an automatic transition is permitted.
 *
 * **The default is zero, not one.** Before anything has been observed the answer
 * to "is the player more than half visible?" must be *no*. Every unknown resolves
 * against autoplay, which is the same discipline `mayAutoplay` applies
 * (agents/21 → "If uncertain, cue … and require an explicit play action").
 */

let ratio = 0

/** Called by the surface's `IntersectionObserver`. */
export function setYouTubeVisibleRatio(next: number): void {
  ratio = Number.isFinite(next) ? Math.min(Math.max(next, 0), 1) : 0
}

/** The latest observed ratio, 0–1. Zero until something has been observed. */
export function youTubeVisibleRatio(): number {
  return ratio
}

/** Reset when the surface unmounts, so a stale ratio cannot authorise autoplay. */
export function resetYouTubeVisibility(): void {
  ratio = 0
}

/** True when the document itself is hidden — locked screen, background tab. */
export function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}
