import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useUiStore } from '@/app/ui-store'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { MAX_QUERY_LENGTH, normalizeQuery } from '@/music/audius/adapter'
import { playHistoryEntry } from '@/personalization/replay'
import { useSearchSuggestions } from '@/features/search/useSearchSuggestions'
import { usePersonalizationStore } from '@/personalization/store'
import type { SearchEntry } from '@/personalization/types'
import { SearchSuggestions } from './SearchSuggestions'
import { SUGGESTION_LIST_ID, flattenRows, suggestionId } from './suggestion-rows'
import type { SuggestionRow } from './suggestion-rows'

/**
 * The reference's `.top-search` control, wired to the `/search?q=` route.
 *
 * Typing updates the URL with `replace` so the back button is not flooded with
 * one entry per keystroke. Blank input returns to `/`.
 *
 * Phase 5 adds a history dropdown beneath it. Two things keep that addition from
 * disturbing anything:
 *
 * · **One submit path.** `submitQuery` is the only function that navigates to a
 *   search, and Enter, a clicked history row and a keyboard-activated row all go
 *   through it. It pushes history, which is exactly the signal
 *   `useSubmittedSearchKey` reads, so a reused query spends YouTube quota under
 *   precisely the same rules as a typed one — no more, no less.
 * · **No network of its own.** The dropdown reads the local personalization
 *   store and filters in memory. Focusing it, arrowing through it, filtering it
 *   and removing a row all cost zero provider requests.
 */
