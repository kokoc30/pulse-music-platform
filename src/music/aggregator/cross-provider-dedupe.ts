import { normalizeText } from '@/music/search/text'
import { diceCoefficient } from '@/music/search/similarity'
import { pickArtwork } from '@/music/normalize'
import type { ScoredTrack } from '@/music/search/relevance'
import type { Track } from '@/music/types'

/**
 * Conservative cross-provider duplicate collapsing.
 *
 * The same recording genuinely does appear on both catalogues, and showing it
 * twice looks broken. But collapsing is destructive and unrecoverable: a merged
 * result the visitor wanted is simply gone. So every rule here is deliberately
 * biased towards *leaving a duplicate visible* — false negatives are cheap,
 * false positives are not (agents/15_MULTI_PROVIDER_SEARCH.md →
 * "Cross-Provider Deduplication").
 */

/** Titles must be near-identical, not merely similar. */
export const MIN_TITLE_SIMILARITY = 0.92
/** Artists likewise: a cover by a different act is a different recording. */
export const MIN_ARTIST_SIMILARITY = 0.9
/** Two masters of one recording differ by a second or two, not more. */
export const MAX_DURATION_DRIFT_SECONDS = 3

/**
 * Words that make a track a *different* recording rather than the same one.
 * If the two titles do not carry exactly the same set, they are never merged —
 * this is what keeps a remix, a live take and an acoustic version apart from the
 * studio original even when every other signal says "same song".
 */
const VERSION_MARKERS = new Set([
  'remix',
  'rmx',
  'mix',
  'live',
  'acoustic',
  'unplugged',
  'instrumental',
  'karaoke',
  'cover',
  'edit',
  'radio',
  'extended',
  'club',
  'dub',
  'demo',
  'reprise',
  'rework',
  'bootleg',
  'mashup',
  'vip',
  'session',
  'sessions',
  'version',
  'remastered',
  'remaster',
  'slowed',
  'reverb',
  'sped',
  'orchestral',
  'piano',
])

/** Decorations that say nothing about which recording this is. */
const NOISE_TOKENS = new Set(['official', 'audio', 'video', 'hd', 'lyrics', 'lyric', 'mp3', 'full', 'the', 'a', 'an'])

/** The version markers present in a title, as a stable sorted key. */
export function versionMarkers(title: string): string[] {
  const { tokens } = normalizeText(title)
  const found = new Set<string>()
  for (const token of tokens) {
    if (VERSION_MARKERS.has(token)) found.add(token)
  }
  return [...found].sort()
}

/** Title with decoration removed, so "Kosandra (Official Audio)" compares as "kosandra". */
function comparableTitle(title: string): string {
  const { tokens } = normalizeText(title)
  return tokens.filter((token) => !NOISE_TOKENS.has(token)).join(' ')
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  return diceCoefficient(a, b)
}

/**
 * True only when every signal agrees: near-identical title, near-identical
 * artist, near-identical length, and no version-marker conflict.
 */
export function isSameRecording(a: Track, b: Track): boolean {
  if (a.provider === b.provider) return false

  const titleA = comparableTitle(a.title)
  const titleB = comparableTitle(b.title)
  if (!titleA || !titleB) return false
  if (similarity(titleA, titleB) < MIN_TITLE_SIMILARITY) return false

  const artistA = normalizeText(a.artistName).folded
  const artistB = normalizeText(b.artistName).folded
  if (!artistA || !artistB) return false
  if (similarity(artistA, artistB) < MIN_ARTIST_SIMILARITY) return false

  // A duration of 0 means "unknown", which is not evidence of a match.
  if (a.durationSeconds <= 0 || b.durationSeconds <= 0) return false
  if (Math.abs(a.durationSeconds - b.durationSeconds) > MAX_DURATION_DRIFT_SECONDS) return false

  const markersA = versionMarkers(a.title).join('|')
  const markersB = versionMarkers(b.title).join('|')
  return markersA === markersB
}

function artworkCompleteness(track: Track): number {
  return pickArtwork(track.artwork, 'medium') ? 1 : 0
}

/**
 * Which of two duplicates the visitor sees. Deterministic at every step, so the
 * same result set always renders the same way
 * (agents/15_MULTI_PROVIDER_SEARCH.md → "Duplicate Winner").
 */
export function pickWinner(a: ScoredTrack, b: ScoredTrack): ScoredTrack {
  if (a.relevance.score !== b.relevance.score) return a.relevance.score > b.relevance.score ? a : b
  if (a.track.isStreamable !== b.track.isStreamable) return a.track.isStreamable ? a : b
  const artworkA = artworkCompleteness(a.track)
  const artworkB = artworkCompleteness(b.track)
  if (artworkA !== artworkB) return artworkA > artworkB ? a : b
  if (a.track.durationSeconds !== b.track.durationSeconds) {
    return a.track.durationSeconds > b.track.durationSeconds ? a : b
  }
  // Last resort: a stable, provider-neutral lexicographic tie-break on the
  // namespaced id, so no provider wins by policy.
  return a.track.id <= b.track.id ? a : b
}

export interface DedupeResult {
  tracks: ScoredTrack[]
  /** How many rows were collapsed away. Diagnostics only. */
  merged: number
}

/**
 * Collapses cross-provider duplicates in a list that is already globally
 * ranked. Walking in rank order means the surviving row keeps the best
 * position it earned.
 */
export function dedupeAcrossProviders(ranked: readonly ScoredTrack[]): DedupeResult {
  const kept: ScoredTrack[] = []
  let merged = 0

  for (const candidate of ranked) {
    const duplicateAt = kept.findIndex((existing) => isSameRecording(existing.track, candidate.track))
    if (duplicateAt === -1) {
      kept.push(candidate)
      continue
    }
    const existing = kept[duplicateAt]
    if (!existing) continue
    merged += 1
    kept[duplicateAt] = pickWinner(existing, candidate)
  }

  return { tracks: kept, merged }
}
