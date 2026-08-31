import { create } from 'zustand'
import type { YouTubeVideoItem } from '@/music/types'

/**
 * State for the YouTube surface.
 *
 * Kept apart from `player-store` on purpose. The audio store's vocabulary —
 * queue, seek position, volume, stream errors — belongs to something the app
 * controls; a YouTube embed is a player the app may only ask politely to start
 * and stop, whose volume and scrubbing are the visitor's business through
 * YouTube's own native controls. Merging the two would invite exactly the kind
 * of code that treats a video like a track.
 */

export type YouTubeStatus = 'idle' | 'loading' | 'cued' | 'playing' | 'paused' | 'ended' | 'error'

/** Why the player is waiting for an explicit press. See `awaitingUserPlayReason`. */
export type AwaitingPlayReason =
  | 'visibility'
  | 'document-hidden'
  | 'player-not-ready'
  | 'permission-policy'
  | 'autoplay-blocked'
  | 'player-command-no-start'
  | 'player-returned-to-cued'

export interface YouTubePlaybackState {
  /** The item the surface is showing. Null means the surface is closed. */
  item: YouTubeVideoItem | null
  status: YouTubeStatus
  /** True while the visible surface is mounted and displayed. */
  surfaceOpen: boolean
  /**
   * Set when a scripted transition cued an item that may not auto-play, so the
   * UI can ask for an explicit press instead of starting on its own.
   */
  awaitingUserPlay: boolean
  /**
   * *Why* an explicit press is being asked for.
   *
   * These are not the same situation and must not be reported as one, which is
   * the whole reason the reported bug was hard to place: a video sitting on a
   * thumbnail looks identical whether the application never asked it to play or
   * the browser refused. Recording which lets a diagnostic build say so, lets a
   * test assert it, and lets the UI phrase the one case that genuinely warrants
   * a word to the visitor.
   *
   * · `'visibility'` — the player was not measurably more than half visible, so
   *   this application did not initiate playback. Required Minimum
   *   Functionality; the app's own decision.
   * · `'document-hidden'` — the app was in the background. The app's decision.
   * · `'player-not-ready'` — the player did not become usable within the bound,
   *   so no command was issued. The app's decision, and a slow one.
   * · `'permission-policy'` — the embed's frame was never delegated the
   *   `autoplay` permission, so the browser would refuse any scripted start
   *   whatever else were true. A configuration fact, and the one failure here
   *   that is fixable by a header or an attribute rather than by timing.
   * · `'autoplay-blocked'` — the app *did* issue a play command and the browser
   *   or the provider said so, through the documented `onAutoplayBlocked`.
   *   **Not** the app's decision, and nothing in this codebase can or should
   *   work around it.
   * · `'player-command-no-start'` — the app issued a play command and the player
   *   said nothing at all inside the confirmation window. The quiet form of the
   *   case above: a browser that declines without firing the event.
   * · `'player-returned-to-cued'` — the app issued a play command, the player
   *   *began* (`buffering`) and then fell back to `cued`. This is the sequence a
   *   physical phone actually reported —
   *   `unstarted → buffering → unstarted → cued` — and it is the most specific
   *   silent refusal there is: the command was accepted, the start was attempted,
   *   and something stopped it without raising anything. Nothing in this codebase
   *   can or should work around it.
   */
  awaitingUserPlayReason: AwaitingPlayReason | null
  currentTime: number
  duration: number
  error: string | null

  /**
   * The already-fetched result list this playback came from.
   *
   * **Session-only, and deliberately so.** It is never written to IndexedDB or
   * `localStorage`: it is a page of YouTube search results, and the Phase 7
   * library rules for saved YouTube metadata are a separate, stricter thing.
   * A reload starts with no session, which is correct — the results are gone
   * too.
   *
   * Empty for a video opened from anywhere other than a result list (Recently
   * Played, a saved library item), because those are single items with nothing
   * to continue into.
   */
  sessionItems: YouTubeVideoItem[]
  /** Index into `sessionItems` of the item currently loaded. `-1` when none. */
  sessionIndex: number
  /** The query the results came from, for the surface's caption. */
  sessionQuery: string | null
  /**
   * Whether a *natural end* may advance to the next eligible video.
   *
   * Governs advancing through the session while the player is on screen, and —
   * since the "playback never stops" rule — extending that session with one
   * related search when it runs out. It still grants nothing in the background:
   * a hidden document pauses, and a player that is not more than half visible
   * cues rather than plays.
   */
  continuousPlay: boolean
  /**
   * Set when the hidden-document rule paused playback, so the surface can
   * explain why once the visitor comes back. Session-only, and cleared as soon
   * as it has been shown or playback resumes.
   */
  pausedForBackgroundPolicy: boolean
}

