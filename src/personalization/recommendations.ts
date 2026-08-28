import { isLowSignal, detectScript, normalizeText } from '@/music/search/text'
import type { Track } from '@/music/types'
import {
  EXPLORATION_RATIO,
  MAX_TRACKS_PER_ARTIST,
  MS_PER_HOUR,
  OVERPLAYED_COUNT,
  RECENTLY_PLAYED_COOLDOWN_HOURS,
} from './config'
import { artistKey } from './profile'
import type { PersonalizationProfile } from './profile'
import type { ListenEntry } from './types'

/**
 * Client-side re-ranking of the candidate pool the dashboard already loaded.
 *
 * **No new infrastructure.** There is no model, no embedding, no LLM and no
 * recommendation service. The home page already fetches trending, this month and
 * four genre stations; this module reorders that pool against the local profile
 * and hands back a shelf. In the common case Phase 4 adds *zero* provider
 * requests to a home render (STEP 11).
 *
 * **Nothing YouTube touches this.** The pool is Audius/Jamendo `Track`s and the
 * profile is built from catalogue rows and first-party queries only, so no
 * YouTube API metadata participates in the score — which is precisely the
 * cross-platform derived metric §III.E.4.h prohibits.
 */

export interface ScoredTrack {
  track: Track
  score: number
  /** Which signals contributed, strongest first. Drives explainable copy. */
  reasons: RecommendationReason[]
}

export type RecommendationReason = 'artist' | 'genre' | 'query' | 'script' | 'discovery'

/** Weights of the four alignment signals. They sum to 1 by construction. */
export const SIGNAL_WEIGHTS = {
  artist: 0.45,
  genre: 0.25,
  query: 0.2,
  script: 0.1,
} as const

export interface RankOptions {
  /** History rows, used to hold back what was just played. */
  history?: ListenEntry[]
  /** Ids the visitor dismissed. */
  dismissed?: readonly string[]
  size: number
  now?: number
  /** Ids already used by another shelf on the same page. */
  exclude?: readonly string[]
}

/**
 * Alignment of one candidate with the profile, in 0–1.
 *
 * Each term is the candidate's share of an already-normalized weight map, so a
 * score is comparable across profiles of very different sizes.
 */
export function alignmentScore(
  track: Track,
  profile: PersonalizationProfile,
): { score: number; reasons: RecommendationReason[] } {
  const reasons: RecommendationReason[] = []

  const artist = profile.artistWeights[artistKey(track.artistName)] ?? 0
  if (artist > 0) reasons.push('artist')

  const genre = track.genre ? (profile.genreWeights[track.genre.toLowerCase()] ?? 0) : 0
  if (genre > 0) reasons.push('genre')

  const { tokens } = normalizeText(`${track.title} ${track.artistName}`)
  let query = 0
  for (const token of tokens) {
    if (isLowSignal(token)) continue
    query += profile.tokenWeights[token] ?? 0
  }
  if (query > 0) reasons.push('query')

  const script = profile.scriptWeights[detectScript(`${track.title} ${track.artistName}`)] ?? 0
  if (script > 0) reasons.push('script')

  const score =
    SIGNAL_WEIGHTS.artist * Math.min(artist * 3, 1) +
    SIGNAL_WEIGHTS.genre * Math.min(genre * 3, 1) +
    SIGNAL_WEIGHTS.query * Math.min(query * 3, 1) +
    SIGNAL_WEIGHTS.script * Math.min(script, 1)

  return { score, reasons }
}

/**
 * Items to keep out of a recommendation shelf.
 *
 * Two reasons, both about usefulness rather than preference: something played in
 * the last day is still fresh in the listener's mind, and something already
 * played several times is not a recommendation. Neither removes it from
 * Recently Played, which is exactly where it belongs.
 */
export function heldBackIds(
  history: readonly ListenEntry[],
  now = Date.now(),
): Set<string> {
  const cooldown = now - RECENTLY_PLAYED_COOLDOWN_HOURS * MS_PER_HOUR
  const held = new Set<string>()
  for (const entry of history) {
    if (entry.lastPlayedAt >= cooldown || entry.playCount >= OVERPLAYED_COUNT) held.add(entry.id)
  }
  return held
}

