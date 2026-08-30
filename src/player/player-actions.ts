import { useUiStore } from '@/app/ui-store'
import { recentlyPlayed } from '@/personalization/history'
import { usePersonalizationStore } from '@/personalization/store'
import { reportStreamFailure, resolveStreamSource } from '@/music/stream-source'
import { MusicError, assertAudioTrack } from '@/music/types'
import type { Track } from '@/music/types'
import { getAudioEngine } from './audio-engine'
import { bufferedCandidates, clearAutoplayBuffer, refillBuffer, takeFromBuffer } from './autoplay'
import {
  advanceCollection,
  clearCollectionUnlessContext,
  hasActiveCollection,
  noteCollectionTrackStarted,
  retreatCollection,
  topUpCollection,
} from './collection-session'
import { activateAudio } from './playback-coordinator'
import { usePlayerStore } from './player-store'
import type { PlayerState, QueueContext } from './player-store'
import { nextQueueIndex, previousQueueIndex } from './queue-order'
import {
  MIN_QUEUE_DEPTH,
  NO_MORE_TRACKS_MESSAGE,
  RELATED_RETRY_DELAY_MS,
  notePlayed,
} from './related-fetcher'

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
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: string }).name : undefined
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

  const queueContext = playContext.context ?? state.queueContext

  /**
   * Starting something under a different context ends the collection session.
   *
   * A search seed, a shelf, a chart or a single saved item is a different
   * explicit intent, and the list the visitor left behind must not resurface
   * three tracks later. An advance *within* the collection — including a
   * generated autoplay candidate appended to its queue — carries the same
   * context and leaves the session alone.
   */
  clearCollectionUnlessContext(queueContext?.id ?? null)

  state.setQueue(nextQueue, index, queueContext)
  // Keeps the collection's cursor in step with an ordinary queue advance.
  // Silent for anything the collection did not put in the queue, which is what
  // lets a manually queued track play without moving the visitor's place.
  noteCollectionTrackStarted(track.id)
  state.setCurrentTime(0)
  state.setDuration(track.durationSeconds)
  state.setError(null)

  // Remembered at selection rather than at first sound, so a track that fails to
  // stream is still never offered again as "related" a minute later.
  notePlayed(track.id)

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
    // Real sound is the only thing that proves the provider is reachable, so it
    // is the only thing that clears the streak `handleMediaError` counts.
    consecutiveFailures = 0
    // Deliberately not awaited: the music is already playing, and topping the
    // supply up must never be something the listener can hear.
    void ensureAutoplayDepth(store)
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

/**
 * Keeps three playable items standing ahead of the listener.
 *
 * Called when a track *starts*, which is the whole point of it: the lookup then
 * runs over the three minutes of music already playing, and the track that ends
 * finds its successor already chosen. The previous arrangement only ever asked
 * at the moment of silence, so every continuation cost a visible gap and a
 * failed lookup cost the session.
 *
 * Depth counts both halves of what could play next — what the listener explicitly
 * queued, and what autoplay has already planned — because either can answer.
 * Nothing here plays anything, and nothing here is awaited by playback.
 */
