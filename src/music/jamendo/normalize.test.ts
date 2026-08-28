import { describe, expect, it } from 'vitest'
import { normalizeJamendoTrack, normalizeJamendoTracks, toJamendoProviderId } from './normalize'
import type { JamendoTrackPayload } from './wire'

function payload(overrides: Partial<JamendoTrackPayload> = {}): JamendoTrackPayload {
  return {
    id: '1880336',
    title: 'Reverie',
    artistName: 'Lumen Field',
    artistId: '440321',
    albumName: 'Slow Country',
    durationSeconds: 214,
    artwork: 'https://usercontent.jamendo.com/track/1880336/covers/1.300.jpg',
    audioUrl: 'https://prod-1.storage.jamendo.com/?trackid=1880336&format=mp32',
    sourceUrl: 'https://www.jamendo.com/track/1880336/reverie',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
    releaseDate: '2023-04-11',
    ...overrides,
  }
}

describe('Jamendo normalization', () => {
  it('maps a normal album track onto the shared Track model', () => {
    const track = normalizeJamendoTrack(payload())
    expect(track).toMatchObject({
      id: 'jamendo:1880336',
      provider: 'jamendo',
      providerId: '1880336',
      title: 'Reverie',
      artistName: 'Lumen Field',
      artistId: '440321',
      durationSeconds: 214,
      isStreamable: true,
      sourceUrl: 'https://www.jamendo.com/track/1880336/reverie',
      licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
      attributionRequired: true,
    })
  })

  it('namespaces the id so it can never collide with an Audius id', () => {
    // Jamendo ids are numeric and Audius ids are short strings; a bare id could
    // realistically collide once both catalogues share one list.
    const jamendo = normalizeJamendoTrack(payload({ id: 'abc123' }))
    expect(jamendo?.id).toBe('jamendo:abc123')
    expect(jamendo?.id).not.toBe('audius:abc123')
    expect(toJamendoProviderId('jamendo:abc123')).toBe('abc123')
    expect(toJamendoProviderId('abc123')).toBe('abc123')
    expect(toJamendoProviderId('   ')).toBe('')
  })

  it('marks every Jamendo track as requiring attribution', () => {
    expect(normalizeJamendoTrack(payload())?.attributionRequired).toBe(true)
  })

  it('exposes the source URL as the provider page the UI links to', () => {
    const track = normalizeJamendoTrack(payload())
    expect(track?.sourceUrl).toBe('https://www.jamendo.com/track/1880336/reverie')
    // `permalink` is the model's generic provider-page field, so the existing
    // player link works without a provider branch.
    expect(track?.permalink).toBe(track?.sourceUrl)
  })

  it('normalizes a single with no artwork into a renderable row', () => {
    const track = normalizeJamendoTrack(payload({ artwork: undefined, artworkLarge: undefined }))
    expect(track).not.toBeNull()
    expect(track?.artwork).toEqual({})
    expect(track?.isStreamable).toBe(true)
  })

  it('fills every artwork slot from the one cover Jamendo returns', () => {
    const track = normalizeJamendoTrack(payload())
    expect(track?.artwork.small).toBe(payload().artwork)
    expect(track?.artwork.medium).toBe(payload().artwork)
    expect(track?.artwork.large).toBe(payload().artwork)
  })

  it('treats an invalid duration as unknown rather than propagating NaN', () => {
    expect(normalizeJamendoTrack(payload({ durationSeconds: 0 }))?.durationSeconds).toBe(0)
    expect(normalizeJamendoTrack(payload({ durationSeconds: Number.NaN }))?.durationSeconds).toBe(0)
    expect(normalizeJamendoTrack(payload({ durationSeconds: -5 }))?.durationSeconds).toBe(0)
  })

  it('marks a track with no audio URL as not streamable instead of dropping it', () => {
    const track = normalizeJamendoTrack(payload({ audioUrl: undefined }))
    expect(track).not.toBeNull()
    expect(track?.isStreamable).toBe(false)
    expect(track?.streamUrl).toBeUndefined()
  })

  it('keeps a track that has no source URL, without inventing one', () => {
    const track = normalizeJamendoTrack(payload({ sourceUrl: undefined }))
    expect(track).not.toBeNull()
    expect(track?.sourceUrl).toBeUndefined()
    expect(track?.permalink).toBeUndefined()
    // Attribution is still required; the UI falls back to the provider credit.
    expect(track?.attributionRequired).toBe(true)
  })

  it('never carries a download URL: the model has no field for one', () => {
    const track = normalizeJamendoTrack(payload())
    expect(JSON.stringify(track)).not.toContain('audiodownload')
    expect(JSON.stringify(track)).not.toContain('/download/')
  })

  it('drops a payload with no usable identity', () => {
    expect(normalizeJamendoTrack(null)).toBeNull()
    expect(normalizeJamendoTrack(payload({ id: '' }))).toBeNull()
    expect(normalizeJamendoTrack(payload({ title: '' }))).toBeNull()
  })

  it('names an artist-less payload rather than rendering a blank byline', () => {
    expect(normalizeJamendoTrack(payload({ artistName: '' }))?.artistName).toBe('Unknown artist')
  })

  it('de-duplicates a list by namespaced id', () => {
    const tracks = normalizeJamendoTracks([payload(), payload(), payload({ id: '2' }), null])
    expect(tracks.map((track) => track.id)).toEqual(['jamendo:1880336', 'jamendo:2'])
  })
})
