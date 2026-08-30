import { showNotice } from '@/app/ui-store'
import type { Track } from '@/music/types'
import {
  advanceCollection,
  clearCollection,
  collectionContextId,
  collectionRefAt,
  collectionSession,
  noteCollectionQueue,
  setCollectionEngine,
  setCollectionPosition,
  startCollection,
} from '@/player/collection-session'
import type {
  CollectionContext,
  CollectionRouteRequest,
  CollectionSessionState,
} from '@/player/collection-session'
import { playTrack } from '@/player/player-actions'
import { usePlayerStore } from '@/player/player-store'
import { playYouTubeVideo } from '@/player/youtube-actions'
import { useYouTubeStore } from '@/player/youtube-store'
import { documentHidden } from '@/player/youtube-visibility'
import { resolveMany, resolveQuietly } from './resolve'
import { youTubeItemFromRef } from './track-ref'
import type { LibraryTrackRef } from './types'
import { canPlaySavedYouTubeRef } from './youtube-policy'

/**
 * Playing a saved list, whatever it is made of.
 *
 * The half of collection playback that knows about *providers*: how to turn a
 * saved reference back into something playable, and which engine owns it. The
 * other half — what the list is, what order it is in and what comes next — lives
 * in `player/collection-session.ts` and knows none of this. The two meet through
 * the `CollectionEngine` registered at the bottom of this file, and the arrow
 * points one way, which is what lets the player layer ask "play the next saved
 * item" without importing the library.
 *
 * **The queue is a window, not the list.** The audio queue holds the run of
 * catalogue items the audio engine can play right now — the current one plus a
 * bounded look-ahead — in the session's running order. It stops at the first
 * YouTube item, because a video is not a `Track` and never becomes one. When the
 * run is exhausted the session routes the next saved item to whichever engine
 * owns it, and the collection carries on across the change.
 */

/**
 * How much of a saved list one Play may take as its session.
 *
 * A collection of a thousand liked songs is a real thing; a queue of a thousand
 * is not. The rest stay visible and are reachable by starting from a later row.
 */
export const MAX_COLLECTION_ITEMS = 100

/**
 * How far ahead of the listener the collection resolves.
 *
 * A saved reference deliberately carries no playable URL, so every item in the
 * queue costs a provider lookup. Resolving the whole list on a click was the
 * previous behaviour and it does not scale: a hundred liked songs meant a
 * hundred requests before the second one was wanted, most of them for tracks the
 * listener would never reach.
 *
 * So the current item is resolved and started immediately, and this many more
 * are resolved behind it — enough that the queue panel shows a real list and a
 * hand-off is never audible, few enough that opening a large collection is not a
 * request storm. The window is topped back up as playback advances, one small
 * batch at a time.
 */
export const COLLECTION_LOOKAHEAD = 24

/* --------------------------------------------------------------------------
   Starting
   -------------------------------------------------------------------------- */

/**
 * Plays a saved list from a chosen position.
 *
 * `refs` is the collection **as the visitor can see it** — the current sort and
 * the current filter already applied by the page. That list, in that order, is
 * what is snapshotted and what plays, because it is what was on screen when the
 * row was clicked. Nothing re-reads the library afterwards, so liking, unliking,
 * re-sorting or typing in the filter cannot rewrite a session that is already
 * running.
 *
 * Playback starts before the list has been resolved: the chosen item is looked
 * up and started, and the look-ahead fills in behind it.
 */
export async function playCollection(
  refs: readonly LibraryTrackRef[],
  startIndex: number,
  context: CollectionContext,
): Promise<void> {
  registerCollectionEngine()

  const snapshot = refs.slice(0, MAX_COLLECTION_ITEMS)
  if (snapshot.length === 0) return

  // Shuffle is read from the player, where the visitor set it, rather than
  // passed down from the page: the hero buttons already switch it before they
  // start the list, and the queue panel's copy of the control writes to the same
  // place. One flag, one seed, one permutation.
  const player = usePlayerStore.getState()
  const position = startCollection(snapshot, startIndex, context, {
    shuffle: player.shuffle,
    seed: player.shuffleSeed,
  })
  if (position < 0) return

  /**
   * The first item is reached through the ordinary advance.
   *
   * Backing the cursor up by one and stepping forward means a row that turns out
   * to be unavailable is skipped by exactly the same bounded rule that governs
   * every later transition — there is no separate "first item" code path that
   * could disagree with it. `'off'` because the very first step must never wrap:
   * a list started at C begins at C.
   */
  setCollectionPosition(position - 1)
  const started = await advanceCollection({
    reason: 'user',
    repeatMode: 'off',
    userInitiated: true,
  })

  if (!started) {
    clearCollection()
    showNotice("These tracks aren't available to stream right now.")
  }
}

