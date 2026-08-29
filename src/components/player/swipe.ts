import { useCallback, useRef } from 'react'

/**
 * The vertical swipe that opens and closes Now Playing.
 *
 * The decision is a pure function of the gesture, deliberately: gesture bugs are
 * miserable to reproduce through a rendered tree, and every rule here — how far
 * is far enough, how much horizontal drift is too much, what counts as a stray
 * touch — is arithmetic that deserves a test rather than a device.
 *
 * **Scoped, not global.** These handlers are attached to a specific grab area —
 * the mini-player's info region, the sheet's handle — and never to the page. The
 * app does not become a gesture surface, and nothing competes with ordinary
 * scrolling or with the seek rail.
 */

/**
 * How far a finger must travel before this counts as a swipe.
 *
 * Large enough that a tap with a shaky thumb is still a tap, small enough that a
 * deliberate flick does not have to cross the screen.
 */
export const SWIPE_THRESHOLD_PX = 56

/**
 * How much the movement must favour the vertical axis.
 *
 * A drag that is mostly sideways belongs to something else — a scrubber, a
 * carousel, a browser back-gesture — and must not be read as an open or close.
 */
export const SWIPE_AXIS_RATIO = 1.4

/** Longer than this and it is a considered drag, not a swipe. */
export const SWIPE_MAX_DURATION_MS = 800

export interface SwipeSample {
  /** Horizontal travel, in CSS pixels. */
  dx: number
  /** Vertical travel. Negative is upward. */
  dy: number
  /** Milliseconds between pointer down and up. */
  elapsed: number
}

export type SwipeDirection = 'up' | 'down' | null

/**
 * Which way this gesture went, if either.
 *
 * Returns `null` for everything ambiguous — too short, too slow, too sideways —
 * because the cost of a false positive is a surface opening or closing under
 * someone's finger, and the cost of a false negative is that they try again.
 */
export function swipeDirection(sample: SwipeSample): SwipeDirection {
  const { dx, dy, elapsed } = sample
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (elapsed > SWIPE_MAX_DURATION_MS) return null

  const vertical = Math.abs(dy)
  if (vertical < SWIPE_THRESHOLD_PX) return null
  if (vertical < Math.abs(dx) * SWIPE_AXIS_RATIO) return null

  return dy < 0 ? 'up' : 'down'
}

/**
 * True when a gesture starting on this element should be ignored.
 *
 * A press that lands on a control belongs to that control. Without this, sliding
 * the seek rail would close the sheet and dragging the volume rail would open
 * it — the two conflicts most likely to make the feature feel broken.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      'button, a, input, select, textarea, [role="slider"], [role="menu"], [role="menuitem"], [data-no-swipe="true"]',
    ),
  )
}

export interface VerticalSwipeOptions {
  onSwipeUp?: () => void
  onSwipeDown?: () => void
}

export interface VerticalSwipeHandlers {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onPointerCancel: () => void
}

/**
 * Pointer Events, once, for mouse touch and pen alike.
 *
 * **The pointer is captured, and it has to be.** A swipe by definition ends
 * somewhere other than where it began: releasing 90px above the mini-player
 * delivers `pointerup` to whatever is under the finger *there*, and a handler
 * bound to the grab area never hears it. `setPointerCapture` retargets the rest
 * of the gesture back to the element that started it, which is the difference
 * between a swipe that works and one that silently does nothing.
 *
 * Capture is only taken once a gesture is genuinely being tracked — never when
 * the press landed on a control — so buttons, links and the rails keep their own
 * events. Nothing calls `preventDefault`: the area stays scrollable and
 * tappable, and the direction is decided on release rather than fought for
 * during the move.
 */
export function useVerticalSwipe(options: VerticalSwipeOptions): VerticalSwipeHandlers {
  const start = useRef<{ x: number; y: number; at: number } | null>(null)

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (isInteractiveTarget(event.target)) {
      start.current = null
      return
    }
    start.current = { x: event.clientX, y: event.clientY, at: Date.now() }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Some environments refuse an unknown pointer id. The gesture then simply
      // does not complete, and the tap and button routes still work.
    }
  }, [])

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const origin = start.current
      start.current = null
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      } catch {
        // Already released by the browser, which is the normal case.
      }
      if (!origin) return

      const direction = swipeDirection({
        dx: event.clientX - origin.x,
        dy: event.clientY - origin.y,
        elapsed: Date.now() - origin.at,
      })

      if (direction === 'up') options.onSwipeUp?.()
      else if (direction === 'down') options.onSwipeDown?.()
    },
    [options],
  )

  const onPointerCancel = useCallback(() => {
    start.current = null
  }, [])

  return { onPointerDown, onPointerUp, onPointerCancel }
}
