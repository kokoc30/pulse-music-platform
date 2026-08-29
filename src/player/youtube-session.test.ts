import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YouTubeVideoItem } from '@/music/types'
import { createFakeYouTubeFactory } from './youtube/fake-adapter'
import type { FakeYouTubeFactory } from './youtube/fake-adapter'
import { createYouTubeIframeEngine, getYouTubeEngine, setYouTubeEngine } from './youtube-engine'
import { resetPlaybackCoordinator } from './playback-coordinator'
import {
  advanceYouTubeSession,
  bindYouTubeEngineEvents,
  closeYouTubeSurface,
  handleDocumentVisibility,
  hasYouTubeSessionStep,
  nextEligibleIndex,
  playYouTubeResult,
  playYouTubeSessionStep,
  playYouTubeVideo,
} from './youtube-actions'
import { initialYouTubeState, useYouTubeStore } from './youtube-store'
import { resetYouTubeVisibility, setYouTubeVisibleRatio } from './youtube-visibility'

/**
 * Continuing through YouTube results the visitor already has.
 *
 * Two things are being protected at once, and they pull in opposite directions:
 * a video that ends should not dump the visitor on YouTube's replay screen, and
 * nothing may auto-play unless the policy's visibility condition is genuinely
 * met. Every test below pins one side or the other.
 *
 * **Zero quota, asserted.** `fetch` is spied on throughout: no continuation may
 * cause a `search.list`, a `videos.list`, or any request at all.
 */

let factory: FakeYouTubeFactory
let fetchSpy: ReturnType<typeof vi.fn>

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

const A = video({ videoId: 'aaaaaaaaaaa', title: 'Arabic Song A' })
const B = video({ videoId: 'bbbbbbbbbbb', title: 'Arabic Song B' })
const C = video({ videoId: 'ccccccccccc', title: 'Arabic Song C' })

const store = () => useYouTubeStore.getState()
const currentId = () => store().item?.videoId ?? null

/** Drives the engine's `ended` event exactly as the real player would. */
async function endCurrentVideo() {
  factory.current()?.emitState(0)
  // The handler is fired synchronously but advances asynchronously.
  await vi.waitFor(() => expect(store().status).not.toBe('playing'))
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  useYouTubeStore.setState({ ...initialYouTubeState })
  resetPlaybackCoordinator()
  resetYouTubeVisibility()
  factory = createFakeYouTubeFactory()
  setYouTubeEngine(createYouTubeIframeEngine({ factory, origin: 'http://localhost' }))
  // Any request at all is a failure here, so the whole of `fetch` is replaced
  // rather than merely observed — a continuation must never reach the network.
  fetchSpy = vi.fn(() => Promise.reject(new Error('no request may be made')))
  globalThis.fetch = fetchSpy
})

/**
 * The engine only builds a player once it has a node, exactly as the surface
 * gives it one. Without this the fake factory never creates a player and the
 * assertions about what the player was asked to do would be vacuous.
 */
function attach() {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  getYouTubeEngine().attach(mount)
  return mount
}

describe('choosing eligible items', () => {
  it('walks forward to the next embeddable result', () => {
    expect(nextEligibleIndex([A, B, C], 0, 1)).toBe(1)
    expect(nextEligibleIndex([A, B, C], 1, 1)).toBe(2)
  })

  it('reports -1 at the end rather than wrapping', () => {
    expect(nextEligibleIndex([A, B, C], 2, 1)).toBe(-1)
    expect(nextEligibleIndex([A, B, C], 0, -1)).toBe(-1)
  })

  it('skips a made-for-kids result entirely', () => {
    const kids = video({ videoId: 'kkkkkkkkkkk', madeForKids: true })
    expect(nextEligibleIndex([A, kids, C], 0, 1)).toBe(2)
  })

  it('skips a result with embedding disabled', () => {
    const blocked = video({ videoId: 'nnnnnnnnnnn', embeddable: false })
    expect(nextEligibleIndex([A, blocked, C], 0, 1)).toBe(2)
  })

  it('skips one YouTube did not report as made-for-kids either way', () => {
    // `null` is not the explicit `false` the policy audit requires.
    const unknown = video({ videoId: 'uuuuuuuuuuu', madeForKids: null })
    expect(nextEligibleIndex([A, unknown, C], 0, 1)).toBe(2)
  })

  it('walks backwards for Previous', () => {
    expect(nextEligibleIndex([A, B, C], 2, -1)).toBe(1)
  })
})

