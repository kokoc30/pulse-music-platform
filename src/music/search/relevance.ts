import type { Artist, Track } from '@/music/types'
import { diceCoefficient, tokenMatchScore } from './similarity'
import { isLowSignal, normalizeText } from './text'
import type { NormalizedText } from './text'

/**
 * Local relevance scoring.
 *
 * Audius' own ranking is substring-driven, so a query like `sara al swas`
 * comes back with `djwashiwasha` and `Selawase` — real API results that share
 * letters and nothing else. Everything here exists to measure *textual*
 * relevance well enough to reject those, and popularity is deliberately capped
 * far below the text signal so a famous track can never outrank a real match.
 */

/** Below this, a candidate is noise and is dropped entirely. */
export const MIN_RELEVANCE = 0.34
/** At or above this, the top result is confident enough to skip query expansion. */
export const STRONG_RELEVANCE = 0.62
/** An artist match this good justifies pulling their catalogue directly. */
export const STRONG_ARTIST_RELEVANCE = 0.8
/** Whole-string bigram overlap below this is coincidental, not a match. */
export const MIN_WHOLE_STRING_OVERLAP = 0.55
/** Hard ceiling on the popularity tie-breaker's contribution. */
export const MAX_POPULARITY_BONUS = 0.05

/**
 * How much of what the visitor actually asked for must be present before a
 * candidate may be called a *strong* match.
 *
 * A score alone cannot express this. `aram asatryan` against the real Jamendo
 * row `Eternos Rivales - Fil d'aram` scores 0.375 — comfortably over
 * `MIN_RELEVANCE` — purely because the single generic token `aram` matched
 * perfectly. `asatryan`, the token that actually identifies the artist,
 * matched nothing at all. Half a name is not the name.
 *
 * 0.6 is chosen so a two-token query needs both tokens (1/2 = 0.5 fails) while
 * a three-token query may miss one (2/3 = 0.67 passes) — the shortest queries
 * are the ones where a missing token is most likely to mean a different entity.
 */
export const MIN_STRONG_COVERAGE = 0.6

/** A query token counts as present at or above this `tokenMatchScore`. */
export const TOKEN_EVIDENCE = 0.5

/**
 * A field score at or above this means the *whole query* was found intact —
 * equality, an opening phrase, or whitespace-insensitive containment.
 *
 * Coverage is then 1 by construction, and computing it token-by-token would be
 * wrong: `miyagiandypanda` typed without spaces is a perfect match for the
 * artist `Miyagi & Andy Panda`, yet its single 15-character token matches none
 * of that name's three short tokens individually.
 */
export const PHRASE_EVIDENCE = 0.86

export interface RelevanceBreakdown {
  score: number
  title: number
  artist: number
  popularity: number
  /**
   * Fraction of the query's *important* tokens for which this candidate carries
   * evidence, across title and artist together. `1` when the whole query was
   * found as a phrase. Low-signal words (`the`, `official`, `al`, …) are
   * excluded, so they can neither help nor hurt.
   */
  coverage: number
}

/**
 * Substring containment where both ends fall on a word boundary, so `kosandra`
 * matches inside `miyagi andy panda kosandra official audio` but `sara` does not
 * match inside `sarabande`.
 */
function containsAtWordBoundary(haystack: string, needle: string): boolean {
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return false
    const before = at === 0 ? '' : haystack[at - 1]
    const after = haystack[at + needle.length] ?? ''
    const openLeft = !before || !/\p{L}|\p{N}/u.test(before)
    const openRight = !after || !/\p{L}|\p{N}/u.test(after)
    if (openLeft && openRight) return true
    from = at + 1
  }
}

