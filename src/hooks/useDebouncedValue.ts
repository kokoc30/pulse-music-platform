import { useEffect, useState } from 'react'

/**
 * Debounce for the search field. The reference filters synchronously; production
 * must not fire an Audius request per keystroke (agents/06_AUDIUS_INTEGRATION.md
 * recommends ~250-350 ms).
 */
export const SEARCH_DEBOUNCE_MS = 300

export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    if (Object.is(value, debounced)) return
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
    // `debounced` is a dependency only so the linter can verify the closure;
    // the early return above stops it from restarting the timer.
  }, [value, delayMs, debounced])

  return debounced
}
