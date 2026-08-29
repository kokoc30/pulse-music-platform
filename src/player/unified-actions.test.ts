import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { audiusTrack } from '@/test/fixtures/library'
import { youtubePayload } from '@/test/fixtures/youtube'
// Type-only, so both are erased before `vi.mock` hoisting can care about them.
import type * as CoordinatorModule from './playback-coordinator'
import type * as YouTubeActionsModule from './youtube-actions'

/**
 * The transport facade.
 *
 * The whole point of this module is that it is the *only* place in the UI layer
 * that dispatches on the engine, so these tests assert exactly one thing per
 * action: the right underlying function was called, and the other engine's was
 * not. Behaviour lives in the modules being dispatched to and is tested there —
 * duplicating it here would be a second definition of what Next means, which is
 * the failure this refactor exists to remove.
 */

const engine = vi.hoisted((): { current: 'none' | 'audio' | 'youtube' } => ({ current: 'none' }))

vi.mock('./playback-coordinator', async (importOriginal) => ({
  ...(await importOriginal<typeof CoordinatorModule>()),
  activeEngine: () => engine.current,
}))

vi.mock('./player-actions', () => ({
  togglePlay: vi.fn(() => Promise.resolve()),
  skipToNext: vi.fn(() => Promise.resolve()),
  playPrevious: vi.fn(() => Promise.resolve()),
  seek: vi.fn(),
  playTrack: vi.fn(() => Promise.resolve()),
}))

vi.mock('./youtube-actions', async (importOriginal) => ({
  // `nextEligibleIndex` is a pure helper the snapshot needs; keep it real.
  ...(await importOriginal<typeof YouTubeActionsModule>()),
  toggleYouTubePlayback: vi.fn(),
  playYouTubeSessionStep: vi.fn(() => Promise.resolve(true)),
  seekYouTube: vi.fn(),
  playYouTubeVideo: vi.fn(() => Promise.resolve(true)),
}))

const audio = await import('./player-actions')
const youtube = await import('./youtube-actions')
const { useUiStore } = await import('@/app/ui-store')
const { useLibraryStore } = await import('@/library/store')
const { usePlayerStore } = await import('./player-store')
const { useYouTubeStore } = await import('./youtube-store')
const {
  unifiedExpand,
  unifiedLikeToggle,
  unifiedNext,
  unifiedPlay,
  unifiedPlayPause,
  unifiedPrev,
  unifiedSeek,
} = await import('./unified-actions')

const VIDEO = normalizeYouTubeVideo(youtubePayload({ videoId: 'aram0000001', title: 'Sourp' }))
const TRACK = audiusTrack()