export async function ensureAutoplayDepth(store: Store = usePlayerStore): Promise<void> {
  const state = store.getState()
  const seed = state.currentTrack
  if (!seed || !state.autoplaySimilar) return

  const queuedAhead = Math.max(0, state.queue.length - 1 - state.currentIndex)
  if (queuedAhead + bufferedCandidates().length >= MIN_QUEUE_DEPTH) return

  await refillBuffer({
    seed,
    queuedIds: state.queue.map((track) => track.id),
    recentIds: recentlyPlayedIds(),
  })
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
 * Session's Next, and a track ending naturally (agents/32 → "Queue priority";
 * agents/45 → "Priority at track end"):
 *
 *   1. repeat one — replay the current track
 *   2. the explicit queue, in the running order in force — whatever the visitor
 *      actually asked for, including the resolved part of a saved collection
 *   3. the collection session — the next *saved item*, on whichever engine owns
 *      it, including the Repeat-playlist wrap of that collection
 *   4. repeat playlist — wrap the queue itself, when no collection is playing
 *   5. autoplay's generated candidate, when the preference is on
 *   6. stop
 *
 * Every rule the visitor set outranks everything the app generated. Autoplay is
 * consulted last and unconditionally last, so it can neither jump ahead of a
 * queued item nor pre-empt a repeat.
 *
 * **Step 3 is what makes a saved list a list rather than a queue.** The queue
 * holds only what the audio engine can play, and a collection may continue past
 * it — into a YouTube item, or simply into the part of the list not resolved
 * yet. Asking the collection *before* autoplay is what stops a generated track
 * appearing while Liked Songs still has songs in it.
 *
 * The wrap is split between 3 and 4 for the same reason: while a collection is
 * playing, Repeat playlist means *that collection*, not the window of it the
 * queue happens to hold. So the queue is asked with the wrap suppressed and the
 * collection performs it instead. With no collection, step 4 is the original
 * behaviour, unchanged.
 *
 * `skipRepeatOne` exists for the one case that could otherwise loop: a track
 * that has just failed to play. It is excluded from being chosen again by
 * repeat one.
 */
export async function playNext(
  store: Store = usePlayerStore,
  options: { skipRepeatOne?: boolean; reason?: AdvanceReason } = {},
): Promise<void> {
  const reason: AdvanceReason = options.reason ?? 'ended'
  const state = store.getState()

  // 1. Repeat one. Deliberately ahead of the queue: the visitor asked for this
  //    track, and nothing generated may override that. It applies only when the
  //    track ran out on its own — see `skipToNext`.
  if (
    reason === 'ended' &&
    state.repeatMode === 'one' &&
    state.currentTrack &&
    !options.skipRepeatOne
  ) {
    await playTrack(state.currentTrack, { queue: state.queue, index: state.currentIndex }, store)
    return
  }

  // 2, and 4 when no collection is playing. The explicit queue in its running
  //    order, carrying its own Repeat-playlist wrap — except while a collection
  //    is playing, where the wrap is withheld here and performed at step 3
  //    instead, so Repeat playlist repeats the saved list rather than the
  //    resolved window of it that the queue happens to hold.
  const collection = hasActiveCollection()
  const nextIndex = nextQueueDestination(state, reason, collection)
  const next = nextIndex === null ? undefined : state.queue[nextIndex]

  if (next && nextIndex !== null) {
    await playTrack(next, { queue: state.queue, index: nextIndex }, store)
    // Not awaited: the music is already playing and the window is refilled over
    // it. Makes no request at all while the look-ahead is still deep enough.
    void topUpCollection()
    return
  }

  // 3. The saved collection, on whichever engine owns the next item. This is
  //    ahead of autoplay unconditionally: an explicit list the visitor chose
  //    outranks anything the app would generate.
  if (
    collection &&
    (await advanceCollection({
      reason,
      repeatMode: state.repeatMode,
      userInitiated: reason === 'user',
    }))
  ) {
    return
  }

  // 5. Generated similar audio, when the visitor left autoplay on.
  if (state.autoplaySimilar && state.currentTrack) {
    if (await playAutoplayNext(store)) return
    /**
     * One delayed retry, and only for a track that ran out on its own.
     *
     * The case it exists for is a network that dropped during the last minute of
     * a track: the lookup that should have refilled the buffer failed, and two
     * seconds later the connection is usually back. A press of Next is not given
     * this — someone waiting on a button does not want a two-second pause, and
     * they can press it again.
     *
     * Exactly one retry. Beyond that the answer is a message, never a loop.
     */
    if (reason === 'ended') {
      await delay(RELATED_RETRY_DELAY_MS)
      // The listener may have started something else during the wait.
      if (store.getState().currentTrack?.id !== state.currentTrack.id) return
      if (await playAutoplayNext(store)) return
    }
  }

  // 6. Stop cleanly instead of looping.
  engine().pause()
  store.getState().setCurrentTime(0)
  store.getState().setStatus('paused')

  /**
   * Say so — however the silence arrived.
   *
   * This used to speak only to someone who had pressed Next, on the reasoning
   * that a session ending quietly needs no explanation. It does now: with
   * autoplay refilling the queue from the catalogue, a track ending in silence
   * means every source was asked and none of them answered. That is an
   * exceptional state and the bar should say so, because the alternative the
   * reports describe — the same song starting again — is not available.
   */
  useUiStore.getState().showNotice(NO_MORE_TRACKS_MESSAGE)
}

