import { describe, expect, it, vi } from 'vitest'
import { makePlayedItem, NOW } from '@/test/fixtures/personalization'
import type { PlaySession } from './history'
import { createListenTracker, MAX_TICK_SECONDS } from './listen-tracker'

/** Feeds a run of realistic 0.25 s `timeupdate` samples. */
function playFor(
  tracker: ReturnType<typeof createListenTracker>,
  seconds: number,
  from = 0,
): void {
  const step = 0.25
  for (let position = from + step; position <= from + seconds + 1e-9; position += step) {
    tracker.progress(Number(position.toFixed(4)), NOW)
  }
}

describe('listen tracker', () => {
  it('emits nothing while a play is below the threshold', () => {
    const emit = vi.fn<(session: PlaySession) => void>()
    const tracker = createListenTracker(emit)

    tracker.start(makePlayedItem({ durationSeconds: 240 }), NOW)
    playFor(tracker, 20)

    expect(emit).not.toHaveBeenCalled()
  })

  it('emits exactly once at the moment a listen qualifies', () => {
    const emit = vi.fn<(session: PlaySession) => void>()
    const tracker = createListenTracker(emit)

    tracker.start(makePlayedItem({ durationSeconds: 240 }), NOW)
    playFor(tracker, 45)

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].playedSeconds).toBeCloseTo(30, 1)
    expect(emit.mock.calls[0][0].creditedSeconds).toBe(0)
  })

  it('emits a second, additive session when the track finishes', () => {
    const emit = vi.fn<(session: PlaySession) => void>()
    const tracker = createListenTracker(emit)

    tracker.start(makePlayedItem({ durationSeconds: 240 }), NOW)
    playFor(tracker, 60)
    tracker.complete(NOW)

    expect(emit).toHaveBeenCalledTimes(2)
    const final = emit.mock.calls[1][0]
    expect(final.completed).toBe(true)
    // Everything already credited is declared, so the store adds only the rest.
    expect(final.creditedSeconds).toBeCloseTo(30, 1)
    expect(final.playedSeconds).toBeCloseTo(60, 1)
  })

  describe('seeking cannot manufacture a listen', () => {
    it('ignores a forward scrub to the end of the track', () => {
      const emit = vi.fn<(session: PlaySession) => void>()
      const tracker = createListenTracker(emit)

      tracker.start(makePlayedItem({ durationSeconds: 240 }), NOW)
      playFor(tracker, 3)
      // The scrubber is dragged from 0:03 to 3:55.
      tracker.progress(235, NOW)
      tracker.progress(235.25, NOW)

      expect(emit).not.toHaveBeenCalled()
      expect(tracker.snapshot()?.playedSeconds).toBeLessThan(4)
    })

    it('records the reached position for completion even when time was skipped', () => {
      const emit = vi.fn<(session: PlaySession) => void>()
      const tracker = createListenTracker(emit)

      tracker.start(makePlayedItem({ durationSeconds: 240 }), NOW)
      playFor(tracker, 3)
      tracker.progress(235, NOW)
      tracker.stop(NOW)

      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit.mock.calls[0][0].reachedSeconds).toBe(235)
      expect(emit.mock.calls[0][0].playedSeconds).toBeLessThan(4)
    })

    it('ignores a backwards seek rather than subtracting time', () => {
      const emit = vi.fn<(session: PlaySession) => void>()
      const tracker = createListenTracker(emit)

      tracker.start(makePlayedItem({ durationSeconds: 240 }), NOW)
      playFor(tracker, 20)
      tracker.progress(0, NOW)
      playFor(tracker, 20)

      // 40 seconds genuinely heard, across two passes over the same 20 seconds.
      expect(emit).toHaveBeenCalledTimes(1)
      expect(tracker.snapshot()?.playedSeconds).toBeCloseTo(40, 0)
    })

    it('credits at most one tick-width per sample', () => {
      const emit = vi.fn<(session: PlaySession) => void>()
      const tracker = createListenTracker(emit)

      tracker.start(makePlayedItem({ durationSeconds: 240 }), NOW)
      tracker.progress(MAX_TICK_SECONDS, NOW)
      expect(tracker.snapshot()?.playedSeconds).toBe(MAX_TICK_SECONDS)

      tracker.progress(MAX_TICK_SECONDS * 3, NOW)
      expect(tracker.snapshot()?.playedSeconds).toBe(MAX_TICK_SECONDS)
    })

    it('ignores nonsense positions', () => {
      const emit = vi.fn<(session: PlaySession) => void>()
      const tracker = createListenTracker(emit)
      tracker.start(makePlayedItem(), NOW)
      tracker.progress(Number.NaN, NOW)
      tracker.progress(-4, NOW)
      expect(tracker.snapshot()?.playedSeconds).toBe(0)
    })
  })

  describe('skips and switches', () => {
    it('emits an early-skip session when a track is dropped after a few seconds', () => {
      const emit = vi.fn<(session: PlaySession) => void>()
      const tracker = createListenTracker(emit)

      tracker.start(makePlayedItem({ durationSeconds: 240 }), NOW)
      playFor(tracker, 4)
      tracker.stop(NOW)

      expect(emit).toHaveBeenCalledTimes(1)
      const session = emit.mock.calls[0][0]
      expect(session.playedSeconds).toBeCloseTo(4, 1)
      expect(session.completed).toBe(false)
      expect(session.creditedSeconds).toBe(0)
    })

    it('finalizes the previous track when a new one starts', () => {
      const emit = vi.fn<(session: PlaySession) => void>()
      const tracker = createListenTracker(emit)

      tracker.start(makePlayedItem({ providerItemId: 'a', durationSeconds: 240 }), NOW)
      playFor(tracker, 5)
      tracker.start(makePlayedItem({ providerItemId: 'b', durationSeconds: 240 }), NOW)

      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit.mock.calls[0][0].item.providerItemId).toBe('a')
      expect(tracker.current()?.providerItemId).toBe('b')
    })

    it('emits nothing for a track that was opened and never played', () => {
      const emit = vi.fn<(session: PlaySession) => void>()
      const tracker = createListenTracker(emit)

      tracker.start(makePlayedItem(), NOW)
      tracker.stop(NOW)

      expect(emit).not.toHaveBeenCalled()
    })

    it('does not re-emit a fully credited session on a bare stop', () => {
      const emit = vi.fn<(session: PlaySession) => void>()
      const tracker = createListenTracker(emit)

      tracker.start(makePlayedItem({ durationSeconds: 240 }), NOW)
      playFor(tracker, 30)
      expect(emit).toHaveBeenCalledTimes(1)

      tracker.stop(NOW)
      expect(emit).toHaveBeenCalledTimes(1)
    })

    it('ignores progress after playback has stopped', () => {
      const emit = vi.fn<(session: PlaySession) => void>()
      const tracker = createListenTracker(emit)
      tracker.start(makePlayedItem(), NOW)
      tracker.stop(NOW)
      tracker.progress(100, NOW)
      expect(tracker.snapshot()).toBeNull()
    })
  })

  it('qualifies a short item at its own, lower threshold', () => {
    const emit = vi.fn<(session: PlaySession) => void>()
    const tracker = createListenTracker(emit)

    tracker.start(makePlayedItem({ durationSeconds: 60 }), NOW)
    playFor(tracker, 16)

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0].playedSeconds).toBeCloseTo(15, 1)
  })
})
