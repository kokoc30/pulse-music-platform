import type { ListenEntry, SearchEntry } from '@/personalization/types'

/**
 * The dropdown's row model, kept beside the component rather than inside it so
 * `SearchBar` can walk the same flattened list the listbox renders. One index
 * addresses one row, which is what makes arrow-key navigation a single number
 * rather than a section/row pair that could drift out of step with the markup.
 */

export const SUGGESTION_LIST_ID = 'search-suggestions'

/** Stable per-row DOM id, so `aria-activedescendant` can address it. */
export function suggestionId(index: number): string {
  return `search-suggestion-${index}`
}

/** One activatable row. */
export type SuggestionRow =
  | { kind: 'search'; entry: SearchEntry }
  | { kind: 'played'; entry: ListenEntry }

/** The order the keyboard walks: recent searches, then recently played. */
export function flattenRows(searches: SearchEntry[], played: ListenEntry[]): SuggestionRow[] {
  return [
    ...searches.map((entry): SuggestionRow => ({ kind: 'search', entry })),
    ...played.map((entry): SuggestionRow => ({ kind: 'played', entry })),
  ]
}
