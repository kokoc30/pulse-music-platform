import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YouTubeVideoItem } from '@/music/types'
import { createFakeYouTubeFactory } from './youtube/fake-adapter'
import type { FakeYouTubeFactory } from './youtube/fake-adapter'
import { createYouTubeIframeEngine, getYouTubeEngine, setYouTubeEngine } from './youtube-engine'
import { resetPlaybackCoordinator } from './playback-coordinator'
import { useUiStore } from '@/app/ui-store'
import { NO_MORE_TRACKS_MESSAGE, clearPlayedSession } from './related-fetcher'
import {
  MAX_SESSION_RELATED_SEARCHES,
  advanceYouTubeSession,
  bindYouTubeEngineEvents,
  closeYouTubeSurface,
  extendYouTubeSession,
  handleDocumentVisibility,
  hasYouTubeSessionStep,
  nextEligibleIndex,
  playYouTubeResult,
  playYouTubeSessionStep,
  playYouTubeVideo,
  resetYouTubeAdvanceGuard,
  resetYouTubeRelatedBudget,
  youTubeRelatedSearchesSpent,
} from './youtube-actions'
import { initialYouTubeState, useYouTubeStore } from './youtube-store'
import { resetYouTubeVisibility, setYouTubeVisibleRatio } from './youtube-visibility'

/**
 * Continuing after a YouTube video ends.
 *
 * Three things are being protected at once, and they pull against each other:
 * a video that ends must not dump the visitor on YouTube's replay screen,
 * nothing may auto-play unless the policy's visibility condition is genuinely
 * met, and the day's hundred searches belong to every visitor rather than to
 * whoever left a tab open. Every test below pins one of the three.
 *
 * **Bounded quota, asserted.** `fetch` is replaced throughout, so every request
 * is both visible and refused. A continuation that can be answered from results
 * already in hand must make none; only an *exhausted* session may spend one, and
 * `MAX_SESSION_RELATED_SEARCHES` caps how many a sitting may spend in total.
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
const D = video({ videoId: 'ddddddddddd', title: 'Arabic Song D' })
const E = video({ videoId: 'eeeeeeeeeee', title: 'Arabic Song E' })
const F = video({ videoId: 'fffffffffff', title: 'Arabic Song F' })
const G = video({ videoId: 'ggggggggggg', title: 'Arabic Song G' })

/**
 * A session long enough that the depth prefetch stays out of the way.
 *
 * Playing a video tops the session up to `MIN_QUEUE_DEPTH` playable items
 * ahead, which is exactly what a real search of fifteen results makes invisible
 * and a fixture of three would make constant. Tests about *advancing* use this;
 * tests about *running out* deliberately use a short one.
 */
