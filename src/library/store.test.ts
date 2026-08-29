import { beforeEach, describe, expect, it } from 'vitest'
import { audiusRef, jamendoRef, libraryWith, playlist, youtubeRef, FIXED_NOW } from '@/test/fixtures/library'
import { setExplicitIntentSource } from '@/personalization/explicit-intent'
import { createFakeLibraryRepository } from './fake-repository'
import type { FakeLibraryRepository } from './fake-repository'
import { onLibraryChange, setLibraryRepository, useLibraryStore } from './store'
import { createEmptyLibrary } from './types'

/**
 * The store: what reaches disk, what does not, and what happens when disk is
 * not there at all.
 */

let repository: FakeLibraryRepository

const store = () => useLibraryStore.getState()

beforeEach(() => {
  setExplicitIntentSource(null)
  repository = createFakeLibraryRepository()
  setLibraryRepository(repository)
  useLibraryStore.setState({
    state: createEmptyLibrary(FIXED_NOW),
    status: 'ok',
    hydrated: false,
    storageAvailable: false,
  })
})

describe('hydration', () => {
  it('reads a previous session back', async () => {
    repository.seed(
      libraryWith({
        tracks: [audiusRef()],
        liked: ['audius:t1'],
        playlists: [playlist({ itemKeys: ['audius:t1'] })],
      }),
    )

    await store().hydrate()

    expect(store().hydrated).toBe(true)
    expect(store().storageAvailable).toBe(true)
    expect(store().state.likedTrackKeys).toEqual(['audius:t1'])
    expect(store().state.playlists.pl_test.itemKeys).toEqual(['audius:t1'])
  })

  it('starts empty when there is nothing stored', async () => {
    await store().hydrate()
    expect(store().state.likedTrackKeys).toEqual([])
    expect(store().status).toBe('ok')
  })

  it('purges expired YouTube saves before anything can render', async () => {
    const expired = youtubeRef({ metadataUpdatedAt: FIXED_NOW - 40 * 86_400_000 })
    repository.seed(
      libraryWith({
        tracks: [audiusRef(), expired],
        liked: [expired.key, 'audius:t1'],
        playlists: [playlist({ itemKeys: [expired.key] })],
      }),
    )

    await store().hydrate()

    expect(store().state.tracks[expired.key]).toBeUndefined()
    expect(store().state.likedTrackKeys).toEqual(['audius:t1'])
    expect(store().state.playlists.pl_test.itemKeys).toEqual([])
  })

  it('writes the purge back, so it is gone from disk too', async () => {
    repository.seed(
      libraryWith({
        tracks: [youtubeRef({ metadataUpdatedAt: FIXED_NOW - 40 * 86_400_000 })],
        liked: ['youtube:aaaaaaaaaaa'],
      }),
    )

    await store().hydrate()
    await Promise.resolve()

    expect(JSON.stringify(repository.raw())).not.toContain('aaaaaaaaaaa')
  })

  it('reports a newer record as incompatible and does not overwrite it', async () => {
    repository.seedRaw({ version: 12, tracks: {} })

    await store().hydrate()
    await Promise.resolve()

    expect(store().status).toBe('incompatible')
    expect(store().storageAvailable).toBe(false)
    // The build that wrote it is entitled to find it intact.
    expect(repository.raw()).toEqual(expect.objectContaining({ version: 12 }))
  })
})

describe('a mutation either lands completely or writes nothing', () => {
  it('persists a like', async () => {
    await store().hydrate()
    store().like(audiusRef())
    await Promise.resolve()

    const raw = repository.raw()!
    expect(raw.likedTrackKeys).toEqual(['audius:t1'])
    expect(Object.keys(raw.tracks as object)).toEqual(['audius:t1'])
  })

  it('writes nothing at all when a mutation is refused', async () => {
    await store().hydrate()
    store().like(audiusRef())
    await Promise.resolve()
    const writesBefore = repository.writes()

    // A duplicate playlist add, which the reducer declines.
    store().createPlaylist({ name: 'A', track: audiusRef() })
    await Promise.resolve()
    const playlistId = store().state.playlistOrder[0]
    const writesAfterCreate = repository.writes()

    const refused = store().addToPlaylist(playlistId, audiusRef())
    await Promise.resolve()

    expect(refused.ok).toBe(false)
    expect(refused.reason).toBe('duplicate')
    expect(repository.writes()).toBe(writesAfterCreate)
    expect(writesAfterCreate).toBeGreaterThan(writesBefore)
  })

  it('never leaves a playlist naming a track it did not store', async () => {
    await store().hydrate()
    store().createPlaylist({ name: 'Road Trip', track: jamendoRef() })
    await Promise.resolve()

    const raw = repository.raw()!
    const playlists = raw.playlists as Record<string, { itemKeys: string[] }>
    const tracks = raw.tracks as Record<string, unknown>
    for (const list of Object.values(playlists)) {
      for (const key of list.itemKeys) expect(tracks[key]).toBeDefined()
    }
  })
})

