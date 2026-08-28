import { NavigationType, useLocation, useNavigationType } from 'react-router-dom'

/**
 * Identity of an **explicit search submission**, or `null` when the current
 * query arrived some other way.
 *
 * The distinction this has to draw is between *the query text changing* and
 * *the visitor asking for that query to be searched*. The application already
 * encodes it, and has since Phase 1 — `SearchBar` navigates two different ways
 * on purpose:
 *
 * · **debounced typing** → `navigate(url, { replace: true })`, so the back
 *   button is not flooded with one entry per keystroke;
 * · **pressing Enter** → `navigate(url)`, a real history push.
 *
 * Every other way to start a search in this app is also a push: the footer's
 * genre links, the station cards, and the "Search for <artist>" action on an
 * artist card are all `<Link>`s or programmatic pushes.
 *
 * So `PUSH` *is* the explicit-submission signal, and nothing new had to be
 * invented to detect it. Reading it here rather than threading a flag through
 * the router means every one of those entry points is covered automatically.
 *
 * **What is deliberately excluded:**
 *
 * · `REPLACE` — search-as-you-type. This is the whole quota guarantee: a
 *   visitor typing `sara al sawas` settles the debounce several times on the
 *   way (`sara`, `sara al`, …) and each of those is a completed
 *   Audius + Jamendo search. Auto-running YouTube on them would spend several
 *   of the day's 100 searches on one person typing one phrase.
 * · `POP` — a deep link, a page refresh, or the back button. A refresh loop
 *   would otherwise spend a search every time, and the per-tab cache is empty
 *   after a reload. These keep the manual button, which is exactly the
 *   behaviour they had before.
 *
 * The value is `location.key`, which is unique per history entry. That makes it
 * a stable identity for one submission — it does not change across re-renders,
 * so it can be used to make the automatic call idempotent — while pressing
 * Enter twice produces two distinct keys, and the second is absorbed by the
 * client's exact-query session cache at zero quota cost.
 */
export function useSubmittedSearchKey(): string | null {
  const navigationType = useNavigationType()
  const location = useLocation()
  return navigationType === NavigationType.Push ? location.key : null
}
