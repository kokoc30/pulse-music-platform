import { useCallback, useEffect, useRef, useState } from 'react'
import { getMusicProvider } from '@/music/provider'
import { rememberTracks } from '@/player/autoplay'
import { MusicError } from '@/music/types'
import type { Artist, Track } from '@/music/types'
import { SHELF_QUEUE_SIZE, STATION_SHELF } from './shelves'

export interface DiscoveryData {
  trending: Track[]
  month: Track[]
  artists: Artist[]
  stations: Record<string, Track[]>
}

export type DiscoveryStatus = 'loading' | 'success' | 'partial' | 'error'

export interface DiscoveryState extends DiscoveryData {
  status: DiscoveryStatus
  /** Shelf id → user-safe message, so one failed shelf cannot blank the page. */
  errors: Record<string, string>
  reload: () => void
}

interface DiscoveryResult {
  data: DiscoveryData
  errors: Record<string, string>
}

const EMPTY: DiscoveryData = { trending: [], month: [], artists: [], stations: {} }

/**
 * Session cache shared by every consumer (the header, the banner and the home
 * page all read it). The homepage must not refetch on every mount
 * (agents/06_AUDIUS_INTEGRATION.md → "Rate Limits / Request Discipline").
 *
 * The shared load is deliberately *not* tied to any single component's
 * AbortController: one unmount — including React StrictMode's double-invoked
 * effect in development — must not cancel the fetch every other subscriber is
 * waiting on. Subscribers instead ignore results that arrive after unmount.
 */
let cache: DiscoveryResult | null = null
let inFlight: Promise<DiscoveryResult> | null = null
const subscribers = new Set<(result: DiscoveryResult) => void>()

export function clearDiscoveryCache(): void {
  cache = null
  inFlight = null
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof MusicError ? error.userMessage : fallback
}

async function loadDiscovery(): Promise<DiscoveryResult> {
  const provider = getMusicProvider()
  const errors: Record<string, string> = {}

  const [trending, month, artists, ...stationResults] = await Promise.all([
    provider.getTrendingTracks({ limit: SHELF_QUEUE_SIZE }).catch((error: unknown) => {
      errors.trending = safeMessage(error, 'Trending songs are unavailable right now.')
      return [] as Track[]
    }),
    provider
      .getTrendingTracks({ limit: SHELF_QUEUE_SIZE, time: 'month' })
      .catch((error: unknown) => {
        errors.month = safeMessage(error, 'This month’s tracks are unavailable right now.')
        return [] as Track[]
      }),
    provider.getTopArtists({ limit: 4 }).catch((error: unknown) => {
      errors.artists = safeMessage(error, 'Popular artists are unavailable right now.')
      return [] as Artist[]
    }),
    ...STATION_SHELF.map((station) =>
      provider
        .getTrendingTracks({ limit: SHELF_QUEUE_SIZE, genre: station.genre })
        .catch((error: unknown) => {
          errors[`station:${station.id}`] = safeMessage(
            error,
            `${station.label} is unavailable right now.`,
          )
          return [] as Track[]
        }),
    ),
  ])

  const stations: Record<string, Track[]> = {}
  STATION_SHELF.forEach((station, position) => {
    stations[station.id] = stationResults[position] ?? []
  })

  // Autoplay ranks tracks the session already holds rather than fanning out
  // provider requests of its own, so every shelf load quietly widens its pool.
  rememberTracks([trending, month, ...Object.values(stations)].flat())

  return { data: { trending, month, artists, stations }, errors }
}

function statusFor(result: DiscoveryResult): DiscoveryStatus {
  const failures = Object.keys(result.errors).length
  if (!failures) return 'success'
  const nothingLoaded =
    !result.data.trending.length &&
    !result.data.month.length &&
    !result.data.artists.length &&
    Object.values(result.data.stations).every((tracks) => !tracks.length)
  return nothingLoaded ? 'error' : 'partial'
}

function ensureLoaded(): Promise<DiscoveryResult> {
  if (cache) return Promise.resolve(cache)
  inFlight ??= loadDiscovery()
    .then((result) => {
      cache = result
      inFlight = null
      for (const notify of subscribers) notify(result)
      return result
    })
    .catch((error: unknown) => {
      inFlight = null
      const result: DiscoveryResult = {
        data: EMPTY,
        errors: { all: safeMessage(error, 'Discovery is unavailable right now.') },
      }
      cache = result
      for (const notify of subscribers) notify(result)
      return result
    })
  return inFlight
}

export function useDiscovery(): DiscoveryState {
  const [snapshot, setSnapshot] = useState<{
    data: DiscoveryData
    errors: Record<string, string>
    status: DiscoveryStatus
  }>(() =>
    cache
      ? { data: cache.data, errors: cache.errors, status: statusFor(cache) }
      : { data: EMPTY, errors: {}, status: 'loading' },
  )

  const [reloadToken, setReloadToken] = useState(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const notify = (result: DiscoveryResult) => {
      if (!mountedRef.current) return
      setSnapshot({ data: result.data, errors: result.errors, status: statusFor(result) })
    }
    subscribers.add(notify)

    if (!cache) setSnapshot((previous) => ({ ...previous, status: 'loading' }))
    void ensureLoaded().then(notify)

    return () => {
      mountedRef.current = false
      subscribers.delete(notify)
    }
  }, [reloadToken])

  const reload = useCallback(() => {
    clearDiscoveryCache()
    setReloadToken((token) => token + 1)
  }, [])

  return { ...snapshot.data, status: snapshot.status, errors: snapshot.errors, reload }
}
