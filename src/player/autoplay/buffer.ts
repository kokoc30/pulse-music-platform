import { buildProfile } from '@/personalization/profile'
import { usePersonalizationStore } from '@/personalization/store'
import type { Track } from '@/music/types'
import { collectCandidates } from './candidates'
import type { CandidateSources } from './candidates'
import { BUFFER_TARGET, planAutoplay } from './planner'
import { sessionTracks } from './session-pool'
import type { ScoredCandidate } from './types'

/**
 * The small standing supply of "what could play next".
 *
 * In memory only, never persisted, and refilled only when the explicit queue
 * cannot answer. Keeping it separate from the player queue is the point: the
 * queue is what the visitor asked for, this is what the app would offer, and
 * user intent has to win every time (agents/34 → "Keep explicit queue and
 * autoplay buffer conceptually separate").
 */

let buffer: ScoredCandidate[] = []
/** Seed the current buffer was planned from, so a new track invalidates it. */
let seedId: string | null = null
let refilling: Promise<void> | null = null

export interface RefillContext {
  seed: Track
  queuedIds: readonly string[]
  recentIds: readonly string[]
  signal?: AbortSignal
  /** Test seams. */
  sources?: Partial<CandidateSources>
}

/**
 * Artist affinity from the existing profile — **only** when consent is granted.
 *
 * Consent is enforced here, at the boundary, rather than inside the planner:
 * the planner simply receives affinities or does not, so there is no flag it
 * could misread and no second profile anywhere (agents/32 → "If consent is
 * denied … must not use stored profile history").
 */
export function affinityForAutoplay(): Record<string, number> | undefined {
  const state = usePersonalizationStore.getState()
  if (state.state.consent !== 'granted') return undefined
  const weights = buildProfile(state.state).artistWeights
  return Object.keys(weights).length ? weights : undefined
}

/**
 * Tops the buffer up to target.
 *
 * Concurrent calls share one in-flight refill: a track ending while a refill is
 * already running must not double the request budget.
 */
export async function refillBuffer(context: RefillContext): Promise<void> {
  if (seedId !== context.seed.id) {
    // A different seed means a different question; nothing planned for the old
    // one is still the best answer.
    buffer = []
    seedId = context.seed.id
  }
  if (buffer.length >= BUFFER_TARGET) return
  if (refilling) return refilling

  refilling = (async () => {
    const sources: CandidateSources = {
      session: context.sources?.session ?? sessionTracks(),
      ...(context.signal ? { signal: context.signal } : {}),
      ...(context.sources?.fetchSimilar ? { fetchSimilar: context.sources.fetchSimilar } : {}),
    }

    const pool = await collectCandidates(context.seed, sources)
    const affinity = affinityForAutoplay()

    buffer = planAutoplay({
      seed: context.seed,
      candidates: pool.candidates,
      queuedIds: context.queuedIds,
      recentIds: context.recentIds,
      bufferedIds: buffer.map((item) => item.track.id),
      ...(affinity ? { artistAffinity: affinity } : {}),
      size: BUFFER_TARGET,
    })
  })().finally(() => {
    refilling = null
  })

  return refilling
}

/** Removes and returns the next planned track, if the buffer holds one. */
export function takeFromBuffer(): Track | null {
  const next = buffer.shift()
  return next?.track ?? null
}

/** Read-only view, for tests and diagnostics. */
export function bufferedCandidates(): readonly ScoredCandidate[] {
  return buffer
}

/** Drops the buffer — on stop, on a queue change, and between tests. */
export function clearAutoplayBuffer(): void {
  buffer = []
  seedId = null
  refilling = null
}
