import { detectScript, isLowSignal, normalizeText } from '@/music/search/text'
import type { Script } from '@/music/search/text'
import {
  EARLY_PROFILE_LISTENS,
  EXPLICIT_LIKE_WEIGHT,
  EXPLICIT_MIN_DECAY,
  EXPLICIT_PLAYLIST_WEIGHT,
  MATURE_PROFILE_LISTENS,
  MAX_EXPLICIT_ITEMS,
  MIN_SEED_AFFINITY,
  MIN_SEED_PLAYS,
  WARM_PROFILE_LISTENS,
} from './config'
import { readExplicitIntent } from './explicit-intent'
import type { ExplicitIntent, ExplicitItem } from './explicit-intent'
import { addWeight, effectiveWeight, normalizeWeights, recencyDecay } from './scoring'
import type { WeightMap } from './scoring'
import { qualifiedListenCount } from './history'
import type { ListenEntry, PersonalizationState, SearchEntry } from './types'

/**
 * The local preference profile.
 *
 * **Content signals only.** Every field below describes something the visitor
 * interacted with — an artist, a provider-supplied tag, a token they typed, the
 * script that text was written in. None of them is, or may be presented as, a
 * claim about who the visitor is. `scriptWeights.arabic = 0.47` says
 * "Arabic-script text keeps coming up in this browser's own searches and
 * listening"; the UI surfaces it as *Based on your recent searches*, never as a
 * statement about the person (STEP 7).
 *
 * **YouTube is excluded, by construction.** `buildProfile` filters YouTube rows
 * out before any weight is computed, so no YouTube API metadata reaches
 * `artistWeights`, `genreWeights`, `tokenWeights` or `scriptWeights`. YouTube
 * Developer Policies §III.E.4.h forbids using API Data "to create new or derived
 * data or metrics", and a cross-provider preference score is exactly that. What
 * the visitor *typed* is first-party input and is treated as such: a submitted
 * query counts whether or not the result they eventually played came from
 * YouTube (docs/youtube-personalization-policy-audit.md §4).
 */

export type ProfileStage = 'cold' | 'early' | 'warm' | 'mature'

export interface ArtistAffinity {
  /** Comparison key: the folded, lowercased artist name. */
  key: string
  /** Display name, taken from the most recently played matching row. */
  name: string
  /** Provider artist id, when one was recorded. Enables "more from" lookups. */
  artistId?: string
  provider: 'audius' | 'jamendo'
  /** Share of total artist weight, 0–1. */
  weight: number
  /** Qualified plays across this artist's items. */
  plays: number
  lastPlayedAt: number
}

export interface PersonalizationProfile {
  qualifiedListenCount: number
  /** Distinct catalogue items with at least one qualified listen. */
  qualifiedItemCount: number
  stage: ProfileStage
  artists: ArtistAffinity[]
  artistWeights: WeightMap
  genreWeights: WeightMap
  tokenWeights: WeightMap
  scriptWeights: Record<Script, number>
  /** Ids of items played recently enough to hold back from recommendations. */
  recentItemIds: string[]
  /**
   * Distinct catalogue items the visitor explicitly saved — liked, or curated
   * into a playlist. Counted once each, however many playlists hold them.
   */
  explicitItemCount: number
  /**
   * Items the visitor marked *Not interested*, as an exclusion list.
   *
   * The negative signal is deliberately an exclusion and nothing more. A
   * negative *weight* would generalise one refusal into a claim about an artist,
   * a genre or a script, which is both weaker evidence than it looks and exactly
   * the kind of inference agents/43 rules out. Saying "not this one" is treated
   * as meaning "not this one" (agents/43 → "Not interested").
   */
  hiddenItemIds: string[]
  updatedAt: number
}

export const EMPTY_SCRIPT_WEIGHTS: Record<Script, number> = {
  latin: 0,
  cyrillic: 0,
  arabic: 0,
  armenian: 0,
  other: 0,
}

export function emptyProfile(now = Date.now()): PersonalizationProfile {
  return {
    qualifiedListenCount: 0,
    qualifiedItemCount: 0,
    stage: 'cold',
    artists: [],
    artistWeights: {},
    genreWeights: {},
    tokenWeights: {},
    scriptWeights: { ...EMPTY_SCRIPT_WEIGHTS },
    recentItemIds: [],
    explicitItemCount: 0,
    hiddenItemIds: [],
    updatedAt: now,
  }
}

