import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudiusProvider } from '@/music/audius/adapter'
import { setMusicProvider } from '@/music/provider'
import type { Track, YouTubeVideoItem } from '@/music/types'
import { useUiStore } from '@/app/ui-store'
import { resetPersonalizationForTests } from '@/personalization'
import { getAudioEngine, setAudioEngine } from './audio-engine'
import { clearAutoplayBuffer, clearSessionPool } from './autoplay'
import { createFakeAudioEngine } from './fake-audio-engine'
import type { FakeAudioEngine } from './fake-audio-engine'
import { resetPlaybackCoordinator } from './playback-coordinator'
import {
  handleMediaError,
  handleTrackEnded,
  playTrack,
  resetAdvanceGuard,
  resetFailureStreak,
  resetMediaRetries,
} from './player-actions'
import { initialPlayerState, usePlayerStore } from './player-store'
import { NO_MORE_TRACKS_MESSAGE, clearPlayedSession } from './related-fetcher'
import { createFakeYouTubeFactory } from './youtube/fake-adapter'
import type { FakeYouTubeFactory } from './youtube/fake-adapter'
import { createYouTubeIframeEngine, getYouTubeEngine, setYouTubeEngine } from './youtube-engine'
import {
  bindYouTubeEngineEvents,
  isYouTubeAdvancing,
  playYouTubeResult,
  resetYouTubeAdvanceGuard,
  resetYouTubeFailureStreak,
  resetYouTubeRelatedBudget,
} from './youtube-actions'
import { initialYouTubeState, useYouTubeStore } from './youtube-store'
import { resetYouTubeVisibility, setYouTubeVisibleRatio } from './youtube-visibility'

/**
 * The rule, end to end: **playback never stops on its own.**
 *
 * Everything below is driven by the engines' own events rather than by calling
 * an advance directly, because the reported bugs were about what happens when
 * nobody is watching — a track that ran out and started again, and a video that
 * ran out and put up a replay screen. What the transport does when a button is
 * pressed is tested in `next-semantics` and `youtube-session`; this file is
 * about what it does when nothing is pressed at all.
 *
 * The one ending that is allowed is silence with an explanation. Restarting
 * what just finished is not an ending, it is the bug.
 */

let audio: FakeAudioEngine
let factory: FakeYouTubeFactory
let counter = 0

function track(overrides: Partial<Track> = {}): Track {
  counter += 1
  const providerId = overrides.providerId ?? `t${counter}`
  return {
    id: `audius:${providerId}`,
    mediaKind: 'audio',
    provider: 'audius',
    providerId,
    title: `Track ${providerId}`,
    artistName: `Artist ${counter}`,
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    genre: 'Electronic',
    ...overrides,
    ...(overrides.id ? { id: overrides.id } : {}),
  }
}

function video(overrides: Partial<YouTubeVideoItem> = {}): YouTubeVideoItem {
  const videoId = overrides.videoId ?? 'aaaaaaaaaaa'
  return {
    id: `youtube:${videoId}`,
    mediaKind: 'youtube-video',
    provider: 'youtube',
    providerId: videoId,
    videoId,
    title: `Video ${videoId}`,
    channelTitle: 'A Channel',
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    durationSeconds: 200,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embeddable: true,
    madeForKids: false,
    ...overrides,
    ...(overrides.id ? { id: overrides.id } : {}),
  }
}

/**
 * A catalogue that answers the related search with exactly these tracks.
 *
 * `getTrendingTracks` is closed off as well, because the genre fallback is the
 * autoplay buffer's last door: a test that means "the catalogue offers these
 * two" has to mean it offers nothing else either. Streams resolve locally, so
 * starting a track needs no round-trip.
 */
function catalogueOffers(tracks: Track[]) {
  setMusicProvider({
    ...createAudiusProvider(),
    searchTracks: () => Promise.resolve(tracks),
    getTrendingTracks: () => Promise.resolve([]),
    getStreamSource: (item) => Promise.resolve(`https://stream.test/${item.providerId}.mp3`),
  })
}

/** A catalogue with nothing to give, anywhere. */
function catalogueIsEmpty() {
  catalogueOffers([])
}

const audioId = () => usePlayerStore.getState().currentTrack?.providerId
const videoId = () => useYouTubeStore.getState().item?.videoId ?? null

