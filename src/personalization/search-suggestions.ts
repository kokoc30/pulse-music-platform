import { normalizeText } from '@/music/search/text'
import { RECENT_PLAYED_SUGGESTIONS, RECENT_SEARCH_SUGGESTIONS } from './config'
import { recentShelf } from './selectors'
import type { ListenEntry, PersonalizationState, SearchEntry } from './types'

/**
 * What the search dropdown offers, derived from history the app already keeps.
 *
 * There is **no new store and no new persistence** here. This module is a set of
 * pure selectors over the same `searchHistory` and `listeningHistory` the home
 * dashboard reads, which is what makes a replay reorder the dropdown and the
 * home shelf together — they consume one canonical ordering, so they cannot
 * drift apart.
 *
 * Nothing here touches the network. Filtering is in-memory over a list already
 * capped at 50 rows, so it costs nothing to run on every keystroke and there is
 * no suggestion API to call.
 */

/** Recent submitted searches, most recent first, bounded for display. */
export function recentSearches(
  state: PersonalizationState,
  limit = RECENT_SEARCH_SUGGESTIONS,
): SearchEntry[] {
  return [...state.searchHistory]
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .slice(0, Math.max(0, limit))
}

/**
 * Recent searches matching what has been typed so far.
 *
 * Matching uses the project's existing normalization, so it folds case,
 * punctuation and diacritics without transliterating: typing `ara` finds both
 * `Aram Asatryan` and `sara al sawas`, while a Cyrillic query stays reachable
 * only by Cyrillic input. The compact form is checked too, so `alswas` still
 * finds `sara al sawas`.
 *
 * An empty term returns the unfiltered list — the dropdown's resting state.
 */
export function filterRecentSearches(
  entries: readonly SearchEntry[],
  term: string,
  limit = RECENT_SEARCH_SUGGESTIONS,
): SearchEntry[] {
  const typed = normalizeText(term)
  const needle = typed.folded || typed.normalized
  if (!needle) return entries.slice(0, Math.max(0, limit))

  const compactNeedle = typed.compact

  return entries
    .filter((entry) => {
      const candidate = normalizeText(entry.query)
      return (
        candidate.folded.includes(needle) ||
        candidate.normalized.includes(needle) ||
        (compactNeedle.length > 0 && candidate.compact.includes(compactNeedle))
      )
    })
    .slice(0, Math.max(0, limit))
}

/**
 * Recently played media for the dropdown.
 *
 * Delegates to `recentShelf` — the *same* selector the home page renders — and
 * differs only in how many rows it takes. That is deliberate and load-bearing:
 * the shelf is where the ordering, the YouTube retention purge and the
 * embeddable / made-for-kids eligibility rules live, and a second implementation
 * here would sooner or later offer a video the home page correctly refuses to.
 */
export function recentlyPlayedSuggestions(
  state: PersonalizationState,
  now = Date.now(),
  limit = RECENT_PLAYED_SUGGESTIONS,
): ListenEntry[] {
  return recentShelf(state, now, Math.max(0, limit))
}
