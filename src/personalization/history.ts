import { detectScript, normalizeText } from '@/music/search/text'
import type { MediaProviderId } from '@/music/types'
import {
  MAX_HISTORY_DAYS,
  MAX_HISTORY_ITEMS,
  MAX_SEARCH_HISTORY,
  MS_PER_DAY,
} from './config'
import { completionRatioFor, isEarlySkip, isQualifiedListen } from './qualification'
import { purgeExpiredYouTube } from './youtube-retention'
import type { ListenContext, ListenEntry, PersonalizationState, SearchEntry } from './types'

/**
 * Pure reducers over listening and search history.
 *
 * Nothing here reads a clock, touches storage or knows about React: every
 * function takes the current state plus a `now`, and returns the next state.
 * That is what makes retention, deduplication and the qualified-listen rule
 * testable without a browser, and what keeps a single definition of each rule.
 */

/** Local calendar day, used to detect "played again on another day". */
export function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * One finished play, as observed by the listen tracker.
 *
 * `playedSeconds` is accumulated from clock deltas rather than read off the
 * player's position, so scrubbing to the end of a track cannot manufacture a
 * qualified listen (STEP 28 → "seeking does not produce impossible playedSeconds").
 */
export interface PlaySession {
  item: PlayedItem
  /** Seconds genuinely heard in this play session, in total. */
  playedSeconds: number
  /**
   * How much of `playedSeconds` an earlier commit of this same session already
   * folded into history.
   *
   * A play is committed twice: once the instant it qualifies, so the dashboard
   * can react while the track is still going, and once when it finishes. Passing
   * what was already credited is what makes the second commit additive rather
   * than duplicative — the running total grows by the difference, and the play
   * count cannot be incremented twice for one listen.
   */
  creditedSeconds: number
  /** Furthest position reached, used only for the completion ratio. */
  reachedSeconds: number
  startedAt: number
  endedAt: number
  /** True when the media element reported `ended`. */
  completed: boolean
}

/** The allow-listed description of a playable item, built by the caller. */
export interface PlayedItem {
  provider: MediaProviderId
  providerItemId: string
  title: string
  artist: string
  artistId?: string
  artworkUrl?: string
  artworkMirrors?: string[]
  thumbnailUrl?: string
  durationSeconds?: number
  genre?: string
  sourceUrl?: string
  embeddable?: boolean
  madeForKids?: boolean | null
  searchQuery?: string
  context: ListenContext
}

export function entryIdFor(provider: MediaProviderId, providerItemId: string): string {
  return `${provider}:${providerItemId}`
}

function baseEntry(item: PlayedItem, now: number): ListenEntry {
  const entry: ListenEntry = {
    id: entryIdFor(item.provider, item.providerItemId),
    provider: item.provider,
    mediaKind: item.provider === 'youtube' ? 'youtube-video' : 'audio',
    providerItemId: item.providerItemId,
    title: item.title,
    artist: item.artist,
    context: item.context,
    startedAt: now,
    qualifiedAt: null,
    lastPlayedAt: now,
    playedSeconds: 0,
    completionRatio: 0,
    playCount: 0,
    skipCount: 0,
    playedDays: [],
    storedAt: now,
  }
  if (item.artistId) entry.artistId = item.artistId
  if (item.durationSeconds && item.durationSeconds > 0) entry.durationSeconds = item.durationSeconds
  if (item.sourceUrl) entry.sourceUrl = item.sourceUrl
  if (item.searchQuery) entry.searchQuery = item.searchQuery
  if (item.provider === 'youtube') {
    if (item.thumbnailUrl) entry.thumbnailUrl = item.thumbnailUrl
    entry.embeddable = item.embeddable === true
    entry.madeForKids = item.madeForKids ?? null
  } else {
    if (item.artworkUrl) entry.artworkUrl = item.artworkUrl
    if (item.artworkMirrors?.length) entry.artworkMirrors = item.artworkMirrors
    if (item.genre) entry.genre = item.genre
  }
  return entry
}