const DEEP = [A, B, C, D, E, F, G]

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
  resetYouTubeRelatedBudget()
  resetYouTubeAdvanceGuard()
  clearPlayedSession()
  useUiStore.setState({ notice: null, noticeAction: null })
  factory = createFakeYouTubeFactory()
  setYouTubeEngine(createYouTubeIframeEngine({ factory, origin: 'http://localhost' }))
  // Every request is both visible and refused: the spy records what was asked
  // for, and the rejection proves no continuation depends on one succeeding.
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
  it('adopts the list exactly as the search returned it', async () => {
    attach()
    await playYouTubeResult([A, B, C], B, 'arabic song')

    expect(store().sessionItems).toHaveLength(3)
    expect(store().sessionIndex).toBe(1)
    expect(store().sessionQuery).toBe('arabic song')
    expect(currentId()).toBe('bbbbbbbbbbb')
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
    await playYouTubeResult(DEEP, A)
    setYouTubeVisibleRatio(0.75)
    bindYouTubeEngineEvents()
  })

  it('advances to the next result', async () => {
    const advanced = await advanceYouTubeSession()

    expect(advanced).toBe(true)
    expect(currentId()).toBe('bbbbbbbbbbb')
    expect(store().sessionIndex).toBe(1)
  })

  it('spends no YouTube quota while the session can still answer', async () => {
    fetchSpy.mockClear()
    await advanceYouTubeSession()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(youTubeRelatedSearchesSpent()).toBe(0)
  })

  it('skips an ineligible result on the way', async () => {
    const kids = video({ videoId: 'kkkkkkkkkkk', madeForKids: true })
    await playYouTubeResult([A, kids, C, D, E], A)
    setYouTubeVisibleRatio(0.8)

    await advanceYouTubeSession()

    expect(currentId()).toBe('ccccccccccc')
    // The blocked item was never handed to the player.
    expect(factory.players.some((player) => player.videoId === 'kkkkkkkkkkk')).toBe(false)
  })

  /**
   * The end of the session used to be the end of the story, and this assertion
   * used to say so. It is the reported bug: the visitor was left looking at
   * YouTube's replay screen with no way onward but to search again.
   *
   * Now the session is extended. Here the search is refused — `fetch` rejects —
   * so the honest ending stands: the bar says it cannot find more, the video
   * that just ended is *not* restarted, and the allowance is spent once rather
   * than in a loop.
   */
  it('searches for more when the session runs out, and says so when that fails', async () => {
    await playYouTubeResult([A, B], B)
    setYouTubeVisibleRatio(0.9)
    fetchSpy.mockClear()

    const advanced = await advanceYouTubeSession()

    expect(advanced).toBe(false)
    expect(fetchSpy).toHaveBeenCalled()
    // Above all: the video that just ended is not the one loaded next.
    expect(currentId()).toBe('bbbbbbbbbbb')
    expect(store().sessionIndex).toBe(1)
    expect(useUiStore.getState().notice).toBe(NO_MORE_TRACKS_MESSAGE)
  })

  it('never spends more than the sitting is allowed', async () => {
    for (let attempt = 0; attempt < MAX_SESSION_RELATED_SEARCHES + 4; attempt += 1) {
      await extendYouTubeSession()
    }

    expect(youTubeRelatedSearchesSpent()).toBe(MAX_SESSION_RELATED_SEARCHES)
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
    await playYouTubeResult(DEEP, A)
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
    await playYouTubeResult(DEEP, A)
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
    expect(store().sessionItems).toHaveLength(DEEP.length)
    expect(store().sessionIndex).toBe(0)
  })
})

describe('stepping through the session by hand', () => {
  beforeEach(async () => {
    attach()
    await playYouTubeResult(DEEP, B)
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

  /**
   * Previous disables itself at the start of the list; Next does not disable
   * itself at the end of it, because the action behind Next can extend the
   * session. A control that greys out over an action that would have answered is
   * the exact defect `useHasNext` was deleted for on the audio side.
   */
  it('reports what is reachable so the controls can disable themselves', async () => {
    expect(hasYouTubeSessionStep(1)).toBe(true)
    expect(hasYouTubeSessionStep(-1)).toBe(true)

    await playYouTubeResult([A, B], B)
    expect(hasYouTubeSessionStep(1)).toBe(true)
    expect(hasYouTubeSessionStep(-1)).toBe(true)

    store().setContinuousPlay(false)
    expect(hasYouTubeSessionStep(1)).toBe(false)
  })

  it('spends no quota while the session can still answer', async () => {
    fetchSpy.mockClear()
    await playYouTubeSessionStep(1)
    await playYouTubeSessionStep(-1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(youTubeRelatedSearchesSpent()).toBe(0)
  })

  it('refuses to step back past the start', async () => {
    await playYouTubeSessionStep(-1)
    expect(await playYouTubeSessionStep(-1)).toBe(false)
    expect(currentId()).toBe('aaaaaaaaaaa')
  })

  /**
   * A press at the end of the list extends it rather than doing nothing — and
   * when the search cannot answer, says so instead of replaying the video.
   */
  it('extends the list on a press past the end, and explains a failure', async () => {
    await playYouTubeResult([A, B], B)

    expect(await playYouTubeSessionStep(1)).toBe(false)

    // A search was attempted — either the press's own, or the depth prefetch it
    // joined, which is the point of sharing one extension between them.
    expect(youTubeRelatedSearchesSpent()).toBeGreaterThan(0)
    expect(currentId()).toBe('bbbbbbbbbbb')
    expect(useUiStore.getState().notice).toBe(NO_MORE_TRACKS_MESSAGE)
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