export function SearchBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)

  const urlQuery = location.pathname === '/search' ? (searchParams.get('q') ?? '') : ''
  const [value, setValue] = useState(urlQuery)
  const debounced = useDebouncedValue(value)

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const { searches, played, enabled } = useSearchSuggestions(value)
  const removeSearch = usePersonalizationStore((store) => store.removeSearch)
  const clearSearchHistory = usePersonalizationStore((store) => store.clearSearchHistory)

  const rows = useMemo(() => flattenRows(searches, played), [searches, played])
  // An empty dropdown is worse than none: it covers the page and says nothing.
  const hasSuggestions = enabled && rows.length > 0
  const isOpen = open && hasSuggestions

  const closeDropdown = useCallback(() => {
    setOpen(false)
    setActiveIndex(-1)
  }, [])

  // Keep the field in step with external navigation (Clear, Home, back button,
  // deep link).
  useEffect(() => {
    setValue((current) => (normalizeQuery(current) === normalizeQuery(urlQuery) ? current : urlQuery))
  }, [urlQuery])

  /**
   * Only a change in the *typed* query may navigate.
   *
   * Without this guard the effect also fires when the route changes, and a
   * still-populated field would immediately push the visitor back to
   * `/search?q=…` the moment they clicked Home or Clear.
   */
  const previousDebouncedRef = useRef(debounced)
  useEffect(() => {
    const previous = previousDebouncedRef.current
    previousDebouncedRef.current = debounced
    if (previous === debounced) return

    const query = normalizeQuery(debounced)
    if (query === normalizeQuery(urlQuery)) return

    if (!query) {
      if (location.pathname === '/search') void navigate('/', { replace: true })
      return
    }
    void navigate(`/search?q=${encodeURIComponent(query)}`, { replace: true })
  }, [debounced, location.pathname, navigate, urlQuery])

  /**
   * The one and only way this app starts an explicit search.
   *
   * A real history push, because that is what marks a submission: it is what
   * lets the automatic YouTube fallback fire once, and what makes Back return to
   * the previous search.
   */
  const submitQuery = useCallback(
    (raw: string) => {
      const query = normalizeQuery(raw)
      if (!query) return
      setValue(query)
      closeDropdown()
      void navigate(`/search?q=${encodeURIComponent(query)}`)
    },
    [closeDropdown, navigate],
  )

  const activateRow = useCallback(
    (row: SuggestionRow) => {
      if (row.kind === 'search') {
        submitQuery(row.entry.query)
        return
      }
      // Replay goes through the existing routing — Audius and Jamendo to the
      // audio engine, YouTube to its own player. No logic is duplicated here.
      closeDropdown()
      void playHistoryEntry(row.entry)
    },
    [closeDropdown, submitQuery],
  )

  const handleRemoveSearch = useCallback(
    (entry: SearchEntry) => {
      removeSearch(entry.normalizedQuery)
      // The dropdown stays open and the field keeps focus: removing one row is a
      // correction, not the end of the interaction.
      setActiveIndex(-1)
      inputRef.current?.focus()
    },
    [removeSearch],
  )

  const handleClearSearches = useCallback(() => {
    clearSearchHistory()
    setActiveIndex(-1)
    inputRef.current?.focus()
  }, [clearSearchHistory])

  // The reference renders a decorative "⌘" key cap; make it a real shortcut.
  const focusInput = useCallback(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // The sidebar / mobile drawer "Search" actions hand focus back to this field.
  const focusSearchToken = useUiStore((s) => s.focusSearchToken)
  useEffect(() => {
    if (focusSearchToken === 0) return
    focusInput()
  }, [focusSearchToken, focusInput])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        focusInput()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusInput])

  // A click anywhere else dismisses the dropdown; a click *inside* it does not,
  // which is what lets the remove buttons work.
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (target instanceof Node && shellRef.current?.contains(target)) return
      closeDropdown()
    }
    // Capture phase, deliberately. React handles the event on its root, which is
    // *inside* `document`, so a bubble-phase listener here would run after the
    // row had already re-rendered — and a clicked Clear or Remove button is
    // detached by then, making `contains` report it as an outside click and
    // dismissing the dropdown the visitor was still using.
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('touchstart', onPointerDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('touchstart', onPointerDown, true)
    }
  }, [isOpen, closeDropdown])

  /**
   * Navigating away closes it, including via the back button.
   *
   * Unless the field still has focus, in which case the visitor has not
   * navigated away at all — the route changed underneath them as a side effect
   * of their own typing. Emptying the field to browse history returns to `/`
   * after the debounce, and dismissing the list they had just opened, a third of
   * a second after they opened it, would be baffling.
   */
  useEffect(() => {
    if (document.activeElement === inputRef.current) return
    closeDropdown()
  }, [location.key, closeDropdown])

  // A highlight can outlive the row it pointed at — after a removal, or once
  // typing narrows the list.
  useEffect(() => {
    setActiveIndex((current) => (current >= rows.length ? -1 : current))
  }, [rows.length])

  const activeId = isOpen && activeIndex >= 0 ? suggestionId(activeIndex) : undefined

  return (
    <div className="search-shell" ref={shellRef}>
      <label className="top-search">
        <Search size={22} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          maxLength={MAX_QUERY_LENGTH}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="What do you want to play?"
          aria-label="Search songs and artists"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={SUGGESTION_LIST_ID}
          aria-autocomplete="list"
          {...(activeId ? { 'aria-activedescendant': activeId } : {})}
          onChange={(event) => {
            setValue(event.target.value)
            // Typing restarts the choice: nothing stays highlighted from before.
            setActiveIndex(-1)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && hasSuggestions) {
              event.preventDefault()
              setOpen(true)
              setActiveIndex((current) => (current + 1 >= rows.length ? 0 : current + 1))
              return
            }
            if (event.key === 'ArrowUp' && hasSuggestions) {
              event.preventDefault()
              setOpen(true)
              setActiveIndex((current) => (current <= 0 ? rows.length - 1 : current - 1))
              return
            }
            if (event.key === 'Escape') {
              // While the dropdown is open, Escape dismisses it and leaves the
              // typed text alone; otherwise it keeps its original meaning.
              if (isOpen) {
                event.preventDefault()
                closeDropdown()
                return
              }
              setValue('')
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const highlighted = isOpen && activeIndex >= 0 ? rows[activeIndex] : undefined
              if (highlighted) {
                activateRow(highlighted)
                return
              }
              submitQuery(value)
              return
            }
            // Removal without a mouse. Only meaningful on a highlighted recent
            // search, and only when the field is empty enough that Delete is not
            // the visitor editing their query.
            if (
              (event.key === 'Delete' || event.key === 'Backspace') &&
              isOpen &&
              activeIndex >= 0 &&
              value.length === 0
            ) {
              const row = rows[activeIndex]
              if (row?.kind === 'search') {
                event.preventDefault()
                handleRemoveSearch(row.entry)
              }
            }
          }}
        />
        <span className="search-key" aria-hidden="true">
          ⌘
        </span>
      </label>

      {isOpen ? (
        <SearchSuggestions
          searches={searches}
          played={played}
          activeIndex={activeIndex}
          onActivate={activateRow}
          onRemoveSearch={handleRemoveSearch}
          onClearSearches={handleClearSearches}
          onHighlight={setActiveIndex}
        />
      ) : null}
    </div>
  )
}
