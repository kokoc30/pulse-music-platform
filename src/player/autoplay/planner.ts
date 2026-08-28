import { artistKey } from '@/personalization/profile'
import { scoreCandidates } from './similarity'
import type { PlanContext, ScoredCandidate } from './types'

/**
 * Turning a scored pool into the next few tracks.
 *
 * Pure and deterministic: same inputs, same output, every time. Nothing here
 * plays anything, fetches anything or reads a store — it takes the situation as
 * an argument and returns an ordered list (agents/32 → "Diversity").
 */

/** Items the autoplay buffer aims to hold. */
export const BUFFER_TARGET = 5

/** Recently played tracks that autoplay strongly avoids re-picking. */
export const RECENT_WINDOW = 20

/** At most one repeat of an artist inside any run of three. */
export const ARTIST_CAP_NEAR = 1
export const ARTIST_WINDOW_NEAR = 3

/** At most two inside any run of ten. */
export const ARTIST_CAP_FAR = 2
export const ARTIST_WINDOW_FAR = 10

/**
 * Share of later slots that may go to exploration rather than pure similarity.
 *
 * Position 0 is exempt: the track that plays *next* always maximises similarity,
 * because that is the one the listener judges the feature by.
 */
export const EXPLORATION_RATIO = 0.2

/** How far down the ranking an exploration pick may reach. */
const EXPLORATION_DEPTH = 8

/**
 * Whether an artist may take the slot at `position`, given what precedes it.
 *
 * Both windows are checked because they say different things: "not twice in a
 * row" and "not five times in ten". A candidate has to satisfy both.
 */
export function artistAllowed(
  chosen: readonly ScoredCandidate[],
  artist: string,
  position: number,
): boolean {
  const countIn = (window: number) => {
    const start = Math.max(0, position - window)
    let count = 0
    for (let index = start; index < chosen.length; index += 1) {
      if (artistKey(chosen[index].track.artistName) === artist) count += 1
    }
    return count
  }
  // `ARTIST_CAP_NEAR` is the number of *existing* items allowed in the window,
  // so adding one more would make it `cap + 1` — hence `>=`.
  if (countIn(ARTIST_WINDOW_NEAR - 1) >= ARTIST_CAP_NEAR) return false
  return countIn(ARTIST_WINDOW_FAR - 1) < ARTIST_CAP_FAR
}

/**
 * The next tracks to play, in order.
 *
 * Exclusions come first and are absolute — the seed itself, anything the
 * visitor explicitly queued, anything already buffered, anything unplayable,
 * and anything in the recent window. Only what survives is ranked.
 */
export function planAutoplay(context: PlanContext): ScoredCandidate[] {
  const size = Math.max(0, context.size ?? BUFFER_TARGET)
  if (size === 0) return []

  const excluded = new Set<string>([
    context.seed.id,
    ...context.queuedIds,
    ...(context.bufferedIds ?? []),
    // Only the most recent slice is avoided: a listener with a long history
    // would otherwise run out of catalogue entirely.
    ...context.recentIds.slice(0, RECENT_WINDOW),
  ])

  /**
   * Only playable, non-excluded candidates survive.
   *
   * There is no YouTube check here, and deliberately so: a `Track` is typed as
   * `provider: 'audius' | 'jamendo'`, so a `YouTubeVideoItem` cannot be a
   * candidate at all. The policy that autoplay never queues YouTube (agents/33)
   * is a compile-time property of the model rather than a filter that could be
   * forgotten — the same argument `music/types.ts` makes about the audio engine.
   */
  const eligible = context.candidates.filter(
    (candidate) => candidate.track.isStreamable && !excluded.has(candidate.track.id),
  )

  const ranked = scoreCandidates(context.seed, eligible, {
    // Undefined unless the caller had consent to read the profile.
    ...(context.artistAffinity ? { artistAffinity: context.artistAffinity } : {}),
  })

  const chosen: ScoredCandidate[] = []
  const taken = new Set<string>()
  const explorationSlots = Math.round(size * EXPLORATION_RATIO)
  let explorationUsed = 0

  for (let position = 0; position < size; position += 1) {
    /**
     * Later slots may reach deeper into the ranking for variety.
     *
     * Deterministic rather than random: it walks *backwards* from a fixed depth,
     * so "the exploratory pick" is a defined item rather than a dice roll, and
     * the same history always yields the same run.
     */
    const explore =
      position > 0 && explorationUsed < explorationSlots && ranked.length > EXPLORATION_DEPTH

    const order = explore
      ? [...ranked.slice(1, EXPLORATION_DEPTH + 1).reverse(), ...ranked]
      : ranked

    const pick = order.find((candidate) => {
      if (taken.has(candidate.track.id)) return false
      return artistAllowed(chosen, artistKey(candidate.track.artistName), position)
    })

    if (!pick) break

    if (explore && pick !== ranked.find((candidate) => !taken.has(candidate.track.id))) {
      explorationUsed += 1
    }

    taken.add(pick.track.id)
    chosen.push(pick)
  }

  return chosen
}

/** The single best next track, or `null` when nothing is eligible. */
export function planNextTrack(context: PlanContext): ScoredCandidate | null {
  return planAutoplay({ ...context, size: 1 })[0] ?? null
}
