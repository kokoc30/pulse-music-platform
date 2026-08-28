/**
 * The single global audio engine.
 *
 * Exactly one `HTMLAudioElement` exists for the whole application; track rows
 * and cards never own audio (agents/07_PLAYER_BEHAVIOR.md → "Single Audio
 * Engine"). Everything is behind the `AudioEngine` interface so tests can inject
 * a deterministic fake instead of fighting jsdom (agents/09_TESTING_QA.md).
 */

export interface AudioEngineEvents {
  onLoadStart?: () => void
  onCanPlay?: () => void
  onPlay?: () => void
  onPause?: () => void
  onTimeUpdate?: (currentTime: number) => void
  onDurationChange?: (duration: number) => void
  onVolumeChange?: (volume: number, muted: boolean) => void
  onEnded?: () => void
  onError?: (message: string) => void
}

export interface AudioEngine {
  load(src: string): void
  play(): Promise<void>
  pause(): void
  seek(seconds: number): void
  setVolume(value: number): void
  setMuted(muted: boolean): void
  getDuration(): number
  getCurrentTime(): number
  /** Releases the current source without tearing the engine down. */
  stop(): void
  subscribe(events: AudioEngineEvents): () => void
  destroy(): void
}

/** Human-readable, non-leaky text for the five `MediaError` codes. */
export function describeMediaError(error: MediaError | null): string {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Playback was interrupted.'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'The audio stream was interrupted by a network problem.'
    case MediaError.MEDIA_ERR_DECODE:
      return 'This audio file could not be decoded by your browser.'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This track isn't available to stream right now."
    default:
      return 'Playback failed. Try another track.'
  }
}

export const AUDIO_ELEMENT_ID = 'pulse-audio'

export function createHtmlAudioEngine(element?: HTMLAudioElement): AudioEngine {
  const audio = element ?? new Audio()
  audio.preload = 'metadata'
  // Never send credentials and never request CORS access we do not need: the
  // element streams the signed Audius URL directly from Audius.
  audio.crossOrigin = null

  // Attached to the document rather than left detached: mobile Safari is far
  // more reliable with an in-document media element, and it gives tests a real
  // element to assert against. It is the only <audio> the app ever creates.
  if (!element && typeof document !== 'undefined' && !audio.isConnected) {
    audio.id = AUDIO_ELEMENT_ID
    audio.setAttribute('data-testid', AUDIO_ELEMENT_ID)
    audio.hidden = true
    document.body.appendChild(audio)
  }

  const listeners = new Set<AudioEngineEvents>()
  const emit = <K extends keyof AudioEngineEvents>(
    key: K,
    ...args: Parameters<NonNullable<AudioEngineEvents[K]>>
  ) => {
    for (const listener of listeners) {
      const handler = listener[key] as ((...a: typeof args) => void) | undefined
      handler?.(...args)
    }
  }

  const handlers: Array<[keyof HTMLMediaElementEventMap, () => void]> = [
    ['loadstart', () => emit('onLoadStart')],
    ['canplay', () => emit('onCanPlay')],
    ['play', () => emit('onPlay')],
    ['playing', () => emit('onPlay')],
    ['pause', () => emit('onPause')],
    ['timeupdate', () => emit('onTimeUpdate', audio.currentTime)],
    [
      'loadedmetadata',
      () => emit('onDurationChange', Number.isFinite(audio.duration) ? audio.duration : 0),
    ],
    [
      'durationchange',
      () => emit('onDurationChange', Number.isFinite(audio.duration) ? audio.duration : 0),
    ],
    ['volumechange', () => emit('onVolumeChange', audio.volume, audio.muted)],
    ['ended', () => emit('onEnded')],
    ['error', () => emit('onError', describeMediaError(audio.error))],
  ]

  for (const [event, handler] of handlers) {
    audio.addEventListener(event, handler)
  }

  return {
    load(src) {
      audio.src = src
      audio.load()
    },
    async play() {
      await audio.play()
    },
    pause() {
      audio.pause()
    },
    seek(seconds) {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0
      if (duration <= 0) return
      audio.currentTime = Math.min(Math.max(seconds, 0), duration)
    },
    setVolume(value) {
      audio.volume = Math.min(Math.max(value, 0), 1)
    },
    setMuted(muted) {
      audio.muted = muted
    },
    getDuration() {
      return Number.isFinite(audio.duration) ? audio.duration : 0
    },
    getCurrentTime() {
      return audio.currentTime
    },
    stop() {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    },
    subscribe(events) {
      listeners.add(events)
      return () => {
        listeners.delete(events)
      }
    },
    destroy() {
      for (const [event, handler] of handlers) {
        audio.removeEventListener(event, handler)
      }
      listeners.clear()
      audio.pause()
      audio.removeAttribute('src')
      audio.remove()
    },
  }
}

let engine: AudioEngine | null = null

/** Lazily created so importing this module never touches the DOM. */
export function getAudioEngine(): AudioEngine {
  engine ??= createHtmlAudioEngine()
  return engine
}

/** Test seam, and the HMR teardown hook. */
export function setAudioEngine(next: AudioEngine | null): void {
  if (engine && engine !== next) engine.destroy()
  engine = next
}
