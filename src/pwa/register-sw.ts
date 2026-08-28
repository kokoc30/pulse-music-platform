import { usePlayerStore } from '@/player/player-store'

/**
 * Service-worker registration, and the one rule that governs updates:
 * **never interrupt playback.**
 *
 * A new worker is left waiting until the player is idle. Applying an update
 * reloads the page, and reloading mid-track would stop the music, drop the
 * position and clear the queue — the opposite of what a phase about background
 * audio is for (agents/31 → "Do not force-reload an update while audio is
 * playing").
 */

export const SW_PATH = '/sw.js'

/** How often the waiting worker re-checks whether it may take over. */
const UPDATE_POLL_MS = 30_000

function isPlaying(): boolean {
  const { status } = usePlayerStore.getState()
  return status === 'playing' || status === 'loading'
}

export interface RegisterOptions {
  /** Test seam. Defaults to the real container. */
  container?: ServiceWorkerContainer
  /** Test seam for the playback guard. */
  playing?: () => boolean
}

/**
 * Registers the worker, if this browser has one and the page is secure.
 *
 * Never throws: a failed registration costs the app nothing, so it degrades to
 * "no offline shell" rather than to an error.
 */
export async function registerServiceWorker(options: RegisterOptions = {}): Promise<boolean> {
  const container =
    options.container ??
    (typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { serviceWorker?: ServiceWorkerContainer }).serviceWorker)

  if (!container) return false

  try {
    const registration = await container.register(SW_PATH, { scope: '/' })
    watchForUpdate(registration, options.playing ?? isPlaying)
    return true
  } catch {
    return false
  }
}

/**
 * Applies a waiting update at the first safe moment.
 *
 * The worker itself never calls `skipWaiting()` on install; the page tells it
 * when. Until then the visitor keeps the version they are listening to.
 */
export function watchForUpdate(
  registration: ServiceWorkerRegistration,
  playing: () => boolean,
): () => void {
  let applied = false

  const apply = () => {
    if (applied) return
    const waiting = registration.waiting
    if (!waiting) return
    if (playing()) return
    applied = true
    waiting.postMessage('pulse:skip-waiting')
  }

  apply()
  registration.addEventListener?.('updatefound', apply)
  const timer = setInterval(apply, UPDATE_POLL_MS)

  return () => {
    clearInterval(timer)
    registration.removeEventListener?.('updatefound', apply)
  }
}
