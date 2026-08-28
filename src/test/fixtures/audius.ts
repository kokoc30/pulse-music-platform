/**
 * Raw Audius API payloads (snake_case, exactly as the HTTP API returns them),
 * so the SDK's own `FromJSON` mapping is exercised rather than bypassed.
 *
 * Covers the cases agents/09_TESTING_QA.md requires: a normal track, a track
 * with no artwork, a non-streamable/gated track, and an empty result set.
 */

export interface RawAudiusTrack {
  id: string
  title: string
  duration: number
  genre?: string
  mood?: string | null
  play_count?: number
  permalink?: string
  is_streamable?: boolean
  access?: { stream: boolean; download: boolean }
  artwork?: Record<string, unknown> | null
  user?: Record<string, unknown>
  // The generated SDK model maps these unconditionally, and the live API always
  // returns them, so fixtures must carry them too.
  followee_reposts?: unknown[]
  followee_favorites?: unknown[]
  track_segments?: unknown[]
  remix_of?: unknown
  field_visibility?: Record<string, boolean>
  is_original_available?: boolean
  is_downloadable?: boolean
  repost_count?: number
  favorite_count?: number
  comment_count?: number
  blocknumber?: number
  created_at?: string
  cover_art_sizes?: string
}

export function makeRawTrack(overrides: Partial<RawAudiusTrack> = {}): RawAudiusTrack {
  return {
    id: 'trk1',
    followee_reposts: [],
    followee_favorites: [],
    track_segments: [],
    remix_of: null,
    field_visibility: { mood: true, tags: true, genre: true, share: true, remixes: true, play_count: true },
    is_original_available: false,
    is_downloadable: false,
    repost_count: 12,
    favorite_count: 34,
    comment_count: 5,
    blocknumber: 1,
    created_at: '2026-01-01T00:00:00Z',
    cover_art_sizes: 'art1',
    title: 'Midnight Signal',
    duration: 214,
    genre: 'House',
    mood: 'Energizing',
    play_count: 12_345,
    permalink: '/nova/midnight-signal',
    is_streamable: true,
    access: { stream: true, download: true },
    artwork: {
      '150x150': 'https://cn1.example.audius/content/art1/150x150.jpg',
      '480x480': 'https://cn1.example.audius/content/art1/480x480.jpg',
      '1000x1000': 'https://cn1.example.audius/content/art1/1000x1000.jpg',
      mirrors: ['https://cn2.example.audius', 'https://cn3.example.audius'],
    },
    user: {
      id: 'usr1',
      name: 'Nova Sound',
      handle: 'novasound',
      is_verified: true,
      follower_count: 8_400,
      track_count: 42,
      is_deactivated: false,
      is_available: true,
      profile_picture: {
        '150x150': 'https://cn1.example.audius/content/pic1/150x150.jpg',
        '480x480': 'https://cn1.example.audius/content/pic1/480x480.jpg',
      },
    },
    ...overrides,
  }
}

export const RAW_TRACKS: RawAudiusTrack[] = [
  makeRawTrack(),
  makeRawTrack({
    id: 'trk2',
    title: 'Paper Lanterns',
    duration: 187,
    permalink: '/novasound/paper-lanterns',
    // Same artist as trk1: artist-driven searches need a catalogue with depth.
    user: { id: 'usr1', name: 'Nova Sound', handle: 'novasound', is_verified: true },
  }),
  makeRawTrack({
    id: 'trk3',
    title: 'No Artwork Here',
    duration: 301,
    artwork: null,
    permalink: '/ghost/no-artwork-here',
    user: { id: 'usr3', name: 'Ghost Radio', handle: 'ghostradio' },
  }),
  makeRawTrack({
    id: 'trk4',
    title: 'Gated Premiere',
    duration: 245,
    is_streamable: false,
    access: { stream: false, download: false },
    permalink: '/vault/gated-premiere',
    user: { id: 'usr4', name: 'The Vault', handle: 'thevault' },
  }),
]

export const RAW_USERS = [
  {
    id: 'usr1',
    name: 'Nova Sound',
    handle: 'novasound',
    is_verified: true,
    follower_count: 8_400,
    track_count: 42,
    is_deactivated: false,
    is_available: true,
    profile_picture: {
      '150x150': 'https://cn1.example.audius/content/pic1/150x150.jpg',
      '480x480': 'https://cn1.example.audius/content/pic1/480x480.jpg',
    },
  },
  {
    id: 'usr2',
    name: '@Kite',
    handle: 'kite',
    is_verified: false,
    follower_count: 900,
    track_count: 7,
    is_deactivated: false,
    is_available: true,
    profile_picture: null,
  },
  {
    id: 'usr5',
    name: 'Deactivated Artist',
    handle: 'gone',
    is_verified: false,
    is_deactivated: true,
    is_available: false,
  },
]

const ENVELOPE = {
  latest_chain_block: 1,
  latest_indexed_block: 1,
  latest_chain_slot_plays: 1,
  latest_indexed_slot_plays: 1,
  signature: 'sig',
  timestamp: '2026-01-01T00:00:00Z',
  version: { service: 'discovery-node', version: '1.0.0' },
}

export const trackListResponse = (tracks: RawAudiusTrack[] = RAW_TRACKS) => ({
  ...ENVELOPE,
  data: tracks,
})

export const userListResponse = (users: unknown[] = RAW_USERS) => ({ ...ENVELOPE, data: users })

export const searchResponse = (tracks: RawAudiusTrack[] = RAW_TRACKS) => ({ data: tracks })

/** Shape of : tracks and users in one envelope. */
export const catalogSearchResponse = (
  tracks: RawAudiusTrack[] = RAW_TRACKS,
  users: unknown[] = RAW_USERS,
) => ({
  ...ENVELOPE,
  data: { tracks, users, playlists: [], albums: [] },
})

export const streamResponse = (url = 'https://cn1.example.audius/tracks/cidstream/abc?signature=x') => ({
  data: url,
})

export const STREAM_URL = 'https://cn1.example.audius/tracks/cidstream/abc?signature=x'
