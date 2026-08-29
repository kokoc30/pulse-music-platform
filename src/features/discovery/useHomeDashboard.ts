import { useEffect, useMemo, useRef, useState } from 'react'
import { getMusicProvider } from '@/music/provider'
import type { Track } from '@/music/types'
import { MAX_AFFINITY_LOOKUPS, RECENT_SHELF_SIZE, SHELF_SIZE } from '@/personalization/config'
import { artistKey, seedArtist } from '@/personalization/profile'
import type { ArtistAffinity, PersonalizationProfile } from '@/personalization/profile'
import { buildRecommendations, tracksByArtists } from '@/personalization/recommendations'
import type { ScoredTrack } from '@/personalization/recommendations'
import { planHomeSections, recentShelf } from '@/personalization/selectors'
import type { HomeSectionId } from '@/personalization/selectors'
import { usePersonalizationStore } from '@/personalization/store'
import type { ListenEntry } from '@/personalization/types'
import type { Mix } from '@/library/mixes'
import { useMadeForYouMixes } from '@/features/library/useMixes'
import { useLibraryStore } from '@/library/store'
import { useDiscovery } from './useDiscovery'
import type { DiscoveryState } from './useDiscovery'

/**
 * Assembles the personalized home page.
 *
 * **The candidate pool is what the page already loaded.** Trending, this month
 * and the four genre stations are fetched by `useDiscovery` exactly as they were
 * before Phase 4; this hook flattens them into one pool and re-ranks it locally.
 * A personalized home render therefore costs the same requests a cold one does
 * (STEP 11).
 *
 * **Zero YouTube requests, ever.** Nothing here touches `/api/youtube`, the
 * YouTube session cache or the IFrame API. Retained YouTube entries can appear
 * in Recently Played because they are already on the device; discovering *new*
 * YouTube content stays tied to an explicit search, which is the existing quota
 * model and is not relaxed by this phase (STEP 25).
 *
 * **One bounded exception.** *More from artists you like* may fall back to at
 * most `MAX_AFFINITY_LOOKUPS` Audius artist lookups when the pool happens to
 * contain nothing by the listener's top artists. They are cached for the session,
 * run only for a warm-or-better profile, and are the only extra requests this
 * phase can make.
 */

export interface HomeDashboard {
  sections: HomeSectionId[]
  discovery: DiscoveryState
  profile: PersonalizationProfile
  /**
   * Made-for-you mixes, or an empty array when the evidence does not support
   * any. Built from the same pool the shelves use, so they cost no requests.
   */
  mixes: Mix[]
  recommended: ScoredTrack[]
  recent: ListenEntry[]
  because: { seed: ArtistAffinity; tracks: Track[] } | null
  artistTracks: Track[]
  /** True when personalization is switched on for this browser. */
  enabled: boolean
}

/** Module-level cache so remounting the page cannot re-spend a lookup. */
const artistTrackCache = new Map<string, Track[]>()

export function clearArtistTrackCache(): void {
  artistTrackCache.clear()
}

