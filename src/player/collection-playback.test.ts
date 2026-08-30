import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/app/ui-store'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { resetMusicProvider, setMusicProvider } from '@/music/provider'
import type { MusicProvider } from '@/music/provider'
import type { Track } from '@/music/types'
import { audiusRef, youtubeRef } from '@/test/fixtures/library'
import { youtubePayload } from '@/test/fixtures/youtube'
import type { LibraryTrackRef } from '@/library/types'
import { playCollection, resetCollectionEngineRegistration } from '@/library/collection-playback'
import { setAudioEngine } from './audio-engine'
import { clearAutoplayBuffer, clearSessionPool } from './autoplay'
import {
  collectionSession,
  remainingCollectionItems,
  resetCollectionSession,
} from './collection-session'
import { createFakeAudioEngine } from './fake-audio-engine'
import type { FakeAudioEngine } from './fake-audio-engine'
import { activeEngine, resetPlaybackCoordinator } from './playback-coordinator'
import {
  handleTrackEnded,
  playPrevious,
  resetAdvanceGuard,
  resetFailureStreak,
  resetMediaRetries,
  skipToNext,
} from './player-actions'
import { initialPlayerState, usePlayerStore } from './player-store'
import { clearPlayedSession } from './related-fetcher'
import { unifiedNext, unifiedPrev } from './unified-actions'
import { createFakeYouTubeFactory } from './youtube/fake-adapter'
import type { FakeYouTubeFactory } from './youtube/fake-adapter'
import {
  bindYouTubeEngineEvents,
  playYouTubeResult,
  resetYouTubeAdvanceGuard,
  resetYouTubeFailureStreak,
  resetYouTubeRelatedBudget,
} from './youtube-actions'
import { createYouTubeIframeEngine, setYouTubeEngine } from './youtube-engine'
import { initialYouTubeState, useYouTubeStore } from './youtube-store'
import { resetYouTubeVisibility, setYouTubeVisibleRatio } from './youtube-visibility'

/**
 * A saved list, played as a list.
 *
 * The reported bug was that Liked Songs did not reliably continue: a song
 * finished and the next saved one did not follow. Underneath were four separate
 * defects, and each has a test here that fails against the previous
 * implementation:
 *
 * · a YouTube item in the middle of the list was filtered out of the queue and
 *   silently skipped;
 * · starting the list *on* a YouTube item threw the rest of the list away;
 * · starting from the middle rotated the list, so Repeat off wrapped round to
 *   the beginning;
 * · a YouTube search session left open beforehand answered Next instead of the
 *   saved list.
 *
 * Everything is driven through the real actions — `handleTrackEnded` for a
 * natural end, `skipToNext` and `unifiedNext` for a press — because the bug was
 * about what happens when nobody is watching.
 */

const LIKED = { id: 'library:liked', label: 'Liked Songs' }

function ref(id: string, title = id.toUpperCase()): LibraryTrackRef {
  return audiusRef({ key: `audius:${id}`, providerItemId: id, title })
}

