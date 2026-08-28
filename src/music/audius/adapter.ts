import { normalizeArtists, normalizeTracks } from '../normalize'
import type { MusicProvider } from '../provider'
import { MusicError } from '../types'
import type {
  Artist,
  CatalogSearchResult,
  SearchOptions,
  TopArtistsOptions,
  Track,
  TrendingOptions,
} from '../types'
import { getAudiusSdk } from './client'
import { reportFailedStreamOrigin, resolveHealthyStreamUrl } from './content-nodes'
import type { AudiusSdk } from './client'
import { musicErrorMessage, toMusicError } from './errors'

export const DEFAULT_SEARCH_LIMIT = 20
export const DEFAULT_TRENDING_LIMIT = 20
export const DEFAULT_ARTIST_LIMIT = 8
export const DEFAULT_ARTIST_TRACK_LIMIT = 10
export const MAX_QUERY_LENGTH = 120

/** Trim, collapse whitespace and length-limit before anything reaches the network. */
export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH)
}

function initOverrides(signal: AbortSignal | undefined): RequestInit | undefined {
  return signal ? { signal } : undefined
}

export function createAudiusProvider(
  resolveSdk: () => Promise<AudiusSdk> = getAudiusSdk,
): MusicProvider {
  return {
    id: 'audius',

    async searchTracks(rawQuery, options: SearchOptions = {}): Promise<Track[]> {
      const query = normalizeQuery(rawQuery)
      if (!query) return []

      try {
        const response = await (await resolveSdk()).tracks.searchTracks(
          {
            query,
            limit: options.limit ?? DEFAULT_SEARCH_LIMIT,
            offset: options.offset ?? 0,
            sortMethod: 'relevant',
          },
          initOverrides(options.signal),
        )
        return normalizeTracks(response.data)
      } catch (error) {
        throw toMusicError(error)
      }
    },

    /**
     * `/search/full` returns matching tracks *and* users in one response, which
     * is what makes artist-oriented queries work: "Skrillex" surfaces the
     * verified artist rather than a page of remixes that merely name-drop them.
     */
    async searchCatalog(rawQuery, options: SearchOptions = {}): Promise<CatalogSearchResult> {
      const query = normalizeQuery(rawQuery)
      if (!query) return { tracks: [], artists: [] }

      try {
        const response = await (await resolveSdk()).search.search(
          {
            query,
            kind: 'all',
            limit: options.limit ?? DEFAULT_SEARCH_LIMIT,
            offset: options.offset ?? 0,
            sortMethod: 'relevant',
          },
          initOverrides(options.signal),
        )
        return {
          tracks: normalizeTracks(response.data?.tracks),
          artists: normalizeArtists(response.data?.users),
        }
      } catch (error) {
        throw toMusicError(error)
      }
    },

    async getArtistTracks(artistId, options: SearchOptions = {}): Promise<Track[]> {
      const id = toProviderId(artistId)
      if (!id) return []
      try {
        const response = await (await resolveSdk()).users.getTracksByUser(
          {
            id,
            limit: options.limit ?? DEFAULT_ARTIST_TRACK_LIMIT,
            offset: options.offset ?? 0,
            sortMethod: 'plays',
          },
          initOverrides(options.signal),
        )
        return normalizeTracks(response.data)
      } catch (error) {
        const musicError = toMusicError(error)
        // A profile with no public tracks is an empty shelf, not a failure.
        if (musicError.code === 'NOT_FOUND') return []
        throw musicError
      }
    },

    async getTrendingTracks(options: TrendingOptions = {}): Promise<Track[]> {
      try {
        const response = await (await resolveSdk()).tracks.getTrendingTracks(
          {
            limit: options.limit ?? DEFAULT_TRENDING_LIMIT,
            offset: options.offset ?? 0,
            ...(options.genre ? { genre: options.genre } : {}),
            ...(options.time ? { time: options.time } : {}),
          },
          initOverrides(options.signal),
        )
        return normalizeTracks(response.data)
      } catch (error) {
        throw toMusicError(error)
      }
    },

    async getUndergroundTrendingTracks(options: TrendingOptions = {}): Promise<Track[]> {
      try {
        const response = await (await resolveSdk()).tracks.getUndergroundTrendingTracks(
          {
            limit: options.limit ?? DEFAULT_TRENDING_LIMIT,
            offset: options.offset ?? 0,
          },
          initOverrides(options.signal),
        )
        return normalizeTracks(response.data)
      } catch (error) {
        throw toMusicError(error)
      }
    },

    async getTopArtists(options: TopArtistsOptions = {}): Promise<Artist[]> {
      try {
        const response = await (await resolveSdk()).users.getTopUsers(
          {
            limit: options.limit ?? DEFAULT_ARTIST_LIMIT,
            offset: options.offset ?? 0,
          },
          initOverrides(options.signal),
        )
        return normalizeArtists(response.data)
      } catch (error) {
        throw toMusicError(error)
      }
    },

    async getTrack(id, options = {}): Promise<Track | null> {
      const trackId = toProviderId(id)
      if (!trackId) return null
      try {
        const response = await (await resolveSdk()).tracks.getTrack(
          { trackId },
          initOverrides(options.signal),
        )
        const [track] = normalizeTracks(response.data ? [response.data] : [])
        return track ?? null
      } catch (error) {
        const musicError = toMusicError(error)
        if (musicError.code === 'NOT_FOUND') return null
        throw musicError
      }
    },

    /**
     * Uses the SDK's first-class stream helper with `noRedirect`, which returns
     * the signed URL of the MP3 on Audius' own content infrastructure. The audio
     * element then streams straight from Audius — nothing is proxied, cached or
     * re-hosted by this application (agents/06_AUDIUS_INTEGRATION.md).
     */
    async getStreamSource(track, options = {}): Promise<string> {
      if (!track.isStreamable) {
        throw new MusicError('NOT_STREAMABLE', musicErrorMessage('NOT_STREAMABLE'))
      }
      try {
        const response = await (await resolveSdk()).tracks.streamTrack(
          { trackId: track.providerId, noRedirect: true },
          initOverrides(options.signal),
        )
        const url = typeof response.data === 'string' ? response.data.trim() : ''
        if (!url) {
          throw new MusicError('NOT_STREAMABLE', musicErrorMessage('NOT_STREAMABLE'))
        }
        // Audius keeps routing a given track to the same content node, so a
        // node that already failed this session is swapped for a healthy one.
        return await resolveHealthyStreamUrl(url)
      } catch (error) {
        const musicError = toMusicError(error)
        // A gated or removed track answers 403/404 on the stream endpoint.
        if (musicError.code === 'NOT_FOUND' || musicError.code === 'CONFIG') {
          throw new MusicError('NOT_STREAMABLE', musicErrorMessage('NOT_STREAMABLE'), {
            cause: error,
            ...(musicError.status !== undefined ? { status: musicError.status } : {}),
          })
        }
        throw musicError
      }
    },

    reportStreamFailure(streamUrl) {
      reportFailedStreamOrigin(streamUrl)
    },
  }
}

/** Accepts both the domain id (`audius:abc`) and a bare provider id. */
export function toProviderId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('audius:') ? trimmed.slice('audius:'.length) : trimmed
}
