import { describe, expect, it } from 'vitest'
import { FORBIDDEN_WIRE_KEYS, WIRE_KEYS, parseJamendoSearchPayload, parseJamendoTrack } from './wire'

const VALID = {
  id: '1',
  title: 'Reverie',
  artistName: 'Lumen Field',
  durationSeconds: 214,
  artwork: 'https://usercontent.jamendo.com/track/1/covers/1.300.jpg',
  audioUrl: 'https://prod-1.storage.jamendo.com/?trackid=1&format=mp32',
  sourceUrl: 'https://www.jamendo.com/track/1/reverie',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
}

describe('Jamendo wire validation', () => {
  it('accepts a well-formed payload', () => {
    expect(parseJamendoTrack(VALID)).toMatchObject({ id: '1', title: 'Reverie', durationSeconds: 214 })
  })

  it('declares exactly the key list the server promises to emit', () => {
    // Mirrors `PAYLOAD_KEYS` in server/jamendo/sanitize.ts. If the two ever
    // drift, one of these two assertions fails rather than the app breaking.
    expect([...WIRE_KEYS].sort()).toEqual(
      [
        'albumName',
        'artistId',
        'artistName',
        'artwork',
        'artworkLarge',
        'audioUrl',
        // Phase 6 similarity metadata. Sent only on the `similar` action, but
        // declared unconditionally so the two key lists stay comparable.
        'bpm',
        'durationSeconds',
        'id',
        'licenseUrl',
        'releaseDate',
        'sourceUrl',
        'tags',
        'title',
      ].sort(),
    )
  })

  it('rejects a row carrying any forbidden key outright, rather than filtering it', () => {
    // A row with `audiodownload` means the sanitizer did not run; trusting the
    // rest of that response would be unsafe.
    for (const key of FORBIDDEN_WIRE_KEYS) {
      expect(parseJamendoTrack({ ...VALID, [key]: 'x' })).toBeNull()
    }
  })

  it('rejects a non-HTTPS or unparseable URL even though the server should have', () => {
    expect(parseJamendoTrack({ ...VALID, audioUrl: 'http://insecure/a.mp3' })?.audioUrl).toBeUndefined()
    expect(parseJamendoTrack({ ...VALID, sourceUrl: 'javascript:alert(1)' })?.sourceUrl).toBeUndefined()
    expect(parseJamendoTrack({ ...VALID, artwork: 'not a url' })?.artwork).toBeUndefined()
  })

  it('coerces a string duration and rejects a nonsensical one', () => {
    expect(parseJamendoTrack({ ...VALID, durationSeconds: '187' })?.durationSeconds).toBe(187)
    expect(parseJamendoTrack({ ...VALID, durationSeconds: 'abc' })?.durationSeconds).toBe(0)
    expect(parseJamendoTrack({ ...VALID, durationSeconds: -3 })?.durationSeconds).toBe(0)
  })

  it('drops a row with no identity', () => {
    expect(parseJamendoTrack({ ...VALID, id: '' })).toBeNull()
    expect(parseJamendoTrack({ ...VALID, title: '   ' })).toBeNull()
    expect(parseJamendoTrack(null)).toBeNull()
    expect(parseJamendoTrack('nope')).toBeNull()
  })

  it('survives a malformed envelope without throwing', () => {
    expect(parseJamendoSearchPayload(null)).toEqual([])
    expect(parseJamendoSearchPayload({})).toEqual([])
    expect(parseJamendoSearchPayload({ results: 'nope' })).toEqual([])
    expect(parseJamendoSearchPayload({ results: [null, 3, 'x'] })).toEqual([])
  })

  it('de-duplicates by provider id', () => {
    const parsed = parseJamendoSearchPayload({ results: [VALID, VALID, { ...VALID, id: '2' }] })
    expect(parsed.map((track) => track.id)).toEqual(['1', '2'])
  })
})