/**
 * Builds one recommendation shelf.
 *
 * Three constraints are applied in order, and the order matters:
 *
 * 1. **Eligibility** — dismissed, held back, already used on this page, or not
 *    streamable, and it is gone.
 * 2. **Diversity** — roughly three-quarters of the slots go to the best-aligned
 *    candidates and the remainder to deliberate exploration: the best-scoring
 *    candidates whose artist is *absent* from the profile. A profile that is 70%
 *    Arabic-script therefore produces a shelf that is mostly, but never wholly,
 *    Arabic-script (STEP 12).
 * 3. **Artist cap** — at most two rows per artist, applied across both groups,
 *    so a single prolific artist cannot fill a shelf.
 *
 * Exploration picks deterministically (highest score first, then pool order), so
 * the same history and pool always produce the same shelf — no randomness to
 * make the tests flaky or the UI jump between renders.
 */
export function buildRecommendations(
  candidates: readonly Track[],
  profile: PersonalizationProfile,
  options: RankOptions,
): ScoredTrack[] {
  const now = options.now ?? Date.now()
  const held = heldBackIds(options.history ?? [], now)
  const dismissed = new Set(options.dismissed ?? [])
  const excluded = new Set(options.exclude ?? [])

  const seenIds = new Set<string>()
  const eligible: ScoredTrack[] = []
  for (const track of candidates) {
    if (!track.isStreamable) continue
    if (seenIds.has(track.id) || held.has(track.id) || dismissed.has(track.id)) continue
    if (excluded.has(track.id)) continue
    seenIds.add(track.id)
    const { score, reasons } = alignmentScore(track, profile)
    eligible.push({ track, score, reasons })
  }

  const aligned = eligible
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.track.id.localeCompare(b.track.id))

  const knownArtists = new Set(Object.keys(profile.artistWeights))
  const exploration = eligible
    .filter((item) => !knownArtists.has(artistKey(item.track.artistName)))
    .sort((a, b) => b.score - a.score || a.track.id.localeCompare(b.track.id))

  const explorationSlots = Math.min(
    Math.round(options.size * EXPLORATION_RATIO),
    Math.max(options.size - 1, 0),
  )
  const alignedSlots = options.size - explorationSlots

  const picked: ScoredTrack[] = []
  const artistCounts = new Map<string, number>()

  const pickedIds = new Set<string>()
  const take = (pool: readonly ScoredTrack[], slots: number, reason?: RecommendationReason) => {
    let remaining = slots
    for (const item of pool) {
      if (remaining <= 0 || picked.length >= options.size) return
      if (pickedIds.has(item.track.id)) continue
      const key = artistKey(item.track.artistName)
      if ((artistCounts.get(key) ?? 0) >= MAX_TRACKS_PER_ARTIST) continue
      artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1)
      pickedIds.add(item.track.id)
      picked.push(reason ? { ...item, reasons: [reason] } : item)
      remaining -= 1
    }
  }

  take(aligned, alignedSlots)
  take(exploration, explorationSlots, 'discovery')
  // Whatever is left over fills the shelf rather than leaving a gap: a
  // half-empty personalized shelf reads as broken (STEP 14).
  take(eligible, options.size - picked.length)

  return picked.slice(0, options.size)
}

/**
 * Tracks by an artist the listener already likes, for *More from artists you
 * like* and *Because you listened to …*.
 *
 * Sourced from the pool the page already has. Bounded per-artist provider
 * lookups happen one level up, in the hook, and only when the pool cannot answer.
 */
export function tracksByArtists(
  candidates: readonly Track[],
  artistKeys: readonly string[],
  options: RankOptions,
): Track[] {
  const wanted = new Set(artistKeys)
  const held = heldBackIds(options.history ?? [], options.now ?? Date.now())
  const excluded = new Set(options.exclude ?? [])
  const dismissed = new Set(options.dismissed ?? [])

  const picked: Track[] = []
  const artistCounts = new Map<string, number>()
  const seen = new Set<string>()

  for (const track of candidates) {
    if (picked.length >= options.size) break
    if (!track.isStreamable || seen.has(track.id)) continue
    if (held.has(track.id) || excluded.has(track.id) || dismissed.has(track.id)) continue
    const key = artistKey(track.artistName)
    if (!wanted.has(key)) continue
    if ((artistCounts.get(key) ?? 0) >= MAX_TRACKS_PER_ARTIST) continue
    seen.add(track.id)
    artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1)
    picked.push(track)
  }

  return picked
}
