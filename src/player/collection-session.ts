import { create } from 'zustand'
import type { LibraryTrackRef } from '@/library/types'
import { shuffledOrder } from './queue-order'
import type { RepeatMode } from './queue-order'

/**
 * The collection playback session: *which saved list is playing, and what comes
 * next in it*.
 *
 * This layer exists because the app has two playback engines and a saved list
 * belongs to neither of them. Liked Songs may hold an Audius track, a Jamendo
 * track and a YouTube video side by side; the first two play through the one
 * `HTMLAudioElement`, the third through YouTube's own embedded player, and
 * neither engine can answer "what did the visitor actually ask to hear after
 * this". Before this module existed nothing could: the audio queue silently
 * dropped every YouTube item in the list, and starting a saved list *on* a video
 * threw the rest of the list away entirely.
 *
 * **It sits above both engines and is neither of them.**
 *
 * - It is not the audio `Track[]` queue. That queue holds resolved, playable
 *   catalogue tracks, and is a *materialization* of the part of this session the
 *   audio engine can play right now.
 * - It is not the YouTube result session. That is a page of search results with
 *   its own continuation rules; this is a list the visitor saved. When a video
 *   is playing because a collection routed it there, Next means *the next saved
 *   item*, never the next search result.
 * - It is not Phase 6 autoplay. Autoplay is generated, and is consulted only
 *   once an explicit collection has genuinely run out.
 * - It is not library data. Nothing here is persisted: a reload has no session,
 *   which is correct, because it has no playback either.
 *
 * **It holds references, never playable material.** `items` are
 * `LibraryTrackRef`s — provider, provider id, and the metadata a row needs. No
 * stream URL, no signed URL, no provider payload, no bytes. Resolution stays
 * where it already lived, in the library layer, and reaches this module only
 * through the registered `CollectionEngine` below.
 *
 * **The running order lives here, not in the queue.** `order` is a permutation
 * of indices into `items`, drawn once when the session starts and never redrawn
 * — which is what makes "shuffle uses every item exactly once and does not
 * reshuffle on every Next" true by construction, across an engine change, and
 * without ever touching the persisted library order.
 */

export interface CollectionContext {
  /** Stable id of the list, e.g. `library:liked` or `playlist:pl_1`. */
  id: string
  label: string
}

export interface CollectionSessionState {
  /** Null when no explicit collection is playing. */
  context: CollectionContext | null
  /**
   * The visible collection, snapshotted at the moment playback started.
   *
   * A snapshot rather than a live read, deliberately: liking a song, unliking
   * one, re-sorting the page or typing in the filter must not reach in and
   * rewrite what the listener is currently hearing. New collection state applies
   * the next time playback is started.
   */
  items: LibraryTrackRef[]
  /** Permutation of indices into `items`. Identity unless shuffle was on. */
  order: number[]
  /** Position *within `order`* of the item playing now. `-1` when none. */
  position: number
  /**
   * Audio track id to the order position it was materialized from.
   *
   * This is how an ordinary queue advance keeps the session in step: `playTrack`
   * looks the started track up here, and a track that is not in it — a generated
   * autoplay candidate, a manually queued one — leaves the position exactly
   * where it was, which is what lets an explicit *Play next* run before the
   * collection continues.
   */
  queuePositions: Record<string, number>
  /** Highest order position already resolved into the audio queue. */
  queuedThrough: number
}

export const initialCollectionSession: CollectionSessionState = {
  context: null,
  items: [],
  order: [],
  position: -1,
  queuePositions: {},
  queuedThrough: -1,
}

export const useCollectionStore = create<CollectionSessionState>(() => ({
  ...initialCollectionSession,
}))

export function collectionSession(): CollectionSessionState {
  return useCollectionStore.getState()
}

/** The id of the list currently playing, or null. */
export function collectionContextId(): string | null {
  return useCollectionStore.getState().context?.id ?? null
}

export function hasActiveCollection(): boolean {
  return useCollectionStore.getState().context !== null
}

/* --------------------------------------------------------------------------
   Lifecycle
   -------------------------------------------------------------------------- */

export interface StartCollectionOptions {
  /** Draw a shuffled running order rather than the visible one. */
  shuffle?: boolean
  /** Seed for the permutation, so a session order is reproducible. */
  seed?: number
}

/**
 * Begins a collection session over a snapshot of the visible list.
 *
 * Returns the starting position within the running order, or `-1` when there is
 * nothing to play.
 */