/** Isolated so tests can drive it with fake timers. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Whether the visitor pressed Next, or the track simply ran out.
 *
 * These are different intentions and they get different answers, which is the
 * distinction the previous implementation was missing: it treated a button press
 * exactly like a track ending, so Repeat one answered a press to *leave* the
 * song by playing that same song again.
 */
export type AdvanceReason = 'ended' | 'user'

/**
 * The next queue position, for this reason.
 *
 * Identical to `nextQueueIndex` except for one case, and that case is the whole
 * point: a Repeat-playlist queue of a *single* track wraps to itself. That is
 * the right answer when the track ended — the visitor asked for the list to
 * repeat — and the wrong one for a press of Next, which is a request to leave
 * the current song. Returning `null` there lets the caller fall through to
 * autoplay instead of restarting what is already playing.
 */
function nextQueueDestination(
  state: PlayerState,
  reason: AdvanceReason,
  collectionActive = false,
): number | null {
  const index = nextQueueIndex({
    queueLength: state.queue.length,
    currentIndex: state.currentIndex,
    shuffle: state.shuffle,
    shuffleOrder: state.shuffleOrder,
    // A collection owns its own wrap, over the whole saved list rather than the
    // resolved window of it. Wrapping here as well would restart the window.
    repeatMode: collectionActive ? 'off' : state.repeatMode,
  })
  if (index === null) return null
  if (reason === 'user' && index === state.currentIndex) return null
  return index
}

/**
 * The one action behind every Next the visitor can press.
 *
 * The bottom bar, the expanded Now Playing sheet, the Media Session's
 * `nexttrack` and a headset's skip button all call this and nothing else, so
 * "what Next does" is defined once rather than four times
 * (agents/45 → "Media Session").
 *
 * It differs from a track ending in exactly two ways, both of them the same
 * idea — a press of Next means *leave this song*:
 *
 * · Repeat one does not answer it. Replaying the current track would be the
 *   literal opposite of what was asked.
 * · A single-track Repeat-playlist queue does not wrap onto itself.
 *
 * Everything else is unchanged, and deliberately so: a real queued track still
 * outranks anything generated, and a multi-track Repeat playlist still wraps —
 * `A B C` at `C` goes to `A`, because `A` is a genuinely different track.
 */
