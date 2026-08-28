import { recentlyPlayed } from '@/personalization/history'
import { usePersonalizationStore } from '@/personalization/store'
import { reportStreamFailure, resolveStreamSource } from '@/music/stream-source'
import { MusicError, assertAudioTrack } from '@/music/types'
import type { Track } from '@/music/types'
import { getAudioEngine } from './audio-engine'
import { clearAutoplayBuffer, refillBuffer, takeFromBuffer } from './autoplay'
import { activateAudio } from './playback-coordinator'
import { usePlayerStore } from './player-store'
import type { QueueContext } from './player-store'

/**
 * Restarting instead of stepping back is the convention when the listener is
 * already meaningfully into the track (agents/07_PLAYER_BEHAVIOR.md).
 */
export const PREVIOUS_RESTART_THRESHOLD_SECONDS = 3

export interface PlayContext {
  queue?: Track[]
  index?: number
  context?: QueueContext
}

type Store = typeof usePlayerStore

/**
 * Single source for the audio engine. `setAudioEngine()` in audio-engine.ts is
 * the only seam — the actions and `PlayerEngineHost` must never resolve
 * different engines, or events and commands would run against separate elements.
 */
const engine = getAudioEngine

function safeErrorText(error: unknown): string {
  if (error instanceof MusicError) return error.userMessage
  return 'Playback failed. Try another track.'
}

/**
 * `play()` rejects with `NotAllowedError` when the browser's autoplay policy
 * blocks it, and with `AbortError` when a newer load supersedes it. Neither is a
 * playback failure the listener needs to see.
 */
function isBenignPlayRejection(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null ? (error as { name?: string }).name : undefined
  return name === 'NotAllowedError' || name === 'AbortError'
}

/**
 * Audius resolves each stream request to one of many community-run content
 * nodes, and an individual node is regularly unreachable or serving a broken TLS
 * certificate. Each retry asks for a fresh URL, which is normally a different
 * node. Hard-bounded so a genuinely dead track can never loop
 * (agents/07_PLAYER_BEHAVIOR.md → "Media Errors").
 */
export const MAX_MEDIA_RETRIES = 2
const retryState: { trackId: string | null; attempts: number; source: string | null } = {
  trackId: null,
  attempts: 0,
  source: null,
}

export function resetMediaRetries(): void {
  retryState.trackId = null
  retryState.attempts = 0
  retryState.source = null
}

/**
 * Selects a track and attempts real playback.
 *
 * Race safety: every call takes a fresh monotonic load token; any await that
 * resolves after a newer call has started is discarded before it can touch the
 * audio element or the store.
 */
export async function playTrack(
  track: Track,
  playContext: PlayContext = {},
  store: Store = usePlayerStore,
): Promise<void> {
  // Runtime mirror of the type-level rule: nothing that is not an audio track
  // may reach the `HTMLAudioElement`. Everything funnels through here — the
  // queue, the rows, the cards, next/previous — so this one guard covers the
  // whole audio path (agents/28 → "YouTube never enters HTMLAudioElement").
  assertAudioTrack(track)

  // Claim the single active engine before anything is loaded, which pauses a
  // playing YouTube embed. Audius → YouTube → Audius keeps its position.
  activateAudio()

  const state = store.getState()

  // Selecting a different track clears the retry budget; replaying the same one
  // (including the automatic retry below) keeps it.
  if (retryState.trackId !== track.id) {
    retryState.trackId = track.id
    retryState.attempts = 0
  }

  const queue = playContext.queue ?? (state.queue.length ? state.queue : [track])
  const indexFromContext = playContext.index
  const resolvedIndex =
    indexFromContext !== undefined && queue[indexFromContext]?.id === track.id
      ? indexFromContext
      : queue.findIndex((item) => item.id === track.id)
  const index = resolvedIndex >= 0 ? resolvedIndex : 0
  const nextQueue = resolvedIndex >= 0 ? queue : [track, ...queue.filter((t) => t.id !== track.id)]

  state.setQueue(nextQueue, index, playContext.context ?? state.queueContext)
  state.setCurrentTime(0)
  state.setDuration(track.durationSeconds)
  state.setError(null)

  if (!track.isStreamable) {
    state.setStatus('error')
    state.setError("This track isn't available to stream.")
    engine().stop()
    return
  }

  const token = state.nextLoadToken()
  state.setStatus('loading')

  let source: string
  try {
    source = await resolveStreamSource(track)
  } catch (error) {
    if (store.getState().loadToken !== token) return
    store.getState().setStatus('error')
    store.getState().setError(safeErrorText(error))
    return
  }

  if (store.getState().loadToken !== token) return

  const audio = engine()
  audio.setVolume(store.getState().muted ? 0 : store.getState().volume)
  audio.setMuted(store.getState().muted)
  retryState.source = source
  audio.load(source)

  try {
    await audio.play()
    if (store.getState().loadToken !== token) return
    store.getState().setStatus('playing')
  } catch (error) {
    if (store.getState().loadToken !== token) return
    if (isBenignPlayRejection(error)) {
      store.getState().setStatus('paused')
      return
    }
    store.getState().setStatus('error')
    store.getState().setError(safeErrorText(error))
  }
}

