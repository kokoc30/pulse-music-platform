import { describe, expect, it } from 'vitest'
import {
  audiusRef,
  jamendoRef,
  libraryWith,
  playlist,
  youtubeRef,
  FIXED_NOW,
} from '@/test/fixtures/library'
import { createFakeLibraryRepository } from './fake-repository'
import { migrateLibrary } from './migrations'
import {
  createMemoryLibraryRepository,
  isIndexedDbAvailable,
  normalizePlaylistDescription,
  normalizePlaylistName,
  sanitizeLibrary,
  sanitizeTrackRef,
  toPersistedLibrary,
} from './storage'
import {
  MAX_HIDDEN_KEYS,
  MAX_LIKED_TRACKS,
  MAX_PLAYLISTS,
  MAX_PLAYLIST_NAME_LENGTH,
  MAX_TRACKS_PER_PLAYLIST,
  createEmptyLibrary,
} from './types'

describe('reading a stored library never crashes', () => {
  it('accepts anything at all and returns a usable state', () => {
    for (const value of [null, undefined, 0, 'x', [], true, { version: 'one' }]) {
      const { state } = sanitizeLibrary(value)
      expect(state.tracks).toEqual({})
      expect(state.likedTrackKeys).toEqual([])
      expect(state.playlists).toEqual({})
    }
  })

  it('drops a malformed reference and keeps the rest', () => {
    const { state, repaired } = sanitizeLibrary({
      version: 1,
      tracks: {
        'audius:t1': { ...audiusRef(), key: undefined },
        broken: { provider: 'audius' },
        alsoBroken: 'not an object',
      },
      likedTrackKeys: ['audius:t1', 'broken'],
    })

    expect(Object.keys(state.tracks)).toEqual(['audius:t1'])
    expect(state.likedTrackKeys).toEqual(['audius:t1'])
    expect(repaired).toBe(true)
  })

  it('rebuilds the key from the provider and id rather than trusting the stored one', () => {
    const ref = sanitizeTrackRef({ ...audiusRef(), key: 'jamendo:evil' })
    expect(ref?.key).toBe('audius:t1')
  })

  it('rejects a reference with no provider, id or title', () => {
    expect(sanitizeTrackRef({ provider: 'audius', providerItemId: 't1' })).toBeNull()
    expect(sanitizeTrackRef({ provider: 'spotify', providerItemId: 't1', title: 'x' })).toBeNull()
    expect(sanitizeTrackRef({ provider: 'audius', title: 'x' })).toBeNull()
  })

  it('refuses a non-http artwork or source URL', () => {
    const ref = sanitizeTrackRef({
      ...audiusRef(),
      artwork: { url: 'javascript:alert(1)', mirrors: ['javascript:alert(2)'] },
      sourceUrl: 'data:text/html,<script>',
    })
    expect(ref?.artwork).toBeUndefined()
    expect(ref?.sourceUrl).toBeUndefined()
  })
})

describe('the stored shape can never hold a dangling reference', () => {
  it('drops playlist keys with no surviving track', () => {
    const { state, repaired } = sanitizeLibrary({
      version: 1,
      tracks: { 'audius:t1': audiusRef() },
      playlists: {
        pl_a: { ...playlist(), id: 'pl_a', itemKeys: ['audius:t1', 'audius:ghost'] },
      },
      playlistOrder: ['pl_a'],
    })

    expect(state.playlists.pl_a.itemKeys).toEqual(['audius:t1'])
    expect(repaired).toBe(true)
  })

  it('drops liked keys with no surviving track', () => {
    const { state } = sanitizeLibrary({
      version: 1,
      tracks: { 'audius:t1': audiusRef() },
      likedTrackKeys: ['audius:t1', 'jamendo:ghost'],
    })
    expect(state.likedTrackKeys).toEqual(['audius:t1'])
  })

  it('deduplicates a key repeated inside one playlist', () => {
    const { state } = sanitizeLibrary({
      version: 1,
      tracks: { 'audius:t1': audiusRef() },
      playlists: {
        pl_a: { ...playlist(), id: 'pl_a', itemKeys: ['audius:t1', 'audius:t1'] },
      },
      playlistOrder: ['pl_a'],
    })
    expect(state.playlists.pl_a.itemKeys).toEqual(['audius:t1'])
  })
})

