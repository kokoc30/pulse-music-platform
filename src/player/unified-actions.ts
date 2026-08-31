import { showNotice, useUiStore } from '@/app/ui-store'
import { useLibraryStore } from '@/library/store'
import { LIKE_ADDED_MESSAGE, LIKE_REMOVED_MESSAGE } from '@/library/types'
import { isYouTubeVideoItem } from '@/music/types'
import type { MediaItem } from '@/music/types'
import { clearCollection } from './collection-session'
import { activeEngine } from './playback-coordinator'
import {
  SEEK_STEP_SECONDS,
  playPrevious,
  playTrack,
  seek,
  seekBy,
  skipToNext,
  togglePlay,
} from './player-actions'
import type { QueueContext } from './player-store'
import { usePlayerStore } from './player-store'
import { selectSnapshotState } from './use-playback-snapshot'
import {
  closeYouTubeSurface,
  playYouTubeSessionStep,
  playYouTubeVideo,
  seekYouTube,
  toggleYouTubePlayback,
  youTubeSeekLimit,
} from './youtube-actions'
import { useYouTubeStore } from './youtube-store'

/**
 * The transport, addressed once rather than twice.
 *
 * **This file and `use-playback-snapshot.ts` are the only two places in the UI
 * layer permitted to know that two engines exist.** Components call these; they
 * do not import `player-actions` or `youtube-actions`, and they do not test
 * `engine === 'youtube'`. That rule is what stops the bottom bar drifting back
 * into two implementations, which is exactly how seek, like and expand came to
 * exist for one engine only.
 *
 * Each function is a two-line dispatch and nothing more. No behaviour lives
 * here: `skipToNext` still owns what Next means for audio, `playYouTubeSessionStep`
 * still owns what it means for a result session, and both keep their own rules
 * about repeat, autoplay, embeddability and quota. This is an address book, not
 * a second player.
 */

/**
 * How far the skip-back and skip-forward controls move.
 *
 * Re-exported so a player surface has one import for the whole transport,
 * including its units. The value itself still belongs to `player-actions`,
 * beside the Media Session defaults it matches.
 */
export { SEEK_STEP_SECONDS }

/**
 * Brings the expanded view up when a YouTube action needs a player to act on.
 *
 * The embedded player is mounted only while the expanded view is open — see
 * `GlobalPlayer` — so a collapsed video has a bar, a thumbnail and no player at
 * all, and a press of Play has nothing to press.
 *
 * Only this one caller needs it. Every *other* way a video starts goes through
 * `runStartSequence`, which opens the surface itself in phase 1 through
 * `prepareYouTubePlaybackSurface` — and does so only once the item is known to
 * be a video, so a step that lands on a catalogue track never pulls the sheet
 * up. A resume has no such sequence to run: it acts on the loaded item directly,
 * so it asks here.
 *
 * Deliberately not a general "always expand". A pause needs no player to be
 * built and a seek acts on one that already exists, so neither disturbs the view.
 */
function revealYouTubePlayer(): void {
  if (!useUiStore.getState().nowPlayingOpen) unifiedExpand(true)
}

/**
 * Play or pause whatever currently holds the engine claim.
 *
 * The YouTube branch carries one extra line, and it is the honest consequence of
 * where the player lives. The stage was docked beside the mini-player for a
 * while, so a collapsed video still had a live player and pressing play pressed
 * play. That docked player is what made a video look like two products, so it is
 * gone: collapsed, there is no player, and a press of Play means *open the view,
 * build the player, restore the position and start*.
 *
 * The visitor experiences it as one gesture, which is what it is. Nothing is
 * started in the background and nothing is faked — the sheet comes up because
 * the video is about to be visible in it.
 */
export function unifiedPlayPause(): void {
  if (activeEngine() === 'youtube') {
    // Only when something is going to *start*. A pause acts on a player that is
    // by definition already on screen.
    if (useYouTubeStore.getState().status !== 'playing') revealYouTubePlayer()
    toggleYouTubePlayback()
    return
  }
  void togglePlay()
}

/**
 * Moves the playhead to an absolute position, in seconds.
 *
 * Absolute rather than relative on both sides: the seek rail computes a position
 * from where the pointer was released, and `seek` / `seekYouTube` are the two
 * functions that take one. The relative form has its own entry point below, so
 * neither engine can ever be handed an offset where it expects a position.
 */
export function unifiedSeek(seconds: number): void {
  if (activeEngine() === 'youtube') {
    seekYouTube(seconds)
    return
  }
  seek(seconds)
}

/**
 * Moves the playhead by a relative amount, in seconds.
 *
 * Separate from `unifiedSeek` rather than folded into it, because conflating an
 * offset with a position is precisely the bug that would be invisible until one
 * engine jumped to second 10 while the other jumped forward by 10.
 *
 * The audio side keeps its own `seekBy`, which owns the arithmetic and the
 * clamp; the YouTube side has no relative form, so the offset is resolved
 * against the position the store already holds and handed on as a position.
 *
 * This is what the expanded view's ten-second controls call for *either* engine.
 * They used to be an audio affordance, on the reasoning that a visitor already
 * reaches for YouTube's own ±10s gestures inside the frame — but the frame is a
 * small card in a Pulse player now, its gestures are the provider's rather than
 * the app's, and a transport row that changes shape depending on what is loaded
 * is two players wearing one skin. Both engines publish `seekTo`; both get the
 * control.
 */
export function unifiedSeekBy(deltaSeconds: number): void {
  if (activeEngine() === 'youtube') {
    const state = useYouTubeStore.getState()
    if (!Number.isFinite(deltaSeconds)) return
    // The same limit the rail is drawn against, so the button and the scrubber
    // can never disagree about whether this video can be moved.
    if (youTubeSeekLimit(state) <= 0) return
    seekYouTube(state.currentTime + deltaSeconds)
    return
  }
  seekBy(deltaSeconds)
}