/** Textual similarity of a query to one field (title or artist name). */
function fieldScore(query: NormalizedText, field: NormalizedText): number {
  if (!field.folded || !query.folded) return 0

  // Whole-field equality, in either the spaced or the compacted form.
  if (field.folded === query.folded || field.compact === query.compact) return 1

  let best = 0

  // The query is the field's opening phrase — "Kosandra (Official Audio)".
  if (field.folded.startsWith(query.folded)) best = Math.max(best, 0.95)
  // The query appears intact somewhere inside — "Miyagi & Andy Panda - Kosandra".
  // Word boundaries are required: `sara` sits inside `sarabande` without being
  // it, and rewarding that is how unrelated results reach the top.
  else if (query.folded.length >= 3 && containsAtWordBoundary(field.folded, query.folded)) {
    best = Math.max(best, 0.9)
  }
  // Whitespace-insensitive containment catches "al swas" inside "alswas". The
  // longer minimum compensates for the lost word boundaries.
  else if (query.compact.length >= 6 && field.compact.includes(query.compact)) {
    best = Math.max(best, 0.86)
  }

  // Per-token coverage: how much of what the visitor asked for is present.
  // Coverage of *query* tokens, not field tokens, so a long title full of extra
  // words ("… (Official Audio)") is not penalised for being long.
  const significant = query.tokens.filter((token) => !isLowSignal(token))
  const scored = significant.length > 0 ? significant : query.tokens
  if (scored.length > 0) {
    let total = 0
    let matched = 0
    for (const token of scored) {
      const tokenScore = tokenMatchScore(token, field.tokens)
      total += tokenScore
      if (tokenScore >= 0.5) matched += 1
    }
    // A plain mean treats "half the name matched" as half-good. For names it is
    // not: missing a distinctive token usually means the wrong entity. `sawas`
    // alone matches `LAWAS` at 0.68, which a mean would push over the threshold
    // even though `sara` matched nothing at all.
    const breadth = 0.5 + 0.5 * (matched / scored.length)
    best = Math.max(best, (total / scored.length) * breadth)
  }

  // Whole-string similarity as a floor, for single-word queries and typos.
  //
  // Two guards keep this from manufacturing relevance out of nothing:
  //   · only bigram overlap is used, never edit distance. Edit distance
  //     normalizes by the longer string, so a short query aligns "cheaply"
  //     inside a long unrelated title — `sara al swas` scored 0.42 against
  //     `PARAS - LOWAS GV RMX` on that alone.
  //   · lengths must be comparable, or a long title accumulates coincidental
  //     bigram hits simply by being long.
  const queryLength = query.folded.length
  const fieldLength = field.folded.length
  const lengthRatio = Math.min(queryLength, fieldLength) / Math.max(queryLength, fieldLength, 1)
  if (lengthRatio >= 0.6) {
    const overlap = diceCoefficient(query.folded, field.folded)
    // Two same-length strings of ordinary letters share a surprising number of
    // bigrams: `sara al swas` overlaps `sagar biswas` at 0.43 and
    // `jesuswasarapper` at 0.48 while meaning nothing. Only a decisive overlap
    // is allowed to set the floor.
    if (overlap >= MIN_WHOLE_STRING_OVERLAP) best = Math.max(best, overlap * 0.85)
  }

  return Math.min(best, 1)
}

/**
 * The tokens a query is actually *about*.
 *
 * Low-signal words are dropped so `the` and `official` cannot dilute coverage,
 * and a query made entirely of them falls back to its raw tokens rather than
 * becoming uncoverable.
 */
export function importantTokens(query: NormalizedText): string[] {
  const significant = query.tokens.filter((token) => !isLowSignal(token))
  return significant.length > 0 ? significant : query.tokens
}

/**
 * Fraction of the query's important tokens present in `fieldTokens`.
 *
 * Evidence is counted across title *and* artist together, because people type
 * `barov ari aram asatryan` as one phrase and neither field alone contains all
 * of it (agents' Step 5). Presence, not degree: a token either has evidence or
 * it does not, so one very strong partial match cannot stand in for a missing
 * one — which is precisely the failure this exists to stop.
 */
export function tokenCoverage(query: NormalizedText, fieldTokens: readonly string[]): number {
  const tokens = importantTokens(query)
  if (tokens.length === 0) return 1
  let matched = 0
  for (const token of tokens) {
    if (tokenMatchScore(token, fieldTokens) >= TOKEN_EVIDENCE) matched += 1
  }
  return matched / tokens.length
}

/**
 * Whether a candidate is good enough to present as a real answer.
 *
 * Two independent conditions, and both must hold:
 *
 * · **relevance** — the existing textual score, unchanged;
 * · **coverage** — evidence for substantially all of what was asked for.
 *
 * Keeping them separate is the point. Raising `MIN_RELEVANCE` instead would
 * have thrown away genuine single-token and fuzzy matches (`kassandra` →
 * `Kosandra` scores 0.70) while *still* admitting `Some Song` by `Asatryan` at
 * 0.626. Only coverage distinguishes those two.
 */
