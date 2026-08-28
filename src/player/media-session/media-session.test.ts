import { describe, expect, it, vi } from 'vitest'
import type { Track } from '@/music/types'
import {
  DEFAULT_SEEK_OFFSET_SECONDS,
  POSITION_THROTTLE_MS,
  SESSION_ACTIONS,
  createMediaSessionController,
  detectEnvironment,
} from './controller'
import type { MediaSessionLike, SessionHandlers } from './controller'
import { artworkForSession, sessionMetadataFor } from './metadata'

/**
 * The Media Session bridge.
 *
 * Everything here runs against a double rather than a real browser, because the
 * point is to pin behaviour that differs *between* browsers: which actions
 * exist, whether `setPositionState` is implemented, whether assigning
 * `playbackState` throws. A real environment would only ever prove one of them.
 */

interface Double {
  session: MediaSessionLike & { handlers: Map<string, ((details: unknown) => void) | null> }
  positions: Array<{ duration: number; playbackRate: number; position: number }>
  metadataInit: Record<string, unknown>[]
  now: { value: number }
}

/** A browser that implements the whole API. `unsupported` lists actions it refuses. */
function makeDouble(options: { unsupported?: string[]; noPositionState?: boolean } = {}): Double {
  const handlers = new Map<string, ((details: unknown) => void) | null>()
  const positions: Double['positions'] = []
  const metadataInit: Record<string, unknown>[] = []
  const now = { value: 1_000_000 }

  const session = {
    handlers,
    metadata: null,
    playbackState: 'none',
    setActionHandler(action: string, handler: ((details: unknown) => void) | null) {
      if (options.unsupported?.includes(action)) {
        throw new Error(`NotSupportedError: ${action}`)
      }
      handlers.set(action, handler)
    },
    ...(options.noPositionState
      ? {}
      : {
          setPositionState(state?: { duration: number; playbackRate: number; position: number }) {
            if (state) positions.push(state)
          },
        }),
  } as Double['session']

  return { session, positions, metadataInit, now }
}

function controllerFor(double: Double) {
  return createMediaSessionController({
    session: double.session,
    MediaMetadata: class {
      constructor(init: Record<string, unknown>) {
        double.metadataInit.push(init)
      }
    },
    now: () => double.now.value,
  })
}

function noopHandlers(): SessionHandlers {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    previousTrack: vi.fn(),
    nextTrack: vi.fn(),
    seekTo: vi.fn(),
    seekBy: vi.fn(),
  }
}

const track = (overrides: Partial<Track> = {}): Track => ({
  id: 'audius:t1',
  mediaKind: 'audio',
  provider: 'audius',
  providerId: 't1',
  title: 'Midnight Signal',
  artistName: 'Nova Sound',
  artwork: {
    medium: 'https://cn1.example.audius/content/abc/480x480.jpg',
    large: 'https://cn1.example.audius/content/abc/1000x1000.jpg',
    mirrors: ['https://cn2.example.audius'],
  },
  durationSeconds: 214,
  isStreamable: true,
  ...overrides,
})

describe('capability detection', () => {
  it('reports unsupported when there is no navigator at all', () => {
    const controller = createMediaSessionController({})
    expect(controller.supported).toBe(false)
  })

  it('does nothing, and throws nothing, on an unsupported browser', () => {
    const controller = createMediaSessionController({})
    const handlers = noopHandlers()
    expect(() => {
      controller.activate(handlers)
      controller.setTrack(track())
      controller.setPlaybackState('playing')
      controller.setPosition({ duration: 100, position: 10 })
      controller.deactivate()
    }).not.toThrow()
    expect(controller.registeredActions()).toEqual([])
  })

  it('treats a navigator with no mediaSession as unsupported', () => {
    const original = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
    try {
      expect(detectEnvironment().session).toBeUndefined()
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true })
    }
  })
})

