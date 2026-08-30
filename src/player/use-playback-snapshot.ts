import { useEffect, useState } from 'react'
import { pickArtwork } from '@/music/normalize'
import { providerLabel } from '@/music/provider-labels'
import type { Artwork, Track, YouTubeVideoItem } from '@/music/types'
import { trackRefFromTrack, trackRefFromYouTube } from '@/library/track-ref'
import type { LibraryTrackRef } from '@/library/types'
import type { EngineKind } from './playback-coordinator'
import { selectCanSkipNext, selectHasPrevious } from './player-selectors'
import { usePlayerStore } from './player-store'
import type { PlayerState } from './player-store'
import { mapAudioStatus, mapYouTubeStatus } from './types'
import type { UnifiedStatus } from './types'
import { useActiveEngine } from './use-active-engine'
import { nextEligibleIndex } from './youtube-actions'
import { useYouTubeStore } from './youtube-store'
import type { YouTubePlaybackState } from './youtube-store'

/**
 * One answer to "what is playing, and what may I do to it".
 *
 * **This is a read model, not a third store.** Nothing writes here. It selects
 * from `usePlayerStore` and `useYouTubeStore` and returns a projection; both
 * stores keep their own shape, their own actions and their own engine, and
 * `Track` and `YouTubeVideoItem` stay separate types. What changes is only that
 * a component no longer has to know which of the two it is looking at.
 *
 * Before this existed, `GlobalPlayer` resolved the active engine and then
 * branched into two entirely separate component trees. Unification had happened
 * at the container and never at the component, which meant every affordance had
 * to be built twice — and three of them (seek, like, expand) were built once and
 * silently existed for audio only.
 *
 * **Capabilities, not engine checks.** The real difference between the engines
 * is *which controls can honestly be offered*, so that is expressed as data. A
 * component asks `capabilities.shuffle`, never `engine === 'youtube'`. That is
 * what keeps the engine branch in exactly two files — this one and
 * `unified-actions.ts`.
 */

export interface PlaybackCapabilities {
  /** The seek rail is live. True for both engines: YouTube publishes `seekTo`. */
  seek: boolean
  like: boolean
  /** A YouTube result session has no running order to shuffle. */
  shuffle: boolean
  repeat: boolean
  /** Volume inside the embed is the visitor's business, through native controls. */
  volume: boolean
  queue: boolean
  expand: boolean
  /**
   * The item can continue into an already-fetched result list when it ends.
   *
   * YouTube only, and it is a *setting* rather than a control: the visitor's
   * answer to "should the next search result follow this one". The audio side
   * expresses the same idea as `autoplaySimilar`, which lives in Settings, so
   * there is no second switch for it here.
   */
  continuous: boolean
  /**
   * The item can be dismissed, handing the bar back to whatever was underneath.
   *
   * YouTube only. An audio track is dismissed by playing something else or by
   * letting the queue end; a video is an overlay on a session the visitor may
   * still want back, and `activateYouTube` preserved that session on purpose.
   * Without this the only way out of a docked player is to start another track.
   */
  dismiss: boolean
}

export interface PlaybackSnapshot {
  engine: EngineKind
  title: string
  /** Artist for a catalogue track; channel for a video. Never relabelled. */
  subtitle: string
  /**
   * The artwork object, with its Audius mirror origins intact, so the shared
   * `<Artwork>` failover still works. Null for YouTube, which renders a live
   * stage rather than a still.
   */
  artwork: Artwork | null
  artworkUrl: string
  artworkAspect: 'square' | '16:9'
  /** The provider's own page for this item. Empty when it published none. */
  sourceUrl: string
  providerLabel: string
  /**
   * The `rel` a link to `sourceUrl` must carry.
   *
   * Data rather than a branch in the components, because the two providers
   * genuinely differ: YouTube's Required Minimum Functionality states an API
   * client "must not use the noreferrer feature", while the catalogues have no
   * such rule and take the safer pair. Deciding that in the bar would have been
   * the one engine check left in a player surface.
   */
  sourceRel: string
  /**
   * True when the source link is a licence or policy obligation rather than a
   * convenience — Jamendo's per-item backlink, and YouTube's watch-page link.
   * Such a link may not be dropped for want of room on a phone.
   */
  attributionRequired: boolean
  libraryKey: string
  /**
   * Builds the saved reference, or null when nothing is loaded. A function
   * rather than a value for the same reason the rows use one: it is called only
   * when the heart is actually pressed.
   */
  toLibraryRef: (() => LibraryTrackRef) | null
  status: UnifiedStatus
  currentTime: number
  duration: number
  error: string | null
  canNext: boolean
  canPrevious: boolean
  capabilities: PlaybackCapabilities
  /** True only for YouTube: the artwork slot holds a live player, not an image. */
  isEmbeddedStage: boolean
  /**
   * The item the embedded stage should host. Carried on the snapshot so the bar
   * and the sheet can mount the stage without either of them reading the YouTube
   * store — which is the rule that keeps the engine branch out of components.
   */
  stageItem: YouTubeVideoItem | null
  /**
   * The loaded item as something the audio queue could accept, or null.
   *
   * Only the *Add to queue* menu entry needs this, and only that entry is
   * withheld for a video — a YouTube item has no place in an audio queue, by
   * type as well as by policy. Everything else the track menu offers (playlists,
   * hiding a recommendation) works from the library reference and is offered for
   * both.
   */
  queueableTrack: Track | null
}

