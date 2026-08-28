import type { Track as AudiusTrack, User as AudiusUser } from '@audius/sdk'
import { describe, expect, it } from 'vitest'
import {
  buildArtworkCandidates,
  isTrackStreamable,
  normalizeArtists,
  normalizeTrack,
  normalizeTracks,
  pickArtwork,
} from './normalize'

/** SDK-model shape (post-`FromJSON`), which is what the adapter hands us. */
const sdkTrack = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'abc123',
    title: '  Midnight Signal  ',
    duration: 214,
    genre: 'House',
    mood: 'Energizing',
    playCount: 12345,
    permalink: '/nova/midnight-signal',
    isStreamable: true,
    access: { stream: true, download: true },
    artwork: {
      _150x150: 'https://cn1.test/content/a/150x150.jpg',
      _480x480: 'https://cn1.test/content/a/480x480.jpg',
      _1000x1000: 'https://cn1.test/content/a/1000x1000.jpg',
      mirrors: ['https://cn2.test', 'https://cn3.test/'],
    },
    user: { id: 'u1', name: 'Nova Sound', handle: 'novasound' },
    ...overrides,
  }) as unknown as AudiusTrack

describe('normalizeTrack', () => {
  it('maps an Audius track onto the domain model', () => {
    const track = normalizeTrack(sdkTrack())
    expect(track).toMatchObject({
      id: 'audius:abc123',
      provider: 'audius',
      providerId: 'abc123',
      title: 'Midnight Signal',
      artistName: 'Nova Sound',
      artistId: 'u1',
      artistHandle: 'novasound',
      durationSeconds: 214,
      genre: 'House',
      mood: 'Energizing',
      playCount: 12345,
      isStreamable: true,
      permalink: 'https://audius.co/nova/midnight-signal',
    })
    expect(track?.artwork).toMatchObject({
      small: 'https://cn1.test/content/a/150x150.jpg',
      medium: 'https://cn1.test/content/a/480x480.jpg',
      large: 'https://cn1.test/content/a/1000x1000.jpg',
    })
  })

  it('returns null when the provider id is missing', () => {
    expect(normalizeTrack(sdkTrack({ id: '' }))).toBeNull()
    expect(normalizeTrack(sdkTrack({ id: undefined }))).toBeNull()
  })

  it('survives a missing artwork object', () => {
    const track = normalizeTrack(sdkTrack({ artwork: undefined }))
    expect(track?.artwork).toEqual({})
    expect(pickArtwork(track!.artwork, 'medium')).toBeUndefined()
  })

  it('survives a missing user', () => {
    expect(normalizeTrack(sdkTrack({ user: undefined }))?.artistName).toBe('Unknown artist')
  })

  it('falls back to the handle and strips a leading @ from the display name', () => {
    expect(normalizeTrack(sdkTrack({ user: { id: 'u2', name: '@Kite', handle: 'kite' } }))?.artistName).toBe('Kite')
    expect(normalizeTrack(sdkTrack({ user: { id: 'u3', name: '  ', handle: 'ghost' } }))?.artistName).toBe('ghost')
  })

  it('coerces an unusable duration to zero rather than NaN', () => {
    expect(normalizeTrack(sdkTrack({ duration: undefined }))?.durationSeconds).toBe(0)
    expect(normalizeTrack(sdkTrack({ duration: Number.NaN }))?.durationSeconds).toBe(0)
    expect(normalizeTrack(sdkTrack({ duration: -12 }))?.durationSeconds).toBe(0)
  })

  it('drops a negative or non-numeric play count instead of rendering it', () => {
    expect(normalizeTrack(sdkTrack({ playCount: -1 }))?.playCount).toBeUndefined()
    expect(normalizeTrack(sdkTrack({ playCount: 0 }))?.playCount).toBe(0)
  })

  it('leaves an already absolute permalink alone', () => {
    expect(normalizeTrack(sdkTrack({ permalink: 'https://audius.co/x/y' }))?.permalink).toBe(
      'https://audius.co/x/y',
    )
  })

  it('gives an untitled track a readable fallback title', () => {
    expect(normalizeTrack(sdkTrack({ title: '   ' }))?.title).toBe('Untitled track')
  })
})

