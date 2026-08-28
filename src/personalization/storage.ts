import { detectScript } from '@/music/search/text'
import type { Script } from '@/music/search/text'
import type { MediaProviderId } from '@/music/types'
import {
  MAX_ARTWORK_MIRRORS,
  MAX_DISMISSED_ITEMS,
  MAX_HISTORY_ITEMS,
  MAX_SEARCH_HISTORY,
} from './config'
import { migrate } from './migrations'
import {
  LISTEN_CONTEXTS,
  PERSONALIZATION_STORAGE_KEY,
  PERSONALIZATION_VERSION,
  createEmptyState,
} from './types'
import type {
  ConsentChoice,
  ListenContext,
  ListenEntry,
  PersonalizationState,
  SearchEntry,
  StorageStatus,
} from './types'

/**
 * The only code in the application allowed to touch personalization storage.
 *
 * Three properties matter here, and each is enforced structurally rather than by
 * convention:
 *
 * **Nothing crashes.** Every read runs through `sanitizeState`, which rebuilds
 * the object field by field from `unknown`. A hand-edited entry, a truncated
 * write, a value of the wrong type, an array where an object was expected — each
 * is dropped and the rest is kept. There is no cast from a parsed payload to
 * `PersonalizationState` anywhere in this file.
 *
 * **Only allow-listed fields are written.** `toPersisted` constructs the stored
 * object explicitly. A provider that starts returning a credential, a signed
 * stream URL or an access token in its payload cannot leak into storage, because
 * no code path copies an object wholesale into it (STEP 21).
 *
 * **Storage failure disables personalization; it never breaks the app.** Private
 * browsing, disabled storage and an exhausted quota all resolve to
 * `'unavailable'`, which the store treats as "personalization is off". Failures
 * are handled where they happen, never logged in a loop (STEP 19).
 */

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    // Reading the property itself throws when storage is blocked by policy.
    return null
  }
}

/** True when a real write can actually be performed right now. */
export function isStorageAvailable(storage: Storage | null = safeStorage()): boolean {
  if (!storage) return false
  const probe = `${PERSONALIZATION_STORAGE_KEY}.probe`
  try {
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

/* --------------------------------------------------------------------------
   Validation primitives
   -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, max = 400): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonNegative(value: unknown, fallback = 0): number {
  const parsed = num(value)
  return parsed !== undefined && parsed >= 0 ? parsed : fallback
}

function ratio(value: unknown): number {
  const parsed = num(value)
  if (parsed === undefined) return 0
  return Math.min(Math.max(parsed, 0), 1)
}

function bool(value: unknown): boolean {
  return value === true
}

/** Only http(s) URLs survive, so a hand-edited `javascript:` can never render. */
function safeUrl(value: unknown): string | undefined {
  const raw = str(value, 2000)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : undefined
  } catch {
    return undefined
  }
}

/**
 * Bounded list of `http(s)` origins. Anything else — a path, a `javascript:`
 * URL, a non-string — is dropped rather than repaired, and the list is capped so
 * a provider that starts publishing fifty mirrors cannot inflate storage.
 */
function safeOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const origins: string[] = []
  for (const candidate of value) {
    if (origins.length >= MAX_ARTWORK_MIRRORS) break
    const raw = str(candidate, 300)
    if (!raw) continue
    try {
      const url = new URL(raw)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
      if (!origins.includes(url.origin)) origins.push(url.origin)
    } catch {
      continue
    }
  }
  return origins
}

const PROVIDERS: readonly MediaProviderId[] = ['audius', 'jamendo', 'youtube']

function providerOf(value: unknown): MediaProviderId | undefined {
  return PROVIDERS.includes(value as MediaProviderId) ? (value as MediaProviderId) : undefined
}

function listenContext(value: unknown): ListenContext {
  return LISTEN_CONTEXTS.includes(value as ListenContext) ? (value as ListenContext) : 'other'
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function dayList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const days = value.filter((day): day is string => typeof day === 'string' && DAY_PATTERN.test(day))
  return [...new Set(days)].sort().slice(-64)
}