const NO_CAPABILITIES: PlaybackCapabilities = {
  seek: false,
  like: false,
  shuffle: false,
  repeat: false,
  volume: false,
  queue: false,
  expand: false,
  continuous: false,
  dismiss: false,
}

/** Frozen and shared: an identity a memo can compare against cheaply. */
export const EMPTY_SNAPSHOT: PlaybackSnapshot = {
  engine: 'none',
  title: '',
  subtitle: '',
  artwork: null,
  artworkUrl: '',
  artworkAspect: 'square',
  sourceUrl: '',
  providerLabel: '',
  sourceRel: 'noopener noreferrer',
  attributionRequired: false,
  libraryKey: '',
  toLibraryRef: null,
  status: 'idle',
  currentTime: 0,
  duration: 0,
  error: null,
  canNext: false,
  canPrevious: false,
  capabilities: NO_CAPABILITIES,
  isEmbeddedStage: false,
  stageItem: null,
  queueableTrack: null,
}

/**
 * YouTube's documented medium-quality thumbnail, 320 x 180.
 *
 * Built from the video id rather than taken from the search payload because the
 * payload's key varies — `maxresdefault` is 1280 wide, which is twenty times the
 * width the bar draws it at. This is the same host, the same image and the same
 * unmodified frame, at the size actually being displayed.
 */
export function youTubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
}

export interface SnapshotInput {
  engine: EngineKind
  audio: PlayerState
  youtube: YouTubePlaybackState
}

/**
 * The pure half, so the mapping can be tested without React or a live engine.
 *
 * The precedence is exactly the one the bar had before it was unified, and the
 * asymmetry between the two branches is deliberate:
 *
 * · **YouTube, only while it holds the claim.** A video is shown when the
 *   coordinator says it is the live engine and there is an item behind that.
 * · **Audio whenever a track is loaded**, claim or no claim. Closing a video
 *   releases the claim to `'none'`, and the audio track it paused is still
 *   loaded underneath — `activateYouTube` preserves it on purpose so it can be
 *   resumed. Requiring `engine === 'audio'` here would drop the visitor to the
 *   join strip at exactly that moment, losing a track they never dismissed.
 * · **Nothing** only when neither engine has anything at all.
 */
