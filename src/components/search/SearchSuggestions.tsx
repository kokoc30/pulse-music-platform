import { History, X } from 'lucide-react'
import { Artwork } from '@/components/track/Artwork'
import { YouTubeThumbnail } from '@/components/youtube/YouTubeThumbnail'
import { providerLabel } from '@/music/provider-labels'
import { historyArtwork } from '@/personalization/artwork'
import { toYouTubeItem } from '@/personalization/replay'
import { SUGGESTION_LIST_ID, suggestionId } from './suggestion-rows'
import type { SuggestionRow } from './suggestion-rows'
import type { ListenEntry, SearchEntry } from '@/personalization/types'

/**
 * The search dropdown's list.
 *
 * Presentational only: it renders what it is given and reports what was
 * activated. Every decision — what to show, what happens on activation, where
 * the data came from — belongs to `SearchBar`, so the two cannot disagree about
 * which row is highlighted.
 *
 * The pattern is the standard combobox/listbox one. The input owns the focus and
 * `aria-activedescendant`; the rows are `role="option"` and are never focused
 * themselves, which is what lets the visitor keep typing while arrowing through
 * history.
 *
 * The remove control sits inside its option. That is a deliberate, and
 * deliberately mitigated, compromise: a screen reader in browse mode may not
 * reach a button nested in an option, so removal is *also* bound to Delete and
 * Backspace on the highlighted row, and each option carries an explicit
 * `aria-label` so its accessible name stays the query alone.
 */

export interface SearchSuggestionsProps {
  searches: SearchEntry[]
  played: ListenEntry[]
  /** Index into the flattened row list, or -1 when nothing is highlighted. */
  activeIndex: number
  onActivate: (row: SuggestionRow) => void
  onRemoveSearch: (entry: SearchEntry) => void
  onClearSearches: () => void
  onHighlight: (index: number) => void
}

export function SearchSuggestions({
  searches,
  played,
  activeIndex,
  onActivate,
  onRemoveSearch,
  onClearSearches,
  onHighlight,
}: SearchSuggestionsProps) {
  return (
    <div className="search-suggestions" data-testid="search-suggestions">
      {searches.length > 0 ? (
        <div className="suggestion-group-head">
          <span id="suggestion-heading-recent">Recent searches</span>
          <button
            type="button"
            className="suggestion-clear"
            // `onMouseDown` rather than `onClick`: the input's blur would
            // otherwise close the dropdown before the click landed.
            onMouseDown={(event) => {
              event.preventDefault()
              onClearSearches()
            }}
          >
            Clear
          </button>
        </div>
      ) : null}

      <ul
        className="suggestion-list"
        id={SUGGESTION_LIST_ID}
        role="listbox"
        aria-label="Recent searches and recently played"
      >
        {searches.map((entry, index) => (
          <li
            key={`search:${entry.normalizedQuery}`}
            id={suggestionId(index)}
            role="option"
            aria-selected={activeIndex === index}
            aria-label={`Search again for ${entry.query}`}
            className="suggestion-row"
            data-active={activeIndex === index ? 'true' : 'false'}
            onMouseDown={(event) => {
              event.preventDefault()
              onActivate({ kind: 'search', entry })
            }}
            onMouseEnter={() => onHighlight(index)}
          >
            <History size={15} aria-hidden="true" className="suggestion-icon" />
            {/* The stored query, rendered exactly as it was typed — never
                transliterated, never case-folded for display. */}
            <span className="suggestion-text" title={entry.query}>
              {entry.query}
            </span>
            <button
              type="button"
              className="suggestion-remove"
              aria-label={`Remove “${entry.query}” from recent searches`}
              onMouseDown={(event) => {
                // Stop the row's own handler: removing must never search.
                event.preventDefault()
                event.stopPropagation()
                onRemoveSearch(entry)
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}

        {played.length > 0 ? (
          <li className="suggestion-group-head suggestion-group-head-played" role="presentation">
            <span>Recently played</span>
          </li>
        ) : null}

        {played.map((entry, position) => {
          const index = searches.length + position
          const youtubeItem = entry.provider === 'youtube' ? toYouTubeItem(entry) : null
          const label = entry.provider === 'youtube' ? 'YouTube' : providerLabel(entry.provider === 'jamendo' ? 'jamendo' : 'audius')
          return (
            <li
              key={`played:${entry.id}`}
              id={suggestionId(index)}
              role="option"
              aria-selected={activeIndex === index}
              aria-label={`Play ${entry.title} by ${entry.artist} from ${label}`}
              className="suggestion-row suggestion-row-media"
              data-active={activeIndex === index ? 'true' : 'false'}
              onMouseDown={(event) => {
                event.preventDefault()
                onActivate({ kind: 'played', entry })
              }}
              onMouseEnter={() => onHighlight(index)}
            >
              <span className={youtubeItem ? 'suggestion-art suggestion-art-video' : 'suggestion-art'}>
                {youtubeItem ? (
                  <YouTubeThumbnail item={youtubeItem} width="fill" />
                ) : (
                  // The same resolver the home shelf uses, so a dead content
                  // node fails over here too rather than blanking.
                  <Artwork artwork={historyArtwork(entry)} size="small" />
                )}
              </span>
              <span className="suggestion-media-text">
                <b title={entry.title}>{entry.title}</b>
                <small title={entry.artist}>
                  {entry.artist}
                  <span className="suggestion-provider"> · {label}</span>
                </small>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
