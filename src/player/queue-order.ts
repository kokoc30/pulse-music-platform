/**
 * Playback order: shuffle and repeat, as arithmetic over the queue.
 *
 * **The queue is never rearranged.** `queue` stays in the order the visitor's
 * playlist, shelf or search put it in, and shuffle is expressed as a separate
 * permutation of *indices* into it. That is what makes "shuffling playback must
 * not mutate the persisted playlist order" true by construction rather than by
 * remembering to copy an array (agents/45 → "Do not mutate persisted playlist
 * order when shuffling"), and it is why turning shuffle off restores the
 * original sequence exactly, mid-track, with no reload.
 *
 * **Deterministic within a session.** The permutation comes from a seeded PRNG
 * rather than `Math.random`, so the same seed and the same queue always produce
 * the same order. Next and Previous are therefore predictable — pressing Next
 * three times and Previous three times returns to where it started — and the
 * tests can describe an exact sequence instead of asserting statistics
 * (agents/45 → "preserve a session order so Next/Previous are predictable").
 */

export type RepeatMode = 'off' | 'all' | 'one'

export const REPEAT_MODES: readonly RepeatMode[] = ['off', 'all', 'one']

/** Off → repeat playlist → repeat one → off, the order the button cycles. */
export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  if (mode === 'off') return 'all'
  if (mode === 'all') return 'one'
  return 'off'
}

export const REPEAT_LABELS: Record<RepeatMode, string> = {
  off: 'Repeat off',
  all: 'Repeat playlist',
  one: 'Repeat one',
}

/**
 * A small, fast, fully deterministic PRNG.
 *
 * `Math.random` cannot be seeded, so a shuffle built on it is neither
 * reproducible for the visitor across a Previous/Next round trip nor testable
 * without statistical assertions. Mulberry32 is thirty-two bits of state and
 * three operations, which is ample for choosing a running order.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A shuffled running order over `length` queue positions.
 *
 * `currentIndex` is placed first when it is a real position, so switching
 * shuffle on mid-track never interrupts what is playing and the very next item
 * is genuinely a different one — the "avoid immediate repeat of the current
 * item" rule, satisfied structurally.
 *
 * Fisher–Yates over the remaining positions, drawing from the seeded generator.
 */
export function shuffledOrder(length: number, currentIndex: number, seed: number): number[] {
  if (length <= 0) return []

  const rest: number[] = []
  for (let index = 0; index < length; index += 1) {
    if (index !== currentIndex) rest.push(index)
  }

  const random = mulberry32(seed)
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[rest[index], rest[swap]] = [rest[swap], rest[index]]
  }

  return currentIndex >= 0 && currentIndex < length ? [currentIndex, ...rest] : rest
}

/** The playback order in force: the shuffled permutation, or plain 0…n-1. */
export function effectiveOrder(
  queueLength: number,
  shuffle: boolean,
  shuffleOrder: readonly number[],
): number[] {
  if (shuffle && shuffleOrder.length === queueLength) return [...shuffleOrder]
  return Array.from({ length: queueLength }, (_, index) => index)
}

export interface OrderState {
  queueLength: number
  currentIndex: number
  shuffle: boolean
  shuffleOrder: readonly number[]
  repeatMode: RepeatMode
}

/**
 * The next queue position, or `null` when the queue itself is exhausted.
 *
 * `null` is the signal that lets `playNext` fall through to autoplay. Note what
 * is *not* handled here: `repeat one` is deliberately absent, because replaying
 * the current track is not a queue movement — it is handled one level up, ahead
 * of the queue, which is what gives it the top of the precedence order
 * (agents/45 → "Priority at track end").
 */
export function nextQueueIndex(state: OrderState): number | null {
  const order = effectiveOrder(state.queueLength, state.shuffle, state.shuffleOrder)
  if (order.length === 0) return null

  const position = order.indexOf(state.currentIndex)
  if (position < 0) return order[0] ?? null

  const next = order[position + 1]
  if (next !== undefined) return next

  // End of the list. Only an explicit Repeat playlist wraps it; autoplay must
  // never be able to turn a finite list into an endless one.
  return state.repeatMode === 'all' ? (order[0] ?? null) : null
}

/**
 * The previous queue position, or `null` at the start.
 *
 * Repeat playlist wraps backwards too: a visitor who has just wrapped forward to
 * the first track expects Previous to take them back to the last.
 */
export function previousQueueIndex(state: OrderState): number | null {
  const order = effectiveOrder(state.queueLength, state.shuffle, state.shuffleOrder)
  if (order.length === 0) return null

  const position = order.indexOf(state.currentIndex)
  if (position < 0) return null

  if (position > 0) return order[position - 1] ?? null
  return state.repeatMode === 'all' ? (order[order.length - 1] ?? null) : null
}
