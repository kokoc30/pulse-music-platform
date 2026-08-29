import { describe, expect, it } from 'vitest'
import {
  SWIPE_AXIS_RATIO,
  SWIPE_MAX_DURATION_MS,
  SWIPE_THRESHOLD_PX,
  isInteractiveTarget,
  swipeDirection,
} from './swipe'

/**
 * The gesture rules, as arithmetic.
 *
 * Gesture bugs are the kind that only appear on someone's phone, so the decision
 * is a pure function and every rule is pinned here rather than left to a device.
 * The bias throughout is towards *not* firing: a surface that opens or closes
 * under a finger is far worse than one that needs a second try.
 */

const swipe = (dx: number, dy: number, elapsed = 200) => swipeDirection({ dx, dy, elapsed })

describe('a deliberate vertical swipe', () => {
  it('opens on a clear upward flick', () => {
    expect(swipe(0, -SWIPE_THRESHOLD_PX)).toBe('up')
    expect(swipe(4, -120)).toBe('up')
  })

  it('closes on a clear downward flick', () => {
    expect(swipe(0, SWIPE_THRESHOLD_PX)).toBe('down')
    expect(swipe(-6, 140)).toBe('down')
  })
})

describe('everything ambiguous is ignored', () => {
  it('ignores a tap that wobbled', () => {
    expect(swipe(0, -5)).toBeNull()
    expect(swipe(2, 3)).toBeNull()
    expect(swipe(0, 0)).toBeNull()
  })

  it('ignores movement just short of the threshold', () => {
    expect(swipe(0, -(SWIPE_THRESHOLD_PX - 1))).toBeNull()
    expect(swipe(0, SWIPE_THRESHOLD_PX - 1)).toBeNull()
  })

  it('ignores a drag that is mostly horizontal', () => {
    // A sideways drag belongs to a scrubber or a browser back-gesture.
    expect(swipe(200, -60)).toBeNull()
    expect(swipe(-200, 60)).toBeNull()
  })

  it('requires the vertical axis to dominate, not merely lead', () => {
    const dy = -100
    const justTooFlat = Math.abs(dy) / SWIPE_AXIS_RATIO + 1
    expect(swipe(justTooFlat, dy)).toBeNull()
    expect(swipe(Math.abs(dy) / SWIPE_AXIS_RATIO - 5, dy)).toBe('up')
  })

  it('ignores a slow considered drag', () => {
    expect(swipe(0, -200, SWIPE_MAX_DURATION_MS + 1)).toBeNull()
    expect(swipe(0, -200, SWIPE_MAX_DURATION_MS - 1)).toBe('up')
  })

  it('ignores nonsense coordinates rather than guessing', () => {
    expect(swipe(Number.NaN, -100)).toBeNull()
    expect(swipe(0, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('gestures that start on a control belong to that control', () => {
  const make = (html: string): Element => {
    const host = document.createElement('div')
    host.innerHTML = html
    return host.firstElementChild!
  }

  it('ignores buttons, links and form fields', () => {
    expect(isInteractiveTarget(make('<button>x</button>'))).toBe(true)
    expect(isInteractiveTarget(make('<a href="#">x</a>'))).toBe(true)
    expect(isInteractiveTarget(make('<input />'))).toBe(true)
  })

  it('ignores the seek and volume rails, which are sliders', () => {
    // The conflict this exists for: dragging the scrubber must never close the
    // sheet, and dragging the volume rail must never open it.
    expect(isInteractiveTarget(make('<div role="slider"></div>'))).toBe(true)
  })

  it('ignores menus and anything opted out explicitly', () => {
    expect(isInteractiveTarget(make('<div role="menuitem">x</div>'))).toBe(true)
    expect(isInteractiveTarget(make('<div data-no-swipe="true"></div>'))).toBe(true)
  })

  it('looks at ancestors, because a press lands on the icon inside a button', () => {
    const button = make('<button><svg><path></path></svg></button>')
    expect(isInteractiveTarget(button.querySelector('path'))).toBe(true)
  })

  it('allows a gesture on ordinary content', () => {
    expect(isInteractiveTarget(make('<div><b>Title</b></div>'))).toBe(false)
    expect(isInteractiveTarget(null)).toBe(false)
  })
})