export function useHomeDashboard(): HomeDashboard {
  const discovery = useDiscovery()
  const state = usePersonalizationStore((store) => store.state)
  const profile = usePersonalizationStore((store) => store.profile)
  const enabled = state.consent === 'granted'

  /**
   * One flat, deduplicated candidate pool.
   *
   * Recomputed only when a shelf actually changes identity, not on every render
   * — the discovery cache hands back the same arrays until it reloads.
   */
  const candidates = useMemo(() => {
    const pool: Track[] = []
    const seen = new Set<string>()
    const push = (tracks: Track[]) => {
      for (const track of tracks) {
        if (seen.has(track.id)) continue
        seen.add(track.id)
        pool.push(track)
      }
    }
    push(discovery.trending)
    push(discovery.month)
    for (const tracks of Object.values(discovery.stations)) push(tracks)
    return pool
  }, [discovery.trending, discovery.month, discovery.stations])

  const recent = useMemo(
    () => (enabled ? recentShelf(state, Date.now(), RECENT_SHELF_SIZE) : []),
    // `updatedAt` is the store's change token: it moves on every meaningful
    // event and on nothing else, which is what keeps this off the playback path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, state.updatedAt],
  )

  /**
   * Everything excluded from a generated shelf.
   *
   * Two sources with different lifetimes: Phase 4's per-card dismissals, and
   * Phase 7's *Not interested*, which lives in the library so it survives with
   * or without personalization consent. Merged here rather than in the ranker,
   * which has no business knowing there are two lists.
   */
  const hiddenKeys = useLibraryStore((store) => store.state.hiddenRecommendationKeys)
  const excluded = useMemo(
    () => [...state.dismissedItems, ...hiddenKeys],
    [state.dismissedItems, hiddenKeys],
  )

  const seed = useMemo(() => (enabled ? seedArtist(profile) : null), [enabled, profile])

  // Built from the same free pool the shelves use, plus the Phase 6 session
  // pool. Returns nothing on a cold profile, which is what keeps the section
  // from appearing before there is anything behind it.
  const mixes = useMadeForYouMixes(candidates)

  const recommended = useMemo(() => {
    if (!enabled || profile.stage === 'cold' || profile.stage === 'early') return []
    return buildRecommendations(candidates, profile, {
      history: state.listeningHistory,
      dismissed: excluded,
      size: SHELF_SIZE,
    })
  }, [enabled, candidates, profile, state.listeningHistory, excluded])

  const affinityKeys = useMemo(
    () => profile.artists.slice(0, 3).map((artist) => artist.key),
    [profile.artists],
  )

  const pooledArtistTracks = useMemo(() => {
    if (!enabled || affinityKeys.length === 0) return []
    return tracksByArtists(candidates, affinityKeys, {
      history: state.listeningHistory,
      dismissed: excluded,
      size: SHELF_SIZE,
      exclude: recommended.map((item) => item.track.id),
    })
  }, [enabled, candidates, affinityKeys, state.listeningHistory, excluded, recommended])

  const fetched = useFetchedArtistTracks(profile, pooledArtistTracks.length, enabled)

  const artistTracks = useMemo(() => {
    if (pooledArtistTracks.length >= 2) return pooledArtistTracks
    const excluded = new Set([
      ...recommended.map((item) => item.track.id),
      ...pooledArtistTracks.map((track) => track.id),
    ])
    const extra = fetched.filter((track) => track.isStreamable && !excluded.has(track.id))
    return [...pooledArtistTracks, ...extra].slice(0, SHELF_SIZE)
  }, [pooledArtistTracks, fetched, recommended])

  const becauseTracks = useMemo(() => {
    if (!seed) return []
    // Rows another shelf on this page already used. Distinct from `excluded`,
    // which is what the visitor asked never to see again.
    const alreadyShown = [
      ...recommended.map((item) => item.track.id),
      ...artistTracks.map((track) => track.id),
    ]
    const pool = [...candidates, ...fetched]
    return tracksByArtists(pool, [seed.key], {
      history: state.listeningHistory,
      dismissed: excluded,
      size: SHELF_SIZE,
      exclude: alreadyShown,
    })
  }, [
    seed,
    candidates,
    fetched,
    recommended,
    artistTracks,
    state.listeningHistory,
    excluded,
  ])

  const sections = planHomeSections({
    stage: enabled ? profile.stage : 'cold',
    hasMixes: mixes.length > 0,
    hasRecommendations: recommended.length >= 2,
    hasRecent: recent.length > 0,
    // The section names an artist out loud, so it needs both a defensible seed
    // and real rows to stand behind the claim (STEP 13).
    hasBecause: Boolean(seed) && becauseTracks.length >= 2,
    hasArtistShelf: artistTracks.length >= 2,
  })

  return {
    sections,
    discovery,
    profile,
    mixes,
    recommended,
    recent,
    because: seed && becauseTracks.length >= 2 ? { seed, tracks: becauseTracks } : null,
    artistTracks,
    enabled,
  }
}

/**
 * The one bounded provider fan-out in this phase.
 *
 * Runs only when the profile is warm or better *and* the pool the page already
 * has could not fill the shelf. At most `MAX_AFFINITY_LOOKUPS` requests, one per
 * artist, cached for the session so navigating home again is free. Audius only:
 * Jamendo's proxy exposes no artist endpoint, and YouTube is never contacted.
 */
function useFetchedArtistTracks(
  profile: PersonalizationProfile,
  pooledCount: number,
  enabled: boolean,
): Track[] {
  const [tracks, setTracks] = useState<Track[]>([])
  const requestedRef = useRef<string | null>(null)

  const lookupIds = useMemo(() => {
    if (!enabled) return []
    if (profile.stage !== 'warm' && profile.stage !== 'mature') return []
    if (pooledCount >= 2) return []
    return profile.artists
      .filter((artist) => artist.provider === 'audius' && Boolean(artist.artistId))
      .slice(0, MAX_AFFINITY_LOOKUPS)
      .map((artist) => artist.artistId as string)
  }, [enabled, profile.stage, profile.artists, pooledCount])

  useEffect(() => {
    if (lookupIds.length === 0) {
      setTracks([])
      return
    }

    const key = lookupIds.join(',')
    if (requestedRef.current === key) return
    requestedRef.current = key

    const cached = lookupIds.flatMap((id) => artistTrackCache.get(id) ?? [])
    if (lookupIds.every((id) => artistTrackCache.has(id))) {
      setTracks(cached)
      return
    }

    let cancelled = false
    void (async () => {
      const provider = getMusicProvider()
      const results = await Promise.all(
        lookupIds.map(async (id) => {
          const hit = artistTrackCache.get(id)
          if (hit) return hit
          try {
            const artistTracks = await provider.getArtistTracks(id, { limit: SHELF_SIZE * 2 })
            artistTrackCache.set(id, artistTracks)
            return artistTracks
          } catch {
            // A failed affinity lookup is not an error the visitor needs to see:
            // the shelf simply falls back to discovery.
            artistTrackCache.set(id, [])
            return [] as Track[]
          }
        }),
      )
      if (!cancelled) setTracks(results.flat())
    })()

    return () => {
      cancelled = true
    }
  }, [lookupIds])

  return tracks
}

/** Keys of the artists a shelf is drawn from, for the accessible description. */
export function affinityNames(profile: PersonalizationProfile, tracks: Track[]): string[] {
  const wanted = new Set(tracks.map((track) => artistKey(track.artistName)))
  return profile.artists.filter((artist) => wanted.has(artist.key)).map((artist) => artist.name)
}