export function stageFor(qualifiedListens: number): ProfileStage {
  if (qualifiedListens >= MATURE_PROFILE_LISTENS) return 'mature'
  if (qualifiedListens >= WARM_PROFILE_LISTENS) return 'warm'
  if (qualifiedListens >= EARLY_PROFILE_LISTENS) return 'early'
  return 'cold'
}

/** Stable comparison key for an artist or channel name. */
export function artistKey(name: string): string {
  const normalized = normalizeText(name)
  return normalized.folded || normalized.normalized || name.toLowerCase()
}

/** Catalogue rows only. The one place YouTube is filtered out of scoring. */
export function catalogEntries(history: ListenEntry[]): ListenEntry[] {
  return history.filter((entry) => entry.provider !== 'youtube')
}

function tokensOf(entry: ListenEntry): string[] {
  const { tokens } = normalizeText(`${entry.title} ${entry.artist}`)
  return tokens.filter((token) => !isLowSignal(token))
}

/**
 * How much one explicitly saved item is worth.
 *
 * Two booleans, added once each, then damped by a floored recency. There is no
 * term here that could grow with the number of playlists a track sits in,
 * because the input carries no such number — five playlists and one playlist
 * produce exactly the same value (agents/43 → "No double-count explosions").
 */
export function explicitWeight(item: ExplicitItem, now = Date.now()): number {
  const base =
    (item.liked ? EXPLICIT_LIKE_WEIGHT : 0) + (item.inPlaylist ? EXPLICIT_PLAYLIST_WEIGHT : 0)
  if (base <= 0) return 0
  return base * Math.max(recencyDecay(item.savedAt, now), EXPLICIT_MIN_DECAY)
}

