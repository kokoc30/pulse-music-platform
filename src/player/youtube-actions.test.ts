import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { youtubePayload } from '@/test/fixtures/youtube'
import { activeEngine, resetPlaybackCoordinator } from './playback-coordinator'
import { createFakeYouTubeFactory } from './youtube/fake-adapter'
import type { FakeYouTubeFactory } from './youtube/fake-adapter'
import {
  AUTOPLAY_VISIBILITY_RATIO,
  bindYouTubeEngineEvents,
  closeYouTubeSurface,
  cueYouTubeVideo,
  handleDocumentVisibility,
  mayAutoplay,
  playYouTubeVideo,
  toggleYouTubePlayback,
} from './youtube-actions'
import { createYouTubeIframeEngine, setYouTubeEngine } from './youtube-engine'
import { initialYouTubeState, useYouTubeStore } from './youtube-store'

const video = (overrides = {}) => normalizeYouTubeVideo(youtubePayload(overrides))

let factory: FakeYouTubeFactory
let container: HTMLDivElement
let unbind: () => void

beforeEach(() => {
  factory = createFakeYouTubeFactory()
  container = document.createElement('div')
  document.body.appendChild(container)
  const engine = createYouTubeIframeEngine({ factory, origin: 'https://pulse.test' })
  engine.attach(container)
  setYouTubeEngine(engine)
  unbind = bindYouTubeEngineEvents()
  useYouTubeStore.setState(initialYouTubeState)
  resetPlaybackCoordinator()
})

afterEach(() => {
  unbind()
  setYouTubeEngine(null)
  container.remove()
})

describe('the scripted-autoplay visibility rule', () => {
  /**
   * "An API Client must not initiate an automatic playback until the player is
   * visible and more than half of the player is visible on the page or screen."
   * — YouTube Required Minimum Functionality.
   */
  it('uses a strict "more than half" threshold', () => {
    expect(AUTOPLAY_VISIBILITY_RATIO).toBe(0.5)
    expect(mayAutoplay({ userInitiated: false, visibleRatio: 0.51 })).toBe(true)
    expect(mayAutoplay({ userInitiated: false, visibleRatio: 0.5 })).toBe(false)
    expect(mayAutoplay({ userInitiated: false, visibleRatio: 0.49 })).toBe(false)
    expect(mayAutoplay({ userInitiated: false, visibleRatio: 0 })).toBe(false)
  })

  it('refuses every unknown — the uncertain case is "do not autoplay"', () => {
    expect(mayAutoplay({ userInitiated: false })).toBe(false)
    expect(mayAutoplay({ userInitiated: false, visibleRatio: Number.NaN })).toBe(false)
  })

  it('refuses when the document is hidden, however visible the element is', () => {
    expect(mayAutoplay({ userInitiated: false, visibleRatio: 1, documentHidden: true })).toBe(false)
  })

  it('allows a direct user gesture, which is not automatic playback at all', () => {
    expect(mayAutoplay({ userInitiated: true })).toBe(true)
    expect(mayAutoplay({ userInitiated: true, visibleRatio: 0 })).toBe(true)
  })

  it('cues rather than plays when a scripted transition cannot confirm visibility', async () => {
    await playYouTubeVideo(video(), { userInitiated: false })
    expect(factory.current()?.playCalls).toBe(0)
    expect(factory.current()?.cued).toBe(true)
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
    expect(useYouTubeStore.getState().status).toBe('cued')
  })

  it('plays on a scripted transition only when the player is genuinely visible', async () => {
    await playYouTubeVideo(video(), { userInitiated: false, visibleRatio: 0.95 })
    expect(factory.current()?.playing).toBe(true)
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(false)
  })

  it('cue() never plays, whatever the caller believes about visibility', async () => {
    await cueYouTubeVideo(video())
    expect(factory.current()?.playCalls).toBe(0)
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
  })
})

describe('the surface is revealed before anything plays', () => {
  it('opens the surface first, so the player is on screen when play is asked for', async () => {
    const order: string[] = []
    const unsubscribe = useYouTubeStore.subscribe((state) => {
      if (state.surfaceOpen) order.push('surface-open')
    })
    await playYouTubeVideo(video(), { userInitiated: true })
    unsubscribe()

    expect(order[0]).toBe('surface-open')
    expect(useYouTubeStore.getState().surfaceOpen).toBe(true)
  })

  it('claims the single active engine as it opens', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    expect(activeEngine()).toBe('youtube')
  })
})

