import type { ProviderId } from '@/music/types'

/**
 * The seam through which explicit library intent reaches the preference profile.
 *
 * **Why a registered source rather than an import.** The library needs the
 * player, the providers and the personalization types; the profile needs to know
 * what was liked and playlisted. Importing one store from the other would tie
 * them together permanently and make the cycle real. Instead the library
 * *registers* a reader here at start-up, and the profile calls it only while
 * personalization is enabled. The dependency points one way — library →
 * personalization — and the profile keeps working with nothing registered at
 * all, which is exactly what a test, a cold start and a consent refusal all look
 * like.
 *
 * **One item per saved track, never one per membership.** An `ExplicitItem`
 * carries two booleans, not two counters. A track sitting in five playlists
 * produces one item with `inPlaylist: true`, so "five playlists must not
 * multiply the signal" is a property of the data structure rather than a rule
 * the scorer has to remember (agents/43 → "No double-count explosions").
 *
 * **Catalogue only.** `provider` is `ProviderId`, which cannot be `'youtube'`.
 * A YouTube save can therefore not be expressed as an explicit signal at all,
 * which is how YouTube API metadata stays out of every derived preference score
 * (agents/44 → "YouTube recommendation exclusion").
 */

export interface ExplicitItem {
  /** `provider:providerItemId`. */
  key: string
  provider: ProviderId
  title: string
  artist: string
  artistId?: string
  genre?: string
  /** In Liked Songs. */
  liked: boolean
  /** In at least one playlist. How many is deliberately not reported. */
  inPlaylist: boolean
  /** When the visitor saved it. Drives a gentle recency effect, nothing more. */
  savedAt: number
}

export interface ExplicitIntent {
  items: ExplicitItem[]
  /** Keys the visitor marked *Not interested*. Excluded, never generalised. */
  hiddenKeys: string[]
}

export const EMPTY_INTENT: ExplicitIntent = { items: [], hiddenKeys: [] }

type IntentSource = () => ExplicitIntent

let source: IntentSource | null = null

/** Registered once at start-up by the library module. */
export function setExplicitIntentSource(next: IntentSource | null): void {
  source = next
}

/**
 * Reads current explicit intent, or nothing.
 *
 * Never throws: a source that fails leaves the profile exactly as it would be
 * without a library, rather than taking the home page down with it.
 */
export function readExplicitIntent(): ExplicitIntent {
  if (!source) return EMPTY_INTENT
  try {
    return source()
  } catch {
    return EMPTY_INTENT
  }
}
