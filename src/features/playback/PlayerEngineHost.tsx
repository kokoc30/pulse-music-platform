import { useEffect } from 'react'
import { showNotice } from '@/app/ui-store'
import { getAudioEngine } from '@/player/audio-engine'
import { handleMediaError, handleTrackEnded } from '@/player/player-actions'
import { usePlayerStore } from '@/player/player-store'

/**
 * Owns the one global audio engine's event wiring.
 *
 * Mounted once, above the router, so SPA navigation never rebuilds the engine
 * (agents/07_PLAYER_BEHAVIOR.md → "Navigation Persistence"). It renders nothing.
 */
export function PlayerEngineHost(): null {
  useEffect(() => {
    const engine = getAudioEngine()
    const store = usePlayerStore.getState()

    engine.setVolume(store.muted ? 0 : store.volume)
    engine.setMuted(store.muted)

    const unsubscribe = engine.subscribe({
      onTimeUpdate: (currentTime) => usePlayerStore.getState().setCurrentTime(currentTime),
      onDurationChange: (duration) => {
        if (duration > 0) usePlayerStore.getState().setDuration(duration)
      },
      onPlay: () => {
        const state = usePlayerStore.getState()
        if (state.currentTrack && state.status !== 'playing') state.setStatus('playing')
      },
      onPause: () => {
        const state = usePlayerStore.getState()
        // `pause` also fires while switching sources; only reflect a real pause.
        if (state.status === 'playing') state.setStatus('paused')
      },
      onEnded: () => {
        void handleTrackEnded()
      },
      onError: (message) => {
        const state = usePlayerStore.getState()
        // An `error` event with no source is the engine being torn down.
        if (!state.currentTrack || state.status === 'idle') return
        handleMediaError(message)
      },
    })

    // Surface every playback failure — media errors and failed stream lookups
    // alike — through the reference's toast, exactly once per error.
    let lastError = usePlayerStore.getState().error
    const unsubscribeStore = usePlayerStore.subscribe((state) => {
      if (state.error && state.error !== lastError) showNotice(state.error)
      lastError = state.error
    })

    return () => {
      unsubscribe()
      unsubscribeStore()
    }
  }, [])

  return null
}