describe('action handlers', () => {
  it('registers every documented action on a full implementation', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    controller.activate(noopHandlers())

    expect(controller.registeredActions()).toEqual([...SESSION_ACTIONS])
  })

  it('registers the rest when a browser refuses one action', () => {
    // `stop` and `seekto` are the two browsers most often decline.
    const double = makeDouble({ unsupported: ['stop', 'seekto'] })
    const controller = controllerFor(double)
    controller.activate(noopHandlers())

    const registered = controller.registeredActions()
    expect(registered).not.toContain('stop')
    expect(registered).not.toContain('seekto')
    expect(registered).toContain('play')
    expect(registered).toContain('nexttrack')
  })

  it('routes each OS action to the matching player action', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    const handlers = noopHandlers()
    controller.activate(handlers)

    double.session.handlers.get('play')?.(undefined)
    double.session.handlers.get('pause')?.(undefined)
    double.session.handlers.get('stop')?.(undefined)
    double.session.handlers.get('previoustrack')?.(undefined)
    double.session.handlers.get('nexttrack')?.(undefined)

    expect(handlers.play).toHaveBeenCalledTimes(1)
    expect(handlers.pause).toHaveBeenCalledTimes(1)
    expect(handlers.stop).toHaveBeenCalledTimes(1)
    expect(handlers.previousTrack).toHaveBeenCalledTimes(1)
    expect(handlers.nextTrack).toHaveBeenCalledTimes(1)
  })

  it('leaves no duplicate or stale handler when activated twice', () => {
    const double = makeDouble()
    const controller = controllerFor(double)

    const first = noopHandlers()
    controller.activate(first)
    const second = noopHandlers()
    controller.activate(second)

    double.session.handlers.get('nexttrack')?.(undefined)

    // Only the current generation runs, and the action list has not doubled.
    expect(first.nextTrack).not.toHaveBeenCalled()
    expect(second.nextTrack).toHaveBeenCalledTimes(1)
    expect(controller.registeredActions()).toEqual([...SESSION_ACTIONS])
  })

  describe('seeking', () => {
    it('passes an absolute seek through', () => {
      const double = makeDouble()
      const controller = controllerFor(double)
      const handlers = noopHandlers()
      controller.activate(handlers)

      double.session.handlers.get('seekto')?.({ seekTime: 42 })
      expect(handlers.seekTo).toHaveBeenCalledWith(42)
    })

    it('ignores a seek with no usable time', () => {
      const double = makeDouble()
      const controller = controllerFor(double)
      const handlers = noopHandlers()
      controller.activate(handlers)

      double.session.handlers.get('seekto')?.({})
      double.session.handlers.get('seekto')?.({ seekTime: Number.NaN })
      expect(handlers.seekTo).not.toHaveBeenCalled()
    })

    it('uses the offset the OS supplies, in both directions', () => {
      const double = makeDouble()
      const controller = controllerFor(double)
      const handlers = noopHandlers()
      controller.activate(handlers)

      double.session.handlers.get('seekforward')?.({ seekOffset: 30 })
      double.session.handlers.get('seekbackward')?.({ seekOffset: 30 })
      expect(handlers.seekBy).toHaveBeenNthCalledWith(1, 30)
      expect(handlers.seekBy).toHaveBeenNthCalledWith(2, -30)
    })

    it('falls back to a sensible jump when the OS supplies none', () => {
      const double = makeDouble()
      const controller = controllerFor(double)
      const handlers = noopHandlers()
      controller.activate(handlers)

      double.session.handlers.get('seekforward')?.({})
      double.session.handlers.get('seekbackward')?.(undefined)
      expect(handlers.seekBy).toHaveBeenNthCalledWith(1, DEFAULT_SEEK_OFFSET_SECONDS)
      expect(handlers.seekBy).toHaveBeenNthCalledWith(2, -DEFAULT_SEEK_OFFSET_SECONDS)
    })
  })
})

describe('metadata', () => {
  it('publishes the title and artist the player shows', () => {
    const metadata = sessionMetadataFor(track())
    expect(metadata.title).toBe('Midnight Signal')
    expect(metadata.artist).toBe('Nova Sound')
  })

  it('never invents an album', () => {
    // The Media Session spec has no provider field, and putting "Audius" in the
    // album slot would misrepresent the release on a lock screen.
    expect(sessionMetadataFor(track()).album).toBe('')
  })

  it('offers artwork through the app’s existing failover resolver', () => {
    const entries = artworkForSession(track())
    expect(entries.length).toBeGreaterThan(1)
    expect(entries[0].src).toContain('cn1.example.audius')
    // The mirror origin is offered too, so a dead content node is survivable
    // on the lock screen exactly as it is in the page.
    expect(entries.some((entry) => entry.src.includes('cn2.example.audius'))).toBe(true)
    for (const entry of entries) expect(entry.src).toMatch(/^https:\/\//)
  })

  it('publishes no artwork rather than a broken entry', () => {
    expect(artworkForSession(track({ artwork: {} }))).toEqual([])
  })

  it('writes metadata once per track, not once per store update', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    controller.setTrack(track())
    controller.setTrack(track())
    controller.setTrack(track())
    expect(double.metadataInit).toHaveLength(1)

    controller.setTrack(track({ id: 'audius:t2', providerId: 't2' }))
    expect(double.metadataInit).toHaveLength(2)
  })

  it('clears metadata when there is no track', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    controller.setTrack(track())
    controller.setTrack(null)
    expect(double.session.metadata).toBeNull()
  })
})