const SCRIPTS: readonly Script[] = ['latin', 'cyrillic', 'arabic', 'armenian', 'other']

function isScript(value: string | undefined): value is Script {
  return value !== undefined && SCRIPTS.includes(value as Script)
}

function consentChoice(value: unknown): ConsentChoice {
  return value === 'granted' || value === 'denied' ? value : 'unset'
}

/* --------------------------------------------------------------------------
   Entry sanitizers
   -------------------------------------------------------------------------- */

export function sanitizeListenEntry(value: unknown): ListenEntry | null {
  if (!isRecord(value)) return null

  const provider = providerOf(value.provider)
  const providerItemId = str(value.providerItemId, 200)
  const title = str(value.title, 300)
  if (!provider || !providerItemId || !title) return null

  const isYouTube = provider === 'youtube'
  const startedAt = nonNegative(value.startedAt)
  const lastPlayedAt = nonNegative(value.lastPlayedAt, startedAt)
  const qualifiedAt = num(value.qualifiedAt)

  const entry: ListenEntry = {
    id: `${provider}:${providerItemId}`,
    provider,
    mediaKind: isYouTube ? 'youtube-video' : 'audio',
    providerItemId,
    title,
    artist: str(value.artist, 300) ?? 'Unknown artist',
    context: listenContext(value.context),
    startedAt: startedAt || lastPlayedAt,
    qualifiedAt: qualifiedAt !== undefined && qualifiedAt > 0 ? qualifiedAt : null,
    lastPlayedAt,
    playedSeconds: nonNegative(value.playedSeconds),
    completionRatio: ratio(value.completionRatio),
    playCount: Math.max(0, Math.floor(nonNegative(value.playCount))),
    skipCount: Math.max(0, Math.floor(nonNegative(value.skipCount))),
    playedDays: dayList(value.playedDays),
    storedAt: nonNegative(value.storedAt, lastPlayedAt),
  }

  const artistId = str(value.artistId, 200)
  if (artistId) entry.artistId = artistId

  const duration = num(value.durationSeconds)
  if (duration !== undefined && duration > 0) entry.durationSeconds = duration

  const sourceUrl = safeUrl(value.sourceUrl)
  if (sourceUrl) entry.sourceUrl = sourceUrl

  const searchQuery = str(value.searchQuery, 200)
  if (searchQuery) entry.searchQuery = searchQuery

  if (isYouTube) {
    // Only the URL of YouTube's own thumbnail is kept — never bytes, never a
    // cropped or re-hosted derivative.
    const thumbnailUrl = safeUrl(value.thumbnailUrl)
    if (thumbnailUrl) entry.thumbnailUrl = thumbnailUrl
    entry.embeddable = bool(value.embeddable)
    entry.madeForKids =
      value.madeForKids === true ? true : value.madeForKids === false ? false : null
  } else {
    const artworkUrl = safeUrl(value.artworkUrl)
    if (artworkUrl) entry.artworkUrl = artworkUrl
    const mirrors = safeOrigins(value.artworkMirrors)
    if (mirrors.length) entry.artworkMirrors = mirrors
    const genre = str(value.genre, 100)
    if (genre) entry.genre = genre
  }

  const lastStartedAt = num(value.lastStartedAt)
  if (lastStartedAt !== undefined && lastStartedAt > 0) entry.lastStartedAt = lastStartedAt

  return entry
}

export function sanitizeSearchEntry(value: unknown): SearchEntry | null {
  if (!isRecord(value)) return null
  const query = str(value.query, 200)
  if (!query) return null

  const providers = Array.isArray(value.providers)
    ? [
        ...new Set(
          value.providers.map(providerOf).filter((id): id is MediaProviderId => Boolean(id)),
        ),
      ]
    : []

  const script = str(value.script, 20)

  return {
    query,
    normalizedQuery: str(value.normalizedQuery, 200) ?? query.toLowerCase(),
    submittedAt: nonNegative(value.submittedAt),
    providers,
    resultWasPlayed: bool(value.resultWasPlayed),
    submitCount: Math.max(1, Math.floor(nonNegative(value.submitCount, 1))),
    script: isScript(script) ? script : detectScript(query),
  }
}

