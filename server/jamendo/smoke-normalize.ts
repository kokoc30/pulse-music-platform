import type { JamendoTrackPayload } from './sanitize.js'

/**
 * A copy of the browser's Jamendo normalization, for the live smoke suite only.
 *
 * The production normalizer lives in `src/music/jamendo/normalize.ts` and is
 * part of the client build; importing it from the server tree would couple the
 * two trees and give the credential-handling code a path into `src/`, which
 * `jamendo-security.test.ts` explicitly forbids. The smoke suite only needs to
 * prove that what Jamendo *actually serves today* still satisfies the model's
 * invariants, so it asserts them here instead.
 */
export interface SmokeTrack {
  id: string
  provider: 'jamendo'
  providerId: string
  title: string
  artistName: string
  durationSeconds: number
  isStreamable: boolean
  attributionRequired: true
  sourceUrl?: string
  licenseUrl?: string
}

export function normalizeJamendoLike(payload: JamendoTrackPayload): SmokeTrack {
  const track: SmokeTrack = {
    id: `jamendo:${payload.id}`,
    provider: 'jamendo',
    providerId: payload.id,
    title: payload.title,
    artistName: payload.artistName || 'Unknown artist',
    durationSeconds: Number.isFinite(payload.durationSeconds) ? Math.max(payload.durationSeconds, 0) : 0,
    isStreamable: Boolean(payload.audioUrl),
    attributionRequired: true,
  }
  if (payload.sourceUrl) track.sourceUrl = payload.sourceUrl
  if (payload.licenseUrl) track.licenseUrl = payload.licenseUrl
  return track
}
