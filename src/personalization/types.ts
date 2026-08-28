import type { Script } from '@/music/search/text'
import type { MediaProviderId } from '@/music/types'

/**
 * The persisted personalization model.
 *
 * Everything here lives in this browser's `localStorage` and nowhere else. There
 * is no account, no server profile and no sync, so the whole model is scoped to
 * one device by construction rather than by policy.
 *
 * Two rules shape every field below:
 *
 * 1. **Content signals, never identity claims.** The model records *what was
 *    interacted with* — an artist, a tag, the script a query was typed in — and
 *    never an inferred attribute of the person doing the interacting. A
 *    `scriptWeights.arabic` of 0.47 means "Arabic-script text keeps coming up in
 *    this browser's own searches and listening"; it does not mean anything about
 *    who is holding the device, and no surface is allowed to phrase it as though
 *    it did.
 * 2. **Minimum necessary data.** Nothing is persisted because it happened to be
 *    in a provider response. Every persisted field is written by an explicit
 *    allow-list in `storage.ts`, so a widened provider payload can never widen
 *    what is stored.
 */

/** Storage schema version. Bumping it requires a migration in `migrations.ts`. */
export const PERSONALIZATION_VERSION = 1

/** Single namespace. Nothing else in the app may write under this key. */
export const PERSONALIZATION_STORAGE_KEY = 'pulse.personalization.v1'

/**
 * Whether this browser has opted into local personalization.
 *
 * `unset` is not a soft yes. Until the visitor answers, nothing is recorded —
 * the app behaves exactly as it did before Phase 4.
 */
export type ConsentChoice = 'unset' | 'granted' | 'denied'

/** Where a listen was started from. Used to explain recommendations, not to rank. */
export type ListenContext =
  | 'search'
  | 'recommendation'
  | 'recent'
  | 'trending'
  | 'queue'
  | 'artist'
  | 'other'

export const LISTEN_CONTEXTS: readonly ListenContext[] = [
  'search',
  'recommendation',
  'recent',
  'trending',
  'queue',
  'artist',
  'other',
]

/**
 * One media item this browser has played, aggregated across every play of it.
 *
 * Deduplicated on `id` (`provider:providerItemId`), so replaying a track updates
 * counters rather than appending a row. Two different provider items are never
 * merged on title similarity — a listener may legitimately keep both a Jamendo
 * cover and the Audius original (STEP 22).
 */
