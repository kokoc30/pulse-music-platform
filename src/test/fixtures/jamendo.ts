/**
 * Sanitized `/api/jamendo` payloads — exactly the shape the serverless function
 * emits, so component and hook tests exercise the real wire contract rather than
 * a convenient invention.
 *
 * Nothing here carries `audiodownload`, a client id, or any other field the
 * sanitizer strips: a fixture that carried one would let a leak pass unnoticed.
 */

export interface JamendoFixtureTrack {
  id: string
  title: string
  artistName: string
  artistId?: string
  albumName?: string
  durationSeconds: number
  artwork?: string
  audioUrl?: string
  sourceUrl?: string
  licenseUrl?: string
  releaseDate?: string
}

export function makeJamendoTrack(
  overrides: Partial<JamendoFixtureTrack> = {},
): JamendoFixtureTrack {
  const id = overrides.id ?? '1880336'
  return {
    id,
    title: 'Reverie',
    artistName: 'Lumen Field',
    artistId: '440321',
    albumName: 'Slow Country',
    durationSeconds: 214,
    artwork: `https://usercontent.jamendo.com/track/${id}/covers/1.300.jpg`,
    audioUrl: `https://prod-1.storage.jamendo.com/?trackid=${id}&format=mp32`,
    sourceUrl: `https://www.jamendo.com/track/${id}/reverie`,
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
    releaseDate: '2023-04-11',
    ...overrides,
  }
}

export const JAMENDO_TRACKS: JamendoFixtureTrack[] = [
  makeJamendoTrack({ id: 'j1', title: 'Midnight Signal', artistName: 'Lumen Field' }),
  makeJamendoTrack({ id: 'j2', title: 'Paper Lanterns Reprise', artistName: 'Cedar Room' }),
  // A row Jamendo returned without a playable stream: visible, not startable.
  makeJamendoTrack({ id: 'j3', title: 'Unavailable Take', artistName: 'Ghost Radio', audioUrl: undefined }),
]

export const jamendoSearchResponse = (tracks: JamendoFixtureTrack[] = JAMENDO_TRACKS, query = '') => ({
  provider: 'jamendo' as const,
  action: 'search' as const,
  query,
  count: tracks.length,
  results: tracks,
})
