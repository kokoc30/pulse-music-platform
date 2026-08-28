import { describe, expect, it } from 'vitest'
import { FORBIDDEN_KEYS, PAYLOAD_KEYS, sanitizeJamendoTrack, sanitizeJamendoTracks } from './sanitize.js'

/** A complete, realistic Jamendo v3.0 track row. */
function rawTrack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '1880336',
    name: 'Reverie',
    duration: 214,
    artist_id: '440321',
    artist_name: 'Lumen Field',
    artist_idstr: 'lumenfield',
    album_name: 'Slow Country',
    album_id: '221100',
    album_image: 'https://usercontent.jamendo.com/album/221100/covers/1.300.jpg',
    image: 'https://usercontent.jamendo.com/track/1880336/covers/1.300.jpg',
    audio: 'https://prod-1.storage.jamendo.com/?trackid=1880336&format=mp32&from=app-devsite',
    audiodownload: 'https://prod-1.storage.jamendo.com/download/track/1880336/mp32/',
    audiodownload_allowed: true,
    shorturl: 'https://jamen.do/t/1880336',
    shareurl: 'https://www.jamendo.com/track/1880336/reverie',
    license_ccurl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
    releasedate: '2023-04-11',
    position: 3,
    prourl: 'https://licensing.jamendo.com/track/1880336',
    waveform: '{"peaks":[1,2,3]}',
    ...overrides,
  }
}

