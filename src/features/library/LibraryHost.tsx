import { useEffect } from 'react'
import { connectLibraryToPersonalization } from '@/library/bridge'
import { useLibraryStore } from '@/library/store'
import { LIBRARY_PURGE_INTERVAL_MS } from '@/library/youtube-policy'

/**
 * Brings the library to life. Renders nothing.
 *
 * Mounted once, above the router, beside the playback and personalization hosts,
 * for the same reason they are: a like pressed on a search result must still be
 * a like after navigating home, and hydrating per route would re-read IndexedDB
 * on every navigation.
 *
 * Three jobs, in order:
 *
 * 1. **Hydrate**, asynchronously. Until it resolves the store holds an empty
 *    library, so the first paint shows unfilled hearts and then fills them —
 *    which is correct rather than merely tolerable: an unknown state must not
 *    render as "liked".
 * 2. **Purge expired YouTube metadata**, at start-up inside `hydrate` and every
 *    six hours after, so a tab left open for a month cannot surface a saved item
 *    past its 30-day retention window (agents/44).
 * 3. **Connect explicit intent to the profile**, so a like changes what the home
 *    page recommends — where, and only where, personalization consent allows it.
 */
export function LibraryHost(): null {
  useEffect(() => {
    void useLibraryStore.getState().hydrate()
  }, [])

  useEffect(() => connectLibraryToPersonalization(), [])

  useEffect(() => {
    const timer = setInterval(
      () => useLibraryStore.getState().purgeExpired(),
      LIBRARY_PURGE_INTERVAL_MS,
    )
    return () => clearInterval(timer)
  }, [])

  return null
}
