import { describe, expect, it } from 'vitest'
import {
  effectiveOrder,
  mulberry32,
  nextQueueIndex,
  nextRepeatMode,
  previousQueueIndex,
  shuffledOrder,
} from './queue-order'
import type { OrderState, RepeatMode } from './queue-order'

const state = (overrides: Partial<OrderState> = {}): OrderState => ({
  queueLength: 5,
  currentIndex: 0,
  shuffle: false,
  shuffleOrder: [],
  repeatMode: 'off',
  ...overrides,
})

describe('the repeat cycle', () => {
  it('goes off, playlist, one, off', () => {
    const seen: RepeatMode[] = []
    let mode: RepeatMode = 'off'
    for (let i = 0; i < 3; i += 1) {
      mode = nextRepeatMode(mode)
      seen.push(mode)
    }
    expect(seen).toEqual(['all', 'one', 'off'])
  })
})

describe('the seeded generator', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('produces different sequences for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it('stays inside [0, 1)', () => {
    const random = mulberry32(7)
    for (let i = 0; i < 500; i += 1) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('the shuffled running order', () => {
  it('is a genuine permutation — every position exactly once', () => {
    const order = shuffledOrder(20, 7, 3)
    expect(order).toHaveLength(20)
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('puts the current item first, so switching shuffle on interrupts nothing', () => {
    expect(shuffledOrder(10, 4, 1)[0]).toBe(4)
  })

  it('never plays the current item again immediately', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const order = shuffledOrder(12, 5, seed)
      expect(order[1]).not.toBe(5)
    }
  })

  it('is stable for a session: the same seed always gives the same order', () => {
    expect(shuffledOrder(15, 2, 99)).toEqual(shuffledOrder(15, 2, 99))
  })

  it('actually shuffles rather than returning the queue order', () => {
    const sequential = Array.from({ length: 30 }, (_, i) => i)
    const shuffled = shuffledOrder(30, 0, 5)
    expect(shuffled).not.toEqual(sequential)
  })

  it('handles the degenerate sizes without throwing', () => {
    expect(shuffledOrder(0, -1, 1)).toEqual([])
    expect(shuffledOrder(1, 0, 1)).toEqual([0])
    // No current item yet: every position is fair game.
    expect(shuffledOrder(3, -1, 1)).toHaveLength(3)
  })
})

describe('the order actually in force', () => {
  it('is plain 0…n-1 with shuffle off', () => {
    expect(effectiveOrder(4, false, [3, 1, 0, 2])).toEqual([0, 1, 2, 3])
  })

  it('is the permutation with shuffle on', () => {
    expect(effectiveOrder(4, true, [3, 1, 0, 2])).toEqual([3, 1, 0, 2])
  })

  it('falls back to queue order when the permutation is stale', () => {
    // The queue grew or shrank and the order has not been rebuilt yet. Playing
    // in list order is the safe answer; skipping an item is not.
    expect(effectiveOrder(5, true, [1, 0])).toEqual([0, 1, 2, 3, 4])
  })
})

describe('next', () => {
  it('advances through the queue', () => {
    expect(nextQueueIndex(state({ currentIndex: 2 }))).toBe(3)
  })

  it('returns null at the end, which is what lets autoplay take over', () => {
    expect(nextQueueIndex(state({ currentIndex: 4 }))).toBeNull()
  })

  it('wraps only when Repeat playlist is on', () => {
    expect(nextQueueIndex(state({ currentIndex: 4, repeatMode: 'all' }))).toBe(0)
    expect(nextQueueIndex(state({ currentIndex: 4, repeatMode: 'off' }))).toBeNull()
  })

  it('follows the shuffled order, not the queue order', () => {
    const shuffled = state({
      currentIndex: 3,
      shuffle: true,
      shuffleOrder: [3, 1, 4, 0, 2],
    })
    expect(nextQueueIndex(shuffled)).toBe(1)
    expect(nextQueueIndex({ ...shuffled, currentIndex: 1 })).toBe(4)
  })

  it('ends at the end of the shuffled order, not the end of the queue', () => {
    const shuffled = state({ currentIndex: 2, shuffle: true, shuffleOrder: [3, 1, 4, 0, 2] })
    expect(nextQueueIndex(shuffled)).toBeNull()
    expect(nextQueueIndex({ ...shuffled, repeatMode: 'all' })).toBe(3)
  })

  it('says null for an empty queue', () => {
    expect(nextQueueIndex(state({ queueLength: 0, currentIndex: -1 }))).toBeNull()
  })

  it('starts at the beginning when the current item is not in the queue', () => {
    expect(nextQueueIndex(state({ currentIndex: -1 }))).toBe(0)
  })
})

describe('previous', () => {
  it('steps back through the queue', () => {
    expect(previousQueueIndex(state({ currentIndex: 3 }))).toBe(2)
  })

  it('returns null at the start unless Repeat playlist wraps it', () => {
    expect(previousQueueIndex(state({ currentIndex: 0 }))).toBeNull()
    expect(previousQueueIndex(state({ currentIndex: 0, repeatMode: 'all' }))).toBe(4)
  })

  it('follows the same shuffled order forwards and backwards', () => {
    const shuffled = state({ currentIndex: 4, shuffle: true, shuffleOrder: [3, 1, 4, 0, 2] })
    expect(previousQueueIndex(shuffled)).toBe(1)
  })

  it('makes next and previous exact inverses, so a shuffle is navigable', () => {
    const order = shuffledOrder(8, 0, 11)
    let index = 0
    const forwards: number[] = []
    for (let step = 0; step < 5; step += 1) {
      const next = nextQueueIndex(
        state({ queueLength: 8, currentIndex: index, shuffle: true, shuffleOrder: order }),
      )
      expect(next).not.toBeNull()
      index = next!
      forwards.push(index)
    }
    for (let step = 0; step < 5; step += 1) {
      const back = previousQueueIndex(
        state({ queueLength: 8, currentIndex: index, shuffle: true, shuffleOrder: order }),
      )
      expect(back).not.toBeNull()
      index = back!
    }
    expect(index).toBe(0)
    expect(forwards[0]).not.toBe(0)
  })
})