describe('Jamendo sanitization', () => {
  it('maps a normal album track onto the wire payload', () => {
    const track = sanitizeJamendoTrack(rawTrack())
    expect(track).toMatchObject({
      id: '1880336',
      title: 'Reverie',
      artistName: 'Lumen Field',
      artistId: '440321',
      albumName: 'Slow Country',
      durationSeconds: 214,
      artwork: 'https://usercontent.jamendo.com/track/1880336/covers/1.300.jpg',
      audioUrl: 'https://prod-1.storage.jamendo.com/?trackid=1880336&format=mp32&from=app-devsite',
      sourceUrl: 'https://www.jamendo.com/track/1880336/reverie',
      licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
      releaseDate: '2023-04-11',
    })
  })

  it('maps a single — a row with no album — without inventing fields', () => {
    const track = sanitizeJamendoTrack(rawTrack({ album_name: '', album_id: '', album_image: '' }))
    expect(track?.albumName).toBeUndefined()
    expect(track?.artworkLarge).toBeUndefined()
    // Its own cover still carries the row.
    expect(track?.artwork).toContain('/track/1880336/')
  })

  it('never emits a download URL or any other forbidden field', () => {
    const track = sanitizeJamendoTrack(rawTrack())
    const serialized = JSON.stringify(track)
    for (const key of FORBIDDEN_KEYS) {
      expect(track).not.toHaveProperty(key)
      expect(serialized).not.toContain(key)
    }
    // The download path itself must be absent, not merely renamed.
    expect(serialized).not.toContain('/download/')
    expect(serialized).not.toContain('licensing.jamendo.com')
  })

  it('emits only keys the wire contract declares', () => {
    const track = sanitizeJamendoTrack(rawTrack())
    for (const key of Object.keys(track ?? {})) {
      expect(PAYLOAD_KEYS).toContain(key as (typeof PAYLOAD_KEYS)[number])
    }
  })

  it('falls back to the album cover when the track has no artwork of its own', () => {
    const track = sanitizeJamendoTrack(rawTrack({ image: '' }))
    expect(track?.artwork).toBe('https://usercontent.jamendo.com/album/221100/covers/1.300.jpg')
  })

  it('leaves artwork absent rather than emitting an empty string', () => {
    const track = sanitizeJamendoTrack(rawTrack({ image: '', album_image: null }))
    expect(track?.artwork).toBeUndefined()
  })

  it('coerces a string duration, which some cached responses return', () => {
    expect(sanitizeJamendoTrack(rawTrack({ duration: '187' }))?.durationSeconds).toBe(187)
    expect(sanitizeJamendoTrack(rawTrack({ duration: '187.6' }))?.durationSeconds).toBe(188)
  })

  it('turns an invalid duration into 0 instead of NaN', () => {
    for (const duration of ['', 'abc', -12, 0, null, undefined, Number.NaN, 999_999]) {
      expect(sanitizeJamendoTrack(rawTrack({ duration }))?.durationSeconds).toBe(0)
    }
  })

  it('omits a missing audio URL so the track is marked unplayable downstream', () => {
    expect(sanitizeJamendoTrack(rawTrack({ audio: '' }))?.audioUrl).toBeUndefined()
    expect(sanitizeJamendoTrack(rawTrack({ audio: null }))?.audioUrl).toBeUndefined()
  })

  it('rejects a non-HTTPS or malformed audio URL', () => {
    expect(sanitizeJamendoTrack(rawTrack({ audio: 'http://insecure.example/a.mp3' }))?.audioUrl).toBeUndefined()
    expect(sanitizeJamendoTrack(rawTrack({ audio: 'not a url' }))?.audioUrl).toBeUndefined()
    expect(sanitizeJamendoTrack(rawTrack({ audio: 'javascript:alert(1)' }))?.audioUrl).toBeUndefined()
  })

  it('falls back from shareurl to shorturl for the attribution backlink', () => {
    expect(sanitizeJamendoTrack(rawTrack({ shareurl: '' }))?.sourceUrl).toBe('https://jamen.do/t/1880336')
  })

  it('omits the source URL entirely when the provider sent neither form', () => {
    expect(sanitizeJamendoTrack(rawTrack({ shareurl: '', shorturl: '' }))?.sourceUrl).toBeUndefined()
  })

  it('keeps the Creative Commons deed URL', () => {
    expect(sanitizeJamendoTrack(rawTrack())?.licenseUrl).toContain('creativecommons.org')
    expect(sanitizeJamendoTrack(rawTrack({ license_ccurl: null }))?.licenseUrl).toBeUndefined()
  })

  it('drops a row that has no usable identity', () => {
    expect(sanitizeJamendoTrack(rawTrack({ id: '' }))).toBeNull()
    expect(sanitizeJamendoTrack(rawTrack({ name: '  ' }))).toBeNull()
    expect(sanitizeJamendoTrack(null)).toBeNull()
    expect(sanitizeJamendoTrack('a string')).toBeNull()
    expect(sanitizeJamendoTrack(42)).toBeNull()
  })

  it('names an artist-less row rather than rendering a blank byline', () => {
    expect(sanitizeJamendoTrack(rawTrack({ artist_name: '' }))?.artistName).toBe('Unknown artist')
  })

  it('refuses to publish any URL containing the configured credential', () => {
    // Defensive: if Jamendo ever embedded the client id in the stream URL, the
    // credential rule outranks playing that one track.
    const track = sanitizeJamendoTrack(
      rawTrack({ audio: 'https://prod-1.storage.jamendo.com/?trackid=1&from=app-abc12345' }),
      { clientId: 'abc12345' },
    )
    expect(track?.audioUrl).toBeUndefined()
    // A URL that does not carry the credential is still published.
    expect(track?.sourceUrl).toBe('https://www.jamendo.com/track/1880336/reverie')
  })

  it('survives a malformed provider response without throwing', () => {
    expect(sanitizeJamendoTracks(null)).toEqual([])
    expect(sanitizeJamendoTracks({ nope: true })).toEqual([])
    expect(sanitizeJamendoTracks(['x', null, 7, {}])).toEqual([])
  })

  it('drops duplicate ids so the list cannot produce duplicate React keys', () => {
    const tracks = sanitizeJamendoTracks([rawTrack(), rawTrack(), rawTrack({ id: '2' })])
    expect(tracks.map((track) => track.id)).toEqual(['1880336', '2'])
  })
})