export function unifiedNext(): void {
  if (activeEngine() === 'youtube') {
    /**
     * No reveal here, deliberately.
     *
     * A step needs a player, and a player only exists in the expanded view — but
     * a step from a *collection-owned* video can land on a catalogue track on
     * the other engine entirely, and expanding for that would pull the sheet up
     * over a visitor who asked for the next song, not for a screen. So the
     * surface is opened where the destination is already known:
     * `prepareYouTubePlaybackSurface`, which only ever runs for an item that is
     * actually going to a YouTube player.
     */
    void playYouTubeSessionStep(1)
    return
  }
  void skipToNext()
}

export function unifiedPrev(): void {
  if (activeEngine() === 'youtube') {
    // See `unifiedNext`: the surface is opened by the start sequence, once the
    // item is known to be a video.
    void playYouTubeSessionStep(-1)
    return
  }
  void playPrevious()
}

/**
 * Toggles the like for whatever is loaded.
 *
 * The programmatic path — a keyboard shortcut, or a future Media Session
 * action. The on-screen heart stays the shared `<LikeButton>` reading the shared
 * library store, because "one canonical heart state" (agents/42) is a stronger
 * guarantee than routing the click through here would be: there is no second
 * copy of *is this liked* to fall out of step, in either arrangement.
 *
 * It writes through the library **store** rather than through
 * `toggleLibraryLikeRef`, and the reason is the dependency direction: the
 * library already imports this module — that is how a saved reference reaches
 * its engine — so importing the library's action layer back would close a cycle.
 * The store is the lower layer both sides share, and the wording it reports is
 * the same pair of constants the action layer uses.
 */
export function unifiedLikeToggle(): void {
  const snapshot = selectSnapshotState({
    engine: activeEngine(),
    audio: usePlayerStore.getState(),
    youtube: useYouTubeStore.getState(),
  })
  const ref = snapshot.toLibraryRef?.()
  if (!ref) return

  const library = useLibraryStore.getState()
  const wasLiked = library.state.likedTrackKeys.includes(ref.key)
  const result = library.toggleLiked(ref)
  if (result.ok) showNotice(wasLiked ? LIKE_REMOVED_MESSAGE : LIKE_ADDED_MESSAGE)
}

/**
 * Opens or collapses the expanded Now Playing view.
 *
 * **A collapse, never a dismiss.** Coming down changes which presentation is on
 * screen and nothing else: the same item stays loaded, at the same position,
 * with the same collection session and the same engine still running. Stopping
 * a video outright is `unifiedDismiss`, below, and the two have deliberately
 * different controls — a chevron for this, a cross for that.
 *
 * **Collapsing a video pauses it, and that is not a compromise.** The embedded
 * player is mounted only while this view is open, so coming down removes it from
 * the page — and the developer policies prohibit content continuing in a player
 * "not displayed in the page, tab, or screen that the user is viewing". Pausing
 * is the only honest answer, and the alternative that avoided it — docking a
 * live 356 x 200 player beside the mini-player so a video was always displayed —
 * is exactly what made a collapsed video look like two players instead of one
 * compact bar.
 *
 * The position is kept, so this costs nothing but a press. `YouTubeStageHost`
 * pauses through `suspendYouTubePlayback` on the way down, which publishes the
 * player's exact clock, and restores the video and that position on the way back
 * up.
 *
 * **Audio is untouched by any of this.** It has no player to remove, and a
 * collapse leaves it playing exactly as before.
 *
 * Still one line for both engines: the pause belongs to the stage's own
 * lifecycle, not to the control that happened to trigger it, so a collapse from
 * the chevron, a swipe, Escape or anywhere else behaves identically.
 */
export function unifiedExpand(open: boolean): void {
  useUiStore.getState().setNowPlayingOpen(open)
}

/**
 * Dismisses the loaded item, handing the bar back to whatever was underneath.
 *
 * The other half of the pair, and genuinely a different act from collapsing.
 * Only a video has one, and it *stops* rather than pauses: a paused player the
 * visitor has dismissed is still a player they cannot see, which is the
 * background-player definition the developer policies prohibit. Releasing the
 * claim brings back the audio track `activateYouTube` preserved — paused, and
 * showing Play, because resuming stays the visitor's decision.
 *
 * It lives on the mini-player rather than in the expanded view, where a cross
 * beside a chevron would invite exactly the mistake the two words describe.
 */
export function unifiedDismiss(): void {
  if (activeEngine() !== 'youtube') return
  closeYouTubeSurface()
}

/**
 * Starts playback of an already-resolved item, on the engine its type calls for.
 *
 * Dispatches on the **item**, not on the active engine — a saved YouTube video
 * plays on the embed no matter what happens to be playing now. Callers that hold
 * a `LibraryTrackRef` or a `ListenEntry` still do their own resolution and their
 * own retention checks first; this is only the final hand-off, so that "which
 * engine plays this" is answered in one place.
 */
export async function unifiedPlay(item: MediaItem, context?: QueueContext): Promise<void> {
  /**
   * A play with no list behind it ends whatever collection was running.
   *
   * Recently Played and the single-saved-item path both come through here
   * without a context, and both mean *just this one*. Leaving the session in
   * place would let a collection the visitor stepped out of quietly resume when
   * this item finished. A play that carries a context is handled one layer down,
   * where the ids can be compared.
   */
  if (!context) clearCollection()

  if (isYouTubeVideoItem(item)) {
    await playYouTubeVideo(item, { userInitiated: true })
    return
  }
  await playTrack(item, { queue: [item], index: 0, ...(context ? { context } : {}) })
}
