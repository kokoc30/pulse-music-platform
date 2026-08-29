/**
 * Deterministic "similar next track" autoplay.
 *
 * The planner returns `Track` candidates and owns no playback: the existing
 * player actions still start every track, the existing queue still wins over
 * anything generated, and the existing history pipeline still records it
 * (agents/32, agents/34).
 */

export type {
  Candidate,
  CandidateSource,
  PlanContext,
  ScoredCandidate,
  SimilarityReason,
} from './types'

export {
  BPM_TOLERANCE,
  PROFILE_WEIGHT,
  PROVIDER_RANK_SPAN,
  WEIGHTS,
  bpmCloseness,
  keyMatch,
  providerCloseness,
  scoreCandidate,
  scoreCandidates,
  tagOverlap,
} from './similarity'

export {
  ARTIST_CAP_FAR,
  ARTIST_CAP_NEAR,
  ARTIST_WINDOW_FAR,
  ARTIST_WINDOW_NEAR,
  BUFFER_TARGET,
  EXPLORATION_RATIO,
  RECENT_WINDOW,
  artistAllowed,
  planAutoplay,
  planNextTrack,
} from './planner'

export {
  GENRE_FALLBACK_LIMIT,
  MAX_REQUESTS_PER_REFILL,
  MAX_SESSION_CANDIDATES,
  collectCandidates,
  collectFallbackCandidates,
} from './candidates'
export type { CandidatePool, CandidateSources } from './candidates'

export { SESSION_POOL_LIMIT, clearSessionPool, rememberTracks, sessionTracks } from './session-pool'

export {
  affinityForAutoplay,
  bufferedCandidates,
  clearAutoplayBuffer,
  refillBuffer,
  takeFromBuffer,
} from './buffer'
export type { RefillContext } from './buffer'
