import { artistKey } from '@/personalization/profile'
import type { Track } from '@/music/types'
import type { Candidate, ScoredCandidate, SimilarityReason } from './types'

/**
 * How alike two tracks are, as arithmetic.
 *
 * Explainable on purpose: no model, no embeddings, no opaque randomness, and no
 * network. Every point in a score can be traced to a named field the provider
 * actually published (agents/32 → "Similarity").
 *
 * **Missing metadata is neutral, never negative.** Audius fills `genre`, `mood`,
 * `tags`, `bpm` and `musicalKey` unevenly, and Jamendo only supplies tags and
 * tempo on the similar action. A track that simply has less metadata must not
 * sink below one that has more; it just has fewer ways to earn points. That is
 * why each signal contributes only when *both* sides have the field, and why
 * the weights below are shares of an achievable total rather than a fixed
 * denominator.
 */

/**
 * Signal weights.
 *
 * `provider` leads because Jamendo's `/tracks/similar` is a real editorial
 * judgement about the catalogue, which nothing computed locally can match.
 * `artist` is deliberately modest: the same artist is a genuine signal, but
 * diversity caps exist precisely so it cannot dominate a run.
 */
export const WEIGHTS = {
  provider: 0.34,
  genre: 0.22,
  tags: 0.16,
  mood: 0.1,
  bpm: 0.1,
  artist: 0.06,
  key: 0.02,
} as const

/** How much local affinity may add on top, when consent allows it at all. */
export const PROFILE_WEIGHT = 0.08

/** Tempo within this many BPM counts as a full match; beyond it, nothing. */
export const BPM_TOLERANCE = 12

/** Provider rank decays over this many positions before it stops counting. */
export const PROVIDER_RANK_SPAN = 12

function norm(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

/** Jaccard overlap of two tag sets: shared tags over the union. */
export function tagOverlap(a: readonly string[] | undefined, b: readonly string[] | undefined): number {
  if (!a?.length || !b?.length) return 0
  const left = new Set(a.map((tag) => tag.toLowerCase()))
  const right = new Set(b.map((tag) => tag.toLowerCase()))
  let shared = 0
  for (const tag of left) if (right.has(tag)) shared += 1
  if (shared === 0) return 0
  return shared / (left.size + right.size - shared)
}

/** 1 at identical tempo, falling linearly to 0 at `BPM_TOLERANCE`. */
export function bpmCloseness(a: number | undefined, b: number | undefined): number {
  if (typeof a !== 'number' || typeof b !== 'number') return 0
  const drift = Math.abs(a - b)
  if (drift >= BPM_TOLERANCE) return 0
  return 1 - drift / BPM_TOLERANCE
}

/**
 * Musical keys match or they do not.
 *
 * No circle-of-fifths distance: providers write keys inconsistently enough
 * (`"C"`, `"C major"`, `"Cmaj"`) that anything cleverer would be guessing, and
 * this signal is weighted low precisely because it is coarse.
 */
export function keyMatch(a: string | undefined, b: string | undefined): number {
  const left = norm(a)
  const right = norm(b)
  if (!left || !right) return 0
  return left === right ? 1 : 0
}

/** Earlier in the provider's own ordering is more similar. */
export function providerCloseness(rank: number | undefined): number {
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank < 0) return 0
  if (rank >= PROVIDER_RANK_SPAN) return 0
  return 1 - rank / PROVIDER_RANK_SPAN
}

export interface ScoreOptions {
  /** Normalized artist affinity, supplied only when consent is granted. */
  artistAffinity?: Readonly<Record<string, number>>
}

/**
 * Similarity of one candidate to the seed, in 0–1.
 *
 * The denominator is the weight of the signals that were actually *available*
 * on both sides. Two tracks that share only a genre are compared on genre, and
 * score well if it matches — rather than being dragged towards zero by four
 * fields neither provider published.
 */
export function scoreCandidate(
  seed: Track,
  candidate: Candidate,
  options: ScoreOptions = {},
): ScoredCandidate {
  const track = candidate.track
  const reasons: SimilarityReason[] = []

  let earned = 0
  let available = 0

  const award = (weight: number, value: number, reason: SimilarityReason, applicable: boolean) => {
    if (!applicable) return
    available += weight
    if (value <= 0) return
    earned += weight * value
    reasons.push(reason)
  }

  // Provider similarity applies only to a candidate the provider itself ranked.
  award(
    WEIGHTS.provider,
    providerCloseness(candidate.providerRank),
    'provider',
    candidate.source === 'jamendo-similar',
  )

  const seedGenre = norm(seed.genre)
  const trackGenre = norm(track.genre)
  award(WEIGHTS.genre, seedGenre === trackGenre ? 1 : 0, 'genre', Boolean(seedGenre && trackGenre))

  award(
    WEIGHTS.tags,
    tagOverlap(seed.tags, track.tags),
    'tags',
    Boolean(seed.tags?.length && track.tags?.length),
  )

  const seedMood = norm(seed.mood)
  const trackMood = norm(track.mood)
  award(WEIGHTS.mood, seedMood === trackMood ? 1 : 0, 'mood', Boolean(seedMood && trackMood))

  award(
    WEIGHTS.bpm,
    bpmCloseness(seed.bpm, track.bpm),
    'bpm',
    typeof seed.bpm === 'number' && typeof track.bpm === 'number',
  )

  // Artist is always comparable — both tracks always have one.
  award(
    WEIGHTS.artist,
    artistKey(seed.artistName) === artistKey(track.artistName) ? 1 : 0,
    'artist',
    true,
  )

  award(
    WEIGHTS.key,
    keyMatch(seed.musicalKey, track.musicalKey),
    'key',
    Boolean(seed.musicalKey && track.musicalKey),
  )

  // Nothing was comparable at all: neutral, not zero-because-bad.
  const base = available > 0 ? earned / available : 0

  /**
   * Local affinity, when consent granted it.
   *
   * Added on top rather than mixed into the denominator: it is a statement
   * about the listener, not about how alike two tracks are, and it must never
   * be able to make an unrelated track out-rank a genuinely similar one.
   */
  let score = base
  const affinity = options.artistAffinity?.[artistKey(track.artistName)]
  if (typeof affinity === 'number' && affinity > 0) {
    score += PROFILE_WEIGHT * Math.min(affinity * 3, 1)
    reasons.push('profile')
  }

  return { track, source: candidate.source, score: Math.min(score, 1), reasons }
}

/**
 * Scores a whole pool, most similar first.
 *
 * Ties break on track id so the same inputs always produce the same order —
 * autoplay must not shuffle between renders or between test runs.
 */
export function scoreCandidates(
  seed: Track,
  candidates: readonly Candidate[],
  options: ScoreOptions = {},
): ScoredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(seed, candidate, options))
    .sort((a, b) => b.score - a.score || a.track.id.localeCompare(b.track.id))
}
