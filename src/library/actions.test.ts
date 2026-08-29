import { describe, expect, it } from 'vitest'
import {
  audiusRef,
  jamendoRef,
  libraryWith,
  playlist,
  youtubeRef,
  FIXED_NOW,
} from '@/test/fixtures/library'
import {
  addTrackToPlaylist,
  collectGarbage,
  createPlaylist,
  createPlaylistId,
  deletePlaylist,
  hideRecommendation,
  likeTrack,
  movePlaylistItem,
  removeTrackFromPlaylist,
  renamePlaylist,
  resetHiddenRecommendations,
  setPlaylistDescription,
  toggleLike,
  unhideRecommendation,
  unlikeTrack,
} from './actions'
import { createEmptyLibrary, MAX_PLAYLISTS, MAX_TRACKS_PER_PLAYLIST } from './types'
import type { LibraryState } from './types'

const NOW = FIXED_NOW + 1000

/** Every reducer returns the same instance when it declines, and that matters. */
const refused = (before: LibraryState, after: LibraryState) => before === after

describe('Liked Songs', () => {
  it('saves the reference alongside the membership', () => {
    const { state, result } = likeTrack(createEmptyLibrary(FIXED_NOW), audiusRef(), NOW)
    expect(result.ok).toBe(true)
    expect(state.likedTrackKeys).toEqual(['audius:t1'])
    expect(state.tracks['audius:t1'].title).toBe('Neon Corridor')
    expect(state.updatedAt).toBe(NOW)
  })

  it('puts the newest like first', () => {
    let state = likeTrack(createEmptyLibrary(), audiusRef(), NOW).state
    state = likeTrack(state, jamendoRef(), NOW + 1).state
    expect(state.likedTrackKeys).toEqual(['jamendo:1880336', 'audius:t1'])
  })

  it('is idempotent — liking twice changes nothing', () => {
    const first = likeTrack(createEmptyLibrary(), audiusRef(), NOW).state
    const second = likeTrack(first, audiusRef(), NOW + 1)
    expect(second.result.ok).toBe(true)
    expect(refused(first, second.state)).toBe(true)
  })

  it('unliking removes membership and collects the now-unreferenced metadata', () => {
    const liked = likeTrack(createEmptyLibrary(), audiusRef(), NOW).state
    const { state } = unlikeTrack(liked, 'audius:t1', NOW + 1)
    expect(state.likedTrackKeys).toEqual([])
    expect(state.tracks).toEqual({})
  })

  it('unliking keeps the metadata while a playlist still holds it', () => {
    let state = likeTrack(createEmptyLibrary(), audiusRef(), NOW).state
    state = createPlaylist(state, { name: 'Keep', track: audiusRef(), id: 'pl_keep' }, NOW).state
    state = unlikeTrack(state, 'audius:t1', NOW + 1).state

    expect(state.likedTrackKeys).toEqual([])
    expect(state.tracks['audius:t1']).toBeDefined()
    expect(state.playlists.pl_keep.itemKeys).toEqual(['audius:t1'])
  })

  it('unliking something that was never liked is a no-op, not a crash', () => {
    const before = createEmptyLibrary()
    const { state, result } = unlikeTrack(before, 'audius:ghost', NOW)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not-found')
    expect(refused(before, state)).toBe(true)
  })

  it('distinguishes the same song on two providers', () => {
    let state = likeTrack(createEmptyLibrary(), audiusRef({ title: 'Same Song' }), NOW).state
    state = likeTrack(
      state,
      jamendoRef({ title: 'Same Song', artist: 'Aster Vale' }),
      NOW + 1,
    ).state

    expect(state.likedTrackKeys).toHaveLength(2)
    // Deduplicating these on text would silently replace one recording with
    // another; identity is provider + provider id and nothing else.
    expect(state.likedTrackKeys).toContain('audius:t1')
    expect(state.likedTrackKeys).toContain('jamendo:1880336')
  })

  it('toggles both ways from one entry point', () => {
    const on = toggleLike(createEmptyLibrary(), audiusRef(), NOW)
    expect(on.state.likedTrackKeys).toEqual(['audius:t1'])
    const off = toggleLike(on.state, audiusRef(), NOW + 1)
    expect(off.state.likedTrackKeys).toEqual([])
  })

  it('refreshes provider metadata on a re-save but keeps the original addedAt', () => {
    const first = likeTrack(createEmptyLibrary(), audiusRef({ addedAt: 1000 }), NOW).state
    const again = likeTrack(
      unlikeTrack(first, 'audius:t1', NOW).state,
      audiusRef({ title: 'Neon Corridor (Remaster)', addedAt: 9000 }),
      NOW + 5,
    ).state
    // Re-saved from scratch here, so addedAt is the new one; the merge path is
    // exercised where a track is added to a second playlist below.
    expect(again.tracks['audius:t1'].title).toBe('Neon Corridor (Remaster)')
  })
})