/* --------------------------------------------------------------------------
   Routing one saved item to its engine
   -------------------------------------------------------------------------- */

/**
 * Plays one saved item on the engine its provider calls for.
 *
 * The routing rule the whole app is built on, enforced rather than assumed: a
 * catalogue reference goes to the single `HTMLAudioElement`, a YouTube reference
 * goes to YouTube's own embedded player, and no branch here could send one to
 * the other. `false` means *this item could not be played* — withdrawn, expired,
 * blocked — and is the collection's cue to step past it.
 */
async function playCollectionItem(request: CollectionRouteRequest): Promise<boolean> {
  if (request.ref.provider === 'youtube') {
    return playYouTubeCollectionItem(request)
  }
  return playAudioCollectionItem(request)
}

/**
 * A saved video, in YouTube's own player, under YouTube's own rules.
 *
 * Two things happen here that do not happen for a search result, and both are
 * about *origin*:
 *
 * **The result session is cleared.** A video playing because a saved list routed
 * it there must not inherit the continuation of whatever search was open before
 * — pressing Next would otherwise leave the collection and walk somebody's old
 * search results instead. Clearing it is also what stops any later transition
 * spending a `search.list` on a list the visitor already has.
 *
 * **The transition is not claimed as a gesture unless it is one.** An automatic
 * hand-off passes `userInitiated: false` and *no* visibility ratio, which is the
 * correction this pass makes. It used to pass `youTubeVisibleRatio()` — read
 * here, at the instant the collection decided the video was next, and therefore
 * before the player existed. Coming from a catalogue track there is no stage
 * mounted at all at that moment, so the value was the visibility module's
 * initial zero, `mayAutoplay` refused it, and every automatic hand-off into a
 * saved video cued and waited for a press it should never have needed.
 *
 * Omitting it hands the decision to `playYouTubeVideo`, which reveals the player
 * first and then waits for the real `IntersectionObserver` to report on the
 * geometry that now exists. The policy is unchanged and no number is invented:
 * when the measurement says the player is not visible enough, the item is still
 * *cued* in the visible player and waits for a press. It is never skipped, and
 * it is never started behind the visitor's back.
 *
 * The document check stays here because it is genuinely answerable now: a hidden
 * document cannot become visible by revealing anything.
 */
async function playYouTubeCollectionItem(request: CollectionRouteRequest): Promise<boolean> {
  // Re-checked at play time, not only at render time: the 30-day retention
  // window may have closed while the page sat open.
  if (!canPlaySavedYouTubeRef(request.ref)) return false
  const item = youTubeItemFromRef(request.ref)
  if (!item) return false

  useYouTubeStore.getState().clearSession()

  return playYouTubeVideo(item, {
    userInitiated: request.userInitiated,
    documentHidden: documentHidden(),
    // A saved list arriving at a video is a real playback route into YouTube,
    // so the official player becomes the visible experience rather than a change
    // of title under a page the visitor is still reading.
    reason: request.userInitiated ? 'user-selection' : 'collection-transition',
  })
}

/**
 * A saved catalogue item, through the one audio element.
 *
 * Two phases, because a visitor should hear something before the rest of the run
 * has been re-resolved: the chosen item is looked up and started, and the
 * look-ahead is filled in behind it without being awaited.
 */
async function playAudioCollectionItem(request: CollectionRouteRequest): Promise<boolean> {
  const track = await resolveQuietly(request.ref)
  if (!track) return false

  const player = usePlayerStore.getState()
  // Set before `playTrack` so the running order is already the collection's; the
  // identical queue that `playTrack` then sets is recognised as the same list
  // and leaves it alone.
  player.setOrderedQueue([track], 0, request.context)
  noteCollectionQueue({ [track.id]: request.position }, request.position)

  await playTrack(track, { queue: [track], index: 0, context: request.context })

  // A stream that could not be resolved reports itself through the store rather
  // than by throwing, and is an unavailable item like any other.
  if (usePlayerStore.getState().status === 'error') return false

  void fillRun(track, request.position, request.context)
  return true
}

/* --------------------------------------------------------------------------
   The resolution window
   -------------------------------------------------------------------------- */

/**
 * Positions in the running order that follow `from` and can join the audio run.
 *
 * It stops at the first YouTube item, and that is the point: the queue is the
 * contiguous stretch the audio engine owns. What comes after the boundary is
 * still in the collection, and the session routes it when playback gets there.
 */
