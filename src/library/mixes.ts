import type { Track } from '@/music/types'
import { MAX_TRACKS_PER_ARTIST } from '@/personalization/config'
import { artistKey } from '@/personalization/profile'
import type { PersonalizationProfile } from '@/personalization/profile'
import { alignmentScore, heldBackIds } from '@/personalization/recommendations'
import type { ListenEntry } from '@/personalization/types'
import { scoreCandidate } from '@/player/autoplay/similarity'
import type { LibraryTrackRef } from './types'

/**
 * Made-for-you mixes.
 *
 * **Composed, not invented.** Every ranking decision here is made by machinery
 * that already exists and is already tested: `alignmentScore` from the Phase 4
 * recommender decides how well a candidate matches the profile, and
 * `scoreCandidate` from the Phase 6 autoplay planner decides how close it is to
 * a specific track the visitor saved. This module chooses *which* question to
 * ask for each mix and applies the diversity rules; it introduces no new scoring
 * (agents/43 → "Do not create a parallel recommendation algorithm").
 *
 * **The pool is free.** Candidates are the tracks the session already loaded —
 * discovery shelves, search results, anything that entered a queue. Building
 * mixes costs zero provider requests, and none of them could go to YouTube even
 * in principle: the pool is `Track[]`, and a YouTube video is not a `Track`.
 *
 * **No YouTube anywhere in the inputs.** Seeds come from
 * `catalogLibraryRefs`, which filters YouTube out at the source, and the profile
 * already excludes it. So no YouTube API metadata reaches a mix, a similarity
 * score or a cluster label (agents/44 → "YouTube recommendation exclusion").
 *
 * **Cold start is honest.** With too little evidence this returns an empty
 * array, and the home page keeps its discovery shelves rather than labelling
 * trending music as "made for you" (agents/43 → "Cold start").
 */

export type MixId = 'your-mix' | 'from-your-likes' | 'discovery-mix'

export interface Mix {
  id: MixId
  title: string
  /** One honest line about where the mix came from. Never an identity claim. */
  description: string
  tracks: Track[]
}

/** Tracks a mix aims for. */
export const MIX_TARGET = 20
/**
 * Below this a mix is not offered at all.
 *
 * A five-track "mix" is a shelf with a grander name, and offering one would make
 * the feature feel thinner the less the app knows — exactly backwards.
 */
export const MIX_MINIMUM = 15
/** Distinct saved catalogue items before any mix is offered. */
export const MIN_EXPLICIT_FOR_MIX = 3
/** Share of a mix given to deliberate exploration. */
export const MIX_EXPLORATION_RATIO = 0.2

export interface MixInput {
  profile: PersonalizationProfile
  /** Catalogue references the visitor liked or playlisted. Never YouTube. */
  saved: readonly LibraryTrackRef[]
  /** Tracks the session already has. No request is made to build this. */
  candidates: readonly Track[]
  history?: readonly ListenEntry[]
  /** Keys marked *Not interested*. */
  hidden?: readonly string[]
  /** Ids already in the explicit queue, so a mix does not echo it back. */
  queuedIds?: readonly string[]
  now?: number
}

interface Scored {
  track: Track
  score: number
}

/**
 * Whether there is enough evidence to offer anything at all.
 *
 * Two independent routes in, because the two kinds of evidence are genuinely
 * different: a visitor who has listened enough to reach a warm profile has shown
 * their taste by behaviour, and a visitor who has deliberately saved a few
 * tracks has stated it outright. Either is a defensible basis; neither is
 * required to arrive through the other.
 */
export function hasMixEvidence(profile: PersonalizationProfile): boolean {
  if (profile.explicitItemCount >= MIN_EXPLICIT_FOR_MIX) return true
  return profile.stage === 'warm' || profile.stage === 'mature'
}

/** Candidates that may appear in any mix at all. */
function eligible(input: MixInput): Track[] {
  const now = input.now ?? Date.now()
  const held = heldBackIds(input.history ?? [], now)
  const hidden = new Set(input.hidden ?? [])
  const queued = new Set(input.queuedIds ?? [])
  // Something already saved is not a recommendation; it is already in the
  // library, one click away.
  const saved = new Set(input.saved.map((ref) => ref.key))

  const seen = new Set<string>()
  const pool: Track[] = []
  for (const track of input.candidates) {
    if (!track.isStreamable) continue
    if (seen.has(track.id)) continue
    // `heldBackIds` suppresses both what was played in the last day and what has
    // been played often enough to stop being a suggestion.
    if (held.has(track.id) || hidden.has(track.id) || queued.has(track.id)) continue
    if (saved.has(track.id)) continue
    seen.add(track.id)
    pool.push(track)
  }
  return pool
}

/**
 * Takes the best candidates, capped per artist, skipping anything already used.
 *
 * The artist cap is the same `MAX_TRACKS_PER_ARTIST` the home shelves use, so a
 * prolific artist cannot own a mix; `used` is shared across all three mixes, so
 * the same track never appears in two of them.
 */