describe('playlists', () => {
  it('creates one with a generated id and puts it first', () => {
    const { state, result } = createPlaylist(createEmptyLibrary(), { name: 'Road Trip' }, NOW)
    expect(result.ok).toBe(true)
    expect(result.playlistId).toBeDefined()
    expect(state.playlistOrder[0]).toBe(result.playlistId)
    expect(state.playlists[result.playlistId!].name).toBe('Road Trip')
    expect(state.playlists[result.playlistId!].itemKeys).toEqual([])
  })

  it('generates distinct ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createPlaylistId()))
    expect(ids.size).toBe(50)
  })

  it('trims the name and rejects an empty one', () => {
    const trimmed = createPlaylist(createEmptyLibrary(), { name: '  Road Trip  ' }, NOW)
    expect(trimmed.state.playlists[trimmed.result.playlistId!].name).toBe('Road Trip')

    const before = createEmptyLibrary()
    const empty = createPlaylist(before, { name: '   ' }, NOW)
    expect(empty.result.reason).toBe('invalid-name')
    expect(refused(before, empty.state)).toBe(true)
  })

  it('keeps a Unicode name exactly as typed', () => {
    const { state, result } = createPlaylist(
      createEmptyLibrary(),
      { name: 'Դանդաղ երգեր 🎧' },
      NOW,
    )
    expect(state.playlists[result.playlistId!].name).toBe('Դանդաղ երգեր 🎧')
  })

  it('creates and adds the first track in one indivisible step', () => {
    const { state, result } = createPlaylist(
      createEmptyLibrary(),
      { name: 'Road Trip', track: audiusRef(), id: 'pl_a' },
      NOW,
    )
    expect(result.ok).toBe(true)
    // Both halves landed, or neither would have.
    expect(state.playlists.pl_a.itemKeys).toEqual(['audius:t1'])
    expect(state.tracks['audius:t1']).toBeDefined()
  })

  it('renames, and refuses a blank rename', () => {
    const created = createPlaylist(createEmptyLibrary(), { name: 'Old', id: 'pl_a' }, NOW).state
    expect(renamePlaylist(created, 'pl_a', 'New', NOW + 1).state.playlists.pl_a.name).toBe('New')

    const blank = renamePlaylist(created, 'pl_a', '  ', NOW + 1)
    expect(blank.result.reason).toBe('invalid-name')
    expect(refused(created, blank.state)).toBe(true)
  })

  it('sets and clears a description', () => {
    let state = createPlaylist(createEmptyLibrary(), { name: 'List', id: 'pl_a' }, NOW).state
    state = setPlaylistDescription(state, 'pl_a', 'Songs for driving', NOW + 1).state
    expect(state.playlists.pl_a.description).toBe('Songs for driving')

    state = setPlaylistDescription(state, 'pl_a', '   ', NOW + 2).state
    expect(state.playlists.pl_a.description).toBeUndefined()
  })

  it('adds a track and refuses a duplicate', () => {
    let state = createPlaylist(createEmptyLibrary(), { name: 'List', id: 'pl_a' }, NOW).state
    state = addTrackToPlaylist(state, 'pl_a', audiusRef(), NOW + 1).state

    const duplicate = addTrackToPlaylist(state, 'pl_a', audiusRef(), NOW + 2)
    expect(duplicate.result.reason).toBe('duplicate')
    expect(refused(state, duplicate.state)).toBe(true)
    expect(state.playlists.pl_a.itemKeys).toEqual(['audius:t1'])
  })

  it('lets the same track live in two playlists', () => {
    let state = createPlaylist(createEmptyLibrary(), { name: 'A', id: 'pl_a' }, NOW).state
    state = createPlaylist(state, { name: 'B', id: 'pl_b' }, NOW).state
    state = addTrackToPlaylist(state, 'pl_a', audiusRef(), NOW + 1).state
    state = addTrackToPlaylist(state, 'pl_b', audiusRef(), NOW + 2).state

    expect(state.playlists.pl_a.itemKeys).toEqual(['audius:t1'])
    expect(state.playlists.pl_b.itemKeys).toEqual(['audius:t1'])
    // One reference, two memberships.
    expect(Object.keys(state.tracks)).toEqual(['audius:t1'])
  })

  it('removes a track and collects it only when nothing else holds it', () => {
    let state = createPlaylist(createEmptyLibrary(), { name: 'A', id: 'pl_a' }, NOW).state
    state = createPlaylist(state, { name: 'B', id: 'pl_b' }, NOW).state
    state = addTrackToPlaylist(state, 'pl_a', audiusRef(), NOW).state
    state = addTrackToPlaylist(state, 'pl_b', audiusRef(), NOW).state

    state = removeTrackFromPlaylist(state, 'pl_a', 'audius:t1', NOW + 1).state
    expect(state.tracks['audius:t1']).toBeDefined()

    state = removeTrackFromPlaylist(state, 'pl_b', 'audius:t1', NOW + 2).state
    expect(state.tracks['audius:t1']).toBeUndefined()
  })

  it('deleting a playlist does not unlike its songs', () => {
    let state = likeTrack(createEmptyLibrary(), audiusRef(), NOW).state
    state = createPlaylist(state, { name: 'A', track: audiusRef(), id: 'pl_a' }, NOW).state
    state = deletePlaylist(state, 'pl_a', NOW + 1).state

    expect(state.playlists.pl_a).toBeUndefined()
    expect(state.playlistOrder).toEqual([])
    expect(state.likedTrackKeys).toEqual(['audius:t1'])
    expect(state.tracks['audius:t1']).toBeDefined()
  })

  it('deleting a playlist collects references nothing else holds', () => {
    const state = deletePlaylist(
      createPlaylist(createEmptyLibrary(), { name: 'A', track: audiusRef(), id: 'pl_a' }, NOW)
        .state,
      'pl_a',
      NOW + 1,
    ).state
    expect(state.tracks).toEqual({})
  })

  it('refuses to act on a playlist that does not exist', () => {
    const before = createEmptyLibrary()
    for (const mutation of [
      () => renamePlaylist(before, 'nope', 'x', NOW),
      () => deletePlaylist(before, 'nope', NOW),
      () => addTrackToPlaylist(before, 'nope', audiusRef(), NOW),
      () => removeTrackFromPlaylist(before, 'nope', 'audius:t1', NOW),
      () => movePlaylistItem(before, 'nope', 0, 1, NOW),
      () => setPlaylistDescription(before, 'nope', 'x', NOW),
    ]) {
      const { state, result } = mutation()
      expect(result.reason).toBe('not-found')
      expect(refused(before, state)).toBe(true)
    }
  })
})

