import type { Artwork, Track } from '@/music/types'
import type { JamendoTrackPayload } from './wire'

/**
 * Sanitized Jamendo payload → the shared `Track` model.
 *
 * Mapping is fixed by agents/14_JAMENDO_PROVIDER_CONTRACT.md → "Jamendo
 * Normalization". Two rules matter beyond the field list:
 *
 * · **Namespaced ids.** `jamendo:1880336` can never collide with an Audius id,
 *   which is what makes a merged result list and a mixed queue safe.
 * · **No download path.** `audiodownload` is stripped server-side and has no
 *   field to land in here; Phase 2 has no download feature.
 */

export const JAMENDO_ID_PREFIX = 'jamendo:'

function toArtwork(payload: JamendoTrackPayload): Artwork {
  const artwork: Artwork = {}
  // Jamendo returns one 300px cover per size request, so the same URL serves
  // every slot the UI asks for rather than leaving thumbnails blank.
  const primary = payload.artwork ?? payload.artworkLarge
  if (primary) {
    artwork.small = primary
    artwork.medium = primary
  }
  const large = payload.artworkLarge ?? primary
  if (large) artwork.large = large
  return artwork
}

/**
 * A Jamendo track is playable only when the provider actually handed us an
 * HTTPS stream URL. Everything else — a missing `audio`, a plain-HTTP URL, a
 * URL the sanitizer refused — lands as a visible but unplayable row rather than
 * a row that fails on click.
 */
export function normalizeJamendoTrack(payload: JamendoTrackPayload | null): Track | null {
  if (!payload?.id || !payload.title) return null

  const track: Track = {
    id: `${JAMENDO_ID_PREFIX}${payload.id}`,
    mediaKind: 'audio',
    provider: 'jamendo',
    providerId: payload.id,
    title: payload.title,
    artistName: payload.artistName || 'Unknown artist',
    artwork: toArtwork(payload),
    durationSeconds: Number.isFinite(payload.durationSeconds) ? Math.max(payload.durationSeconds, 0) : 0,
    isStreamable: Boolean(payload.audioUrl),
    // Jamendo's API terms require visible source attribution for every item
    // (agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md).
    attributionRequired: true,
  }

  if (payload.artistId) track.artistId = payload.artistId
  if (payload.audioUrl) track.streamUrl = payload.audioUrl
  if (payload.sourceUrl) {
    track.sourceUrl = payload.sourceUrl
    // `permalink` is the model's generic "provider page" field, so the existing
    // player link works for Jamendo without a provider branch.
    track.permalink = payload.sourceUrl
  }
  if (payload.licenseUrl) track.licenseUrl = payload.licenseUrl
  // Only the similar action supplies these; a search result simply has none,
  // which the similarity scorer treats as neutral.
  if (payload.tags?.length) track.tags = payload.tags
  if (payload.bpm !== undefined) track.bpm = payload.bpm

  return track
}

export function normalizeJamendoTracks(payloads: readonly (JamendoTrackPayload | null)[]): Track[] {
  const seen = new Set<string>()
  const tracks: Track[] = []
  for (const payload of payloads) {
    const track = normalizeJamendoTrack(payload)
    if (!track || seen.has(track.id)) continue
    seen.add(track.id)
    tracks.push(track)
  }
  return tracks
}

/** Accepts both the domain id (`jamendo:123`) and a bare provider id. */
export function toJamendoProviderId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed) return ''
  return trimmed.startsWith(JAMENDO_ID_PREFIX) ? trimmed.slice(JAMENDO_ID_PREFIX.length) : trimmed
}
