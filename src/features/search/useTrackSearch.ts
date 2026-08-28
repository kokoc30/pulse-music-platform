import { useCallback, useEffect, useRef, useState } from 'react'
import { multiProviderSearch } from '@/music/aggregator'
import type { MultiProviderSearchResult, ProviderOutcome } from '@/music/aggregator'
import { normalizeQuery } from '@/music/audius/adapter'
import type { SearchOutcome } from '@/music/search'
import { MusicError } from '@/music/types'
import { rememberTracks } from '@/player/autoplay'
import type { Artist, MusicErrorCode, Track } from '@/music/types'

export interface TrackSearchState {
  query: string
  status: 'idle' | 'loading' | 'success' | 'error'
  tracks: Track[]
  /**
   * Distinguishes "the catalogue has nothing" from "the catalogue answered but
   * nothing was actually relevant", so the UI can say which is true.
   */
  outcome: SearchOutcome
  /** Set when a confident artist match drove the results. */
  artist: Artist | null
  /**
   * True when Audius or Jamendo returned something the app will stand behind.
   * False means the open catalogues had nothing strong — which is when the
   * prominent YouTube fallback is the honest thing to show.
   */
  hasStrongOpenCatalogMatch: boolean
  /** Per-provider status, so a partial outage stays visible in diagnostics. */
  providers: ProviderOutcome[]
  error: { code: MusicErrorCode; message: string } | null
  retry: () => void
}

/**
 * Runs one relevance-ranked search across every configured provider for an
 * already-debounced query.
 *
 * Stale-request protection is twofold: the in-flight request is aborted, and a
 * monotonic request id gates the state update. A slow `dr` can never overwrite a
 * fast `drake` (agents/06_AUDIUS_INTEGRATION.md). Phase 2 changed only which
 * function is awaited — the abort discipline is unchanged, and it now covers
 * both providers because the aggregator threads the same signal through.
 *
 * Expansion, merging, cross-provider dedupe and ranking live in
 * `@/music/aggregator`; this hook only owns React state and cancellation.
 */
export function useTrackSearch(rawQuery: string): TrackSearchState {
  const query = normalizeQuery(rawQuery)
  const [state, setState] = useState<Omit<TrackSearchState, 'retry'>>({
    query,
    status: query ? 'loading' : 'idle',
    tracks: [],
    outcome: 'empty',
    artist: null,
    hasStrongOpenCatalogMatch: false,
    providers: [],
    error: null,
  })

  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    abortRef.current?.abort()

    if (!query) {
      requestIdRef.current += 1
      abortRef.current = null
      setState({
        query: '',
        status: 'idle',
        tracks: [],
        outcome: 'empty',
        artist: null,
        hasStrongOpenCatalogMatch: false,
        providers: [],
        error: null,
      })
      return
    }

    const requestId = (requestIdRef.current += 1)
    const controller = new AbortController()
    abortRef.current = controller

    setState((previous) => ({ ...previous, query, status: 'loading', error: null }))

    void (async () => {
      try {
        const result: MultiProviderSearchResult = await multiProviderSearch(query, {
          signal: controller.signal,
        })
        if (requestIdRef.current !== requestId) return
        rememberTracks(result.tracks)
        setState({
          query,
          status: 'success',
          tracks: result.tracks,
          outcome: result.outcome,
          artist: result.artist,
          hasStrongOpenCatalogMatch: result.hasStrongOpenCatalogMatch,
          providers: result.providers,
          error: null,
        })
      } catch (error) {
        if (requestIdRef.current !== requestId) return
        if (error instanceof MusicError && error.code === 'ABORTED') return
        const musicError = error instanceof MusicError ? error : null
        setState({
          query,
          status: 'error',
          tracks: [],
          outcome: 'empty',
          artist: null,
          hasStrongOpenCatalogMatch: false,
          providers: [],
          error: {
            code: musicError?.code ?? 'PROVIDER',
            message: musicError?.userMessage ?? 'Search is unavailable right now. Please try again.',
          },
        })
      }
    })()

    return () => controller.abort()
  }, [query, retryToken])

  useEffect(() => () => abortRef.current?.abort(), [])

  const retry = useCallback(() => setRetryToken((token) => token + 1), [])

  return { ...state, retry }
}
