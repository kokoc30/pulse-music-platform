import { describe, expect, it } from 'vitest'
import { audiusRef, libraryWith, playlist, youtubeRef, FIXED_NOW } from '@/test/fixtures/library'
import { MS_PER_DAY, YOUTUBE_RETENTION_DAYS } from '@/personalization/config'
import { collectGarbage } from './actions'
import { toPersistedLibrary } from './storage'
import { trackRefFromYouTube } from './track-ref'
import {
  canPlaySavedYouTubeRef,
  isExpiredYouTubeRef,
  purgeExpiredYouTubeFromLibrary,
  youtubeExpiryFor,
} from './youtube-policy'
import type { YouTubeVideoItem } from '@/music/types'

/**
 * YouTube API Services Developer Policies §III.E.4.d, applied to saved items.
 *
 * Pulse has no YouTube OAuth, so everything it holds is Non-Authorized Data and
 * 30 days is a ceiling. These tests are the enforcement: the constant, the
 * expiry arithmetic, the cascade when an item expires, and the absence of any
 * statistic in what is written (agents/44).
 */

const DAY = MS_PER_DAY

describe('the retention window', () => {
  it('is 30 days, shared with the history rule so the two cannot drift', () => {
    expect(YOUTUBE_RETENTION_DAYS).toBe(30)
    expect(youtubeExpiryFor(FIXED_NOW)).toBe(FIXED_NOW + 30 * DAY)
  })

  it('is stamped at save time, not inferred later', () => {
    const item: YouTubeVideoItem = {
      id: 'youtube:zzz',
      mediaKind: 'youtube-video',
      provider: 'youtube',
      providerId: 'zzz',
      videoId: 'zzz',
      title: 'A Video',
      channelTitle: 'A Channel',
      thumbnailUrl: 'https://i.ytimg.com/vi/zzz/hqdefault.jpg',
      sourceUrl: 'https://www.youtube.com/watch?v=zzz',
      embeddable: true,
      madeForKids: false,
    }
    const ref = trackRefFromYouTube(item, FIXED_NOW)
    expect(ref.youtubeExpiresAt).toBe(FIXED_NOW + 30 * DAY)
    expect(ref.youtubeExpiresAt! - ref.metadataUpdatedAt).toBeLessThanOrEqual(30 * DAY)
  })

  it('treats a reference with no expiry as already expired, never as permanent', () => {
    const ref = { ...youtubeRef(), youtubeExpiresAt: 0 }
    expect(isExpiredYouTubeRef(ref, FIXED_NOW)).toBe(true)
  })

  it('never expires a catalogue reference', () => {
    expect(isExpiredYouTubeRef(audiusRef(), FIXED_NOW + 400 * DAY)).toBe(false)
  })

  it('expires exactly at the boundary, not after it', () => {
    const ref = youtubeRef()
    expect(isExpiredYouTubeRef(ref, FIXED_NOW + 30 * DAY - 1)).toBe(false)
    expect(isExpiredYouTubeRef(ref, FIXED_NOW + 30 * DAY)).toBe(true)
  })
})

describe('a saved YouTube item may only be offered when it is still playable', () => {
  it('accepts one inside retention that YouTube reported as safe to embed', () => {
    expect(canPlaySavedYouTubeRef(youtubeRef(), FIXED_NOW + DAY)).toBe(true)
  })

  it('refuses an expired one, even though the fields are all present', () => {
    expect(canPlaySavedYouTubeRef(youtubeRef(), FIXED_NOW + 31 * DAY)).toBe(false)
  })

  it('refuses one YouTube said may not be embedded', () => {
    expect(canPlaySavedYouTubeRef(youtubeRef({ embeddable: false }), FIXED_NOW)).toBe(false)
  })

  it('requires an explicit not-made-for-kids, treating silence as refusal', () => {
    expect(canPlaySavedYouTubeRef(youtubeRef({ madeForKids: true }), FIXED_NOW)).toBe(false)
    expect(canPlaySavedYouTubeRef(youtubeRef({ madeForKids: null }), FIXED_NOW)).toBe(false)
  })
})

describe('expiry removes the saved item outright', () => {
  const seeded = () =>
    libraryWith({
      tracks: [audiusRef(), youtubeRef()],
      liked: ['youtube:aaaaaaaaaaa', 'audius:t1'],
      playlists: [playlist({ itemKeys: ['youtube:aaaaaaaaaaa', 'audius:t1'] })],
      hidden: ['youtube:aaaaaaaaaaa'],
    })

  it('deletes the reference, its like, and its place in every playlist', () => {
    const purged = purgeExpiredYouTubeFromLibrary(seeded(), FIXED_NOW + 31 * DAY)

    expect(purged.tracks['youtube:aaaaaaaaaaa']).toBeUndefined()
    expect(purged.likedTrackKeys).toEqual(['audius:t1'])
    expect(purged.playlists.pl_test.itemKeys).toEqual(['audius:t1'])
    expect(purged.hiddenRecommendationKeys).toEqual([])
  })

  it('leaves no placeholder behind — the strict route agents/44 asks for', () => {
    const purged = purgeExpiredYouTubeFromLibrary(seeded(), FIXED_NOW + 31 * DAY)
    const serialized = JSON.stringify(toPersistedLibrary(purged))
    expect(serialized).not.toContain('aaaaaaaaaaa')
    expect(serialized).not.toContain('Qele Qele')
    expect(serialized).not.toContain('Sirusho')
    expect(serialized).not.toContain('ytimg')
  })

  it('leaves the catalogue items entirely alone', () => {
    const purged = purgeExpiredYouTubeFromLibrary(seeded(), FIXED_NOW + 31 * DAY)
    expect(purged.tracks['audius:t1']).toEqual(audiusRef())
  })

  it('returns the same instance when nothing has expired, so no write happens', () => {
    const state = seeded()
    expect(purgeExpiredYouTubeFromLibrary(state, FIXED_NOW + DAY)).toBe(state)
  })

  it('leaves the library internally consistent after a purge', () => {
    const purged = collectGarbage(
      purgeExpiredYouTubeFromLibrary(seeded(), FIXED_NOW + 31 * DAY),
    )
    for (const list of Object.values(purged.playlists)) {
      for (const key of list.itemKeys) expect(purged.tracks[key]).toBeDefined()
    }
    for (const key of purged.likedTrackKeys) expect(purged.tracks[key]).toBeDefined()
  })
})

describe('nothing prohibited is ever written', () => {
  it('has no field for a YouTube statistic', () => {
    const written = toPersistedLibrary(
      libraryWith({ tracks: [youtubeRef()], liked: ['youtube:aaaaaaaaaaa'] }),
    )
    const record = (written.tracks as Record<string, Record<string, unknown>>)[
      'youtube:aaaaaaaaaaa'
    ]
    expect(Object.keys(record).sort()).toEqual(
      [
        'addedAt',
        'durationSeconds',
        'embeddable',
        'madeForKids',
        'metadataUpdatedAt',
        'provider',
        'providerItemId',
        'sourceUrl',
        'thumbnailUrl',
        'title',
        'artist',
        'youtubeExpiresAt',
      ].sort(),
    )
  })

  it('keeps the thumbnail as an address, never as bytes', () => {
    const ref = youtubeRef()
    expect(ref.thumbnailUrl).toMatch(/^https:\/\//)
    expect(JSON.stringify(toPersistedLibrary(libraryWith({ tracks: [ref] })))).not.toContain(
      'base64',
    )
  })
})