/* --------------------------------------------------------------------------
   State-level sanitize
   -------------------------------------------------------------------------- */

export interface SanitizeResult {
  state: PersonalizationState
  /** True when something had to be dropped or repaired. */
  repaired: boolean
}

export function sanitizeState(value: unknown, now = Date.now()): SanitizeResult {
  if (!isRecord(value)) return { state: createEmptyState(now), repaired: true }

  let repaired = false

  const rawHistory = Array.isArray(value.listeningHistory) ? value.listeningHistory : []
  if (!Array.isArray(value.listeningHistory) && value.listeningHistory !== undefined) repaired = true

  const seen = new Set<string>()
  const listeningHistory: ListenEntry[] = []
  for (const raw of rawHistory) {
    const entry = sanitizeListenEntry(raw)
    if (!entry || seen.has(entry.id)) {
      repaired = true
      continue
    }
    seen.add(entry.id)
    listeningHistory.push(entry)
  }
  if (listeningHistory.length > MAX_HISTORY_ITEMS) {
    listeningHistory.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    listeningHistory.length = MAX_HISTORY_ITEMS
    repaired = true
  }

  const rawSearches = Array.isArray(value.searchHistory) ? value.searchHistory : []
  if (!Array.isArray(value.searchHistory) && value.searchHistory !== undefined) repaired = true

  const seenQueries = new Set<string>()
  const searchHistory: SearchEntry[] = []
  for (const raw of rawSearches) {
    const entry = sanitizeSearchEntry(raw)
    if (!entry || seenQueries.has(entry.normalizedQuery)) {
      repaired = true
      continue
    }
    seenQueries.add(entry.normalizedQuery)
    searchHistory.push(entry)
  }
  if (searchHistory.length > MAX_SEARCH_HISTORY) {
    searchHistory.sort((a, b) => b.submittedAt - a.submittedAt)
    searchHistory.length = MAX_SEARCH_HISTORY
    repaired = true
  }

  const dismissedItems = Array.isArray(value.dismissedItems)
    ? [...new Set(value.dismissedItems.filter((id): id is string => typeof id === 'string'))].slice(
        0,
        MAX_DISMISSED_ITEMS,
      )
    : []
  if (!Array.isArray(value.dismissedItems) && value.dismissedItems !== undefined) repaired = true

  const preferences = isRecord(value.preferences) ? value.preferences : {}
  const consent = consentChoice(value.consent)
  if (value.consent !== undefined && consent !== value.consent) repaired = true

  const consentUpdatedAt = num(value.consentUpdatedAt)

  return {
    state: {
      version: PERSONALIZATION_VERSION,
      consent,
      consentUpdatedAt:
        consentUpdatedAt !== undefined && consentUpdatedAt > 0 ? consentUpdatedAt : null,
      listeningHistory,
      searchHistory,
      preferences: { promptSeen: bool(preferences.promptSeen) },
      dismissedItems,
      updatedAt: nonNegative(value.updatedAt, now),
    },
    repaired,
  }
}

/* --------------------------------------------------------------------------
   Serialization — the allow-list (STEP 21)
   -------------------------------------------------------------------------- */

/**
 * Builds the persisted object explicitly, one named field at a time.
 *
 * This function is the security boundary for STEP 21. Because it never spreads a
 * source object, there is no path by which a credential, a signed stream URL, an
 * access token or a wholesale provider response can be written to disk — the
 * only way to persist a new field is to add a line here.
 */