describe('isTrackStreamable', () => {
  it('is true only when both the flag and stream access allow it', () => {
    expect(isTrackStreamable(sdkTrack())).toBe(true)
    expect(isTrackStreamable(sdkTrack({ isStreamable: false }))).toBe(false)
    expect(isTrackStreamable(sdkTrack({ access: { stream: false, download: false } }))).toBe(false)
  })

  it('treats a missing flag as streamable, matching the API default', () => {
    expect(isTrackStreamable(sdkTrack({ isStreamable: undefined, access: undefined }))).toBe(true)
  })
})

describe('normalizeTracks', () => {
  it('drops invalid entries and de-duplicates by id', () => {
    const tracks = normalizeTracks([
      sdkTrack({ id: 'a' }),
      sdkTrack({ id: 'a' }),
      sdkTrack({ id: '' }),
      sdkTrack({ id: 'b' }),
    ])
    expect(tracks.map((track) => track.id)).toEqual(['audius:a', 'audius:b'])
  })

  it('returns an empty array for a missing payload', () => {
    expect(normalizeTracks(undefined)).toEqual([])
    expect(normalizeTracks(null)).toEqual([])
  })
})

describe('pickArtwork', () => {
  const artwork = { small: 's', medium: 'm', large: 'l' }

  it('prefers the requested size', () => {
    expect(pickArtwork(artwork, 'small')).toBe('s')
    expect(pickArtwork(artwork, 'medium')).toBe('m')
    expect(pickArtwork(artwork, 'large')).toBe('l')
  })

  it('falls back through the other sizes', () => {
    expect(pickArtwork({ large: 'l' }, 'small')).toBe('l')
    expect(pickArtwork({ small: 's' }, 'large')).toBe('s')
    expect(pickArtwork({}, 'medium')).toBeUndefined()
  })
})

describe('buildArtworkCandidates', () => {
  it('lists the primary URL followed by each mirror of the same path', () => {
    const track = normalizeTrack(sdkTrack())!
    expect(buildArtworkCandidates(track.artwork, 'medium')).toEqual([
      'https://cn1.test/content/a/480x480.jpg',
      'https://cn2.test/content/a/480x480.jpg',
      'https://cn3.test/content/a/480x480.jpg',
    ])
  })

  it('returns nothing when there is no artwork at all', () => {
    expect(buildArtworkCandidates({}, 'small')).toEqual([])
  })

  it('ignores non-http mirror entries', () => {
    const track = normalizeTrack(
      sdkTrack({
        artwork: {
          _150x150: 'https://cn1.test/content/a/150x150.jpg',
          mirrors: ['javascript:alert(1)', 'https://ok.test'],
        },
      }),
    )!
    expect(buildArtworkCandidates(track.artwork, 'small')).toEqual([
      'https://cn1.test/content/a/150x150.jpg',
      'https://ok.test/content/a/150x150.jpg',
    ])
  })
})

describe('normalizeArtists', () => {
  const user = (overrides: Record<string, unknown>) =>
    ({ id: 'u1', name: 'Nova', handle: 'nova', isVerified: true, ...overrides }) as unknown as AudiusUser

  it('maps users and builds a profile permalink', () => {
    expect(normalizeArtists([user({})])[0]).toMatchObject({
      id: 'audius:u1',
      name: 'Nova',
      handle: 'nova',
      isVerified: true,
      permalink: 'https://audius.co/nova',
    })
  })

  it('skips deactivated and unavailable profiles', () => {
    const artists = normalizeArtists([
      user({ id: 'a' }),
      user({ id: 'b', isDeactivated: true }),
      user({ id: 'c', isAvailable: false }),
    ])
    expect(artists.map((artist) => artist.providerId)).toEqual(['a'])
  })
})