beforeEach(() => {
  counter = 0
  audio = createFakeAudioEngine()
  setAudioEngine(audio)
  factory = createFakeYouTubeFactory()
  setYouTubeEngine(createYouTubeIframeEngine({ factory, origin: 'http://localhost' }))
  usePlayerStore.setState({ ...initialPlayerState, autoplaySimilar: true })
  useYouTubeStore.setState({ ...initialYouTubeState })
  useUiStore.setState({ notice: null, noticeAction: null, nowPlayingOpen: false })
  resetPlaybackCoordinator()
  resetPersonalizationForTests()
  resetMediaRetries()
  resetAdvanceGuard()
  resetFailureStreak()
  resetYouTubeVisibility()
  resetYouTubeRelatedBudget()
  resetYouTubeAdvanceGuard()
  resetYouTubeFailureStreak()
  clearSessionPool()
  clearAutoplayBuffer()
  clearPlayedSession()
  catalogueIsEmpty()

  // Exactly the two handlers `PlayerEngineHost` installs. The point of driving
  // the engine's own events rather than calling the actions is that this wiring
  // is what a listener depends on when they are not looking at the screen.
  getAudioEngine().subscribe({
    onEnded: () => {
      void handleTrackEnded()
    },
    onError: (message) => handleMediaError(message),
  })
})

