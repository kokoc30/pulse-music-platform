import { createEmptyLibrary } from '@/library/types'
import type { LibraryState, LibraryTrackRef, Playlist } from '@/library/types'
import { youtubeExpiryFor } from '@/library/youtube-policy'
import type { Track } from '@/music/types'

/**
 * Library fixtures.
 *
 * Deliberately built by hand rather than by driving the UI: a storage test needs
 * to describe an exact stored shape, including shapes production would refuse to
 * write, so it can assert that reading them is safe.
 */

export const FIXED_NOW = Date.UTC(2026, 7, 28, 12, 0, 0)

export function audiusRef(overrides: Partial<LibraryTrackRef> = {}): LibraryTrackRef {
  return {
    key: 'audius:t1',
    provider: 'audius',
    providerItemId: 't1',
    title: 'Neon Corridor',
    artist: 'Aster Vale',
    artistId: 'a1',
    artwork: { url: 'https://art.example/t1.jpg', mirrors: ['https://mirror.example'] },
    durationSeconds: 200,
    genre: 'Electronic',
    sourceUrl: 'https://audius.co/astervale/t1',
    addedAt: FIXED_NOW,
    metadataUpdatedAt: FIXED_NOW,
    ...overrides,
  }
}

export function jamendoRef(overrides: Partial<LibraryTrackRef> = {}): LibraryTrackRef {
  return {
    key: 'jamendo:1880336',
    provider: 'jamendo',
    providerItemId: '1880336',
    title: 'Night Reverie',
    artist: 'Lumen Field',
    artwork: { url: 'https://art.example/j1.jpg' },
    durationSeconds: 180,
    genre: 'Ambient',
    sourceUrl: 'https://www.jamendo.com/track/1880336/night-reverie',
    addedAt: FIXED_NOW,
    metadataUpdatedAt: FIXED_NOW,
    ...overrides,
  }
}

export function youtubeRef(overrides: Partial<LibraryTrackRef> = {}): LibraryTrackRef {
  const storedAt = overrides.metadataUpdatedAt ?? FIXED_NOW
  return {
    key: 'youtube:aaaaaaaaaaa',
    provider: 'youtube',
    providerItemId: 'aaaaaaaaaaa',
    title: 'Qele Qele',
    artist: 'Sirusho',
    thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
    durationSeconds: 210,
    sourceUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    embeddable: true,
    madeForKids: false,
    addedAt: storedAt,
    metadataUpdatedAt: storedAt,
    youtubeExpiresAt: youtubeExpiryFor(storedAt),
    ...overrides,
  }
}

export function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 'pl_test',
    name: 'Road Trip',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    itemKeys: [],
    coverMode: 'auto',
    ...overrides,
  }
}

/** A library assembled from whole references, with every index kept consistent. */
export function libraryWith(options: {
  tracks?: LibraryTrackRef[]
  liked?: string[]
  playlists?: Playlist[]
  hidden?: string[]
  now?: number
}): LibraryState {
  const state = createEmptyLibrary(options.now ?? FIXED_NOW)
  for (const ref of options.tracks ?? []) state.tracks[ref.key] = ref
  state.likedTrackKeys = options.liked ?? []
  for (const list of options.playlists ?? []) {
    state.playlists[list.id] = list
    state.playlistOrder.push(list.id)
  }
  state.hiddenRecommendationKeys = options.hidden ?? []
  return state
}

/* --------------------------------------------------------------------------
   Normalized provider tracks

   The library saves *from* a `Track`, so its tests need one. Built here rather
   than by running the real normalizers, so a test can state exactly the shape it
   is saving from — including fields, like `streamUrl`, that must provably never
   reach storage.
   -------------------------------------------------------------------------- */

export function audiusTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'audius:t1',
    mediaKind: 'audio',
    provider: 'audius',
    providerId: 't1',
    title: 'Neon Corridor',
    artistId: 'a1',
    artistName: 'Aster Vale',
    artwork: { medium: 'https://art.example/t1.jpg', mirrors: ['https://mirror.example'] },
    durationSeconds: 200,
    genre: 'Electronic',
    mood: 'Energizing',
    tags: ['synth', 'night'],
    bpm: 120,
    isStreamable: true,
    permalink: 'https://audius.co/astervale/t1',
    ...overrides,
  }
}

export function jamendoTrackFixture(overrides: Partial<Track> = {}): Track {
  return {
    id: 'jamendo:1880336',
    mediaKind: 'audio',
    provider: 'jamendo',
    providerId: '1880336',
    title: 'Night Reverie',
    artistName: 'Lumen Field',
    artwork: { medium: 'https://art.example/j1.jpg' },
    durationSeconds: 180,
    genre: 'Ambient',
    tags: ['calm'],
    isStreamable: true,
    sourceUrl: 'https://www.jamendo.com/track/1880336/night-reverie',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
    attributionRequired: true,
    // Present on the source track, and provably absent from anything persisted.
    streamUrl: 'https://prod.storage.jamendo.test/?trackid=1880336',
    ...overrides,
  }
}

/** A pool of distinct catalogue tracks, for mix and recommendation tests. */
export function trackPool(count: number, options: { artists?: number; genre?: string } = {}): Track[] {
  const artists = options.artists ?? count
  return Array.from({ length: count }, (_, index) =>
    audiusTrack({
      id: `audius:p${index}`,
      providerId: `p${index}`,
      title: `Pool Track ${index}`,
      artistId: `pa${index % artists}`,
      artistName: `Pool Artist ${index % artists}`,
      ...(options.genre ? { genre: options.genre } : {}),
    }),
  )
}
