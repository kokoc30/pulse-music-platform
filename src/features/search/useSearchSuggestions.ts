import { useMemo } from 'react'
import {
  filterRecentSearches,
  recentSearches,
  recentlyPlayedSuggestions,
} from '@/personalization/search-suggestions'
import { usePersonalizationStore } from '@/personalization/store'
import type { ListenEntry, SearchEntry } from '@/personalization/types'

export interface SearchSuggestionsState {
  /** Recent submitted searches, filtered by what has been typed so far. */
  searches: SearchEntry[]
  /** Recently played media. Only offered while the field is empty. */
  played: ListenEntry[]
  /** False when personalization is off — then there is nothing to suggest. */
  enabled: boolean
}

/**
 * The dropdown's data, from history the app already keeps.
 *
 * **Consent is the gate, and it is checked here once.** With personalization
 * unset or declined there is no history to read and none is shown; search itself
 * is untouched in every state.
 *
 * **Recently played appears only while the field is empty.** Once someone is
 * typing they are narrowing towards a query, and a list that cannot narrow with
 * them is just noise pushing the matches off screen.
 *
 * Recomputed on `updatedAt` — the store's change token — and on the typed term,
 * so a replay reorders the dropdown immediately while playback ticks cost
 * nothing. Storage is never read here; the store holds the state already.
 */
export function useSearchSuggestions(term: string): SearchSuggestionsState {
  const state = usePersonalizationStore((store) => store.state)
  const enabled = state.consent === 'granted'
  const trimmed = term.trim()

  const searches = useMemo(
    () => (enabled ? filterRecentSearches(recentSearches(state), trimmed) : []),
    // `updatedAt` moves on every meaningful history change and on nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, state.updatedAt, trimmed],
  )

  const played = useMemo(
    () => (enabled && !trimmed ? recentlyPlayedSuggestions(state) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, state.updatedAt, trimmed],
  )

  return { searches, played, enabled }
}