function runPositionsAfter(state: CollectionSessionState, from: number, limit: number): number[] {
  const positions: number[] = []
  for (let position = from + 1; position < state.order.length; position += 1) {
    if (positions.length >= limit) break
    const ref = collectionRefAt(state, position)
    if (!ref || ref.provider === 'youtube') break
    positions.push(position)
  }
  return positions
}

/** The refs at those positions, paired so a null cannot shift the alignment. */
function refsAt(
  state: CollectionSessionState,
  positions: readonly number[],
): { position: number; ref: LibraryTrackRef }[] {
  const pairs: { position: number; ref: LibraryTrackRef }[] = []
  for (const position of positions) {
    const ref = collectionRefAt(state, position)
    if (ref) pairs.push({ position, ref })
  }
  return pairs
}

/**
 * Resolves the look-ahead behind a track that has just started.
 *
 * Applied only while the track it was built for is still the loaded one: a
 * visitor who pressed Next during the lookup keeps their choice, and the
 * continuation is dropped rather than forced on top of it.
 */
async function fillRun(
  head: Track,
  headPosition: number,
  context: CollectionContext,
): Promise<void> {
  const state = collectionSession()
  if (state.context?.id !== context.id) return

  const pairs = refsAt(state, runPositionsAfter(state, headPosition, COLLECTION_LOOKAHEAD))
  if (pairs.length === 0) return

  const resolved = await resolveMany(pairs.map((pair) => pair.ref))

  const player = usePlayerStore.getState()
  if (player.currentTrack?.id !== head.id) return
  if (collectionContextId() !== context.id) return

  const queue: Track[] = [head]
  const positions: Record<string, number> = { [head.id]: headPosition }
  pairs.forEach((pair, index) => {
    const track = resolved[index]
    // An item the provider no longer has is simply absent from the queue: one
    // bounded attempt, no retry, and the rest of the list is unaffected.
    if (!track || positions[track.id] !== undefined) return
    queue.push(track)
    positions[track.id] = pair.position
  })

  player.setOrderedQueue(queue, 0, context)
  noteCollectionQueue(positions, pairs[pairs.length - 1].position)
}

/**
 * Keeps the resolved window standing ahead of the listener.
 *
 * Called when a queued track starts, so the lookups run over the music already
 * playing. Never awaited by playback, and it makes no request at all while the
 * window is still deep enough — which is every advance but roughly one in
 * `COLLECTION_LOOKAHEAD`.
 */
async function topUpRun(): Promise<void> {
  const state = collectionSession()
  const context = state.context
  if (!context) return

  const before = usePlayerStore.getState()
  if (before.queueContext?.id !== context.id) return

  const ahead = before.queue.length - 1 - before.currentIndex
  if (ahead >= COLLECTION_LOOKAHEAD) return

  const pairs = refsAt(
    state,
    runPositionsAfter(state, state.queuedThrough, COLLECTION_LOOKAHEAD - ahead),
  )
  if (pairs.length === 0) return

  const resolved = await resolveMany(pairs.map((pair) => pair.ref))

  // Anything that moved the queue underneath the lookup wins; a stale append
  // would renumber a list the listener is already inside.
  const after = usePlayerStore.getState()
  if (after.queueContext?.id !== context.id) return
  if (after.queue.length !== before.queue.length) return
  const current = collectionSession()
  if (current.context?.id !== context.id) return
  if (current.queuedThrough !== state.queuedThrough) return

  const queue = [...after.queue]
  const positions = { ...current.queuePositions }
  pairs.forEach((pair, index) => {
    const track = resolved[index]
    if (!track || positions[track.id] !== undefined) return
    queue.push(track)
    positions[track.id] = pair.position
  })

  if (queue.length === after.queue.length) {
    // Nothing resolved, but the window was still walked: record how far, so the
    // next top-up looks past those items rather than asking for them again.
    noteCollectionQueue(positions, pairs[pairs.length - 1].position)
    return
  }

  usePlayerStore.getState().setOrderedQueue(queue, after.currentIndex, context)
  noteCollectionQueue(positions, pairs[pairs.length - 1].position)
}

/* --------------------------------------------------------------------------
   Registration
   -------------------------------------------------------------------------- */

let registered = false

/**
 * Hands the player layer the two things it cannot work out for itself.
 *
 * Called from `playCollection` rather than at module load: a session cannot
 * exist before a collection has been started, so registering at the moment one
 * is has the same effect and does not depend on import order or on a bundler
 * keeping a side effect it can see nothing using.
 */
export function registerCollectionEngine(): void {
  if (registered) return
  registered = true
  setCollectionEngine({ play: playCollectionItem, topUp: topUpRun })
}

/** Test seam. */
export function resetCollectionEngineRegistration(): void {
  registered = false
}