beforeEach(() => {
  engine.current = 'none'
  usePlayerStore.getState().reset()
  useYouTubeStore.getState().close()
  useUiStore.setState({ nowPlayingOpen: false })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('every action dispatches to exactly one engine', () => {
  it.each([
    ['unifiedPlayPause', () => unifiedPlayPause(), 'togglePlay', 'toggleYouTubePlayback'],
    ['unifiedNext', () => unifiedNext(), 'skipToNext', 'playYouTubeSessionStep'],
    ['unifiedPrev', () => unifiedPrev(), 'playPrevious', 'playYouTubeSessionStep'],
  ] as const)('%s reaches audio and never YouTube', (_name, run, audioFn, youTubeFn) => {
    engine.current = 'audio'
    run()
    expect(audio[audioFn]).toHaveBeenCalledTimes(1)
    expect(youtube[youTubeFn]).not.toHaveBeenCalled()
  })

  it.each([
    ['unifiedPlayPause', () => unifiedPlayPause(), 'togglePlay', 'toggleYouTubePlayback'],
    ['unifiedNext', () => unifiedNext(), 'skipToNext', 'playYouTubeSessionStep'],
    ['unifiedPrev', () => unifiedPrev(), 'playPrevious', 'playYouTubeSessionStep'],
  ] as const)('%s reaches YouTube and never audio', (_name, run, audioFn, youTubeFn) => {
    engine.current = 'youtube'
    run()
    expect(youtube[youTubeFn]).toHaveBeenCalledTimes(1)
    expect(audio[audioFn]).not.toHaveBeenCalled()
  })

  it('steps the session in the direction the control means', () => {
    engine.current = 'youtube'
    unifiedNext()
    expect(youtube.playYouTubeSessionStep).toHaveBeenLastCalledWith(1)
    unifiedPrev()
    expect(youtube.playYouTubeSessionStep).toHaveBeenLastCalledWith(-1)
  })
})

describe('seeking', () => {
  /**
   * Absolute on both sides. The rail computes a *position* from where the
   * pointer was released, and `seek` / `seekYouTube` are the two functions that
   * take one. Routing to the relative helper (`seekBy`) would have the audio
   * engine read a position as an offset.
   */
  it('sends an absolute position to the audio engine', () => {
    engine.current = 'audio'
    unifiedSeek(42)
    expect(audio.seek).toHaveBeenCalledWith(42)
    expect(youtube.seekYouTube).not.toHaveBeenCalled()
  })

  it('sends an absolute position to the YouTube engine', () => {
    engine.current = 'youtube'
    unifiedSeek(42)
    expect(youtube.seekYouTube).toHaveBeenCalledWith(42)
    expect(audio.seek).not.toHaveBeenCalled()
  })
})

describe('unifiedPlay dispatches on the item, not on the claim', () => {
  it('sends a video to the embed even while audio holds the engine', async () => {
    engine.current = 'audio'
    await unifiedPlay(VIDEO)
    expect(youtube.playYouTubeVideo).toHaveBeenCalledWith(VIDEO, { userInitiated: true })
    expect(audio.playTrack).not.toHaveBeenCalled()
  })

  it('sends a track to the audio element even while YouTube holds the engine', async () => {
    engine.current = 'youtube'
    await unifiedPlay(TRACK, { id: 'library:liked', label: 'Liked Songs' })
    expect(audio.playTrack).toHaveBeenCalledWith(TRACK, {
      queue: [TRACK],
      index: 0,
      context: { id: 'library:liked', label: 'Liked Songs' },
    })
    expect(youtube.playYouTubeVideo).not.toHaveBeenCalled()
  })

  it('omits the queue context entirely when none was given', async () => {
    await unifiedPlay(TRACK)
    expect(audio.playTrack).toHaveBeenCalledWith(TRACK, { queue: [TRACK], index: 0 })
  })
})

describe('expanding and collapsing', () => {
  it('opens the sheet without touching either engine', () => {
    engine.current = 'youtube'
    unifiedExpand(true)
    expect(useUiStore.getState().nowPlayingOpen).toBe(true)
    expect(youtube.toggleYouTubePlayback).not.toHaveBeenCalled()
  })

  /**
   * A docked stage is small and easily scrolled past, and the developer
   * policies prohibit a player that is not displayed in the screen the user is
   * viewing. Pausing on the way down means playback never continues into a
   * state this application cannot guarantee is visible.
   */
  it('pauses a playing video on the way down', () => {
    engine.current = 'youtube'
    useYouTubeStore.getState().openWith(VIDEO, 'playing')
    useYouTubeStore.getState().setStatus('playing')

    unifiedExpand(false)

    expect(youtube.toggleYouTubePlayback).toHaveBeenCalledTimes(1)
    expect(useUiStore.getState().nowPlayingOpen).toBe(false)
  })

  it('leaves an already-paused video alone', () => {
    engine.current = 'youtube'
    useYouTubeStore.getState().openWith(VIDEO, 'paused')
    unifiedExpand(false)
    expect(youtube.toggleYouTubePlayback).not.toHaveBeenCalled()
  })

  it('never pauses audio — collapsing is only a change of view', () => {
    engine.current = 'audio'
    unifiedExpand(false)
    expect(audio.togglePlay).not.toHaveBeenCalled()
    expect(useUiStore.getState().nowPlayingOpen).toBe(false)
  })
})

describe('unifiedLikeToggle', () => {
  it('saves whichever item is loaded, on either engine', () => {
    engine.current = 'audio'
    usePlayerStore.getState().setCurrentTrack(TRACK)
    unifiedLikeToggle()
    expect(useLibraryStore.getState().state.likedTrackKeys).toContain('audius:t1')

    engine.current = 'youtube'
    useYouTubeStore.getState().openWith(VIDEO, 'playing')
    unifiedLikeToggle()
    expect(useLibraryStore.getState().state.likedTrackKeys).toContain('youtube:aram0000001')
  })

  it('does nothing when nothing is loaded', () => {
    const before = useLibraryStore.getState().state.likedTrackKeys.length
    unifiedLikeToggle()
    expect(useLibraryStore.getState().state.likedTrackKeys).toHaveLength(before)
  })
})