export function buildProfile(
  state: PersonalizationState,
  now = Date.now(),
  /**
   * Explicit library intent. Defaults to whatever the library registered, and
   * takes an override so tests can describe an exact situation.
   *
   * Reached only from here, and this function is only called while
   * personalization is enabled — which is what makes "explicit library actions
   * must not train the profile when consent is denied" true without the library
   * knowing anything about consent (agents/43).
   */
  intent: ExplicitIntent = readExplicitIntent(),
): PersonalizationProfile {
  // YouTube never reaches any weight below. See the module comment.
  const entries = catalogEntries(state.listeningHistory)
  const explicitItems = [...intent.items]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_EXPLICIT_ITEMS)

  const artistWeights: WeightMap = {}
  const genreWeights: WeightMap = {}
  const tokenWeights: WeightMap = {}
  const scriptRaw: Record<Script, number> = { ...EMPTY_SCRIPT_WEIGHTS }
  const artistMeta = new Map<string, ArtistAffinity>()

  for (const entry of entries) {
    const weight = effectiveWeight(entry, now)
    if (weight <= 0) continue

    const key = artistKey(entry.artist)
    addWeight(artistWeights, key, weight)

    const previous = artistMeta.get(key)
    if (!previous || entry.lastPlayedAt >= previous.lastPlayedAt) {
      artistMeta.set(key, {
        key,
        name: entry.artist,
        ...(entry.artistId ? { artistId: entry.artistId } : {}),
        provider: entry.provider === 'jamendo' ? 'jamendo' : 'audius',
        weight: 0,
        plays: (previous?.plays ?? 0) + entry.playCount,
        lastPlayedAt: entry.lastPlayedAt,
      })
    } else {
      artistMeta.set(key, { ...previous, plays: previous.plays + entry.playCount })
    }

    if (entry.genre) addWeight(genreWeights, entry.genre.toLowerCase(), weight)

    for (const token of tokensOf(entry)) addWeight(tokenWeights, token, weight * 0.5)

    // Script evidence from a catalogue row is the provider's own title metadata
    // for something this browser actually listened to — a content signal, and
    // never a statement about the listener.
    scriptRaw[detectScript(`${entry.title} ${entry.artist}`)] += weight
  }

  /**
   * Explicit intent, folded into the same maps rather than a second engine.
   *
   * A like and a listen are evidence about the same thing — which artists, tags
   * and words this browser keeps coming back to — so they belong in one set of
   * weights. Adding a parallel scorer would mean two rankings to reconcile and
   * two places for a rule to drift (agents/43 → "Do not create a second profile
   * engine").
   *
   * An explicitly saved artist also enters `artistMeta`, so *More from artists
   * you like* can name someone the visitor liked without ever pressing play.
   * `plays` stays at zero for such an artist, which is what keeps *Because you
   * listened to …* honest: that section makes a claim about listening, and
   * `MIN_SEED_PLAYS` still has to be met by real listens.
   */
  for (const item of explicitItems) {
    const weight = explicitWeight(item, now)
    if (weight <= 0) continue

    const key = artistKey(item.artist)
    addWeight(artistWeights, key, weight)

    if (!artistMeta.has(key)) {
      artistMeta.set(key, {
        key,
        name: item.artist,
        ...(item.artistId ? { artistId: item.artistId } : {}),
        provider: item.provider === 'jamendo' ? 'jamendo' : 'audius',
        weight: 0,
        plays: 0,
        lastPlayedAt: item.savedAt,
      })
    }

    if (item.genre) addWeight(genreWeights, item.genre.toLowerCase(), weight)

    const { tokens } = normalizeText(`${item.title} ${item.artist}`)
    for (const token of tokens) {
      if (!isLowSignal(token)) addWeight(tokenWeights, token, weight * 0.5)
    }

    scriptRaw[detectScript(`${item.title} ${item.artist}`)] += weight
  }

  // First-party input: what the visitor typed, regardless of which catalogue (or
  // whether YouTube) eventually answered it.
  for (const search of state.searchHistory) {
    const weight = searchWeight(search, now)
    if (weight <= 0) continue
    scriptRaw[search.script] += weight
    for (const token of normalizeText(search.query).tokens) {
      if (!isLowSignal(token)) addWeight(tokenWeights, token, weight)
    }
  }

  const normalizedArtists = normalizeWeights(artistWeights)
  const artists = [...artistMeta.values()]
    .map((artist) => ({ ...artist, weight: normalizedArtists[artist.key] ?? 0 }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))

  const listens = qualifiedListenCount(entries)

  return {
    qualifiedListenCount: listens,
    qualifiedItemCount: entries.filter((entry) => entry.playCount > 0).length,
    stage: stageFor(listens),
    artists,
    artistWeights: normalizedArtists,
    genreWeights: normalizeWeights(genreWeights),
    tokenWeights: normalizeWeights(tokenWeights),
    scriptWeights: normalizeScripts(scriptRaw),
    recentItemIds: entries
      .filter((entry) => entry.playCount > 0)
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
      .map((entry) => entry.id),
    explicitItemCount: explicitItems.length,
    hiddenItemIds: [...intent.hiddenKeys],
    updatedAt: now,
  }
}

/**
 * A repeated query is a stronger signal than a one-off, but only logarithmically
 * — the same damping the repeat-listen factor uses, for the same reason.
 */
function searchWeight(search: SearchEntry, now: number): number {
  const base = 1 + Math.log(Math.max(1, search.submitCount)) * 0.5
  const played = search.resultWasPlayed ? 1.4 : 1
  return base * played * recencyDecay(search.submittedAt, now)
}

function normalizeScripts(raw: Record<Script, number>): Record<Script, number> {
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0)
  if (total <= 0) return { ...EMPTY_SCRIPT_WEIGHTS }
  const result = { ...EMPTY_SCRIPT_WEIGHTS }
  for (const script of Object.keys(raw) as Script[]) result[script] = raw[script] / total
  return result
}

/* --------------------------------------------------------------------------
   "Because you listened to …" seed (STEP 13)
   -------------------------------------------------------------------------- */

/**
 * The artist a *Because you listened to …* shelf may name, or `null`.
 *
 * Returning `null` is the common, correct answer. The section makes a causal
 * claim in the visitor's own words, so it is only allowed when the evidence
 * genuinely supports it: an artist holding a meaningful share of the profile,
 * with more than one qualified play. A weak or evenly-spread profile omits the
 * section rather than inventing an explanation for it.
 */
export function seedArtist(profile: PersonalizationProfile): ArtistAffinity | null {
  if (profile.stage !== 'warm' && profile.stage !== 'mature') return null
  const seed = profile.artists.find(
    (artist) => artist.weight >= MIN_SEED_AFFINITY && artist.plays >= MIN_SEED_PLAYS,
  )
  return seed ?? null
}