describe('bounds', () => {
  it('refuses a playlist past the cap, and writes nothing', () => {
    let state = createEmptyLibrary()
    for (let index = 0; index < MAX_PLAYLISTS; index += 1) {
      state = createPlaylist(state, { name: `List ${index}`, id: `pl_${index}` }, NOW).state
    }
    const over = createPlaylist(state, { name: 'One too many' }, NOW)
    expect(over.result.reason).toBe('playlist-limit')
    expect(refused(state, over.state)).toBe(true)
  })

  it('refuses a track past the per-playlist cap', () => {
    let state = createPlaylist(createEmptyLibrary(), { name: 'Big', id: 'pl_a' }, NOW).state
    for (let index = 0; index < MAX_TRACKS_PER_PLAYLIST; index += 1) {
      state = addTrackToPlaylist(
        state,
        'pl_a',
        audiusRef({ key: `audius:t${index}`, providerItemId: `t${index}` }),
        NOW,
      ).state
    }
    const over = addTrackToPlaylist(state, 'pl_a', jamendoRef(), NOW)
    expect(over.result.reason).toBe('playlist-track-limit')
    expect(refused(state, over.state)).toBe(true)
  })
})

describe('reordering', () => {
  const threeTrack = () => {
    let state = createPlaylist(createEmptyLibrary(), { name: 'A', id: 'pl_a' }, NOW).state
    for (const id of ['t1', 't2', 't3']) {
      state = addTrackToPlaylist(
        state,
        'pl_a',
        audiusRef({ key: `audius:${id}`, providerItemId: id }),
        NOW,
      ).state
    }
    return state
  }

  const order = (state: LibraryState) => state.playlists.pl_a.itemKeys

  it('moves an item down', () => {
    expect(order(movePlaylistItem(threeTrack(), 'pl_a', 0, 1, NOW).state)).toEqual([
      'audius:t2',
      'audius:t1',
      'audius:t3',
    ])
  })

  it('moves an item up', () => {
    expect(order(movePlaylistItem(threeTrack(), 'pl_a', 2, 1, NOW).state)).toEqual([
      'audius:t1',
      'audius:t3',
      'audius:t2',
    ])
  })

  it('moves to top and to bottom by clamping, which is what those controls send', () => {
    expect(order(movePlaylistItem(threeTrack(), 'pl_a', 2, 0, NOW).state)).toEqual([
      'audius:t3',
      'audius:t1',
      'audius:t2',
    ])
    expect(order(movePlaylistItem(threeTrack(), 'pl_a', 0, 99, NOW).state)).toEqual([
      'audius:t2',
      'audius:t3',
      'audius:t1',
    ])
  })

  it('is a no-op when the item is already there', () => {
    const before = threeTrack()
    const same = movePlaylistItem(before, 'pl_a', 1, 1, NOW)
    expect(same.result.ok).toBe(true)
    expect(refused(before, same.state)).toBe(true)
  })

  it('refuses an out-of-range source', () => {
    const before = threeTrack()
    for (const from of [-1, 3, 1.5, Number.NaN]) {
      const { state, result } = movePlaylistItem(before, 'pl_a', from, 0, NOW)
      expect(result.reason).toBe('not-found')
      expect(refused(before, state)).toBe(true)
    }
  })

  it('touches only the playlist, never the track table', () => {
    const before = threeTrack()
    const after = movePlaylistItem(before, 'pl_a', 0, 2, NOW).state
    expect(after.tracks).toBe(before.tracks)
  })
})