describe('starting a session from already-fetched results', () => {
  it('adopts the list without asking YouTube for anything', async () => {
    attach()
    await playYouTubeResult([A, B, C], B, 'arabic song')

    expect(store().sessionItems).toHaveLength(3)
    expect(store().sessionIndex).toBe(1)
    expect(store().sessionQuery).toBe('arabic song')
    expect(currentId()).toBe('bbbbbbbbbbb')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('preserves the relevance order the search returned', async () => {
    attach()
    await playYouTubeResult([A, B, C], A)
    expect(store().sessionItems.map((item) => item.videoId)).toEqual([
      'aaaaaaaaaaa',
      'bbbbbbbbbbb',
      'ccccccccccc',
    ])
  })

  it('is on by default, so a natural end continues', async () => {
    attach()
    await playYouTubeResult([A, B], A)
    expect(store().continuousPlay).toBe(true)
  })

  it('a single video played from elsewhere gets no session to continue into', async () => {
    attach()
    await playYouTubeResult([A, B, C], A)
    expect(store().sessionItems).toHaveLength(3)

    // Recently Played and the saved library both come through here.
    await playYouTubeVideo(video({ videoId: 'zzzzzzzzzzz' }), { userInitiated: true })
    expect(store().sessionItems).toEqual([])
    expect(store().sessionIndex).toBe(-1)
  })
})

describe('a natural end while the player is on screen', () => {
  beforeEach(async () => {
    attach()
    await playYouTubeResult([A, B, C], A)
    setYouTubeVisibleRatio(0.75)
    bindYouTubeEngineEvents()
  })

  it('advances to the next result', async () => {
    const advanced = await advanceYouTubeSession()

    expect(advanced).toBe(true)
    expect(currentId()).toBe('bbbbbbbbbbb')
    expect(store().sessionIndex).toBe(1)
  })

  it('spends no YouTube quota doing it', async () => {
    fetchSpy.mockClear()
    await advanceYouTubeSession()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips an ineligible result on the way', async () => {
    const kids = video({ videoId: 'kkkkkkkkkkk', madeForKids: true })
    await playYouTubeResult([A, kids, C], A)
    setYouTubeVisibleRatio(0.8)

    await advanceYouTubeSession()

    expect(currentId()).toBe('ccccccccccc')
    // The blocked item was never handed to the player.
    expect(factory.players.some((player) => player.videoId === 'kkkkkkkkkkk')).toBe(false)
  })

  it('stops at the end of the session rather than looping or searching', async () => {
    await playYouTubeResult([A, B], B)
    setYouTubeVisibleRatio(0.9)
    fetchSpy.mockClear()

    const advanced = await advanceYouTubeSession()

    expect(advanced).toBe(false)
    expect(currentId()).toBe('bbbbbbbbbbb')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does nothing when continuous play is switched off', async () => {
    store().setContinuousPlay(false)

    const advanced = await advanceYouTubeSession()

    expect(advanced).toBe(false)
    expect(currentId()).toBe('aaaaaaaaaaa')
  })

  it('runs from the engine event rather than needing a caller', async () => {
    await endCurrentVideo()
    await vi.waitFor(() => expect(currentId()).toBe('bbbbbbbbbbb'))
  })
})

describe('a natural end when the player is not visible enough', () => {
  beforeEach(async () => {
    attach()
    await playYouTubeResult([A, B, C], A)
  })

  it('cues the next result and waits for a press', async () => {
    setYouTubeVisibleRatio(0.4)

    const advanced = await advanceYouTubeSession()

    expect(advanced).toBe(false)
    expect(currentId()).toBe('bbbbbbbbbbb')
    expect(store().status).toBe('cued')
    expect(store().awaitingUserPlay).toBe(true)
    expect(factory.current()?.playing).toBe(false)
  })

  it('treats an unobserved player as not visible', async () => {
    resetYouTubeVisibility()

    await advanceYouTubeSession()

    expect(store().awaitingUserPlay).toBe(true)
    expect(factory.current()?.playing).toBe(false)
  })

  it('does not auto-play while the document is hidden', async () => {
    setYouTubeVisibleRatio(1)
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

    await advanceYouTubeSession()

    expect(store().awaitingUserPlay).toBe(true)
    expect(factory.current()?.playing).toBe(false)
    spy.mockRestore()
  })

  it('makes no request while cueing either', async () => {
    setYouTubeVisibleRatio(0.2)
    fetchSpy.mockClear()
    await advanceYouTubeSession()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the background-playback rule is unchanged', () => {
  beforeEach(async () => {
    attach()
    await playYouTubeResult([A, B, C], A)
    store().setStatus('playing')
  })

  it('pauses when the document becomes hidden', () => {
    handleDocumentVisibility(true)

    expect(store().status).toBe('paused')
    expect(factory.current()?.playing).toBe(false)
  })

  it('never starts the next result because the document went away', () => {
    handleDocumentVisibility(true)
    fetchSpy.mockClear()

    expect(currentId()).toBe('aaaaaaaaaaa')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('records why, so the surface can explain it once', () => {
    handleDocumentVisibility(true)
    expect(store().pausedForBackgroundPolicy).toBe(true)
  })

  it('clears that explanation as soon as playback resumes', () => {
    handleDocumentVisibility(true)
    store().setStatus('playing')
    expect(store().pausedForBackgroundPolicy).toBe(false)
  })

  it('keeps the session intact across the pause', () => {
    handleDocumentVisibility(true)
    expect(store().sessionItems).toHaveLength(3)
    expect(store().sessionIndex).toBe(0)
  })
})

describe('stepping through the session by hand', () => {
  beforeEach(async () => {
    attach()
    await playYouTubeResult([A, B, C], B)
  })

  it('moves forward on a real press, without needing visibility', async () => {
    resetYouTubeVisibility()
    const moved = await playYouTubeSessionStep(1)

    expect(moved).toBe(true)
    expect(currentId()).toBe('ccccccccccc')
    // A press is user-initiated, which is the one case `mayAutoplay` allows
    // without a visibility measurement.
    expect(store().status).not.toBe('cued')
  })

  it('moves backward', async () => {
    const moved = await playYouTubeSessionStep(-1)
    expect(moved).toBe(true)
    expect(currentId()).toBe('aaaaaaaaaaa')
  })

  it('reports what is reachable so the controls can disable themselves', async () => {
    expect(hasYouTubeSessionStep(1)).toBe(true)
    expect(hasYouTubeSessionStep(-1)).toBe(true)

    await playYouTubeSessionStep(1)
    expect(hasYouTubeSessionStep(1)).toBe(false)
    expect(hasYouTubeSessionStep(-1)).toBe(true)
  })

  it('spends no quota', async () => {
    fetchSpy.mockClear()
    await playYouTubeSessionStep(1)
    await playYouTubeSessionStep(-1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses to step past the ends', async () => {
    await playYouTubeSessionStep(-1)
    expect(await playYouTubeSessionStep(-1)).toBe(false)
    expect(currentId()).toBe('aaaaaaaaaaa')
  })
})

describe('closing the surface', () => {
  it('ends the session, so nothing can continue behind it', async () => {
    attach()
    await playYouTubeResult([A, B, C], A)

    closeYouTubeSurface()

    expect(store().sessionItems).toEqual([])
    expect(store().item).toBeNull()
    expect(await advanceYouTubeSession()).toBe(false)
  })

  it('keeps the continuous-play preference, which is about future results', async () => {
    attach()
    await playYouTubeResult([A, B], A)
    store().setContinuousPlay(false)

    closeYouTubeSurface()

    expect(store().continuousPlay).toBe(false)
  })
})