function take(pool: readonly Scored[], size: number, used: Set<string>): Track[] {
  const picked: Track[] = []
  const perArtist = new Map<string, number>()

  for (const item of [...pool].sort(
    (a, b) => b.score - a.score || a.track.id.localeCompare(b.track.id),
  )) {
    if (picked.length >= size) break
    if (used.has(item.track.id)) continue
    const key = artistKey(item.track.artistName)
    if ((perArtist.get(key) ?? 0) >= MAX_TRACKS_PER_ARTIST) continue
    perArtist.set(key, (perArtist.get(key) ?? 0) + 1)
    used.add(item.track.id)
    picked.push(item.track)
  }

  return picked
}

/**
 * How close a candidate is to the things the visitor actually saved.
 *
 * Reuses the Phase 6 similarity scorer against each saved seed and keeps the
 * best match, which is a genuinely different question from "does this fit the
 * profile": it asks whether this specific track resembles a specific track the
 * visitor chose to keep. Seeds are bounded so a large library cannot turn one
 * render into a quadratic scan.
 */
const MAX_SEEDS = 12

function similarityToSaved(track: Track, seeds: readonly Track[]): number {
  let best = 0
  for (const seed of seeds) {
    if (seed.id === track.id) continue
    const scored = scoreCandidate(seed, { track, source: 'session' })
    if (scored.score > best) best = scored.score
  }
  return best
}

/**
 * Saved references resolved against the candidate pool.
 *
 * The similarity scorer needs real `Track`s — genre, tags, bpm, key — and a
 * saved reference deliberately keeps only display metadata. Rather than spend a
 * provider request per seed to fill that gap, seeds are the saved items that
 * happen to be in the pool already. A visitor whose saves are all absent from
 * the pool simply gets the profile-driven mixes, which is a graceful degradation
 * rather than a failure.
 */
function seedTracks(input: MixInput): Track[] {
  const saved = new Set(input.saved.map((ref) => ref.key))
  const seeds: Track[] = []
  for (const track of input.candidates) {
    if (seeds.length >= MAX_SEEDS) break
    if (saved.has(track.id)) seeds.push(track)
  }
  return seeds
}

/**
 * Builds up to three mixes, best-supported first.
 *
 * Generation stops as soon as one cannot reach `MIX_MINIMUM`, so the result is
 * naturally one to three: a modest library gets one good mix rather than three
 * thin ones. Deterministic throughout — the same profile, library and pool
 * always produce the same mixes in the same order, which is what makes them
 * testable and stops them reshuffling between renders.
 */
export function buildMixes(input: MixInput): Mix[] {
  if (!hasMixEvidence(input.profile)) return []

  const pool = eligible(input)
  if (pool.length < MIX_MINIMUM) return []

  const { profile } = input
  const used = new Set<string>()
  const mixes: Mix[] = []

  const aligned: Scored[] = pool.map((track) => ({
    track,
    score: alignmentScore(track, profile).score,
  }))

  // 1. Your Mix — best overall fit, with a fifth held for exploration so the
  //    profile cannot close in on itself.
  const explorationSlots = Math.round(MIX_TARGET * MIX_EXPLORATION_RATIO)
  const knownArtists = new Set(Object.keys(profile.artistWeights))
  const core = take(
    aligned.filter((item) => item.score > 0),
    MIX_TARGET - explorationSlots,
    used,
  )
  const fresh = take(
    aligned.filter((item) => !knownArtists.has(artistKey(item.track.artistName))),
    explorationSlots,
    used,
  )
  const yourMix = [...core, ...fresh]
  if (yourMix.length >= MIX_MINIMUM) {
    mixes.push({
      id: 'your-mix',
      title: 'Your Mix',
      description: 'Built on this device from what you play and save here.',
      tracks: yourMix,
    })
  }

  // 2. More from your likes — the artists the visitor explicitly kept. Offered
  //    only when there is something explicit to stand behind it.
  if (profile.explicitItemCount >= MIN_EXPLICIT_FOR_MIX) {
    const savedArtists = new Set(input.saved.map((ref) => artistKey(ref.artist)))
    const fromLikes = take(
      aligned.filter((item) => savedArtists.has(artistKey(item.track.artistName))),
      MIX_TARGET,
      used,
    )
    if (fromLikes.length >= MIX_MINIMUM) {
      mixes.push({
        id: 'from-your-likes',
        title: 'More from your likes',
        description: 'Artists you have saved in Pulse.',
        tracks: fromLikes,
      })
    }
  }

  // 3. Discovery Mix — closest to what was saved, among artists the profile has
  //    never seen. The one mix that is deliberately not a reflection.
  const seeds = seedTracks(input)
  if (seeds.length > 0) {
    const discovery = take(
      pool
        .filter((track) => !knownArtists.has(artistKey(track.artistName)))
        .map((track) => ({ track, score: similarityToSaved(track, seeds) }))
        .filter((item) => item.score > 0),
      MIX_TARGET,
      used,
    )
    if (discovery.length >= MIX_MINIMUM) {
      mixes.push({
        id: 'discovery-mix',
        title: 'Discovery Mix',
        description: 'Music like your saves, from artists you have not played here.',
        tracks: discovery,
      })
    }
  }

  return mixes
}