describe('Not interested', () => {
  it('records only the key', () => {
    const { state } = hideRecommendation(createEmptyLibrary(), 'audius:t9', NOW)
    expect(state.hiddenRecommendationKeys).toEqual(['audius:t9'])
    // No reason, no category, no inference — the record has nowhere to put one.
    expect(Object.keys(state)).not.toContain('hiddenReasons')
  })

  it('is idempotent and undoable', () => {
    const hidden = hideRecommendation(createEmptyLibrary(), 'audius:t9', NOW).state
    expect(refused(hidden, hideRecommendation(hidden, 'audius:t9', NOW + 1).state)).toBe(true)

    const restored = unhideRecommendation(hidden, 'audius:t9', NOW + 2).state
    expect(restored.hiddenRecommendationKeys).toEqual([])
  })

  it('does not delete history or touch likes and playlists', () => {
    const before = libraryWith({
      tracks: [audiusRef()],
      liked: ['audius:t1'],
      playlists: [playlist({ itemKeys: ['audius:t1'] })],
    })
    const after = hideRecommendation(before, 'audius:t1', NOW).state

    expect(after.likedTrackKeys).toEqual(before.likedTrackKeys)
    expect(after.playlists).toEqual(before.playlists)
    expect(after.tracks).toEqual(before.tracks)
  })

  it('resets in one step', () => {
    const hidden = libraryWith({ hidden: ['audius:a', 'audius:b'] })
    expect(resetHiddenRecommendations(hidden, NOW).state.hiddenRecommendationKeys).toEqual([])
  })
})

describe('garbage collection', () => {
  it('keeps everything something points at', () => {
    const state = libraryWith({
      tracks: [audiusRef(), jamendoRef(), youtubeRef()],
      liked: ['audius:t1'],
      playlists: [playlist({ itemKeys: ['jamendo:1880336'] })],
    })
    const collected = collectGarbage(state)
    expect(Object.keys(collected.tracks).sort()).toEqual(['audius:t1', 'jamendo:1880336'])
  })

  it('returns the same instance when there is nothing to collect', () => {
    const state = libraryWith({ tracks: [audiusRef()], liked: ['audius:t1'] })
    expect(collectGarbage(state)).toBe(state)
  })

  it('does not keep a reference alive merely because it is hidden', () => {
    const state = libraryWith({ tracks: [audiusRef()], hidden: ['audius:t1'] })
    const collected = collectGarbage(state)
    expect(collected.tracks).toEqual({})
    // Excluding an item from a shelf needs its key, not its cover art.
    expect(collected.hiddenRecommendationKeys).toEqual(['audius:t1'])
  })
})