describe('an audio track running out', () => {
  it('plays something else, and never the track that just ended', async () => {
    const seed = track({ providerId: 'seed' })
    catalogueOffers([track({ providerId: 'related' })])
    await playTrack(seed)
    expect(audioId()).toBe('seed')

    audio.emitEnded()
    await vi.waitFor(() => expect(audioId()).toBe('related'))

    expect(usePlayerStore.getState().status).toBe('playing')
  })

  /**
   * The literal symptom that was reported: the same song again.
   *
   * Asserted on the engine rather than only on the store, because "the same
   * source loaded twice" is what a listener actually hears.
   */
  it('never reloads the same source', async () => {
    const seed = track({ providerId: 'seed' })
    catalogueOffers([track({ providerId: 'related' })])
    await playTrack(seed)
    const source = audio.src

    audio.emitEnded()
    await vi.waitFor(() => expect(audioId()).toBe('related'))

    expect(audio.src).not.toBe(source)
  })

  it('keeps going across three tracks without anyone pressing anything', async () => {
    catalogueOffers([track({ providerId: 'second' }), track({ providerId: 'third' })])
    await playTrack(track({ providerId: 'first' }))

    audio.emitEnded()
    await vi.waitFor(() => expect(audioId()).toBe('second'))

    audio.emitEnded()
    await vi.waitFor(() => expect(audioId()).toBe('third'))

    expect(usePlayerStore.getState().queue.map((item) => item.providerId)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('takes the queue before anything it generated', async () => {
    const first = track({ providerId: 'first' })
    const queued = track({ providerId: 'queued' })
    catalogueOffers([track({ providerId: 'generated' })])
    await playTrack(first, { queue: [first, queued], index: 0 })

    audio.emitEnded()
    await vi.waitFor(() => expect(audioId()).toBe('queued'))
  })

  it('honours Repeat one, which is the visitor overriding all of this', async () => {
    const seed = track({ providerId: 'seed' })
    catalogueOffers([track({ providerId: 'related' })])
    await playTrack(seed)
    usePlayerStore.setState({ repeatMode: 'one' })

    await handleTrackEnded()

    expect(audioId()).toBe('seed')
  })

  it('says so and stops, rather than looping, when nothing can be found', async () => {
    catalogueIsEmpty()
    await playTrack(track({ providerId: 'alone' }))

    await handleTrackEnded()

    expect(audioId()).toBe('alone')
    expect(usePlayerStore.getState().status).toBe('paused')
    expect(usePlayerStore.getState().currentTime).toBe(0)
    expect(audio.playing).toBe(false)
    expect(useUiStore.getState().notice).toBe(NO_MORE_TRACKS_MESSAGE)
  })

  /**
   * `ended` and `error` both fire for a stream whose signed URL expired, and an
   * advance now takes long enough to search that two of them would overlap.
   * Two advances would skip a track and start two loads against one element.
   */
  it('advances once even when the ending is reported twice', async () => {
    catalogueOffers([track({ providerId: 'second' }), track({ providerId: 'third' })])
    await playTrack(track({ providerId: 'first' }))

    const first = handleTrackEnded()
    const second = handleTrackEnded()
    await Promise.all([first, second])

    expect(audioId()).toBe('second')
  })
})

describe('an audio track that will not play', () => {
  it('is treated as one that ended, once its retries are spent', async () => {
    const seed = track({ providerId: 'seed' })
    catalogueOffers([track({ providerId: 'related' })])
    await playTrack(seed)

    // Past the retry budget, so the next error is final for this track.
    handleMediaError('gone')
    handleMediaError('gone')
    handleMediaError('gone')

    await vi.waitFor(() => expect(audioId()).toBe('related'))
  })

  it('gives up after a run of failures rather than walking the catalogue', async () => {
    catalogueIsEmpty()
    const seed = track({ providerId: 'seed' })
    await playTrack(seed)
    resetMediaRetries()

    for (let attempt = 0; attempt < 8; attempt += 1) handleMediaError('gone')

    expect(audioId()).toBe('seed')
    expect(usePlayerStore.getState().status).toBe('error')
  })
})

describe('a video running out', () => {
  const A = video({ videoId: 'aaaaaaaaaaa' })
  const B = video({ videoId: 'bbbbbbbbbbb' })
  const C = video({ videoId: 'ccccccccccc' })
  const D = video({ videoId: 'ddddddddddd' })
  const E = video({ videoId: 'eeeeeeeeeee' })

  function attach() {
    const mount = document.createElement('div')
    document.body.appendChild(mount)
    getYouTubeEngine().attach(mount)
  }

  /** Exactly what the IFrame API sends when a video finishes. */
  function endCurrentVideo() {
    factory.current()?.emitState(0)
  }

  /**
   * The guard drops a second ending while the first is still being answered, so
   * a test that means "and then it ended again" has to let the first one finish.
   */
  const settled = () => vi.waitFor(() => expect(isYouTubeAdvancing()).toBe(false))

  beforeEach(async () => {
    attach()
    setYouTubeVisibleRatio(0.9)
    await playYouTubeResult([A, B, C, D, E], A)
    bindYouTubeEngineEvents()
  })

  it('loads the next video into the same player, without a remount', async () => {
    const player = factory.current()
    const players = factory.players.length

    endCurrentVideo()
    await vi.waitFor(() => expect(videoId()).toBe('bbbbbbbbbbb'))

    expect(factory.current()).toBe(player)
    expect(factory.players).toHaveLength(players)
    expect(player?.videoId).toBe('bbbbbbbbbbb')
  })

  /**
   * The sheet is the only place an embed is ever mounted, so closing it on an
   * ending would take the player off the page — and leaving the visitor on
   * YouTube's replay screen is the reported symptom itself.
   */
  it('leaves the sheet open, showing the new video', async () => {
    expect(useUiStore.getState().nowPlayingOpen).toBe(true)

    endCurrentVideo()
    await vi.waitFor(() => expect(videoId()).toBe('bbbbbbbbbbb'))

    expect(useUiStore.getState().nowPlayingOpen).toBe(true)
    expect(useYouTubeStore.getState().item?.videoId).toBe('bbbbbbbbbbb')
  })

  it('keeps going across three videos without anyone pressing anything', async () => {
    endCurrentVideo()
    await vi.waitFor(() => expect(videoId()).toBe('bbbbbbbbbbb'))
    await settled()

    endCurrentVideo()
    await vi.waitFor(() => expect(videoId()).toBe('ccccccccccc'))

    expect(useYouTubeStore.getState().sessionIndex).toBe(2)
  })

  it('never restarts the video that just ended', async () => {
    endCurrentVideo()
    await vi.waitFor(() => expect(videoId()).not.toBe('aaaaaaaaaaa'))
  })

  it('advances once even when the ending is reported twice', async () => {
    endCurrentVideo()
    endCurrentVideo()

    await vi.waitFor(() => expect(videoId()).toBe('bbbbbbbbbbb'))
    // A second advance would have reached C.
    expect(useYouTubeStore.getState().sessionIndex).toBe(1)
  })

  it('treats a video that will not play as one that ended', async () => {
    // 150 is the IFrame API's "the owner does not allow it to be played here",
    // which is what a removed, private or region-blocked video arrives as.
    factory.current()?.emitError(150)
    await vi.waitFor(() => expect(videoId()).toBe('bbbbbbbbbbb'))
  })
})