/**
 * Folds one finished play into the history.
 *
 * Deduplication is on `provider:providerItemId` only. Two items from different
 * catalogues are never merged, however similar their titles — a listener may
 * legitimately keep both a Jamendo cover and the Audius original, and collapsing
 * them would lose a real preference (STEP 22).
 *
 * A play that never qualified still updates `playedSeconds` and `lastPlayedAt`,
 * because a near-zero signal is not the same as no signal, but it does **not**
 * increment `playCount` or set `qualifiedAt`. Repeat weighting therefore counts
 * real listens rather than clicks.
 */
export function recordPlaySession(
  history: ListenEntry[],
  session: PlaySession,
  now = Date.now(),
): ListenEntry[] {
  const { item } = session
  const id = entryIdFor(item.provider, item.providerItemId)
  const index = history.findIndex((entry) => entry.id === id)
  const existing = index >= 0 ? history[index] : undefined

  const duration = item.durationSeconds ?? existing?.durationSeconds
  const credited = Math.max(0, Math.min(session.creditedSeconds, session.playedSeconds))
  const qualified = isQualifiedListen(session.playedSeconds, duration)
  // A second commit of the same play must not count a second listen.
  const newQualification = qualified && !isQualifiedListen(credited, duration)
  // Finishing a very short item is not a rejection of it, however brief it was.
  const skipped = !session.completed && credited === 0 && isEarlySkip(session.playedSeconds, duration)
  const completion = session.completed ? 1 : completionRatioFor(session.reachedSeconds, duration)

  // Refreshing the descriptive fields keeps a renamed track or a rotated
  // thumbnail URL current, and — for YouTube — restarts the retention clock from
  // this genuinely new retrieval.
  const refreshed = baseEntry(item, now)

  const next: ListenEntry = {
    ...refreshed,
    startedAt: existing?.startedAt ?? session.startedAt,
    // A session commit is itself the most recent start, so display recency can
    // never go backwards when a replay is followed by a real listen.
    lastStartedAt: Math.max(existing?.lastStartedAt ?? 0, session.startedAt),
    lastPlayedAt: session.endedAt,
    storedAt: now,
    playedSeconds: (existing?.playedSeconds ?? 0) + Math.max(0, session.playedSeconds - credited),
    completionRatio: Math.max(existing?.completionRatio ?? 0, completion),
    playCount: (existing?.playCount ?? 0) + (newQualification ? 1 : 0),
    skipCount: (existing?.skipCount ?? 0) + (skipped ? 1 : 0),
    qualifiedAt: existing?.qualifiedAt ?? (qualified ? session.endedAt : null),
    playedDays: qualified
      ? [...new Set([...(existing?.playedDays ?? []), dayKey(session.endedAt)])].sort().slice(-64)
      : (existing?.playedDays ?? []),
  }

  // Keep the original discovery query rather than overwriting it: how an item
  // was first found is the more informative signal.
  if (existing?.searchQuery && !item.searchQuery) next.searchQuery = existing.searchQuery
  if (existing?.artistId && !next.artistId) next.artistId = existing.artistId
  if (existing?.durationSeconds && !next.durationSeconds) {
    next.durationSeconds = existing.durationSeconds
  }
  if (existing?.genre && !next.genre && next.provider !== 'youtube') next.genre = existing.genre
  // Keep artwork already known rather than blanking a good row when a provider
  // response happens to arrive without it.
  if (existing?.artworkUrl && !next.artworkUrl) next.artworkUrl = existing.artworkUrl
  if (existing?.artworkMirrors?.length && !next.artworkMirrors?.length) {
    next.artworkMirrors = existing.artworkMirrors
  }

  const merged = index >= 0 ? [...history.slice(0, index), next, ...history.slice(index + 1)] : [next, ...history]

  return pruneHistory(merged, now)
}

/**
 * Applies both retention rules and the size cap.
 *
 * YouTube expiry runs first and is absolute: a YouTube row past its policy
 * window is deleted whether or not the catalogue caps would have kept it.
 */