describe('playback state', () => {
  it('mirrors the player', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    controller.setPlaybackState('playing')
    expect(double.session.playbackState).toBe('playing')
    controller.setPlaybackState('paused')
    expect(double.session.playbackState).toBe('paused')
  })

  it('survives an implementation where the property is read-only', () => {
    const double = makeDouble()
    Object.defineProperty(double.session, 'playbackState', {
      get: () => 'none',
      set: () => {
        throw new Error('read-only')
      },
    })
    const controller = controllerFor(double)
    expect(() => controller.setPlaybackState('playing')).not.toThrow()
  })
})

describe('position state', () => {
  it('publishes a valid position', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    controller.setPosition({ duration: 214, position: 30 })
    expect(double.positions).toEqual([{ duration: 214, playbackRate: 1, position: 30 }])
  })

  it('throttles, so a 4 Hz timeupdate does not become 4 Hz of OS writes', () => {
    const double = makeDouble()
    const controller = controllerFor(double)

    for (let tick = 0; tick < 10; tick += 1) {
      double.now.value += 250
      controller.setPosition({ duration: 214, position: tick })
    }

    // Ten quarter-second ticks span 2.5s, so at most three writes.
    expect(double.positions.length).toBeLessThanOrEqual(3)
    expect(double.positions.length).toBeGreaterThan(0)
  })

  it('writes again once the throttle window has passed', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    controller.setPosition({ duration: 214, position: 1 })
    double.now.value += POSITION_THROTTLE_MS + 1
    controller.setPosition({ duration: 214, position: 2 })
    expect(double.positions).toHaveLength(2)
  })

  it('refuses a position state the spec would reject', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    // Duration is 0 before metadata loads, and NaN on a live stream.
    controller.setPosition({ duration: 0, position: 0 })
    double.now.value += 5_000
    controller.setPosition({ duration: Number.NaN, position: 10 })
    double.now.value += 5_000
    controller.setPosition({ duration: 100, position: -5 })
    expect(double.positions).toEqual([])
  })

  it('clamps a position past the end rather than throwing', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    controller.setPosition({ duration: 100, position: 250 })
    expect(double.positions[0].position).toBe(100)
  })

  it('is a no-op on a browser without setPositionState', () => {
    const double = makeDouble({ noPositionState: true })
    const controller = controllerFor(double)
    expect(() => controller.setPosition({ duration: 100, position: 10 })).not.toThrow()
  })
})

describe('handing the engine to YouTube', () => {
  it('removes every handler and clears the session', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    controller.activate(noopHandlers())
    controller.setTrack(track())
    controller.setPlaybackState('playing')

    controller.deactivate()

    expect(controller.registeredActions()).toEqual([])
    expect(double.session.metadata).toBeNull()
    expect(double.session.playbackState).toBe('none')
    for (const action of SESSION_ACTIONS) {
      expect(double.session.handlers.get(action)).toBeNull()
    }
  })

  it('leaves no handler that could reach a hidden YouTube player', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    const handlers = noopHandlers()
    controller.activate(handlers)
    controller.deactivate()

    // An OS Next after the handover must do nothing at all.
    double.session.handlers.get('nexttrack')?.(undefined)
    expect(handlers.nextTrack).not.toHaveBeenCalled()
  })

  it('restores a working session when audio takes the engine back', () => {
    const double = makeDouble()
    const controller = controllerFor(double)
    controller.activate(noopHandlers())
    controller.deactivate()

    const restored = noopHandlers()
    controller.activate(restored)
    controller.setTrack(track())

    double.session.handlers.get('nexttrack')?.(undefined)
    expect(restored.nextTrack).toHaveBeenCalledTimes(1)
    expect(controller.registeredActions()).toEqual([...SESSION_ACTIONS])
    expect(double.metadataInit).toHaveLength(1)
  })
})