describe('bounds are enforced on read as well as on write', () => {
  it('caps liked songs', () => {
    const tracks: Record<string, unknown> = {}
    const liked: string[] = []
    for (let index = 0; index < MAX_LIKED_TRACKS + 25; index += 1) {
      const key = `audius:t${index}`
      tracks[key] = audiusRef({ key, providerItemId: `t${index}` })
      liked.push(key)
    }
    const { state } = sanitizeLibrary({ version: 1, tracks, likedTrackKeys: liked })
    expect(state.likedTrackKeys).toHaveLength(MAX_LIKED_TRACKS)
  })

  it('caps playlists', () => {
    const playlists: Record<string, unknown> = {}
    const order: string[] = []
    for (let index = 0; index < MAX_PLAYLISTS + 10; index += 1) {
      playlists[`pl_${index}`] = { ...playlist(), id: `pl_${index}`, name: `List ${index}` }
      order.push(`pl_${index}`)
    }
    const { state } = sanitizeLibrary({ version: 1, playlists, playlistOrder: order })
    expect(state.playlistOrder).toHaveLength(MAX_PLAYLISTS)
  })

  it('caps tracks in one playlist', () => {
    const tracks: Record<string, unknown> = {}
    const keys: string[] = []
    for (let index = 0; index < MAX_TRACKS_PER_PLAYLIST + 5; index += 1) {
      const key = `audius:t${index}`
      tracks[key] = audiusRef({ key, providerItemId: `t${index}` })
      keys.push(key)
    }
    const { state } = sanitizeLibrary({
      version: 1,
      tracks,
      playlists: { pl_a: { ...playlist(), id: 'pl_a', itemKeys: keys } },
      playlistOrder: ['pl_a'],
    })
    expect(state.playlists.pl_a.itemKeys).toHaveLength(MAX_TRACKS_PER_PLAYLIST)
  })

  it('caps hidden keys and ignores ones that are not library keys', () => {
    const hidden = Array.from({ length: MAX_HIDDEN_KEYS + 10 }, (_, i) => `audius:h${i}`)
    const { state } = sanitizeLibrary({
      version: 1,
      hiddenRecommendationKeys: [...hidden, 'not-a-key', 'spotify:x', 42],
    })
    expect(state.hiddenRecommendationKeys).toHaveLength(MAX_HIDDEN_KEYS)
    expect(state.hiddenRecommendationKeys).not.toContain('not-a-key')
    expect(state.hiddenRecommendationKeys).not.toContain('spotify:x')
  })
})

describe('playlist names are visitor text', () => {
  it('trims but never transliterates', () => {
    expect(normalizePlaylistName('  Դանդաղ երգեր  ')).toBe('Դանդաղ երգեր')
    expect(normalizePlaylistName('أغاني الطريق')).toBe('أغاني الطريق')
    expect(normalizePlaylistName('🎧 Late night')).toBe('🎧 Late night')
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(normalizePlaylistName('   ')).toBeUndefined()
    expect(normalizePlaylistName('')).toBeUndefined()
    expect(normalizePlaylistName(42)).toBeUndefined()
  })

  it('truncates rather than rejecting an over-long name', () => {
    const long = 'a'.repeat(MAX_PLAYLIST_NAME_LENGTH + 50)
    expect(normalizePlaylistName(long)).toHaveLength(MAX_PLAYLIST_NAME_LENGTH)
  })

  it('stores markup verbatim, because nothing interprets it', () => {
    // React escapes it at render time; storage is not the place to mangle a
    // name someone legitimately chose.
    expect(normalizePlaylistName('<b>bold</b>')).toBe('<b>bold</b>')
    expect(normalizePlaylistDescription('  a & b  ')).toBe('a & b')
  })
})