export function pruneHistory(history: ListenEntry[], now = Date.now()): ListenEntry[] {
  const afterYouTube = purgeExpiredYouTube(history, now)
  const ageCutoff = now - MAX_HISTORY_DAYS * MS_PER_DAY
  const fresh = afterYouTube.filter((entry) => entry.lastPlayedAt > ageCutoff)
  const ordered = [...fresh].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
  return ordered.length > MAX_HISTORY_ITEMS ? ordered.slice(0, MAX_HISTORY_ITEMS) : ordered
}

/**
 * The recency a *listener* means when they say "recently played".
 *
 * `lastPlayedAt` moves when a session produces something worth recording;
 * `lastStartedAt` moves the moment they press play on something they have played
 * before. The shelf answers the second question, so it takes whichever is later
 * — and falls back cleanly for rows written before `lastStartedAt` existed.
 */
export function displayRecency(entry: ListenEntry): number {
  return Math.max(entry.lastPlayedAt, entry.lastStartedAt ?? 0)
}

/**
 * Most recently played first, deduplicated by construction.
 *
 * The single canonical ordering. Both the home shelf and the search dropdown
 * read it, so a replay reorders every surface at once and they cannot drift.
 */
export function recentlyPlayed(history: ListenEntry[], now = Date.now()): ListenEntry[] {
  return purgeExpiredYouTube(history, now)
    .filter((entry) => displayRecency(entry) > 0)
    .sort((a, b) => {
      const recency = displayRecency(b) - displayRecency(a)
      if (recency !== 0) return recency
      // Switching tracks closes the previous session and starts the next one in
      // the same tick, so the two timestamps can land on the same millisecond.
      // A press of play is the later event of the two, and breaking the tie on
      // it keeps the order both correct and deterministic.
      const started = (b.lastStartedAt ?? 0) - (a.lastStartedAt ?? 0)
      if (started !== 0) return started
      return a.id.localeCompare(b.id)
    })
}

/**
 * Acknowledges that playback of an item **already in history** has just started.
 *
 * This exists because pressing play on something you played last week is real,
 * immediate evidence for the *shelf* and no evidence at all for the *profile*.
 * So it moves `lastStartedAt` and refreshes display metadata, and touches
 * nothing else: not `playCount`, not `qualifiedAt`, not `lastPlayedAt`, not
 * `playedSeconds`. Recommendation weight still has to be earned by qualifying.
 *
 * A track that is **not** already in history is ignored outright. A brand-new
 * item must still earn its row by crossing the qualification threshold, so a
 * five-second misclick cannot put an unknown track on the shelf.
 *
 * `storedAt` is deliberately left alone. For YouTube it is the retention clock,
 * and a replay from history reuses metadata already held rather than retrieving
 * it again — only a real session commit, which does re-read the item, restarts
 * that window.
 */
export function touchReplayStart(
  history: ListenEntry[],
  item: PlayedItem,
  now = Date.now(),
): ListenEntry[] {
  const id = entryIdFor(item.provider, item.providerItemId)
  const index = history.findIndex((entry) => entry.id === id)
  if (index < 0) return history

  const existing = history[index]
  const next: ListenEntry = { ...existing, lastStartedAt: now }

  // Fresher display metadata repairs a row recorded before the provider had it —
  // an old entry with no artwork gains it simply by being played again (STEP 10).
  if (item.title) next.title = item.title
  if (item.artist) next.artist = item.artist
  if (item.artistId) next.artistId = item.artistId
  if (item.durationSeconds && item.durationSeconds > 0) next.durationSeconds = item.durationSeconds
  if (item.sourceUrl) next.sourceUrl = item.sourceUrl

  if (item.provider === 'youtube') {
    if (item.thumbnailUrl) next.thumbnailUrl = item.thumbnailUrl
  } else {
    if (item.artworkUrl) next.artworkUrl = item.artworkUrl
    if (item.artworkMirrors?.length) next.artworkMirrors = item.artworkMirrors
    if (item.genre) next.genre = item.genre
  }

  return [...history.slice(0, index), next, ...history.slice(index + 1)]
}

/** Qualified listens only — the count every dashboard stage is derived from. */
export function qualifiedListenCount(history: ListenEntry[]): number {
  return history.reduce((total, entry) => total + entry.playCount, 0)
}

