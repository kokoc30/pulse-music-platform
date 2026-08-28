import type {
  Artist,
  CatalogSearchResult,
  SearchOptions,
  TopArtistsOptions,
  Track,
  TrendingOptions,
} from './types'

/**
 * The single boundary between the application and any music catalogue.
 *
 * UI and feature code import this interface — never `@audius/sdk`
 * (agents/03_ARCHITECTURE.md → "Provider Boundary").
 */
export interface MusicProvider {
  readonly id: string

  searchTracks(query: string, options?: SearchOptions): Promise<Track[]>

  /**
   * Searches tracks and artists in a single round-trip. Artist-oriented queries
   * ("Skrillex") are answered far better by the artist index than by matching
   * substrings in track titles, and doing both in one request keeps the
   * per-search budget small.
   */
  searchCatalog(query: string, options?: SearchOptions): Promise<CatalogSearchResult>

  /** Tracks belonging to one artist, most-played first. */
  getArtistTracks(artistId: string, options?: SearchOptions): Promise<Track[]>
  getTrendingTracks(options?: TrendingOptions): Promise<Track[]>
  getUndergroundTrendingTracks(options?: TrendingOptions): Promise<Track[]>
  getTopArtists(options?: TopArtistsOptions): Promise<Artist[]>
  getTrack(id: string, options?: { signal?: AbortSignal }): Promise<Track | null>

  /**
   * Resolves a directly playable audio URL served by the provider's own
   * infrastructure. The application never proxies, stores or re-hosts audio.
   */
  getStreamSource(track: Track, options?: { signal?: AbortSignal }): Promise<string>

  /**
   * Told when a URL this provider resolved could not be played, so it can route
   * around an unhealthy host on the next attempt. Optional: a provider with a
   * single origin has nothing to do here.
   */
  reportStreamFailure?(streamUrl: string): void
}

let activeProvider: MusicProvider | null = null

/** Registered once at app start (and swapped for a fake in tests). */
export function setMusicProvider(provider: MusicProvider): void {
  activeProvider = provider
}

export function getMusicProvider(): MusicProvider {
  if (!activeProvider) {
    throw new Error('No music provider registered. Call setMusicProvider() during app start-up.')
  }
  return activeProvider
}

export function resetMusicProvider(): void {
  activeProvider = null
}