export function startCollection(
  items: readonly LibraryTrackRef[],
  startIndex: number,
  context: CollectionContext,
  options: StartCollectionOptions = {},
): number {
  const snapshot = [...items]
  if (snapshot.length === 0) {
    clearCollection()
    return -1
  }

  const from = Math.min(Math.max(startIndex, 0), snapshot.length - 1)
  /**
   * The chosen row is pinned first, shuffled or not.
   *
   * `shuffledOrder` already does this — it places `currentIndex` at the head and
   * Fisher–Yates the rest — and it is the right behaviour on both paths. A row
   * click named the song that must play now, and a press of Shuffle over a list
   * still starts at the top of the list the visitor is looking at; what shuffle
   * changes is everything after that.
   */
  const order = options.shuffle
    ? shuffledOrder(snapshot.length, from, options.seed ?? 1)
    : snapshot.map((_, index) => index)

  const position = Math.max(order.indexOf(from), 0)

  useCollectionStore.setState({
    context,
    items: snapshot,
    order,
    position,
    queuePositions: {},
    queuedThrough: -1,
  })

  return position
}

export function clearCollection(): void {
  useCollectionStore.setState({ ...initialCollectionSession })
}

/**
 * Ends the session unless the queue taking over *is* this collection.
 *
 * The one rule that keeps a finished collection from resurfacing: starting
 * anything under a different context — a search seed, a shelf, a chart, a single
 * saved item — ends it, so a continuation the visitor left behind can never
 * reappear three tracks later.
 */
export function clearCollectionUnlessContext(contextId: string | null | undefined): void {
  const active = collectionContextId()
  if (active === null) return
  if (contextId === active) return
  clearCollection()
}

export function setCollectionPosition(position: number): void {
  useCollectionStore.setState({ position })
}

/** Records what the audio queue now holds, so an advance can be mapped back. */
export function noteCollectionQueue(
  queuePositions: Record<string, number>,
  queuedThrough: number,
): void {
  useCollectionStore.setState({ queuePositions, queuedThrough })
}

/**
 * Called whenever an audio track starts, to keep the session's cursor honest.
 *
 * Silent for anything the collection did not put in the queue, which is what
 * leaves the collection's place untouched while a manually queued track or a
 * generated one plays.
 */
export function noteCollectionTrackStarted(trackId: string): void {
  const state = useCollectionStore.getState()
  if (!state.context) return
  const position = state.queuePositions[trackId]
  if (position === undefined || position === state.position) return
  useCollectionStore.setState({ position })
}

/* --------------------------------------------------------------------------
   Navigation
   -------------------------------------------------------------------------- */

/** Whether the visitor pressed a control, or the item simply ran out. */
export type CollectionAdvanceReason = 'ended' | 'user'

export function collectionRefAt(
  state: CollectionSessionState,
  position: number,
): LibraryTrackRef | null {
  const index = state.order[position]
  if (index === undefined) return null
  return state.items[index] ?? null
}

/**
 * The next position in the running order, or `null` when the list is done.
 *
 * `null` is the signal that lets the caller fall through to generated autoplay.
 * **Repeat off does not wrap**, and that is the correction this change makes: a
 * list started at C runs C, D, E and stops. It does not rotate round to A and B,
 * which is what the previous rotate-the-array implementation did, and what made
 * Repeat off behave like Repeat playlist.
 */
export function nextCollectionPosition(
  state: CollectionSessionState,
  repeatMode: RepeatMode,
  reason: CollectionAdvanceReason,
): number | null {
  if (!state.context || state.order.length === 0) return null
  const next = state.position + 1
  if (next < state.order.length) return next
  if (repeatMode !== 'all') return null
  // A one-item Repeat-playlist collection wraps onto itself when it ends, which
  // is what was asked for — but never for a press of Next, which means
  // *leave this*.
  if (reason === 'user' && state.order.length === 1) return null
  return 0
}

/** The previous position, or `null` at the start. Repeat playlist wraps back. */
export function previousCollectionPosition(
  state: CollectionSessionState,
  repeatMode: RepeatMode,
): number | null {
  if (!state.context || state.order.length === 0) return null
  if (state.position > 0) return state.position - 1
  if (repeatMode === 'all' && state.order.length > 1) return state.order.length - 1
  return null
}

/**
 * Whether the collection is what put this item on screen.
 *
 * The question that decides who owns Next while a video is playing. A
 * `LibraryTrackRef.key` and a `YouTubeVideoItem.id` are the same string —
 * `youtube:<videoId>` — precisely so origin can be established without either
 * side carrying a flag that could go stale.
 */
export function collectionOwnsItemKey(
  key: string,
  state: CollectionSessionState = collectionSession(),
): boolean {
  if (!state.context) return false
  return collectionRefAt(state, state.position)?.key === key
}

export interface CollectionItem {
  position: number
  ref: LibraryTrackRef
}

/**
 * The saved items still ahead of the listener, in the running order.
 *
 * What *Up next* is really showing: the queue holds only the resolved catalogue
 * window, so a collection that continues past it — into a saved video, or into
 * items not looked up yet — would otherwise appear to end early. Reading this
 * costs nothing and asks no provider anything; the references are already here.
 */