function video(videoId: string): LibraryTrackRef {
  return youtubeRef({
    key: `youtube:${videoId}`,
    providerItemId: videoId,
    title: `Video ${videoId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
  })
}

function track(id: string, title = id.toUpperCase()): Track {
  return {
    id: `audius:${id}`,
    mediaKind: 'audio',
    provider: 'audius',
    providerId: id,
    title,
    artistName: 'Nova Sound',
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
  }
}

let audio: FakeAudioEngine
let factory: FakeYouTubeFactory
let container: HTMLDivElement
let catalogue: Map<string, Track>
let getTrack: ReturnType<typeof vi.fn>

function provider(): MusicProvider {
  getTrack = vi.fn((id: string) => Promise.resolve(catalogue.get(id) ?? null))
  return {
    id: 'fake-audius',
    searchTracks: () => Promise.resolve([]),
    searchCatalog: () => Promise.resolve({ tracks: [], artists: [] }),
    getArtistTracks: () => Promise.resolve([]),
    getTrendingTracks: () => Promise.resolve([]),
    getUndergroundTrendingTracks: () => Promise.resolve([]),
    getTopArtists: () => Promise.resolve([]),
    getTrack,
    getStreamSource: (item) => Promise.resolve(`https://stream.test/${item.providerId}.mp3`),
  }
}

const nowPlaying = () => usePlayerStore.getState().currentTrack?.providerId ?? null
const nowVideo = () => useYouTubeStore.getState().item?.videoId ?? null
const queueIds = () => usePlayerStore.getState().queue.map((item) => item.providerId)

/** Lets the un-awaited look-ahead settle, as a real listener's few seconds do. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  catalogue = new Map(['a', 'b', 'c', 'd', 'e'].map((id) => [id, track(id)] as const))
  audio = createFakeAudioEngine()
  setAudioEngine(audio)
  setMusicProvider(provider())

  factory = createFakeYouTubeFactory()
  container = document.createElement('div')
  document.body.appendChild(container)
  const engine = createYouTubeIframeEngine({ factory, origin: 'https://pulse.test' })
  engine.attach(container)
  setYouTubeEngine(engine)

  // Autoplay off by default so a continuation can only have come from the list.
  usePlayerStore.setState({ ...initialPlayerState, autoplaySimilar: false })
  useYouTubeStore.setState({ ...initialYouTubeState })
  useUiStore.setState({ notice: null, noticeToken: 0 })
  resetPlaybackCoordinator()
  resetCollectionSession()
  resetCollectionEngineRegistration()
  resetAdvanceGuard()
  resetMediaRetries()
  resetFailureStreak()
  resetYouTubeAdvanceGuard()
  resetYouTubeFailureStreak()
  resetYouTubeRelatedBudget()
  resetYouTubeVisibility()
  clearAutoplayBuffer()
  clearSessionPool()
  clearPlayedSession()
})

afterEach(() => {
  setAudioEngine(null)
  setYouTubeEngine(null)
  resetMusicProvider()
  container.remove()
})

/* ==========================================================================
   Audio-only collections — the ordinary case
   ========================================================================== */

describe('an audio-only collection', () => {
  it('plays each saved song after the one before it', async () => {
    await playCollection([ref('a'), ref('b'), ref('c')], 0, LIKED)
    expect(nowPlaying()).toBe('a')

    await handleTrackEnded()
    expect(nowPlaying()).toBe('b')
    await handleTrackEnded()
    expect(nowPlaying()).toBe('c')
  })

  it('names the collection as the queue context', async () => {
    await playCollection([ref('a'), ref('b')], 0, LIKED)
    expect(usePlayerStore.getState().queueContext).toEqual(LIKED)
  })

  it('starts at the clicked row and continues from there', async () => {
    await playCollection([ref('a'), ref('b'), ref('c'), ref('d')], 1, LIKED)
    expect(nowPlaying()).toBe('b')

    await handleTrackEnded()
    expect(nowPlaying()).toBe('c')
    await handleTrackEnded()
    expect(nowPlaying()).toBe('d')
  })

  it('does not wrap round to the beginning when Repeat is off', async () => {
    await playCollection([ref('a'), ref('b'), ref('c'), ref('d')], 1, LIKED)
    await handleTrackEnded()
    await handleTrackEnded()
    expect(nowPlaying()).toBe('d')

    await handleTrackEnded()
    // A and B were behind the clicked row. Repeat off means the list is over.
    expect(nowPlaying()).toBe('d')
    expect(usePlayerStore.getState().status).toBe('paused')
  })

  it('starts from the first visible row when Play is pressed', async () => {
    await playCollection([ref('a'), ref('b'), ref('c')], 0, LIKED)
    expect(nowPlaying()).toBe('a')
    await settle()
    expect(queueIds()).toEqual(['a', 'b', 'c'])
  })

  it('resolves the look-ahead without waiting for it to start playing', async () => {
    const started = playCollection([ref('a'), ref('b'), ref('c')], 0, LIKED)
    await started
    // The first song is already loaded; the rest arrive behind it.
    expect(nowPlaying()).toBe('a')
    await settle()
    expect(queueIds()).toEqual(['a', 'b', 'c'])
  })
})

/* ==========================================================================
   Order on screen is the order that plays
   ========================================================================== */

describe('the visible order', () => {
  it('is what plays, whatever the stored membership order is', async () => {
    // The page hands over its rows already sorted: C, A, B.
    await playCollection([ref('c'), ref('a'), ref('b')], 0, LIKED)
    expect(nowPlaying()).toBe('c')
    await handleTrackEnded()
    expect(nowPlaying()).toBe('a')
    await handleTrackEnded()
    expect(nowPlaying()).toBe('b')
  })

  it('is the filtered set when the visitor has filtered the page', async () => {
    // Saved: A B C D. The filter leaves B and D on screen, and B was clicked.
    await playCollection([ref('b'), ref('d')], 0, LIKED)
    expect(nowPlaying()).toBe('b')
    await settle()
    // Nothing hidden was resolved into the continuation.
    expect(queueIds()).toEqual(['b', 'd'])

    await handleTrackEnded()
    expect(nowPlaying()).toBe('d')
  })

  it('is a snapshot: re-sorting the page afterwards does not rewrite it', async () => {
    await playCollection([ref('a'), ref('b'), ref('c')], 0, LIKED)
    await settle()

    // The page re-renders under a different sort. The session is untouched.
    expect(collectionSession().items.map((item) => item.providerItemId)).toEqual(['a', 'b', 'c'])
    await handleTrackEnded()
    expect(nowPlaying()).toBe('b')
  })
})

/* ==========================================================================
   Shuffle
   ========================================================================== */

describe('Shuffle', () => {
  it('uses every saved item exactly once', async () => {
    usePlayerStore.getState().setShuffle(true)
    await playCollection([ref('a'), ref('b'), ref('c'), ref('d')], 0, LIKED)

    const { order, items } = collectionSession()
    expect([...order].sort()).toEqual([0, 1, 2, 3])
    expect(items).toHaveLength(4)
  })

  it('holds one running order rather than reshuffling on every Next', async () => {
    usePlayerStore.getState().setShuffle(true)
    await playCollection([ref('a'), ref('b'), ref('c'), ref('d')], 0, LIKED)

    const order = [...collectionSession().order]
    const heard = [nowPlaying()]
    await handleTrackEnded()
    heard.push(nowPlaying())
    await handleTrackEnded()
    heard.push(nowPlaying())

    expect(collectionSession().order).toEqual(order)
    const expected = order
      .slice(0, 3)
      .map((index) => collectionSession().items[index].providerItemId)
    expect(heard).toEqual(expected)
  })

  it('leaves the list it was given exactly as it was', async () => {
    const rows = [ref('a'), ref('b'), ref('c'), ref('d')]
    const before = rows.map((row) => row.key)
    usePlayerStore.getState().setShuffle(true)
    await playCollection(rows, 0, LIKED)

    expect(rows.map((row) => row.key)).toEqual(before)
    expect(collectionSession().items.map((item) => item.key)).toEqual(before)
  })
})

/* ==========================================================================
   Repeat
   ========================================================================== */

describe('Repeat', () => {
  it('off: the collection ends rather than looping', async () => {
    await playCollection([ref('a'), ref('b')], 0, LIKED)
    await handleTrackEnded()
    expect(nowPlaying()).toBe('b')
    await handleTrackEnded()
    expect(nowPlaying()).toBe('b')
    expect(usePlayerStore.getState().status).toBe('paused')
  })

  it('playlist: wraps to the first item of the whole collection', async () => {
    // Started in the middle, so the wrap has to reach items *behind* the start.
    await playCollection([ref('a'), ref('b'), ref('c')], 1, LIKED)
    usePlayerStore.getState().setRepeatMode('all')

    await handleTrackEnded()
    expect(nowPlaying()).toBe('c')
    await handleTrackEnded()
    expect(nowPlaying()).toBe('a')
  })

  it('one: a natural end replays the same song', async () => {
    await playCollection([ref('a'), ref('b'), ref('c')], 1, LIKED)
    usePlayerStore.getState().setRepeatMode('one')

    await handleTrackEnded()
    expect(nowPlaying()).toBe('b')
  })

  it('one: a press of Next still leaves the song', async () => {
    await playCollection([ref('a'), ref('b'), ref('c')], 1, LIKED)
    usePlayerStore.getState().setRepeatMode('one')

    await skipToNext()
    expect(nowPlaying()).toBe('c')
  })
})

/* ==========================================================================
   Precedence over generated autoplay
   ========================================================================== */

describe('the saved list outranks generated autoplay', () => {
  it('plays the next saved song rather than a similar one', async () => {
    const similar = track('z', 'Something Similar')
    setMusicProvider({
      ...provider(),
      searchTracks: () => Promise.resolve([similar]),
      getTrendingTracks: () => Promise.resolve([similar]),
    })
    usePlayerStore.setState({ autoplaySimilar: true })

    await playCollection([ref('a'), ref('b'), ref('c')], 0, LIKED)
    await handleTrackEnded()
    expect(nowPlaying()).toBe('b')
    await handleTrackEnded()
    expect(nowPlaying()).toBe('c')
  })

  it('is consulted only once the collection is genuinely exhausted', async () => {
    const similar = track('z', 'Something Similar')
    setMusicProvider({
      ...provider(),
      searchTracks: () => Promise.resolve([similar]),
      getTrendingTracks: () => Promise.resolve([similar]),
    })
    usePlayerStore.setState({ autoplaySimilar: true })

    await playCollection([ref('a'), ref('b')], 0, LIKED)
    await handleTrackEnded()
    expect(nowPlaying()).toBe('b')
    await handleTrackEnded()
    expect(nowPlaying()).toBe('z')
  })
})

/* ==========================================================================
   Unavailable items
   ========================================================================== */

describe('an item the provider no longer has', () => {
  it('is stepped over rather than ending the collection', async () => {
    catalogue.delete('b')
    await playCollection([ref('a'), ref('b'), ref('c')], 0, LIKED)
    expect(nowPlaying()).toBe('a')

    await handleTrackEnded()
    expect(nowPlaying()).toBe('c')
  })

  it('is asked for once and never retried', async () => {
    catalogue.delete('b')
    await playCollection([ref('a'), ref('b'), ref('c')], 0, LIKED)
    await settle()
    await handleTrackEnded()
    expect(nowPlaying()).toBe('c')

    const asked = getTrack.mock.calls.filter(([id]) => id === 'b').length
    expect(asked).toBe(1)
  })

  it('does not stop the list even at the row that was clicked', async () => {
    catalogue.delete('a')
    await playCollection([ref('a'), ref('b'), ref('c')], 0, LIKED)
    expect(nowPlaying()).toBe('b')
  })

  it('says so honestly when nothing in the list can play', async () => {
    catalogue.clear()
    await playCollection([ref('a'), ref('b')], 0, LIKED)
    expect(nowPlaying()).toBeNull()
    expect(useUiStore.getState().notice).toMatch(/aren't available to stream/i)
  })
})

/* ==========================================================================
   Mixed providers — the collection survives the engine change
   ========================================================================== */

describe('a collection that mixes providers', () => {
  const mixed = () => [ref('a'), video('aaaaaaaaaaa'), ref('c')]

  it('reaches the video that sits between two catalogue tracks', async () => {
    setYouTubeVisibleRatio(1)
    await playCollection(mixed(), 0, LIKED)
    expect(nowPlaying()).toBe('a')

    await handleTrackEnded()
    expect(nowVideo()).toBe('aaaaaaaaaaa')
  })

  it('hands back to the audio engine when the video ends', async () => {
    setYouTubeVisibleRatio(1)
    await playCollection(mixed(), 1, LIKED)
    bindYouTubeEngineEvents()
    expect(nowVideo()).toBe('aaaaaaaaaaa')

    // Exactly what the IFrame API sends when a video finishes.
    factory.current()?.emitState(0)
    await vi.waitFor(() => expect(nowPlaying()).toBe('c'))
    // The audio element took the claim back without another Library click.
    expect(activeEngine()).toBe('audio')
  })

  it('cues the video rather than starting it when the player is not visible', async () => {
    // Nothing observed yet: the visibility rule must resolve against autoplay.
    resetYouTubeVisibility()
    await playCollection(mixed(), 0, LIKED)
    await handleTrackEnded()

    expect(nowVideo()).toBe('aaaaaaaaaaa')
    // Prepared and waiting for a press — never skipped, never started unseen.
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
    expect(useYouTubeStore.getState().status).toBe('cued')
  })

  it('does not begin a video while the document is hidden', async () => {
    setYouTubeVisibleRatio(1)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      await playCollection(mixed(), 0, LIKED)
      await handleTrackEnded()
      expect(nowVideo()).toBe('aaaaaaaaaaa')
      expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
    } finally {
      visibility.mockRestore()
    }
  })

  it('steps over a saved video whose retention has lapsed', async () => {
    const expired = video('aaaaaaaaaaa')
    expired.youtubeExpiresAt = Date.now() - 1
    setYouTubeVisibleRatio(1)

    await playCollection([ref('a'), expired, ref('c')], 0, LIKED)
    await handleTrackEnded()

    expect(nowVideo()).toBeNull()
    expect(nowPlaying()).toBe('c')
  })

  it('loses no item merely because the provider changed', async () => {
    setYouTubeVisibleRatio(1)
    await playCollection(mixed(), 0, LIKED)
    expect(collectionSession().items.map((item) => item.key)).toEqual([
      'audius:a',
      'youtube:aaaaaaaaaaa',
      'audius:c',
    ])
  })
})

/* ==========================================================================
   Origin decides who owns Next
   ========================================================================== */

describe('a video playing from a saved list', () => {
  const results = ['bbbbbbbbbbb', 'aaaaaaaaaaa', 'ccccccccccc'].map((videoId) =>
    normalizeYouTubeVideo(youtubePayload({ videoId })),
  )

  it('answers Next with the next saved item, not the next search result', async () => {
    setYouTubeVisibleRatio(1)
    // A search session is open, sitting on the same video.
    await playYouTubeResult(results, results[1], 'a query')
    expect(nowVideo()).toBe('aaaaaaaaaaa')

    // The visitor now starts that video from Liked Songs instead.
    await playCollection([ref('a'), video('aaaaaaaaaaa'), ref('c')], 1, LIKED)
    unifiedNext()
    await settle()

    expect(nowPlaying()).toBe('c')
    expect(nowVideo()).not.toBe('ccccccccccc')
  })

  it('steps back to the saved item before it', async () => {
    setYouTubeVisibleRatio(1)
    await playCollection([ref('a'), video('aaaaaaaaaaa'), ref('c')], 1, LIKED)

    unifiedPrev()
    await settle()
    expect(nowPlaying()).toBe('a')
  })

  it('makes no YouTube request to continue', async () => {
    setYouTubeVisibleRatio(1)
    const search = vi.fn()
    globalThis.fetch = search

    await playCollection([ref('a'), video('aaaaaaaaaaa'), ref('c')], 1, LIKED)
    unifiedNext()
    await settle()

    expect(search).not.toHaveBeenCalled()
  })

  it('keeps a search session answering Next when the search is the origin', async () => {
    setYouTubeVisibleRatio(1)
    await playYouTubeResult(results, results[0], 'a query')
    unifiedNext()
    await settle()

    expect(nowVideo()).toBe('aaaaaaaaaaa')
  })
})

/* ==========================================================================
   Previous
   ========================================================================== */

describe('Previous', () => {
  it('steps back through the saved order', async () => {
    await playCollection([ref('a'), ref('b'), ref('c')], 0, LIKED)
    await handleTrackEnded()
    expect(nowPlaying()).toBe('b')

    usePlayerStore.getState().setCurrentTime(0)
    await playPrevious()
    expect(nowPlaying()).toBe('a')
  })

  it('restarts the current song when the listener is already into it', async () => {
    await playCollection([ref('a'), ref('b')], 1, LIKED)
    usePlayerStore.getState().setDuration(200)
    usePlayerStore.getState().setCurrentTime(30)

    await playPrevious()
    expect(nowPlaying()).toBe('b')
    expect(usePlayerStore.getState().currentTime).toBe(0)
  })
})

/* ==========================================================================
   Manual queueing
   ========================================================================== */

describe('adding a track by hand', () => {
  it('plays before the collection continues, and the collection still follows', async () => {
    await playCollection([ref('a'), ref('b'), ref('c')], 0, LIKED)
    await settle()

    usePlayerStore.getState().enqueueNext(track('e'))
    await handleTrackEnded()
    expect(nowPlaying()).toBe('e')

    await handleTrackEnded()
    expect(nowPlaying()).toBe('b')
    await handleTrackEnded()
    expect(nowPlaying()).toBe('c')
  })
})

/* ==========================================================================
   Leaving the collection
   ========================================================================== */

describe('starting something else', () => {
  it('ends the collection so it cannot resurface later', async () => {
    await playCollection([ref('a'), ref('b'), ref('c')], 0, LIKED)
    await settle()

    const { playSeedTrack } = await import('@/features/discovery/playShelf')
    await playSeedTrack(track('e'), { id: 'search:whatever', label: 'Search' })

    expect(collectionSession().context).toBeNull()
    await handleTrackEnded()
    expect(nowPlaying()).not.toBe('b')
  })
})

/* ==========================================================================
   Up next
   ========================================================================== */

describe('what is up next', () => {
  it('is the rest of the saved list, in the running order', async () => {
    await playCollection([ref('a'), ref('b'), ref('c'), ref('d')], 1, LIKED)
    await settle()

    expect(remainingCollectionItems().map((item) => item.ref.providerItemId)).toEqual(['c', 'd'])
  })

  it('includes the saved items no audio queue could hold', async () => {
    setYouTubeVisibleRatio(1)
    await playCollection([ref('a'), video('aaaaaaaaaaa'), ref('c')], 0, LIKED)
    await settle()

    expect(remainingCollectionItems().map((item) => item.ref.key)).toEqual([
      'youtube:aaaaaaaaaaa',
      'audius:c',
    ])
  })
})
