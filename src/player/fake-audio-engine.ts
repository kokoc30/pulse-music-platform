import type { AudioEngine, AudioEngineEvents } from './audio-engine'

export interface FakeAudioEngine extends AudioEngine {
  readonly src: string | null
  readonly playing: boolean
  readonly volume: number
  readonly muted: boolean
  readonly loadCount: number
  /** Force the next `play()` to reject with the given error name. */
  failNextPlayWith(name: string): void
  /** Drive the engine's own events from a test. */
  emitDuration(seconds: number): void
  emitTimeUpdate(seconds: number): void
  emitEnded(): void
  emitError(message: string): void
}

/**
 * Deterministic stand-in for the HTMLAudioElement engine. jsdom cannot decode
 * audio, so tests drive this instead of weakening the production engine
 * (agents/09_TESTING_QA.md → "Audio Test Strategy").
 */
export function createFakeAudioEngine(): FakeAudioEngine {
  const listeners = new Set<AudioEngineEvents>()
  let src: string | null = null
  let playing = false
  let volume = 1
  let muted = false
  let duration = 0
  let currentTime = 0
  let loadCount = 0
  let failNextPlay: string | null = null

  const emit = (fn: (events: AudioEngineEvents) => void) => {
    for (const listener of listeners) fn(listener)
  }

  return {
    get src() {
      return src
    },
    get playing() {
      return playing
    },
    get volume() {
      return volume
    },
    get muted() {
      return muted
    },
    get loadCount() {
      return loadCount
    },

    load(next) {
      src = next
      loadCount += 1
      currentTime = 0
      playing = false
      emit((e) => e.onLoadStart?.())
    },
    play() {
      if (failNextPlay) {
        const name = failNextPlay
        failNextPlay = null
        const error = new Error('play rejected')
        error.name = name
        return Promise.reject(error)
      }
      playing = true
      emit((e) => e.onPlay?.())
      return Promise.resolve()
    },
    pause() {
      playing = false
      emit((e) => e.onPause?.())
    },
    seek(seconds) {
      if (duration <= 0) return
      currentTime = Math.min(Math.max(seconds, 0), duration)
      emit((e) => e.onTimeUpdate?.(currentTime))
    },
    setVolume(value) {
      volume = Math.min(Math.max(value, 0), 1)
      emit((e) => e.onVolumeChange?.(volume, muted))
    },
    setMuted(next) {
      muted = next
      emit((e) => e.onVolumeChange?.(volume, muted))
    },
    getDuration() {
      return duration
    },
    getCurrentTime() {
      return currentTime
    },
    stop() {
      playing = false
      src = null
      currentTime = 0
    },
    subscribe(events) {
      listeners.add(events)
      return () => {
        listeners.delete(events)
      }
    },
    destroy() {
      listeners.clear()
      playing = false
      src = null
    },

    failNextPlayWith(name) {
      failNextPlay = name
    },
    emitDuration(seconds) {
      duration = seconds
      emit((e) => e.onDurationChange?.(seconds))
    },
    emitTimeUpdate(seconds) {
      currentTime = seconds
      emit((e) => e.onTimeUpdate?.(seconds))
    },
    emitEnded() {
      playing = false
      emit((e) => e.onEnded?.())
    },
    emitError(message) {
      playing = false
      emit((e) => e.onError?.(message))
    },
  }
}
