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
 * Play or pause whatever currently holds the engine claim.
 *
 * Two lines again, as an address book entry should be. It used to carry a third
 * case for YouTube: the player existed only while the expanded sheet was open,
 * so a video paused by collapsing had no player behind it, and a press of play
 * had to mean *reopen the sheet, rebuild the player, restore the position and
 * resume*. The stage lives in the bar now and is never torn down while a video
 * is loaded, so there is nothing to rebuild and no sheet to reopen — pressing
 * play presses play.
 */
export function unifiedPlayPause(): void {
  if (activeEngine() === 'youtube') {
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
 */
export function unifiedSeekBy(deltaSeconds: number): void {
  if (activeEngine() === 'youtube') {
    const { currentTime, duration } = useYouTubeStore.getState()
    if (duration <= 0 || !Number.isFinite(deltaSeconds)) return
    seekYouTube(currentTime + deltaSeconds)
    return
  }
  seekBy(deltaSeconds)
}

export function unifiedNext(): void {
  if (activeEngine() === 'youtube') {
    void playYouTubeSessionStep(1)
    return
  }
  void skipToNext()
}

export function unifiedPrev(): void {
  if (activeEngine() === 'youtube') {
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
 * **Collapsing pauses nothing, and that is a fix rather than a relaxation.** It
 * used to pause a playing video, because the embed was mounted by this view and
 * by nothing else — collapsing removed the player from the page, and the
 * developer policies prohibit content continuing in a player "not displayed in
 * the page, tab, or screen that the user is viewing". Pausing was the only
 * honest answer to a layout that put the player somewhere it could vanish from.
 *
 * The stage is a stable child of the player shell now, and the shell is
 * `position: fixed` and on screen in both presentations — docked beside the
 * mini-player when collapsed, the primary media region when expanded. A video is
 * displayed either way, so the prohibition is satisfied by construction instead
 * of by stopping the music.
 *
 * One line for both engines, which is what it should always have been.
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
