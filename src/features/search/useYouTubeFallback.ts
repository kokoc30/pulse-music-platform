import { useCallback, useEffect, useRef, useState } from 'react'
import { searchYouTubeVideos } from '@/music/youtube'
import type { YouTubeStatus } from '@/music/youtube'
import { MusicError } from '@/music/types'
import type { YouTubeVideoItem } from '@/music/types'

/**
 * The YouTube fallback.
 *
 * **Nothing here fires on `query`.** A query that merely *changed* — someone
 * typing — never triggers a request, and that is the quota guarantee: the whole
 * deployment shares 100 YouTube searches a day
 * (docs/youtube-policy-audit.md §1), so a hook that searched on every settled
 * keystroke would spend the daily allowance on one visitor typing one phrase.
 * The only automatic behaviour on `query` is the opposite one: changing it
 * *discards* the previous videos, so a stale list can never appear under a new
 * search.
 *
 * There are exactly two ways a request can start:
 *
 * 1. `run()` — the manual control, reached from a click handler;
 * 2. an **explicit submission** that produced no strong open-catalog match, via
 *    `submissionKey` + `autoRunWhen`.
 *
 * The second is gated on `submissionKey`, which is `null` for typing and for
 * deep links (see `useSubmittedSearchKey`), and is made idempotent by
 * `autoRanRef`: React re-renders, effect re-runs and StrictMode's deliberate
 * double-invocation all resolve to the same key and are skipped. A duplicate
 * that somehow got past it would still cost nothing, because the client's
 * exact-query session cache answers it with `requests: 0`.
 */

export interface YouTubeFallbackState {
  /** The query the current results belong to. */
  query: string
  status: 'idle' | 'loading' | 'success' | 'unavailable' | 'quota' | 'error'
  videos: YouTubeVideoItem[]
  /** Requests spent this session. Asserted by the quota-discipline tests. */
  requestCount: number
  /** True when this query's search was started automatically, not by a click. */
  autoRan: boolean
  /** The manual control. */
  run: () => void
  reset: () => void
}

export interface YouTubeFallbackOptions {
  /**
   * Identity of an explicit search submission, or `null` when the current query
   * arrived by typing, a deep link or the back button. Stable across re-renders
   * for one submission — see `useSubmittedSearchKey`.
   */
  submissionKey?: string | null
  /**
   * True once Audius and Jamendo have **settled** with no strong match. Only
   * then may the submission spend a YouTube search.
   */
  autoRunWhen?: boolean
}

export function useYouTubeFallback(
  query: string,
  options: YouTubeFallbackOptions = {},
): YouTubeFallbackState {
  const { submissionKey = null, autoRunWhen = false } = options
  const [state, setState] = useState<{
    query: string
    status: YouTubeFallbackState['status']
    videos: YouTubeVideoItem[]
  }>({ query, status: 'idle', videos: [] })
  const [requestCount, setRequestCount] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const queryRef = useRef(query)
  queryRef.current = query

  // Changing the query throws the old videos away. It does *not* fetch.
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    requestIdRef.current += 1
    setState({ query, status: 'idle', videos: [] })
  }, [query])

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = useCallback(() => {
    const current = queryRef.current.trim()
    if (!current) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const requestId = (requestIdRef.current += 1)

    setState((previous) => ({ ...previous, query: current, status: 'loading' }))

    void (async () => {
      try {
        const result = await searchYouTubeVideos(current, { signal: controller.signal })
        if (requestIdRef.current !== requestId) return
        // A cache hit reports 0 requests, which is what makes "pressing the
        // button twice for the same query costs one search" testable.
        if (result.requests > 0) setRequestCount((count) => count + result.requests)
        setState({
          query: current,
          status: mapStatus(result.status),
          videos: result.videos,
        })
      } catch (error) {
        if (requestIdRef.current !== requestId) return
        if (error instanceof MusicError && error.code === 'ABORTED') return
        setState({ query: current, status: 'error', videos: [] })
      }
    })()
  }, [])

  /**
   * One submission, one automatic search.
   *
   * The ref — not a piece of state — is what makes this idempotent. It survives
   * every re-render and every StrictMode double-invocation of this effect, so
   * the same `(submission, query)` pair can only ever get past it once. It is
   * never reset on success or failure either, which is what stops an automatic
   * retry loop after a YouTube error.
   */
  const autoRanRef = useRef<string | null>(null)
  const [autoRan, setAutoRan] = useState(false)

  useEffect(() => {
    if (!autoRunWhen || !submissionKey) return
    const trimmed = query.trim()
    if (!trimmed) return

    const key = `${submissionKey}\u0000${trimmed}`
    if (autoRanRef.current === key) return
    autoRanRef.current = key

    setAutoRan(true)
    run()
  }, [autoRunWhen, submissionKey, query, run])

  // A new query starts a new story: it may be auto-searched on its own merits.
  useEffect(() => setAutoRan(false), [query])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    requestIdRef.current += 1
    setState({ query: queryRef.current, status: 'idle', videos: [] })
  }, [])

  return { ...state, requestCount, autoRan, run, reset }
}

function mapStatus(status: YouTubeStatus): YouTubeFallbackState['status'] {
  switch (status) {
    case 'success':
      return 'success'
    case 'unavailable':
      return 'unavailable'
    case 'quota':
      return 'quota'
    default:
      return 'error'
  }
}