export function toPersisted(state: PersonalizationState): Record<string, unknown> {
  return {
    version: PERSONALIZATION_VERSION,
    consent: state.consent,
    consentUpdatedAt: state.consentUpdatedAt,
    updatedAt: state.updatedAt,
    preferences: { promptSeen: state.preferences.promptSeen },
    dismissedItems: state.dismissedItems.slice(0, MAX_DISMISSED_ITEMS),
    listeningHistory: state.listeningHistory.map((entry) => {
      const persisted: Record<string, unknown> = {
        provider: entry.provider,
        providerItemId: entry.providerItemId,
        title: entry.title,
        artist: entry.artist,
        context: entry.context,
        startedAt: entry.startedAt,
        qualifiedAt: entry.qualifiedAt,
        lastPlayedAt: entry.lastPlayedAt,
        playedSeconds: Math.round(entry.playedSeconds * 100) / 100,
        completionRatio: Math.round(entry.completionRatio * 1000) / 1000,
        playCount: entry.playCount,
        skipCount: entry.skipCount,
        playedDays: entry.playedDays,
        storedAt: entry.storedAt,
      }
      if (entry.artistId) persisted.artistId = entry.artistId
      if (entry.lastStartedAt) persisted.lastStartedAt = entry.lastStartedAt
      if (entry.durationSeconds) persisted.durationSeconds = entry.durationSeconds
      if (entry.sourceUrl) persisted.sourceUrl = entry.sourceUrl
      if (entry.searchQuery) persisted.searchQuery = entry.searchQuery
      if (entry.provider === 'youtube') {
        if (entry.thumbnailUrl) persisted.thumbnailUrl = entry.thumbnailUrl
        persisted.embeddable = entry.embeddable === true
        persisted.madeForKids = entry.madeForKids ?? null
      } else {
        if (entry.artworkUrl) persisted.artworkUrl = entry.artworkUrl
        if (entry.artworkMirrors?.length) {
          persisted.artworkMirrors = entry.artworkMirrors.slice(0, MAX_ARTWORK_MIRRORS)
        }
        if (entry.genre) persisted.genre = entry.genre
      }
      return persisted
    }),
    searchHistory: state.searchHistory.map((entry) => ({
      query: entry.query,
      normalizedQuery: entry.normalizedQuery,
      submittedAt: entry.submittedAt,
      providers: entry.providers,
      resultWasPlayed: entry.resultWasPlayed,
      submitCount: entry.submitCount,
      script: entry.script,
    })),
  }
}

/* --------------------------------------------------------------------------
   Read / write
   -------------------------------------------------------------------------- */

export interface ReadResult {
  state: PersonalizationState
  status: StorageStatus
}

export function readState(storage: Storage | null = safeStorage(), now = Date.now()): ReadResult {
  if (!storage) return { state: createEmptyState(now), status: 'unavailable' }

  let raw: string | null
  try {
    raw = storage.getItem(PERSONALIZATION_STORAGE_KEY)
  } catch {
    return { state: createEmptyState(now), status: 'unavailable' }
  }

  if (raw === null) return { state: createEmptyState(now), status: 'ok' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Malformed JSON: start clean rather than throwing. The bad value stays in
    // place until the next successful write replaces it.
    return { state: createEmptyState(now), status: 'recovered' }
  }

  const migrated = migrate(parsed)
  if (migrated.kind === 'incompatible') {
    // Written by a newer build. Do not reinterpret it, and do not delete it —
    // that build is entitled to find its own data intact.
    return { state: createEmptyState(now), status: 'incompatible' }
  }
  if (migrated.kind === 'unusable') {
    return { state: createEmptyState(now), status: 'recovered' }
  }

  const { state, repaired } = sanitizeState(migrated.state, now)
  return { state, status: repaired ? 'recovered' : 'ok' }
}

export type WriteOutcome = 'written' | 'unavailable'

export function writeState(
  state: PersonalizationState,
  storage: Storage | null = safeStorage(),
): WriteOutcome {
  if (!storage) return 'unavailable'
  try {
    storage.setItem(PERSONALIZATION_STORAGE_KEY, JSON.stringify(toPersisted(state)))
    return 'written'
  } catch {
    // Quota exceeded, or storage revoked mid-session. Personalization turns
    // itself off; playback, search and the queue are untouched.
    return 'unavailable'
  }
}

export function clearStoredState(storage: Storage | null = safeStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(PERSONALIZATION_STORAGE_KEY)
  } catch {
    // Nothing to do — the caller's in-memory state is already reset.
  }
}