describe('background playback is prevented', () => {
  it('pauses when the document becomes hidden', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    expect(factory.current()?.playing).toBe(true)

    handleDocumentVisibility(true)

    expect(factory.current()?.playing).toBe(false)
    expect(useYouTubeStore.getState().status).toBe('paused')
  })

  it('does nothing when the document becomes visible again — no auto-resume', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    handleDocumentVisibility(true)
    handleDocumentVisibility(false)
    // Resuming on its own would be scripted playback with no visibility proof.
    expect(factory.current()?.playing).toBe(false)
  })

  it('is a no-op when nothing is playing', () => {
    expect(() => handleDocumentVisibility(true)).not.toThrow()
    expect(useYouTubeStore.getState().status).toBe('idle')
  })

  it('stops playback when the visible surface is closed', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    closeYouTubeSurface()
    // Stop, not pause: a dismissed player the visitor cannot see is exactly the
    // background player the developer policies prohibit.
    expect(factory.current()?.playing).toBe(false)
    expect(useYouTubeStore.getState().surfaceOpen).toBe(false)
    expect(activeEngine()).toBe('none')
  })
})

describe('items that may not be embedded', () => {
  it('never builds a player for a made-for-kids video', async () => {
    const result = await playYouTubeVideo(video({ madeForKids: true }), { userInitiated: true })
    expect(result).toBe(false)
    expect(factory.created).toBe(0)
    expect(useYouTubeStore.getState().error).toMatch(/made for kids/i)
  })

  it('never builds a player when madeForKids was not reported', async () => {
    const result = await playYouTubeVideo(video({ madeForKids: null }), { userInitiated: true })
    expect(result).toBe(false)
    expect(factory.created).toBe(0)
  })

  it('never builds a player when the uploader disabled embedding', async () => {
    const result = await playYouTubeVideo(video({ embeddable: false }), { userInitiated: true })
    expect(result).toBe(false)
    expect(factory.created).toBe(0)
    expect(useYouTubeStore.getState().error).toMatch(/embedding/i)
  })

  it('blocks a cue for the same reasons', async () => {
    expect(await cueYouTubeVideo(video({ madeForKids: true }))).toBe(false)
    expect(factory.created).toBe(0)
  })
})

describe('the surface play/pause control', () => {
  it('pauses and resumes through documented IFrame methods only', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    expect(useYouTubeStore.getState().status).toBe('playing')

    toggleYouTubePlayback()
    expect(factory.current()?.playing).toBe(false)
    expect(useYouTubeStore.getState().status).toBe('paused')

    toggleYouTubePlayback()
    expect(factory.current()?.playing).toBe(true)
  })

  it('clears the "press play" prompt once the visitor does', async () => {
    await playYouTubeVideo(video(), { userInitiated: false })
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
    toggleYouTubePlayback()
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(false)
    expect(factory.current()?.playing).toBe(true)
  })

  it('does nothing with no item loaded', () => {
    expect(() => toggleYouTubePlayback()).not.toThrow()
    expect(factory.created).toBe(0)
  })
})

describe('engine events reach the store', () => {
  it('mirrors playing, paused, ended, cued and buffering', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    const player = factory.current()!

    player.emitState(2)
    expect(useYouTubeStore.getState().status).toBe('paused')
    player.emitState(0)
    expect(useYouTubeStore.getState().status).toBe('ended')
    player.emitState(5)
    expect(useYouTubeStore.getState().status).toBe('cued')
    player.emitState(3)
    expect(useYouTubeStore.getState().status).toBe('loading')
    player.emitState(1)
    expect(useYouTubeStore.getState().status).toBe('playing')
  })

  it('surfaces a player error as safe copy', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    factory.current()!.emitError(101)
    expect(useYouTubeStore.getState().status).toBe('error')
    expect(useYouTubeStore.getState().error).toMatch(/outside YouTube/i)
  })

  it('asks for a press when the browser blocks autoplay, and does not retry', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    const before = factory.current()!.playCalls
    factory.current()!.emitAutoplayBlocked()
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
    expect(useYouTubeStore.getState().status).toBe('paused')
    expect(factory.current()!.playCalls).toBe(before)
  })

  it('records progress from the engine clock', async () => {
    await playYouTubeVideo(video(), { userInitiated: true })
    useYouTubeStore.getState().setProgress(42, 213)
    expect(useYouTubeStore.getState().currentTime).toBe(42)
    expect(useYouTubeStore.getState().duration).toBe(213)
  })
})