export async function skipToNext(store: Store = usePlayerStore): Promise<void> {
  await playNext(store, { reason: 'user' })
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

/**
 * Step back one track.
 *
 * Follows the same running order Next does, so a shuffled session is genuinely
 * navigable in both directions rather than shuffled forwards and sequential
 * backwards. Repeat one does *not* apply here: a visitor pressing Previous is
 * asking to move, and answering with the same track again would look broken.
 */
export async function playPrevious(store: Store = usePlayerStore): Promise<void> {
  const state = store.getState()
  if (!state.currentTrack) return

  if (state.currentTime > PREVIOUS_RESTART_THRESHOLD_SECONDS) {
    seek(0, store)
    return
  }

  const previousIndex = previousQueueIndex({
    queueLength: state.queue.length,
    currentIndex: state.currentIndex,
    shuffle: state.shuffle,
    shuffleOrder: state.shuffleOrder,
    repeatMode: state.repeatMode,
  })
  const previous = previousIndex === null ? undefined : state.queue[previousIndex]
  if (!previous || previousIndex === null) {
    // The start of the *queue* is not the start of the collection: the window
    // behind the listener may have been a later run of a longer saved list, or a
    // YouTube item they stepped past. Ask the collection before giving up.
    if (hasActiveCollection() && (await retreatCollection({ repeatMode: state.repeatMode }))) {
      return
    }
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

/**
 * How far the skip-back and skip-forward controls move.
 *
 * Ten seconds is the convention every media app and every OS media notification
 * uses, and the Media Session's own `seekbackward`/`seekforward` already default
 * to it — so the on-screen buttons and the lock screen agree without either
 * knowing about the other.
 */
export const SEEK_STEP_SECONDS = 10

/**
 * Moves the playhead by a relative amount.
 *
 * The one place that arithmetic lives. `seek` already clamps to `[0, duration]`
 * and refuses a non-finite value or an unknown duration, so this adds the
 * *relative* half and nothing else — no second clamp, no direct engine call, no
 * component doing its own `currentTime + offset`.
 *
 * Returns nothing: like `seek`, a request that cannot be honoured is simply not
 * honoured, and the UI reads the resulting position from the store as it does
 * for every other transport action.
 */
export function seekBy(deltaSeconds: number, store: Store = usePlayerStore): void {
  if (!Number.isFinite(deltaSeconds)) return
  const state = store.getState()
  if (state.duration <= 0) return
  seek(state.currentTime + deltaSeconds, store)
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

/**
 * Called by the engine's `ended` event.
 *
 * Guarded against a second advance while one is running, and that guard is not
 * theoretical: `ended` and `error` both fire for a stream whose signed URL
 * expired mid-play, a paused-then-resumed element can emit `ended` twice, and
 * an advance now takes long enough to search the catalogue that two of them
 * would overlap. Two advances would skip a track and could start two loads
 * against one audio element.
 *
 * The concurrent call is dropped rather than queued: the advance already
 * running is answering the same question, and its answer is the right one.
 */
let advancing: Promise<void> | null = null

export async function handleTrackEnded(
  store: Store = usePlayerStore,
  options: { skipRepeatOne?: boolean } = {},
): Promise<void> {
  if (advancing) return advancing
  advancing = playNext(store, { reason: 'ended', ...options }).finally(() => {
    advancing = null
  })
  return advancing
}

/** True while a natural-end advance is in flight. Tests and diagnostics. */
export function isAdvancing(): boolean {
  return advancing !== null
}

/** Test seam. */
export function resetAdvanceGuard(): void {
  advancing = null
}

/**
 * Consecutive tracks that may fail before the session is allowed to stop.
 *
 * A dead track must not end the music, but a catalogue having a bad afternoon
 * must not be walked end to end either. Three failures in a row is the signal
 * that the problem is the connection rather than the track.
 */
export const MAX_CONSECUTIVE_FAILURES = 3
let consecutiveFailures = 0

/** Test seam, and what a deliberate play resets. */
export function resetFailureStreak(): void {
  consecutiveFailures = 0
}

/**
 * Called by the engine's `error` event. Never leaves the UI stuck loading, and
 * gives an unreachable Audius content node exactly one second chance.
 *
 * **A track that has run out of chances is treated as one that ended.** An
 * expired signed URL, a withdrawn track and a dead content node all produce this
 * event, and in every one of those cases the listener's music stopping is the
 * wrong answer — the next track is. The error is still shown, because something
 * did go wrong; what changed is that it is no longer the end of the session.
 *
 * Bounded by `MAX_CONSECUTIVE_FAILURES`, so a provider outage stops cleanly
 * instead of walking the buffer at speed.
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

  consecutiveFailures += 1
  if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) return

  // `skipRepeatOne`, because repeat one would answer a broken track by loading
  // the same broken track — the loop this whole change exists to prevent.
  void handleTrackEnded(store, { skipRepeatOne: true })
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