export async function togglePlay(store: Store = usePlayerStore): Promise<void> {
  const state = store.getState()
  if (!state.currentTrack) return

  if (state.status === 'playing') {
    engine().pause()
    state.setStatus('paused')
    return
  }

  // Recovering from an error, or from a track that was never loaded, needs a
  // fresh stream resolution rather than a bare play().
  if (state.status === 'error' || state.status === 'idle') {
    await playTrack(state.currentTrack, { queue: state.queue, index: state.currentIndex }, store)
    return
  }

  // Resuming counts as claiming the engine too, so pressing play on the bottom
  // bar while a YouTube video is running pauses the video rather than doubling.
  activateAudio()

  try {
    await engine().play()
    store.getState().setStatus('playing')
  } catch {
    store.getState().setStatus('paused')
  }
}

/**
 * Stops playback outright: releases the source and clears the position.
 *
 * The Media Session's `stop` action maps here. Distinct from `pause`, which
 * keeps the track loaded and resumable — stopping is what a listener means when
 * they dismiss a media notification, and leaving a loaded element behind would
 * keep the notification alive on some platforms.
 *
 * The queue survives: pressing play again resumes the same list rather than
 * starting from nothing.
 */
export function stopPlayback(store: Store = usePlayerStore): void {
  const state = store.getState()
  engine().stop()
  clearAutoplayBuffer()
  state.setCurrentTime(0)
  state.setStatus('idle')
}

export function pause(store: Store = usePlayerStore): void {
  const state = store.getState()
  if (!state.currentTrack) return
  engine().pause()
  state.setStatus('paused')
}

/**
 * Bounded alternates tried when a generated candidate will not play.
 *
 * A dead Audius content node or a withdrawn Jamendo track must not end the
 * session, but neither may it become a retry loop: after this many attempts,
 * autoplay stops and leaves the visitor in control (agents/32 → "never
 * infinite-loop").
 */
export const MAX_AUTOPLAY_ATTEMPTS = 3

/**
 * Advance one track.
 *
 * The precedence is exact and is the same for the on-page control, the Media
 * Session's Next, and a track ending naturally (agents/32 → "Queue priority"):
 *
 *   1. the explicit queue — whatever the visitor actually asked for
 *   2. autoplay's generated candidate, when the preference is on
 *   3. stop
 *
 * Autoplay can never jump ahead of a queued item, because the queue is consulted
 * first and unconditionally.
 */
export async function playNext(store: Store = usePlayerStore): Promise<void> {
  const state = store.getState()
  const nextIndex = state.currentIndex + 1
  const next = state.queue[nextIndex]

  // 1. Explicit queue. Includes an existing station/playlist continuation,
  //    which is already materialised into the queue by `playFromShelf`.
  if (next) {
    await playTrack(next, { queue: state.queue, index: nextIndex }, store)
    return
  }

  // 2. Generated similar audio, when the visitor left autoplay on.
  if (state.autoplaySimilar && state.currentTrack && (await playAutoplayNext(store))) return

  // 3. Stop cleanly instead of looping.
  engine().pause()
  store.getState().setCurrentTime(0)
  store.getState().setStatus('paused')
}

