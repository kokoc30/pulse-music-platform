import { PERSONALIZATION_STORAGE_KEY, PERSONALIZATION_VERSION } from '@/personalization/types'
import type {
  ListenEntry,
  PersonalizationState,
  SearchEntry,
} from '@/personalization/types'
import type { PlaySession, PlayedItem } from '@/personalization/history'
import type { MediaProviderId } from '@/music/types'

/**
 * Builders for personalization state.
 *
 * Every test that needs history writes it through these rather than hand-rolling
 * an object literal, so a change to the schema breaks the builders once instead
 * of breaking forty tests individually.
 */

/** A fixed "now" so recency decay is deterministic in every assertion. */
export const NOW = Date.parse('2026-06-15T12:00:00Z')
export const DAY = 86_400_000

export interface EntrySpec {
  provider?: MediaProviderId
  id?: string
  title?: string
  artist?: string
  artistId?: string
  genre?: string
  durationSeconds?: number
  playCount?: number
  skipCount?: number
  completionRatio?: number
  daysAgo?: number
  playedDays?: string[]
  qualified?: boolean
  embeddable?: boolean
  madeForKids?: boolean | null
  storedDaysAgo?: number
  searchQuery?: string
}

export function makeEntry(spec: EntrySpec = {}): ListenEntry {
  const provider = spec.provider ?? 'audius'
  const providerItemId = spec.id ?? 'trk1'
  const lastPlayedAt = NOW - (spec.daysAgo ?? 0) * DAY
  const playCount = spec.playCount ?? 1
  const qualified = spec.qualified ?? playCount > 0

  const entry: ListenEntry = {
    id: `${provider}:${providerItemId}`,
    provider,
    mediaKind: provider === 'youtube' ? 'youtube-video' : 'audio',
    providerItemId,
    title: spec.title ?? 'Midnight Signal',
    artist: spec.artist ?? 'Nova Sound',
    context: 'trending',
    startedAt: lastPlayedAt - 60_000,
    qualifiedAt: qualified ? lastPlayedAt : null,
    lastPlayedAt,
    playedSeconds: 60 * Math.max(playCount, 1),
    completionRatio: spec.completionRatio ?? 0.5,
    playCount,
    skipCount: spec.skipCount ?? 0,
    playedDays: spec.playedDays ?? [],
    storedAt: NOW - (spec.storedDaysAgo ?? spec.daysAgo ?? 0) * DAY,
    durationSeconds: spec.durationSeconds ?? 214,
  }

  if (spec.artistId) entry.artistId = spec.artistId
  if (spec.searchQuery) entry.searchQuery = spec.searchQuery

  if (provider === 'youtube') {
    entry.thumbnailUrl = `https://i.ytimg.com/vi/${providerItemId}/maxresdefault.jpg`
    entry.sourceUrl = `https://www.youtube.com/watch?v=${providerItemId}`
    entry.embeddable = spec.embeddable ?? true
    entry.madeForKids = spec.madeForKids === undefined ? false : spec.madeForKids
  } else {
    entry.artworkUrl = 'https://cn1.example.audius/content/art/480x480.jpg'
    entry.genre = spec.genre ?? 'House'
    entry.sourceUrl = `https://audius.co/nova/${providerItemId}`
  }

  return entry
}

export interface SearchSpec {
  query: string
  daysAgo?: number
  submitCount?: number
  resultWasPlayed?: boolean
  script?: SearchEntry['script']
  providers?: MediaProviderId[]
}

export function makeSearch(spec: SearchSpec): SearchEntry {
  return {
    query: spec.query,
    normalizedQuery: spec.query.toLowerCase(),
    submittedAt: NOW - (spec.daysAgo ?? 0) * DAY,
    providers: spec.providers ?? ['audius'],
    resultWasPlayed: spec.resultWasPlayed ?? false,
    submitCount: spec.submitCount ?? 1,
    script: spec.script ?? 'latin',
  }
}

export function makeState(overrides: Partial<PersonalizationState> = {}): PersonalizationState {
  return {
    version: PERSONALIZATION_VERSION,
    consent: 'granted',
    consentUpdatedAt: NOW - DAY,
    listeningHistory: [],
    searchHistory: [],
    preferences: { promptSeen: true },
    dismissedItems: [],
    updatedAt: NOW,
    ...overrides,
  }
}

export function makePlayedItem(overrides: Partial<PlayedItem> = {}): PlayedItem {
  return {
    provider: 'audius',
    providerItemId: 'trk1',
    title: 'Midnight Signal',
    artist: 'Nova Sound',
    durationSeconds: 240,
    context: 'trending',
    ...overrides,
  }
}

export function makeSession(overrides: Partial<PlaySession> = {}): PlaySession {
  const item = overrides.item ?? makePlayedItem()
  const playedSeconds = overrides.playedSeconds ?? 60
  return {
    item,
    playedSeconds,
    creditedSeconds: 0,
    reachedSeconds: playedSeconds,
    startedAt: NOW - playedSeconds * 1000,
    endedAt: NOW,
    completed: false,
    ...overrides,
  }
}

/**
 * Writes state straight to `localStorage`, the way a returning visitor's browser
 * would already have it. Used by "restored after reload" tests.
 */
export function seedStorage(state: PersonalizationState): void {
  localStorage.setItem(
    PERSONALIZATION_STORAGE_KEY,
    JSON.stringify({
      version: state.version,
      consent: state.consent,
      consentUpdatedAt: state.consentUpdatedAt,
      updatedAt: state.updatedAt,
      preferences: state.preferences,
      dismissedItems: state.dismissedItems,
      listeningHistory: state.listeningHistory,
      searchHistory: state.searchHistory,
    }),
  )
}

/** A storage double that throws on write, as a full quota or private mode does. */
export function failingStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key)
    },
    setItem: () => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    },
  }
}

/** An in-memory storage double that behaves normally. */
export function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key)
    },
    setItem: (key, value) => {
      store.set(key, String(value))
    },
  }
}