describe('when storage will not take a write', () => {
  it('keeps the library working in memory and says so', async () => {
    await store().hydrate()
    repository.setWritable(false)

    store().like(audiusRef())
    await Promise.resolve()
    await Promise.resolve()

    // The session has the like…
    expect(store().state.likedTrackKeys).toEqual(['audius:t1'])
    // …and the UI is told it will not survive a reload.
    expect(store().storageAvailable).toBe(false)
    expect(store().status).toBe('unavailable')
  })

  it('recovers when storage comes back', async () => {
    await store().hydrate()
    repository.setWritable(false)
    store().like(audiusRef())
    await Promise.resolve()
    await Promise.resolve()
    expect(store().storageAvailable).toBe(false)

    repository.setWritable(true)
    store().like(jamendoRef())
    await Promise.resolve()
    await Promise.resolve()

    expect(store().storageAvailable).toBe(true)
    expect(store().status).toBe('ok')
  })
})

describe('subscribers', () => {
  it('are told after every committed change and not before', async () => {
    await store().hydrate()
    const seen: number[] = []
    const off = onLibraryChange((state) => seen.push(state.likedTrackKeys.length))

    store().like(audiusRef())
    store().like(audiusRef()) // idempotent — no change, no notification
    store().unlike('audius:t1')

    off()
    store().like(jamendoRef())

    expect(seen).toEqual([1, 0])
  })
})

describe('clearing the library', () => {
  it('removes everything in this domain', async () => {
    repository.seed(
      libraryWith({
        tracks: [audiusRef()],
        liked: ['audius:t1'],
        playlists: [playlist({ itemKeys: ['audius:t1'] })],
        hidden: ['audius:h1'],
      }),
    )
    await store().hydrate()

    await store().clearLibrary()

    expect(store().state.likedTrackKeys).toEqual([])
    expect(store().state.playlists).toEqual({})
    expect(store().state.tracks).toEqual({})
    expect(store().state.hiddenRecommendationKeys).toEqual([])
    expect(repository.raw()).toBeNull()
  })

  it('touches nothing outside it', async () => {
    localStorage.setItem('pulse:volume', '0.42')
    localStorage.setItem('pulse:autoplay', 'false')
    localStorage.setItem('pulse:repeat', 'all')

    await store().hydrate()
    store().like(audiusRef())
    await store().clearLibrary()

    expect(localStorage.getItem('pulse:volume')).toBe('0.42')
    expect(localStorage.getItem('pulse:autoplay')).toBe('false')
    expect(localStorage.getItem('pulse:repeat')).toBe('all')
  })
})

describe('the periodic retention sweep', () => {
  it('removes an item that expired while the tab stayed open', async () => {
    repository.seed(
      libraryWith({
        tracks: [youtubeRef({ metadataUpdatedAt: FIXED_NOW })],
        liked: ['youtube:aaaaaaaaaaa'],
      }),
    )
    await store().hydrate()
    expect(store().state.likedTrackKeys).toEqual(['youtube:aaaaaaaaaaa'])

    // Time moves past the window; the sweep runs against the real clock.
    useLibraryStore.getState().replaceState(
      libraryWith({
        tracks: [youtubeRef({ metadataUpdatedAt: Date.now() - 40 * 86_400_000 })],
        liked: ['youtube:aaaaaaaaaaa'],
      }),
    )
    store().purgeExpired()

    expect(store().state.tracks['youtube:aaaaaaaaaaa']).toBeUndefined()
    expect(store().state.likedTrackKeys).toEqual([])
  })
})