export function isStrongMatch(relevance: RelevanceBreakdown): boolean {
  return relevance.score >= MIN_RELEVANCE && relevance.coverage >= MIN_STRONG_COVERAGE
}

/** `0..MAX_POPULARITY_BONUS`, log-scaled so nothing dominates on plays alone. */
export function popularityBonus(playCount: number | undefined): number {
  if (typeof playCount !== 'number' || !Number.isFinite(playCount) || playCount <= 0) return 0
  const scaled = Math.log10(playCount + 1) / 7
  return Math.min(scaled, 1) * MAX_POPULARITY_BONUS
}

/**
 * Combines the title and artist signals.
 *
 * The stronger field carries the score on its own — an exact title match is an
 * excellent result even when the uploader's name means nothing, and an exact
 * artist match is excellent even when the track title is unrelated. The weaker
 * field can only add, and matching both earns a small bonus: that is what
 * separates "the artist's own track" from "a remix that name-drops them".
 */
function combineText(title: number, artist: number): number {
  const strong = Math.max(title, artist)
  const weak = Math.min(title, artist)
  const both = strong >= 0.5 && weak >= 0.5 ? 0.05 : 0
  // Capped just below 1 so the popularity tie-breaker always has headroom to
  // separate two textually identical matches, while never being able to close
  // a real textual gap.
  return Math.min(strong + (1 - strong) * weak * 0.5 + both, 1 - MAX_POPULARITY_BONUS)
}

export interface ScoredTrack {
  track: Track
  relevance: RelevanceBreakdown
  /** Which query variant produced the best score, for debugging and tests. */
  matchedQuery: string
}

export function scoreTrack(query: NormalizedText, track: Track): RelevanceBreakdown {
  const title = fieldScore(query, normalizeText(track.title))
  const artistName = fieldScore(query, normalizeText(track.artistName))
  const handle = track.artistHandle ? fieldScore(query, normalizeText(track.artistHandle)) : 0
  const artist = Math.max(artistName, handle * 0.9)

  // People type "artist song" as one phrase, and neither field alone then
  // contains every token. Scoring the concatenation recovers that case without
  // weakening either individual field's judgement.
  const evidence = normalizeText(
    `${track.title} ${track.artistName} ${track.artistHandle ?? ''}`,
  )
  const combined = fieldScore(query, normalizeText(`${track.title} ${track.artistName}`))
  const text = Math.min(
    Math.max(combineText(title, artist), combined),
    1 - MAX_POPULARITY_BONUS,
  )
  const popularity = popularityBonus(track.playCount)

  // Coverage is measured over title and artist together, for the same reason
  // `combined` exists. Finding the whole query as a phrase in either field is
  // full evidence on its own and short-circuits the token walk.
  const phrase = Math.max(title, artist, combined)
  const coverage =
    phrase >= PHRASE_EVIDENCE ? 1 : tokenCoverage(query, evidence.tokens)

  return {
    title,
    artist,
    popularity,
    coverage,
    score: Math.min(text + popularity, 1),
  }
}

export function scoreArtist(query: NormalizedText, artist: Artist): number {
  const name = fieldScore(query, normalizeText(artist.name))
  const handle = artist.handle ? fieldScore(query, normalizeText(artist.handle)) : 0
  return Math.max(name, handle * 0.92)
}

/** Best score for a track across every query variant that was searched. */
export function bestScoreAcross(
  queries: readonly NormalizedText[],
  track: Track,
): { relevance: RelevanceBreakdown; matchedQuery: string } {
  // The winning variant carries its own coverage. That is what keeps aliases
  // working: `кассандра` covers nothing in a Latin-titled `Kosandra`, but the
  // curated `kosandra` variant covers it completely, and the best variant wins.
  let best: RelevanceBreakdown = { score: 0, title: 0, artist: 0, popularity: 0, coverage: 0 }
  let matchedQuery = ''
  for (const query of queries) {
    const relevance = scoreTrack(query, track)
    if (relevance.score > best.score) {
      best = relevance
      matchedQuery = query.provider
    }
  }
  return { relevance: best, matchedQuery }
}