export interface YouTubePlaybackActions {
  openWith: (item: YouTubeVideoItem, status: YouTubeStatus) => void
  setStatus: (status: YouTubeStatus) => void
  setAwaitingUserPlay: (awaiting: boolean, reason?: AwaitingPlayReason | null) => void
  setProgress: (currentTime: number, duration: number) => void
  setError: (error: string | null) => void
  close: () => void

  /** Adopts an already-fetched result list. Makes no request of any kind. */
  startSession: (items: YouTubeVideoItem[], index: number, query: string | null) => void
  /**
   * Extends the session with further results, keeping the current position.
   *
   * Appends rather than replaces, and drops anything already in the list, so a
   * continuation that arrives while the listener is at item 9 cannot renumber
   * what is playing or offer them a video they have just seen.
   */
  appendSessionItems: (items: readonly YouTubeVideoItem[]) => void
  setSessionIndex: (index: number) => void
  setContinuousPlay: (enabled: boolean) => void
  setPausedForBackgroundPolicy: (paused: boolean) => void
  clearSession: () => void
}

export const initialYouTubeState: YouTubePlaybackState = {
  item: null,
  status: 'idle',
  surfaceOpen: false,
  awaitingUserPlay: false,
  awaitingUserPlayReason: null,
  currentTime: 0,
  duration: 0,
  error: null,
  sessionItems: [],
  sessionIndex: -1,
  sessionQuery: null,
  // On by default, but only ever reached after the visitor explicitly started a
  // YouTube result — nothing here can begin playing on its own.
  continuousPlay: true,
  pausedForBackgroundPolicy: false,
}

export const useYouTubeStore = create<YouTubePlaybackState & YouTubePlaybackActions>((set) => ({
  ...initialYouTubeState,

  openWith: (item, status) =>
    set({
      item,
      status,
      surfaceOpen: true,
      awaitingUserPlay: status === 'cued',
      // The reason is set by whoever cued it; opening clears any stale one.
      awaitingUserPlayReason: null,
      currentTime: 0,
      duration: item.durationSeconds ?? 0,
      error: null,
    }),

  setStatus: (status) =>
    set((state) => ({
      status,
      // Any real playing state clears the "press play" prompt.
      awaitingUserPlay: status === 'playing' ? false : state.awaitingUserPlay,
      awaitingUserPlayReason: status === 'playing' ? null : state.awaitingUserPlayReason,
      // …and answers the background-pause explanation, which is only about a
      // playback that was interrupted.
      pausedForBackgroundPolicy: status === 'playing' ? false : state.pausedForBackgroundPolicy,
      error: status === 'error' ? state.error : null,
    })),

  setAwaitingUserPlay: (awaitingUserPlay, reason = null) =>
    set({ awaitingUserPlay, awaitingUserPlayReason: awaitingUserPlay ? reason : null }),

  setProgress: (currentTime, duration) =>
    set({
      currentTime: Number.isFinite(currentTime) ? currentTime : 0,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    }),

  setError: (error) => set({ error, status: error ? 'error' : 'idle' }),

  /**
   * Dismissing the surface ends everything, including the session.
   *
   * `continuousPlay` is the one thing carried across: it is a stated preference
   * about how the visitor wants results to behave, not a property of the list
   * they just closed.
   */
  close: () => set((state) => ({ ...initialYouTubeState, continuousPlay: state.continuousPlay })),

  startSession: (sessionItems, sessionIndex, sessionQuery) =>
    set({ sessionItems, sessionIndex, sessionQuery }),

  appendSessionItems: (incoming) =>
    set((state) => {
      const known = new Set(state.sessionItems.map((item) => item.id))
      const added = incoming.filter((item) => !known.has(item.id))
      if (!added.length) return state
      return { sessionItems: [...state.sessionItems, ...added] }
    }),

  setSessionIndex: (sessionIndex) => set({ sessionIndex }),

  setContinuousPlay: (continuousPlay) => set({ continuousPlay }),

  setPausedForBackgroundPolicy: (pausedForBackgroundPolicy) => set({ pausedForBackgroundPolicy }),

  clearSession: () => set({ sessionItems: [], sessionIndex: -1, sessionQuery: null }),
}))