export function selectSnapshotState(input: SnapshotInput): PlaybackSnapshot {
  const { engine, audio, youtube } = input

  if (engine === 'youtube' && youtube.item) {
    const item = youtube.item
    return {
      engine: 'youtube',
      title: item.title,
      subtitle: item.channelTitle,
      // A real artwork object, not null, so the bar renders a video through the
      // exact same component and the exact same slot as a track. `small` is
      // YouTube's 320x180 key, which is the right weight for a 56px box; the
      // larger keys keep the item's own published thumbnail for anywhere that
      // asks for one. Both are YouTube's own CDN, unmodified and never
      // re-hosted (agents/25; docs/youtube-policy-audit.md §3).
      artwork: {
        small: youTubeThumbnail(item.videoId),
        medium: item.thumbnailUrl,
        large: item.thumbnailUrl,
      },
      artworkUrl: youTubeThumbnail(item.videoId),
      artworkAspect: '16:9',
      sourceUrl: item.sourceUrl,
      providerLabel: 'YouTube',
      // "must not use the noreferrer feature" — Required Minimum Functionality.
      sourceRel: 'noopener',
      // Required Minimum Functionality asks for a real link to the watch page.
      attributionRequired: true,
      libraryKey: item.id,
      toLibraryRef: () => trackRefFromYouTube(item),
      status: mapYouTubeStatus(youtube.status),
      currentTime: youtube.currentTime,
      // The store's duration is zero until the embed reports one; the item's own
      // figure covers that gap so the rail is never dead on arrival.
      duration: youtube.duration || item.durationSeconds || 0,
      error: youtube.error,
      // Next walks the already-fetched results and, once they run out, extends
      // them with one related search — so it stays lit while continuous play is
      // on, because the action behind it can still answer. Previous only ever
      // walks backwards through what is already there; there is no such thing as
      // searching for the video that came before.
      canNext:
        nextEligibleIndex(youtube.sessionItems, youtube.sessionIndex, 1) >= 0 ||
        youtube.continuousPlay,
      canPrevious: nextEligibleIndex(youtube.sessionItems, youtube.sessionIndex, -1) >= 0,
      capabilities: {
        seek: true,
        like: true,
        shuffle: false,
        repeat: false,
        volume: false,
        queue: false,
        expand: true,
        continuous: true,
        dismiss: true,
      },
      isEmbeddedStage: true,
      stageItem: item,
      queueableTrack: null,
    }
  }

  if (audio.currentTrack) {
    const track = audio.currentTrack
    return {
      engine: 'audio',
      title: track.title,
      subtitle: track.artistName,
      artwork: track.artwork,
      artworkUrl: pickArtwork(track.artwork, 'medium') ?? '',
      artworkAspect: 'square',
      sourceUrl: track.sourceUrl ?? track.permalink ?? '',
      providerLabel: providerLabel(track.provider),
      sourceRel: 'noopener noreferrer',
      // Jamendo's terms require it; Audius asks for none, so an Audius track
      // keeps its link as a convenience that may be dropped on a narrow bar.
      attributionRequired: Boolean(track.attributionRequired && track.sourceUrl),
      libraryKey: track.id,
      toLibraryRef: () => trackRefFromTrack(track),
      status: mapAudioStatus(audio.status),
      currentTime: audio.currentTime,
      duration: audio.duration,
      error: audio.error,
      canNext: selectCanSkipNext(audio),
      canPrevious: selectHasPrevious(audio),
      capabilities: {
        seek: true,
        like: true,
        shuffle: true,
        repeat: true,
        volume: true,
        queue: true,
        expand: true,
        continuous: false,
        dismiss: false,
      },
      isEmbeddedStage: false,
      stageItem: null,
      queueableTrack: track,
    }
  }

  return EMPTY_SNAPSHOT
}

/**
 * How long a buffer may last before it is worth showing.
 *
 * Loading the next track takes a few hundred milliseconds, and now that tracks
 * follow one another without anyone pressing anything, that gap arrives every
 * few minutes on its own. Rendering it turns the play control into a spinner
 * that flashes and disables itself between songs — motion nobody asked for,
 * reporting a wait nobody is having.
 *
 * Longer than this and the wait is real: the listener is looking at a control
 * that has not answered, and saying so is the honest thing. So the state is not
 * suppressed, only *delayed* past the length of an ordinary hand-off.
 */
export const BUFFERING_GRACE_MS = 400

/**
 * The status as it should be *drawn*, which is not always the status as it is.
 *
 * A buffer shorter than the grace never reaches the screen; one longer than it
 * appears as usual and stays until it ends. Every other state is passed straight
 * through the moment it arrives — a pause must never be delayed.
 */
function useSettledStatus(status: UnifiedStatus): UnifiedStatus {
  const [settled, setSettled] = useState(status)

  useEffect(() => {
    if (status !== 'buffering') {
      setSettled(status)
      return
    }
    const handle = setTimeout(() => setSettled('buffering'), BUFFERING_GRACE_MS)
    return () => clearTimeout(handle)
  }, [status])

  // A buffer that is already over renders as what replaced it, not as the stale
  // value the timer was still holding.
  return status === 'buffering' ? settled : status
}

/**
 * The React binding.
 *
 * Both stores are read whole rather than through narrow selectors, because the
 * bar this feeds displays a clock: it re-renders on every progress tick by
 * design, and the engine that is *not* playing does not tick — the coordinator
 * pauses it before handing over the claim.
 */
export function usePlaybackSnapshot(): PlaybackSnapshot {
  const engine = useActiveEngine()
  const audio = usePlayerStore()
  const youtube = useYouTubeStore()
  const snapshot = selectSnapshotState({ engine, audio, youtube })
  const status = useSettledStatus(snapshot.status)
  return status === snapshot.status ? snapshot : { ...snapshot, status }
}
