import type { Track } from '@/music/types'

/**
 * Autoplay's own vocabulary.
 *
 * The planner returns `Track`s and nothing else — it never owns playback, never
 * touches an engine, and never writes to the player store. That separation is
 * what lets every rule below be tested as arithmetic
 * (agents/32 → "Candidate planner").
 */

/** Where a candidate came from. Reported for explainability, never for ranking. */
export type CandidateSource =
  /** Jamendo's own `/tracks/similar` endpoint. */
  | 'jamendo-similar'
  /** Tracks the session already loaded: shelves, search results, the queue. */
  | 'session'
  /**
   * One genre-scoped Audius request, spent only when everything free came back
   * empty. Deliberately named for what it is: same genre, not same sound.
   */
  | 'genre-fallback'

export interface Candidate {
  track: Track
  source: CandidateSource
  /**
   * Provider-supplied similarity rank, when the provider ordered the list.
   * `0` is the closest match. Absent for session candidates, which carry no
   * provider opinion at all.
   */
  providerRank?: number
}

/** One scored candidate, with the reasons that produced the score. */
export interface ScoredCandidate {
  track: Track
  source: CandidateSource
  score: number
  /** Which signals contributed. Drives the tests and the report, not the UI. */
  reasons: SimilarityReason[]
}

export type SimilarityReason =
  'provider' | 'genre' | 'tags' | 'mood' | 'bpm' | 'artist' | 'key' | 'profile'

/**
 * Everything the planner needs to choose, gathered by the caller.
 *
 * Passed in rather than read from stores, so the planner stays pure and the
 * tests can describe an exact situation instead of arranging global state.
 */
export interface PlanContext {
  /** The track that just finished, or is finishing. Never a candidate itself. */
  seed: Track
  candidates: readonly Candidate[]
  /** Ids already in the explicit queue. Never duplicated by autoplay. */
  queuedIds: readonly string[]
  /** Recently played ids, most recent first. Strongly avoided. */
  recentIds: readonly string[]
  /** Ids already chosen for the autoplay buffer this round. */
  bufferedIds?: readonly string[]
  /**
   * Local artist affinity, normalized 0–1, from the existing personalization
   * profile. **Only ever supplied when consent is granted** — the planner has
   * no way to reach the profile itself, so consent is enforced at the boundary
   * rather than by a flag the planner could ignore.
   */
  artistAffinity?: Readonly<Record<string, number>>
  /** How many items to plan. Defaults to the buffer target. */
  size?: number
}