/**
 * Plays the best generated candidate, or reports that it could not.
 *
 * Appends to the queue rather than replacing it, so the bar, the queue panel and
 * Previous all behave exactly as they do for a queued track — a generated item
 * is an ordinary queue entry once it starts, with no special history path and no
 * attribution shortcut (agents/34).
 */
async function playAutoplayNext(store: Store): Promise<boolean> {
  const seed = store.getState().currentTrack
  if (!seed) return false

  for (let attempt = 0; attempt < MAX_AUTOPLAY_ATTEMPTS; attempt += 1) {
    const state = store.getState()
    await refillBuffer({
      seed,
      queuedIds: state.queue.map((track) => track.id),
      recentIds: recentlyPlayedIds(),
    })

    const candidate = takeFromBuffer()
    if (!candidate) return false

    const queue = [...store.getState().queue, candidate]
    await playTrack(candidate, { queue, index: queue.length - 1 }, store)

    // `playTrack` reports an unplayable track through the store rather than by
    // throwing, so success is read back from there.
    if (store.getState().status !== 'error') return true
  }

  return false
}

/** Recently played ids from the existing history, most recent first. */
function recentlyPlayedIds(): string[] {
  const state = usePersonalizationStore.getState().state
  return recentlyPlayed(state.listeningHistory).map((entry) => entry.id)
}

export async function playPrevious(store: Store = usePlayerStore): Promise<void> {
  const state = store.getState()
  if (!state.currentTrack) return

  if (state.currentTime > PREVIOUS_RESTART_THRESHOLD_SECONDS) {
    seek(0, store)
    return
  }

  const previousIndex = state.currentIndex - 1
  const previous = state.queue[previousIndex]
  if (!previous) {
    seek(0, store)
    return
  }
  await playTrack(previous, { queue: state.queue, index: previousIndex }, store)
}

export function seek(seconds: number, store: Store = usePlayerStore): void {
  const state = store.getState()
  const duration = state.duration
  if (!Number.isFinite(seconds) || duration <= 0) return
  const clamped = Math.min(Math.max(seconds, 0), duration)
  engine().seek(clamped)
  state.setCurrentTime(clamped)
}

export function setVolume(value: number, store: Store = usePlayerStore): void {
  store.getState().setVolume(value)
  const next = store.getState()
  engine().setVolume(next.muted ? 0 : next.volume)
  engine().setMuted(next.muted)
}

export function toggleMute(store: Store = usePlayerStore): void {
  const state = store.getState()
  const muted = !state.muted
  state.setMuted(muted)
  engine().setMuted(muted)
  engine().setVolume(muted ? 0 : store.getState().volume)
}

/** Called by the engine's `ended` event. */
export async function handleTrackEnded(store: Store = usePlayerStore): Promise<void> {
  await playNext(store)
}

/**
 * Called by the engine's `error` event. Never leaves the UI stuck loading, and
 * gives an unreachable Audius content node exactly one second chance.
 */
export function handleMediaError(message: string, store: Store = usePlayerStore): void {
  const state = store.getState()
  const track = state.currentTrack
  if (!track) return

  if (retryState.trackId === track.id && retryState.attempts < MAX_MEDIA_RETRIES) {
    retryState.attempts += 1
    // Tell the provider which host just failed so the next attempt routes
    // around it — Audius otherwise keeps resolving this track to the same node.
    reportStreamFailure(track, retryState.source)
    state.setStatus('loading')
    void playTrack(track, { queue: state.queue, index: state.currentIndex }, store)
    return
  }

  state.setStatus('error')
  state.setError(message)
}

export function addToQueue(track: Track, store: Store = usePlayerStore): void {
  store.getState().enqueueNext(track)
}

export async function playQueueIndex(index: number, store: Store = usePlayerStore): Promise<void> {
  const state = store.getState()
  const track = state.queue[index]
  if (!track) return
  await playTrack(track, { queue: state.queue, index }, store)
}