describe('the persisted allow-list', () => {
  const persisted = () =>
    toPersistedLibrary(
      libraryWith({
        tracks: [audiusRef(), jamendoRef(), youtubeRef()],
        liked: ['audius:t1', 'youtube:aaaaaaaaaaa'],
        playlists: [playlist({ itemKeys: ['jamendo:1880336'] })],
        hidden: ['audius:h1'],
      }),
    )

  it('writes only the named fields', () => {
    const record = persisted().tracks as Record<string, Record<string, unknown>>
    expect(Object.keys(record['audius:t1']).sort()).toEqual(
      [
        'addedAt',
        'artist',
        'artistId',
        'artwork',
        'durationSeconds',
        'genre',
        'metadataUpdatedAt',
        'provider',
        'providerItemId',
        'sourceUrl',
        'title',
      ].sort(),
    )
  })

  it('has no field for a stream URL, a key or a token, even if one is offered', () => {
    const record = toPersistedLibrary(
      libraryWith({
        tracks: [
          {
            ...audiusRef(),
            // Fields production never sets, forced in to prove the allow-list is
            // a construction rather than a filter.
            ...({
              streamUrl: 'https://cdn.example/secret.mp3',
              audioUrl: 'https://cdn.example/secret.mp3',
              apiKey: 'AIzaSyFAKE',
              accessToken: 'token',
              raw: { anything: true },
            } as object),
          },
        ],
        liked: ['audius:t1'],
      }),
    )
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain('streamUrl')
    expect(serialized).not.toContain('audioUrl')
    expect(serialized).not.toContain('secret.mp3')
    expect(serialized).not.toContain('AIzaSyFAKE')
    expect(serialized).not.toContain('accessToken')
    expect(serialized).not.toContain('"raw"')
  })

  it('never writes a YouTube statistic, because there is no field for one', () => {
    const record = toPersistedLibrary(
      libraryWith({
        tracks: [
          {
            ...youtubeRef(),
            ...({ viewCount: 1_000_000, likeCount: 42, commentCount: 7 } as object),
          },
        ],
        liked: ['youtube:aaaaaaaaaaa'],
      }),
    )
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain('viewCount')
    expect(serialized).not.toContain('likeCount')
    expect(serialized).not.toContain('commentCount')
    expect(serialized).not.toContain('1000000')
  })

  it('always stamps a YouTube reference with its deletion deadline', () => {
    const record = persisted().tracks as Record<string, Record<string, unknown>>
    const youtube = record['youtube:aaaaaaaaaaa']
    expect(youtube.youtubeExpiresAt).toBe(youtubeRef().youtubeExpiresAt)
    expect(youtube.embeddable).toBe(true)
    expect(youtube.madeForKids).toBe(false)
  })

  it('round-trips a full library unchanged', () => {
    const original = libraryWith({
      tracks: [audiusRef(), jamendoRef()],
      liked: ['audius:t1'],
      playlists: [playlist({ itemKeys: ['jamendo:1880336', 'audius:t1'] })],
      hidden: ['audius:h1'],
    })
    const { state } = sanitizeLibrary(toPersistedLibrary(original))

    expect(state.likedTrackKeys).toEqual(original.likedTrackKeys)
    expect(state.playlists.pl_test.itemKeys).toEqual(['jamendo:1880336', 'audius:t1'])
    expect(state.hiddenRecommendationKeys).toEqual(['audius:h1'])
    expect(Object.keys(state.tracks).sort()).toEqual(['audius:t1', 'jamendo:1880336'])
  })
})

describe('version handling', () => {
  it('migrates a current record forward untouched', () => {
    const result = migrateLibrary({ version: 1, tracks: {} })
    expect(result.kind).toBe('ok')
  })

  it('refuses to reinterpret a newer record', () => {
    expect(migrateLibrary({ version: 2, tracks: {} }).kind).toBe('incompatible')
  })

  it('rejects something that is not a library record at all', () => {
    expect(migrateLibrary({ hello: true }).kind).toBe('unusable')
    expect(migrateLibrary('nope').kind).toBe('unusable')
    expect(migrateLibrary({ version: 0 }).kind).toBe('unusable')
  })

  it('leaves a newer record on disk rather than deleting it', async () => {
    const repository = createFakeLibraryRepository()
    repository.seedRaw({ version: 9, tracks: { 'audius:t1': audiusRef() } })

    const result = await repository.read()
    expect(result.status).toBe('incompatible')
    expect(result.state).toEqual(expect.objectContaining({ tracks: {} }))
    // Still there, for the build that wrote it.
    expect(repository.raw()).toEqual(expect.objectContaining({ version: 9 }))
  })
})

describe('storage that cannot store', () => {
  it('falls back to memory when IndexedDB is absent, as it is under jsdom', () => {
    expect(isIndexedDbAvailable()).toBe(false)
  })

  it('keeps working in memory and reports itself unavailable', async () => {
    const repository = createMemoryLibraryRepository()
    const state = libraryWith({ tracks: [audiusRef()], liked: ['audius:t1'] })

    expect(await repository.write(state)).toBe('unavailable')
    const read = await repository.read()
    expect(read.status).toBe('unavailable')
    // The session still has its data; it simply will not survive a reload.
    expect(read.state.likedTrackKeys).toEqual(['audius:t1'])
  })

  it('reports a failed write without losing the in-memory state', async () => {
    const repository = createFakeLibraryRepository()
    repository.setWritable(false)
    expect(await repository.write(libraryWith({ tracks: [audiusRef()] }))).toBe('unavailable')
    expect(repository.writes()).toBe(0)
  })
})

describe('an empty library', () => {
  it('is a valid, complete state', () => {
    const empty = createEmptyLibrary(FIXED_NOW)
    expect(empty.version).toBe(1)
    expect(empty.updatedAt).toBe(FIXED_NOW)
    const { state, repaired } = sanitizeLibrary(toPersistedLibrary(empty))
    expect(repaired).toBe(false)
    expect(state).toEqual(empty)
  })
})
