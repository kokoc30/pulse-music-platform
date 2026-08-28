import { useEffect } from 'react'
import { createMediaSessionController } from '@/player/media-session/controller'
import { onEngineChange } from '@/player/playback-coordinator'
import { pause, playNext, playPrevious, seek, stopPlayback, togglePlay } from '@/player/player-actions'
import { usePlayerStore } from '@/player/player-store'

/**
 * Connects the audio player to the operating system's media controls.
 *
 * Mounted once, above the router, beside the other playback hosts — a lock
 * screen must keep working across SPA navigation. It renders nothing.
 *
 * **Every handler is an existing action.** `nexttrack` calls the same
 * `playNext` the on-page button calls, which is what makes autoplay, queue
 * precedence and history recording identical whether the visitor pressed a
 * button in the app or on their headphones (agents/34).
 *
 * **Audio only.** The controller is cleared the moment YouTube claims the
 * engine and restored when audio takes it back, so no OS transport control can
 * ever reach a hidden YouTube player (agents/33).
 *
 * **Nothing here pauses on `document.hidden`.** That is the point of the phase:
 * a backgrounded tab or a locked screen should keep playing Audius and Jamendo
 * where the browser allows it. The hidden-document pause that *does* exist
 * belongs to the YouTube surface and is untouched.
 */
export function MediaSessionHost(): null {
  useEffect(() => {
    const controller = createMediaSessionController()
    if (!controller.supported) return

    controller.activate({
      play: () => void togglePlay(),
      pause: () => pause(),
      stop: () => stopPlayback(),
      previousTrack: () => void playPrevious(),
      nextTrack: () => void playNext(),
      seekTo: (seconds) => seek(seconds),
      seekBy: (offset) => {
        const { currentTime } = usePlayerStore.getState()
        seek(Math.max(0, currentTime + offset))
      },
    })

    /** Mirrors the store onto the OS. Position writes throttle themselves. */
    const sync = (state: ReturnType<typeof usePlayerStore.getState>) => {
      controller.setTrack(state.currentTrack)
      controller.setPlaybackState(
        state.currentTrack === null
          ? 'none'
          : state.status === 'playing'
            ? 'playing'
            : state.status === 'idle'
              ? 'none'
              : 'paused',
      )
      controller.setPosition({ duration: state.duration, position: state.currentTime })
    }

    sync(usePlayerStore.getState())
    const unsubscribeStore = usePlayerStore.subscribe(sync)

    // Handing the engine to YouTube tears the session down; taking it back
    // rebuilds it from the current store state.
    const unsubscribeEngine = onEngineChange((kind) => {
      if (kind === 'youtube') {
        controller.deactivate()
        return
      }
      controller.activate({
        play: () => void togglePlay(),
        pause: () => pause(),
        stop: () => stopPlayback(),
        previousTrack: () => void playPrevious(),
        nextTrack: () => void playNext(),
        seekTo: (seconds) => seek(seconds),
        seekBy: (offset) => {
          const { currentTime } = usePlayerStore.getState()
          seek(Math.max(0, currentTime + offset))
        },
      })
      sync(usePlayerStore.getState())
    })

    return () => {
      unsubscribeStore()
      unsubscribeEngine()
      controller.deactivate()
    }
  }, [])

  return null
}
