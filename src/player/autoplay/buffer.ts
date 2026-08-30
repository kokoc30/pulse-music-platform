import { buildProfile } from '@/personalization/profile'
import { usePersonalizationStore } from '@/personalization/store'
import type { Track } from '@/music/types'
import { MIN_QUEUE_DEPTH } from '../related-fetcher'
import {
  collectCandidates,
  collectFallbackCandidates,
  collectRelatedCandidates,
} from './candidates'
import type { CandidateSources } from './candidates'
import { BUFFER_TARGET, planAutoplay } from './planner'
import { sessionTracks } from './session-pool'
import type { Candidate, ScoredCandidate } from './types'

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
      ...(context.sources?.fetchByGenre ? { fetchByGenre: context.sources.fetchByGenre } : {}),
      ...(context.sources?.fetchRelatedTracks
        ? { fetchRelatedTracks: context.sources.fetchRelatedTracks }
        : {}),
    }

    const pool = await collectCandidates(context.seed, sources)
    const affinity = affinityForAutoplay()

    const plan = (candidates: readonly Candidate[]) =>
      planAutoplay({
        seed: context.seed,
        candidates,
        queuedIds: context.queuedIds,
        recentIds: context.recentIds,
        bufferedIds: buffer.map((item) => item.track.id),
        ...(affinity ? { artistAffinity: affinity } : {}),
        size: BUFFER_TARGET,
      })

    buffer = plan(pool.candidates)

    /**
     * Not enough ahead of the listener — so ask the catalogue what this *is*.
     *
     * The threshold is supply, not quality: fewer than `MIN_QUEUE_DEPTH`
     * playable items means the next few minutes are not covered, and covering
     * them is the whole rule. Waiting for the buffer to reach zero would move
     * the lookup into the silence after the last track instead of over the music
     * still playing, which is exactly the gap the reports described.
     *
     * The query is built from the seed's tags, genre and detected language, so a
     * Cyrillic-titled pop track asks for `russian pop` and gets Russian pop back.
     * Both providers may spend it, and it is spent at most once per refill.
     */
    // Everything gathered so far, so a later pass adds to the pool rather than
    // replacing it: a candidate the free pass found must not be lost because a
    // paid one was also spent.
    const collected: Candidate[] = [...pool.candidates]

    if (buffer.length < MIN_QUEUE_DEPTH) {
      const related = await collectRelatedCandidates(context.seed, sources)
      if (related.candidates.length) {
        collected.push(...related.candidates)
        buffer = plan(collected)
      }
    }

    /**
     * Nothing survived either pass — so, once, ask for the genre.
     *
     * This is the *Kosandra* case made concrete. A search for one song returns a
     * page that is thirteen re-uploads of that song and nothing else; the
     * same-song rule correctly removes every one of them, and what is left in
     * memory is empty. Without this the track simply ends in silence, which is
     * what the visitor reported.
     *
     * Guarded on an empty plan rather than an empty pool, because a pool full of
     * candidates that all fail the rules is exactly as useless as no pool.
     *
     * `collectFallbackCandidates` decides whether there is anything to spend:
     * it answers only for an **Audius** seed carrying a genre, because a Jamendo
     * seed has already had the provider's own similarity answer and must not be
     * given a weaker one on top. So this call costs nothing at all for Jamendo,
     * and at most the seed's single allowance for Audius. Never retried.
     */
    if (buffer.length === 0) {
      const fallback = await collectFallbackCandidates(context.seed, sources)
      if (fallback.candidates.length) {
        collected.push(...fallback.candidates)
        buffer = plan(collected)
      }
    }
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