export interface ListenEntry {
  /** `${provider}:${providerItemId}` — stable, local, and provider-scoped. */
  id: string
  provider: MediaProviderId
  mediaKind: 'audio' | 'youtube-video'
  providerItemId: string
  title: string
  /** Artist for a catalogue track; channel title for a YouTube video. */
  artist: string
  /** Provider artist id, when the provider supplied one. Enables "more from". */
  artistId?: string
  /** Square cover art. Catalogue tracks only. */
  artworkUrl?: string
  /**
   * Alternate content-node origins for the same image path.
   *
   * Not an optimisation — a correctness requirement. Audius serves artwork from
   * many community-run content nodes and an individual node is regularly
   * unreachable, TLS-broken, or returning an HTML error page (which Chrome then
   * blocks as ORB). Every other card in the app survives that by failing over
   * through `Artwork.mirrors`; a history row that kept only one URL had nothing
   * to fail over to and fell straight to the blank placeholder.
   *
   * Storing the origins keeps a history card's candidate list identical to the
   * card it was created from. They are image hosts and nothing else — the same
   * class of data as `artworkUrl` itself.
   */
  artworkMirrors?: string[]
  /** YouTube's own 16:9 thumbnail, unmodified. YouTube entries only. */
  thumbnailUrl?: string
  durationSeconds?: number
  /** Provider tag/genre, only when the provider supplied one. */
  genre?: string
  /** The provider's own page. Required for Jamendo and YouTube attribution. */
  sourceUrl?: string
  /** True when YouTube reported the video as embeddable. YouTube entries only. */
  embeddable?: boolean
  /** YouTube `status.madeForKids`. `null` means YouTube did not report it. */
  madeForKids?: boolean | null
  /** The submitted query this item was discovered through, when known. */
  searchQuery?: string
  context: ListenContext
  /** First time this item was ever started, in epoch milliseconds. */
  startedAt: number
  /** When this item first became a *qualified* listen, or `null` if never. */
  qualifiedAt: number | null
  /**
   * When the last *meaningful* session for this item ended.
   *
   * This is the **signal** timestamp: retention and recency decay both read it,
   * so it may only move when something worth recording actually happened. It is
   * deliberately not touched by merely pressing play.
   */
  lastPlayedAt: number
  /**
   * When playback of this item last *started*.
   *
   * This is the **display** timestamp, and it exists because the two questions
   * are genuinely different. "Show me what I have been playing" should answer
   * immediately when a listener returns to a track; "how much should this train
   * my recommendations" must not answer until the listen qualifies. Keeping them
   * in one field would force a choice between a stale shelf and a profile that
   * could be trained by clicking play repeatedly for a second at a time.
   *
   * Only ever set for an item **already in history** — a brand-new track still
   * has to earn its row by qualifying. Absent on rows written before this field
   * existed, which is why every reader falls back to `lastPlayedAt`.
   */
  lastStartedAt?: number
  /** Total seconds actually heard across every play. Monotonic, seek-proof. */
  playedSeconds: number
  /** Best completion ratio observed on any single play, 0–1. */
  completionRatio: number
  /** Number of *qualified* plays. A click that never qualified leaves this 0. */
  playCount: number
  /** Plays abandoned inside the early-skip window. */
  skipCount: number
  /** Distinct local calendar days (`YYYY-MM-DD`) this item was played on. */
  playedDays: string[]
  /**
   * When this row was last written. For YouTube this is the retention anchor:
   * the entry is deleted once it is older than the policy limit, wherever it is
   * read from (`youtube-retention.ts`).
   */
  storedAt: number
}

/**
 * One explicitly submitted search. Typing is never recorded — only a real
 * submission (Enter, a genre link, an artist card) reaches this.
 */
export interface SearchEntry {
  /** Exactly what the visitor typed, script and case preserved. */
  query: string
  /** Comparison form, used for dedupe and token weighting. */
  normalizedQuery: string
  submittedAt: number
  /** Which catalogues returned something for it. Never used to rank YouTube. */
  providers: MediaProviderId[]
  /** True once a result from this search was actually played. */
  resultWasPlayed: boolean
  /** Times this same normalized query has been submitted. */
  submitCount: number
  script: Script
}

/** Non-sensitive UI preferences that survive a recommendations reset. */
export interface StoredPreferences {
  /** Whether the visitor has seen and answered the personalization prompt. */
  promptSeen: boolean
}

export interface PersonalizationState {
  version: number
  consent: ConsentChoice
  consentUpdatedAt: number | null
  listeningHistory: ListenEntry[]
  searchHistory: SearchEntry[]
  preferences: StoredPreferences
  /** Ids the visitor has dismissed from recommendation shelves. */
  dismissedItems: string[]
  updatedAt: number
}

export function createEmptyState(now = Date.now()): PersonalizationState {
  return {
    version: PERSONALIZATION_VERSION,
    consent: 'unset',
    consentUpdatedAt: null,
    listeningHistory: [],
    searchHistory: [],
    preferences: { promptSeen: false },
    dismissedItems: [],
    updatedAt: now,
  }
}

/** How the last storage read went. Surfaced so the UI can degrade honestly. */
export type StorageStatus =
  /** Read and parsed cleanly (including "there was nothing there yet"). */
  | 'ok'
  /** Something was malformed and was dropped; the rest was kept. */
  | 'recovered'
  /** A version this build does not understand. Left untouched, not reinterpreted. */
  | 'incompatible'
  /** No usable storage: private mode, disabled cookies, quota exhausted. */
  | 'unavailable'
