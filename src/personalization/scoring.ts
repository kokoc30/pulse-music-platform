import {
  COMPLETION_RATIO,
  MAX_REPEAT_FACTOR,
  MIN_RECENCY_DECAY,
  MS_PER_DAY,
  RECENCY_HALF_LIFE_DAYS,
  REPEAT_LOG_FACTOR,
  WEIGHTS,
} from './config'
import type { ListenEntry } from './types'

/**
 * The weighting model.
 *
 * Deliberately arithmetic rather than learned: no model, no embeddings, no
 * network. Every number a shelf shows can be traced back through these three
 * functions to specific rows of local history, which is what makes the
 * recommendations explainable and the tests deterministic (STEP 8).
 *
 *     effectiveWeight = interactionWeight x recencyDecay x repeatFactor
 *
 * Nothing outside this module may compute a weight, and no component imports it.
 */

/**
 * How much one item's interaction history is worth, before time is considered.
 *
 * A click that never qualified is worth 0.05 — present, but twenty times weaker
 * than a real listen, so an accidental play cannot move a shelf. Finishing a
 * track and coming back to it on a different day are the two strongest signals,
 * because both are hard to produce by accident.
 */
export function interactionWeight(entry: ListenEntry): number {
  let weight = entry.playCount > 0 ? WEIGHTS.qualified : WEIGHTS.unqualifiedPlay

  if (entry.completionRatio >= COMPLETION_RATIO) weight += WEIGHTS.completion
  if (entry.playedDays.length >= 2) weight += WEIGHTS.distinctDay
  weight -= entry.skipCount * WEIGHTS.earlySkip

  return Math.max(weight, WEIGHTS.minimum)
}

/**
 * Exponential decay with a 21-day half-life.
 *
 * Something played this morning counts fully; three weeks ago, half; six months
 * ago, near the floor. The floor is deliberately non-zero so a long-standing
 * favourite never vanishes outright from the profile.
 */
export function recencyDecay(lastPlayedAt: number, now = Date.now()): number {
  if (!Number.isFinite(lastPlayedAt) || lastPlayedAt <= 0) return MIN_RECENCY_DECAY
  const ageDays = Math.max(0, (now - lastPlayedAt) / MS_PER_DAY)
  return Math.max(0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS), MIN_RECENCY_DECAY)
}

/**
 * Repeat listening compounds — logarithmically, and with a ceiling.
 *
 * Linear growth would let one obsessively repeated track own the whole profile;
 * `log` with a 2.5x cap means the tenth play still counts for something while
 * the hundredth cannot crowd everything else out (STEP 4 → "Do not let a single
 * listen dominate the profile").
 */
export function repeatFactor(playCount: number): number {
  if (!Number.isFinite(playCount) || playCount <= 1) return 1
  return Math.min(1 + REPEAT_LOG_FACTOR * Math.log(playCount), MAX_REPEAT_FACTOR)
}

/** The composed weight one history row contributes to the profile. */
export function effectiveWeight(entry: ListenEntry, now = Date.now()): number {
  return (
    interactionWeight(entry) * recencyDecay(entry.lastPlayedAt, now) * repeatFactor(entry.playCount)
  )
}

/* --------------------------------------------------------------------------
   Weight maps
   -------------------------------------------------------------------------- */

export type WeightMap = Record<string, number>

export function addWeight(map: WeightMap, key: string, amount: number): void {
  if (!key || !Number.isFinite(amount) || amount <= 0) return
  map[key] = (map[key] ?? 0) + amount
}

/**
 * Rescales a weight map so its values sum to 1.
 *
 * Normalizing is what keeps the profile a set of *proportions* rather than a
 * running total: adding history changes the balance between preferences instead
 * of inflating every number, so thresholds like `MIN_SEED_AFFINITY` mean the
 * same thing on day one and on day two hundred.
 */
export function normalizeWeights(map: WeightMap): WeightMap {
  const total = Object.values(map).reduce((sum, value) => sum + value, 0)
  if (total <= 0) return {}
  const result: WeightMap = {}
  for (const [key, value] of Object.entries(map)) result[key] = value / total
  return result
}

/** Highest-weighted keys first; ties broken alphabetically so output is stable. */
export function topKeys(map: WeightMap, limit: number): string[] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key)
}