/* --------------------------------------------------------------------------
   Search history (STEP 6)
   -------------------------------------------------------------------------- */

export interface SubmittedSearch {
  query: string
  providers?: MediaProviderId[]
  resultWasPlayed?: boolean
}

/**
 * Records one **explicitly submitted** query.
 *
 * Keystrokes never reach here: the caller gates on `useSubmittedSearchKey`, the
 * same history-push signal the YouTube quota guarantee already relies on, so a
 * visitor typing `sara al sawas` produces one row rather than thirteen.
 *
 * Deduplication is on the normalized form, which folds case, punctuation and
 * spacing but never transliterates — `سارية السواس` and `Սիրուշո` are stored and
 * compared in their own scripts (STEP 6).
 */
export function recordSubmittedSearch(
  searches: SearchEntry[],
  submitted: SubmittedSearch,
  now = Date.now(),
): SearchEntry[] {
  const normalized = normalizeText(submitted.query)
  if (!normalized.provider) return searches

  const key = normalized.folded || normalized.normalized
  const index = searches.findIndex((entry) => entry.normalizedQuery === key)
  const existing = index >= 0 ? searches[index] : undefined

  const next: SearchEntry = {
    query: normalized.provider,
    normalizedQuery: key,
    submittedAt: now,
    providers: [...new Set([...(existing?.providers ?? []), ...(submitted.providers ?? [])])],
    resultWasPlayed: submitted.resultWasPlayed === true || existing?.resultWasPlayed === true,
    submitCount: (existing?.submitCount ?? 0) + 1,
    script: detectScript(normalized.provider),
  }

  const rest = index >= 0 ? [...searches.slice(0, index), ...searches.slice(index + 1)] : searches
  return [next, ...rest].slice(0, MAX_SEARCH_HISTORY)
}

/**
 * Removes one submitted search, addressed by its normalized form.
 *
 * The normalized form is the identity the history model already deduplicates on,
 * so removing by it removes exactly the row the visitor is looking at — not
 * every row whose display text happens to look similar. Returns the same array
 * instance when nothing matched, so the caller can skip a pointless write.
 *
 * Listening history is untouched: this is a search-history-only action
 * (Phase 5 STEP 10).
 */
export function removeSubmittedSearch(
  searches: SearchEntry[],
  normalizedQuery: string,
): SearchEntry[] {
  const next = searches.filter((entry) => entry.normalizedQuery !== normalizedQuery)
  return next.length === searches.length ? searches : next
}

/** Marks the most recent submission of a query as having produced a play. */
export function markSearchResultPlayed(searches: SearchEntry[], query: string): SearchEntry[] {
  const normalized = normalizeText(query)
  const key = normalized.folded || normalized.normalized
  if (!key) return searches
  let changed = false
  const next = searches.map((entry) => {
    if (entry.normalizedQuery !== key || entry.resultWasPlayed) return entry
    changed = true
    return { ...entry, resultWasPlayed: true }
  })
  return changed ? next : searches
}

/* --------------------------------------------------------------------------
   Clear operations (STEP 16)
   -------------------------------------------------------------------------- */

/** Removes listening history and everything derived from it. */
export function clearListeningHistory(
  state: PersonalizationState,
  now = Date.now(),
): PersonalizationState {
  return { ...state, listeningHistory: [], dismissedItems: [], updatedAt: now }
}

/** Removes submitted searches and their contribution to the profile. */
export function clearSearchHistory(
  state: PersonalizationState,
  now = Date.now(),
): PersonalizationState {
  return { ...state, searchHistory: [], updatedAt: now }
}

/**
 * Clears every personalization signal while preserving the consent choice and
 * non-sensitive UI settings. Volume and mute live under different keys entirely
 * and are not touched by any function in this module.
 */
export function resetRecommendations(
  state: PersonalizationState,
  now = Date.now(),
): PersonalizationState {
  return {
    ...state,
    listeningHistory: [],
    searchHistory: [],
    dismissedItems: [],
    updatedAt: now,
  }
}