export function remainingCollectionItems(
  state: CollectionSessionState = collectionSession(),
): CollectionItem[] {
  if (!state.context || state.position < 0) return []
  const items: CollectionItem[] = []
  for (let position = state.position + 1; position < state.order.length; position += 1) {
    const ref = collectionRefAt(state, position)
    if (ref) items.push({ position, ref })
  }
  return items
}

/* --------------------------------------------------------------------------
   Routing

   The session knows *which saved item* is next. It deliberately does not know
   how to resolve one, or which engine owns it: that is the library's job and the
   engines' job, and hard-wiring it here would drag provider resolution into the
   player layer and close an import cycle. The library registers an engine
   instead, and this module calls it.
   -------------------------------------------------------------------------- */

export interface CollectionRouteRequest {
  ref: LibraryTrackRef
  context: CollectionContext
  /** Position in the running order, so the engine can fill a look-ahead. */
  position: number
  /** True only when a real user gesture is driving this transition. */
  userInitiated: boolean
}

export interface CollectionEngine {
  /** Plays one saved item on the engine its provider calls for. */
  play: (request: CollectionRouteRequest) => Promise<boolean>
  /** Resolves a little further ahead in the current audio run. */
  topUp: () => Promise<void>
}

let engine: CollectionEngine | null = null

export function setCollectionEngine(next: CollectionEngine | null): void {
  engine = next
}

/** Test seam. */
export function resetCollectionSession(): void {
  clearCollection()
  engine = null
}

/**
 * Consecutive unavailable items an advance steps over before giving up.
 *
 * A withdrawn track, an expired saved video or a dead content node must not end
 * the collection — and must not become a retry loop either. Each candidate gets
 * exactly one bounded attempt, and the cursor moves past it whether or not it
 * played, so the same item can never be tried twice within one advance.
 */
export const MAX_UNAVAILABLE_SKIPS = 5

/**
 * Moves the collection forward and plays what it lands on.
 *
 * Returns `false` when the collection genuinely has nothing more to offer, which
 * is the caller's cue to consult autoplay. The session is *not* torn down then:
 * Previous still works, and turning Repeat playlist on afterwards still has a
 * list to repeat.
 */
export async function advanceCollection(options: {
  reason: CollectionAdvanceReason
  repeatMode: RepeatMode
  userInitiated: boolean
}): Promise<boolean> {
  if (!engine) return false

  const seen = new Set<number>()
  for (let attempt = 0; attempt <= MAX_UNAVAILABLE_SKIPS; attempt += 1) {
    const state = useCollectionStore.getState()
    if (!state.context) return false

    const next = nextCollectionPosition(state, options.repeatMode, options.reason)
    // A Repeat-playlist collection of nothing but unavailable items would
    // otherwise circle for ever; one lap is the bound.
    if (next === null || seen.has(next)) return false
    seen.add(next)

    const ref = collectionRefAt(state, next)
    // The cursor steps before the attempt, so a failure resumes past the item
    // rather than at it.
    setCollectionPosition(next)
    if (!ref) continue

    const played = await engine.play({
      ref,
      context: state.context,
      position: next,
      userInitiated: options.userInitiated,
    })
    if (played) return true
  }
  return false
}

/**
 * Jumps straight to one position in the running order.
 *
 * Behind a row pressed in *Up next*. An item that turns out to be unavailable
 * falls forward through the ordinary bounded advance rather than doing nothing,
 * which is the same answer a press of Next would give.
 */
export async function playCollectionPosition(position: number): Promise<boolean> {
  if (!engine) return false
  const state = useCollectionStore.getState()
  if (!state.context) return false

  const ref = collectionRefAt(state, position)
  if (!ref) return false

  setCollectionPosition(position)
  const played = await engine.play({
    ref,
    context: state.context,
    position,
    userInitiated: true,
  })
  if (played) return true

  return advanceCollection({ reason: 'user', repeatMode: 'off', userInitiated: true })
}

/** Steps the collection backwards. Same bounded-skip discipline as forwards. */
export async function retreatCollection(options: { repeatMode: RepeatMode }): Promise<boolean> {
  if (!engine) return false

  const seen = new Set<number>()
  for (let attempt = 0; attempt <= MAX_UNAVAILABLE_SKIPS; attempt += 1) {
    const state = useCollectionStore.getState()
    if (!state.context) return false

    const previous = previousCollectionPosition(state, options.repeatMode)
    if (previous === null || seen.has(previous)) return false
    seen.add(previous)

    const ref = collectionRefAt(state, previous)
    setCollectionPosition(previous)
    if (!ref) continue

    const played = await engine.play({
      ref,
      context: state.context,
      position: previous,
      userInitiated: true,
    })
    if (played) return true
  }
  return false
}

/** Resolves a little further into the current audio run. Never awaited by playback. */
export async function topUpCollection(): Promise<void> {
  if (!engine) return
  if (!hasActiveCollection()) return
  await engine.topUp()
}
