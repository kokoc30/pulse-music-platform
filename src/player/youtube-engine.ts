import { isYouTubeVideoItem } from '@/music/types'
import type { MediaItem, YouTubeVideoItem } from '@/music/types'
import {
  YT_STATE,
  allowsAutoplay,
  ensureAutoplayPermission,
  officialYouTubePlayerFactory,
} from './youtube/iframe-adapter'
import type {
  YouTubePlaybackState,
  YouTubePlayerFactory,
  YouTubePlayerHandle,
} from './youtube/iframe-adapter'

/**
 * The single YouTube playback engine.
 *
 * Exactly one embedded player instance exists for the whole application and is
 * reused for every YouTube item, mirroring how one `HTMLAudioElement` serves
 * Audius and Jamendo (agents/24 → "Architecture", "YouTube -> YouTube").
 *
 * What this engine deliberately cannot do:
 *
 * · accept anything that is not a `YouTubeVideoItem` — the guard is a real
 *   runtime check, not just a type,
 * · play while its container is not on screen,
 * · exist at all before the visitor asks for YouTube: the container is attached
 *   by the surface component, and the official script is fetched on first play.
 */

/** Recommended 16:9 size from the IFrame API reference; the floor is 200×200. */
export const RECOMMENDED_WIDTH = 480
export const RECOMMENDED_HEIGHT = 270
export const MINIMUM_DIMENSION = 200

export interface YouTubeEngineEvents {
  onStateChange?: (state: YouTubePlaybackState) => void
  onReady?: () => void
  onError?: (message: string) => void
  onAutoplayBlocked?: () => void
  onTimeUpdate?: (currentTime: number, duration: number) => void
  /**
   * The documented IFrame API method this engine actually invoked.
   *
   * Purely diagnostic, and it earns its place: "did the authorised automatic
   * start issue a play command or a cue" is the single question that separates
   * an application bug from a browser autoplay refusal, and inferring it from
   * the resulting state is exactly the guesswork that sent the first fix to the
   * wrong layer.
   */
  onCommand?: (command: 'loadVideoById' | 'playVideo' | 'cue', videoId: string) => void
}

/**
 * What the engine is being asked to do with an item — and *only* that.
 *
 * This replaces a `userInitiated: boolean`, and the replacement is the point.
 * That flag carried two different facts at once and the engine acted on the
 * wrong one: it cued whenever `userInitiated` was false, which quietly meant
 * "not a direct gesture" was treated as "must not play". The visibility rule had
 * by then moved up into `youtube-actions`, where a *scripted* transition can be
 * properly authorised by a real measurement — and the only way to express that
 * to the engine was to pass `userInitiated: true` for something no human had
 * clicked. A lie that works is still a lie, and the next reader would have
 * believed it.
 *
 * So the engine is told the decision, never the reasoning:
 *
 * · `'play'` — start this video. The caller has established it is allowed to,
 *   either because a visitor pressed something or because the player was
 *   measured visible enough. The engine does not know or care which.
 * · `'cue'` — prepare this video and stop. Never counts as automatic playback,
 *   and is always safe (agents/21 → "Automatic Playback").
 *
 * **No policy lives in this file.** There is no visibility check here, no
 * document check, and no notion of a gesture. Those belong to `mayAutoplay` and
 * its callers, in one place, where they are tested.
 */
export type PlaybackStartMode = 'play' | 'cue'

export interface StartRequest {
  mode: PlaybackStartMode
  /**
   * Throw away any in-flight or failed player construction and build a new one.
   *
   * Only ever set by a direct press, and it is the recovery authority the
   * reported failure needed. A preparation that hung left the shared creation
   * promise holding something that would never settle; every later request
   * inherited it, and the visitor's own Play button became a control that did
   * nothing at all. A gesture is the strongest signal there is, so it may
   * discard a stalled attempt and start again — and it does not queue behind
   * one, since the whole reason it exists is that the earlier attempt is not
   * coming back.
   *
   * It never touches a working player: a live instance is reused exactly as it
   * always was, and only the absence of one lets this take effect.
   */
  recover?: boolean
}

export interface YouTubeEngine {
  /** Gives the engine the on-screen element the player will occupy. */
  attach(container: HTMLElement): void
  detach(): void
  hasContainer(): boolean
  /**
   * Loads an item, playing it or merely cueing it as the caller decided.
   *
   * The one entry point for both, so "which command does an authorised
   * automatic start actually issue" has a single answer to assert against
   * (`'play'` → `loadVideoById`/`playVideo`, never `cueVideoById`).
   */
  start(item: MediaItem, request: StartRequest): Promise<void>
  /**
   * Prepares the *infrastructure* for an item, and constructs no player at all.
   *
   * Two things happen and nothing else: the official IFrame API script is
   * fetched, and the item is recorded as the requested one so the stage's own
   * remount-restore branch can tell an in-flight start from an idle engine and
   * stays quiet rather than cueing over it.
   *
   * **It used to construct an empty `YT.Player`**, on the documented reading
   * that the constructor's `videoId` is optional and that a player built without
   * one holds no media. The reading is correct and the arrangement still did not
   * work on a real device: the empty construction never reached `onReady`, the
   * shared creation promise never settled, and every later request — including a
   * press of Play — inherited a promise that would hang for ever. A black player
   * whose Play button does nothing is a worse failure than the cued player this
   * was meant to improve on, so the empty player is gone. Mocks supported it; a
   * phone did not, and the phone is the authority.
   *
   * What survives is the half that always helped: the script fetch overlaps the
   * visibility measurement, so an authorised start is not also waiting on a
   * network round trip. The player itself is then built around the real video —
   * the same shape as a direct click, which is the path physical devices confirm
   * works.
   *
   * Costs no Data API request and issues no media command of any kind.
   */
  prepare(item: MediaItem): Promise<boolean>
  /**
   * Whether `YT.Player` exists — the *first* of two independent readinesses.
   *
   * `isApiReady` is about the script: the constructor is available. `isReady` is
   * about an instance: a concrete player for an actual video exists and has
   * emitted `onReady`. Conflating the two is what let a decision wait on
   * something nothing was building, and then withhold playback because the wait
   * came back empty.
   */
  isApiReady(): boolean
  /**
   * How player construction is going, for the diagnostic readout.
   *
   * The reported failure was unplaceable from the outside precisely because this
   * was not visible: `player ready false` said the player was not usable, and
   * nothing said whether anything was still trying to build one or had long
   * since given up.
   */
  describeCreation(): PlayerCreationReport
  /**
   * True once a player instance exists and can accept commands.
   *
   * Separate from "the container is on screen": the element can be laid out for
   * a second or more before the IFrame API script has loaded and built a player
   * inside it, and a start issued into that gap does nothing.
   */
  isReady(): boolean
  /**
   * Resolves once the player can accept commands, or on the bound.
   *
   * Bounded rather than open-ended for the same reason the visibility wait is:
   * a script that never loads must end in a cued, visible player with one Play
   * button, not in a spinner nobody can leave.
   */
  whenReady(timeoutMs?: number): Promise<boolean>
  resume(): void
  pause(): void
  stop(): void
  /**
   * Moves the playhead, through the IFrame API's own documented `seekTo`.
   *
   * The mirror of `AudioEngine.seek`, and the reason one seek rail can serve
   * both engines. It reports the new position immediately rather than waiting
   * for the next progress tick, so a released drag does not visibly snap back
   * for up to a second.
   */
  seek(seconds: number): void
  getCurrentItem(): YouTubeVideoItem | null
  isPlaying(): boolean
  /**
   * What the real, generated iframe looks like right now.
   *
   * Diagnostics only, and it exists because the one fact that decides whether a
   * scripted start can succeed at all — whether the embed's frame was delegated
   * the `autoplay` permission — is invisible from the application otherwise, and
   * unreadable on a phone without desktop developer tools.
   */
  describeIframe(): YouTubeIframeDescription | null
  subscribe(events: YouTubeEngineEvents): () => void
  destroy(): void
}

/**
 * Where the one player instance has got to.
 *
 * · `'idle'` — nothing has been asked for, or the last attempt was discarded.
 * · `'creating'` — a construction is in flight and inside its bound.
 * · `'ready'` — a player exists and has emitted `onReady`.
 * · `'failed'` — the factory rejected: no script, or the API refused the video.
 * · `'timed-out'` — the construction exceeded its bound and was abandoned. The
 *   state the reported failure was actually in, and the one nothing could see.
 */
export type PlayerCreationState = 'idle' | 'creating' | 'ready' | 'failed' | 'timed-out'

/** Diagnostics for the construction lifecycle. No identifiers, no keys. */
export interface PlayerCreationReport {
  state: PlayerCreationState
  /**
   * How many attempts this engine has begun or invalidated.
   *
   * Monotonic, and it is what makes a superseded construction identifiable: only
   * the current generation may install itself as the player.
   */
  generation: number
  /** True once a bound has been exceeded, until a later attempt succeeds. */
  timedOut: boolean
}

/** A read of the generated iframe. No identifiers, no keys — geometry and policy. */
export interface YouTubeIframeDescription {
  allow: string
  allowsAutoplay: boolean
  width: number
  height: number
}

/** How often app UI reads the player clock, and only while it is playing. */
export const PROGRESS_POLL_MS = 1_000

/**
 * How long an authorised start may wait for the player to become usable.
 *
 * The first play of a sitting has to fetch the IFrame API script and build an
 * iframe, which on a phone on a slow connection is comfortably a second or two.
 * Deciding to autoplay and then issuing the command into a player that does not
 * exist yet is a command that does nothing at all — the visibility measurement
 * says yes, the video sits on a thumbnail, and nothing explains why.
 *
 * Bounded, like every other wait here: a script that never arrives ends in a
 * cued player and one Play button.
 */
export const PLAYER_READY_TIMEOUT_MS = 4_000

/**
 * How long **one** player construction may take before it is abandoned.
 *
 * The invariant this exists for: a failed, timed-out, detached, superseded or
 * never-ready construction must never prevent a later real start from building a
 * functional player. An unbounded attempt cannot honour that — a promise that
 * never settles is shared by everything asking afterwards, and the request queue
 * behind it stops moving. That is not hypothetical; it is exactly what a
 * physical phone produced: an empty player that never reported ready, no
 * commands issued at all, and a Play button that did nothing.
 *
 * Generous rather than tight, because the first construction of a sitting may
 * still be fetching the API script on a slow connection — and it is a backstop
 * rather than the usual exit, since a press of Play does not wait for it.
 */
export const PLAYER_CREATE_TIMEOUT_MS = 6_000

/**
 * What an abandoned construction rejects with.
 *
 * One message for both ways an attempt is abandoned — it ran out of time, or a
 * newer attempt superseded it — because they mean the same thing to a caller:
 * *this attempt will not give you a player, and a later one still may*. It is
 * emphatically not a media error, and callers must not report it as one.
 */
export const PLAYER_CREATE_ABANDONED_MESSAGE = 'The YouTube player could not be prepared in time.'

/** Whether a rejection is an abandoned construction rather than a media failure. */
export function isPlayerCreationAbandoned(error: unknown): boolean {
  return error instanceof Error && error.message === PLAYER_CREATE_ABANDONED_MESSAGE
}

export interface EngineOptions {
  factory?: YouTubePlayerFactory
  origin?: string
  /** Test seam for the progress timer. */
  scheduler?: {
    setInterval: (fn: () => void, ms: number) => number
    clearInterval: (handle: number) => void
  }
}

function requireYouTubeItem(item: MediaItem): YouTubeVideoItem {
  if (!isYouTubeVideoItem(item)) {
    // The mirror image of `assertAudioTrack`: an audio track must never reach
    // the iframe engine any more than a video may reach the audio element
    // (agents/28 → "Audio providers never enter YouTube engine").
    throw new Error('The YouTube engine only accepts YouTube video items.')
  }
  return item
}

export function createYouTubeIframeEngine(options: EngineOptions = {}): YouTubeEngine {
  const factory = options.factory ?? officialYouTubePlayerFactory
  const scheduler = options.scheduler ?? {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms) as unknown as number,
    clearInterval: (handle) => globalThis.clearInterval(handle),
  }

  const listeners = new Set<YouTubeEngineEvents>()
  let container: HTMLElement | null = null
  let player: YouTubePlayerHandle | null = null
  let creating: Promise<YouTubePlayerHandle> | null = null
  /**
   * Which construction attempt is the live one.
   *
   * Monotonic, and it can only ever invalidate. Every attempt captures the value
   * at its start and compares on the way out, so an attempt this engine has
   * moved on from — timed out, detached, or overtaken by a press of Play —
   * cannot install itself over the player that replaced it, however late its
   * `onReady` arrives.
   */
  let creationGeneration = 0
  let creationState: PlayerCreationState = 'idle'
  let creationTimedOut = false
  /** The script half of readiness: `YT.Player` exists. See `isApiReady`. */
  let apiReady = false
  let current: YouTubeVideoItem | null = null
  /**
   * What the player has actually been given, as opposed to what has been asked
   * for. The two differ for exactly as long as a request is queued, and that gap
   * is where "resume this video" and "load this video" are told apart.
   */
  let loaded: YouTubeVideoItem | null = null
  let playing = false
  let progressTimer: number | null = null
  /**
   * A request that arrived before the visible surface existed.
   *
   * This is the correct order of operations, not a workaround: the surface is
   * opened first and the player is only built once it is on screen
   * (agents/24 → "Audio -> YouTube": render visible surface, *then* wait for
   * player readiness, *then* load). A click therefore lands here for the few
   * milliseconds React needs to mount the surface, and `attach()` flushes it.
   */
  let pending: { item: YouTubeVideoItem; mode: PlaybackStartMode } | null = null

  /**
   * One request to the player at a time, and the newest one wins.
   *
   * Cueing and playing are both several awaits long — build the player, wait for
   * the script, then call the API — so two requests issued close together used
   * to interleave, and whichever *finished* last decided what the player did.
   * That is not a theoretical race: the stage cues the loaded item when it
   * mounts (so a remount does not lose the video), and a hand-off into YouTube
   * plays it a moment later once the visibility measurement lands. Interleaved,
   * the cue's `cueVideoById` arrived after the play's `loadVideoById` and
   * silently stopped a video that had just started — the player sitting on a
   * thumbnail while the store said it was playing.
   *
   * So requests run one after another, and a request that a newer one has
   * overtaken while it waited its turn is dropped rather than applied late. The
   * newest request is always the one the visitor's most recent action asked for,
   * and it is always the last thing to touch the player.
   */
  let queue: Promise<unknown> = Promise.resolve()
  let latestRequest = 0

  /** Resolved the instant a player exists, so readiness is never answered late. */
  const readyWaiters = new Set<(ready: boolean) => void>()

  const emit = (fn: (events: YouTubeEngineEvents) => void) => {
    for (const listener of listeners) fn(listener)
  }

  const stopProgress = () => {
    if (progressTimer !== null) {
      scheduler.clearInterval(progressTimer)
      progressTimer = null
    }
  }

  /** One modest timer, alive only while the player is actually playing. */
  const startProgress = () => {
    if (progressTimer !== null) return
    progressTimer = scheduler.setInterval(() => {
      // Never reports for a player that holds nothing: a tick from an engine
      // between videos is exactly the stale progress this guards against.
      if (!player || !loaded) return
      emit((events) =>
        events.onTimeUpdate?.(player?.getCurrentTime() ?? 0, player?.getDuration() ?? 0),
      )
    }, PROGRESS_POLL_MS)
  }

  /**
   * Forgets the position, because it belongs to the video being left behind.
   *
   * A screenshot of the reported failure showed a black, never-ready player
   * reporting `0:33 / 4:51`. Nothing about that is true of a video that has not
   * loaded, and a rail that confidently shows somebody else's progress is worse
   * than an empty one: it is the app asserting a fact it does not have.
   *
   * The timer alone was not enough of a guard. It only runs while playing, but
   * the *last* tick it published stays in the store until something replaces it,
   * and a transition that never reaches a player has nothing to replace it with.
   * So the moment a different video is requested, the position is stopped and
   * republished as zero — a duration of zero, too, which the read model resolves
   * to the item's own metadata length rather than to the previous video's.
   */
  const resetProgress = () => {
    stopProgress()
    emit((events) => events.onTimeUpdate?.(0, 0))
  }

  const handleState = (state: YouTubePlaybackState) => {
    playing = state === 'playing'
    if (playing) startProgress()
    else stopProgress()
    emit((events) => events.onStateChange?.(state))
  }

  /** Abandons whatever construction is in flight; the next request starts fresh. */
  function invalidateCreation(): void {
    creationGeneration += 1
    creating = null
  }

  /**
   * Starts one bounded, generation-tagged construction of the player.
   *
   * `seed` is always a real video now. The empty construction the preparation
   * used to perform is gone: a physical device demonstrated that a `YT.Player`
   * built with no `videoId` could sit indefinitely without emitting `onReady`,
   * while a direct click — which has always constructed the player *with* the
   * video — is the path that reliably works. Automatic playback converges on
   * that same known-good setup rather than keeping an exotic lifecycle of its
   * own (agents/24 → "Audio -> YouTube").
   *
   * Three rules stop an attempt ever becoming permanent:
   *
   * · it is **bounded**, and one that exceeds its bound releases the shared
   *   promise and rejects rather than holding everything behind it,
   * · it carries a **generation**, and only the current one may install itself,
   * · a **superseded** attempt destroys the player it built rather than leaving
   *   a second, invisible player running behind the one the visitor can see.
   *
   * Rejecting — rather than quietly never settling — is the part that matters
   * most. A promise that stays pending is inherited by every later request and
   * by the request queue itself, which is precisely how a stalled preparation
   * turned into a Play button that did nothing.
   */
  function beginCreation(seed: YouTubeVideoItem): Promise<YouTubePlayerHandle> {
    const host = container
    if (!host) return Promise.reject(new Error('The YouTube player has no visible container yet.'))

    const generation = (creationGeneration += 1)
    const superseded = () => generation !== creationGeneration
    creationState = 'creating'

    const attempt = factory.create(host, {
      videoId: seed.videoId,
      width: RECOMMENDED_WIDTH,
      height: RECOMMENDED_HEIGHT,
      origin: options.origin ?? (typeof window === 'undefined' ? '' : window.location.origin),
      events: {
        onReady: () => emit((events) => events.onReady?.()),
        onStateChange: handleState,
        onError: (message) => {
          playing = false
          stopProgress()
          emit((events) => events.onError?.(message))
        },
        onAutoplayBlocked: () => {
          playing = false
          stopProgress()
          emit((events) => events.onAutoplayBlocked?.())
        },
      },
    })

    // A construction that arrives after this engine moved on cleans itself up.
    void attempt.then(
      (created) => {
        if (superseded()) created.destroy()
      },
      () => {
        // Reported through the bounded promise below, which has the caller.
      },
    )

    return new Promise<YouTubePlayerHandle>((resolve, reject) => {
      const cap = setTimeout(() => {
        if (!superseded()) {
          creationState = 'timed-out'
          creationTimedOut = true
          invalidateCreation()
        }
        reject(new Error(PLAYER_CREATE_ABANDONED_MESSAGE))
      }, PLAYER_CREATE_TIMEOUT_MS)

      attempt.then(
        (created) => {
          clearTimeout(cap)
          if (superseded()) {
            reject(new Error(PLAYER_CREATE_ABANDONED_MESSAGE))
            return
          }
          player = created
          creating = null
          creationState = 'ready'
          creationTimedOut = false
          apiReady = true
          for (const waiter of [...readyWaiters]) waiter(true)
          /**
           * The autoplay delegation, guaranteed here as well as in the factory.
           *
           * The production factory does it synchronously, in the same task the
           * API created the element, which is the earliest a permissions policy
           * can still be influenced. This second attempt is a no-op whenever
           * that worked — the merge is idempotent — and it earns its place for
           * two reasons: it holds for *any* factory rather than only the
           * official one, and it is therefore assertable, which a guarantee
           * buried in the production adapter would not be.
           */
          ensureAutoplayPermission(created.getIframe())
          resolve(created)
        },
        (error: unknown) => {
          clearTimeout(cap)
          if (!superseded()) {
            creationState = 'failed'
            invalidateCreation()
          }
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
  }

  /**
   * Hands back the one player, building it around `seed` if there is none.
   *
   * `recover` discards a stalled or failed attempt first. It deliberately does
   * nothing when a player already exists: a healthy instance is never rebuilt,
   * so a press of Play on a working video stays a resume.
   */
  async function ensurePlayer(seed: YouTubeVideoItem, recover = false): Promise<YouTubePlayerHandle> {
    if (player) return player
    if (!container) throw new Error('The YouTube player has no visible container yet.')
    if (recover) invalidateCreation()
    // Concurrent calls share one creation: two clicks must not build two
    // players (agents/28 → "One YouTube player instance").
    creating ??= beginCreation(seed)
    return await creating
  }

  async function perform(
    video: YouTubeVideoItem,
    mode: PlaybackStartMode,
    isCurrent: () => boolean,
    recover: boolean,
  ): Promise<void> {
    // Against what the *player* holds, not what has been requested. `current`
    // now answers "what did the last caller ask for", which is set the moment a
    // request is queued; asking it here would call this a resume of a video the
    // player has never been given, and the position would be somebody else's.
    const sameVideo = loaded?.videoId === video.videoId && player !== null
    const instance = await ensurePlayer(video, recover)
    // Building the player is the longest step here, so the guard is re-checked
    // on the far side of it: a request the visitor has already replaced must not
    // issue its command into the player the newer one is using.
    if (!isCurrent()) return
    loaded = video
    current = video

    if (mode === 'cue') {
      playing = false
      stopProgress()
      // `cueVideoById` loads the video's thumbnail and prepares the player
      // without fetching content until play — the documented way to line an
      // item up without initiating playback (agents/21 → "Automatic Playback";
      // the uncertain case must resolve to "do not autoplay").
      instance.cueVideoById(video.videoId)
      emit((events) => events.onCommand?.('cue', video.videoId))
      return
    }

    /**
     * `'play'` always issues a real play command — never `cueVideoById` — and
     * *which* documented command depends on whether there is a playback to
     * resume, not merely on whether the ids match.
     *
     * The distinction matters and was previously wrong. `playVideo()` is a
     * resume: its purpose is to continue a video that has already started, from
     * where it stands. `loadVideoById()` is documented as "loads and plays" —
     * one command that does both, from the beginning.
     *
     * A video that has only been *cued* has never started. It is the same id, so
     * the old check called it a resume and sent `playVideo()` at a player
     * sitting on its thumbnail. That is the state a real phone reported: the
     * right video loaded, YouTube's own red play overlay still on it. Asking a
     * cued player to load-and-play is both the documented path for that state
     * and a single command rather than a resume of something that never ran.
     *
     * So: resume only what genuinely played, and load-and-play everything else.
     */
    const state = instance.getPlayerState()
    const resumable =
      state === YT_STATE.PLAYING || state === YT_STATE.PAUSED || state === YT_STATE.BUFFERING

    if (sameVideo && resumable) {
      instance.playVideo()
      emit((events) => events.onCommand?.('playVideo', video.videoId))
    } else {
      instance.loadVideoById(video.videoId)
      emit((events) => events.onCommand?.('loadVideoById', video.videoId))
    }
  }

  /**
   * Queues one request, dropping it if a newer one arrives before its turn.
   *
   * `current` is set at once rather than when the request reaches the player, so
   * "what is loaded" is answerable during the wait. The stage's remount-restore
   * branch asks exactly that, and a null answer there is what made it cue over a
   * play that was already on its way.
   */
  function enqueue(
    video: YouTubeVideoItem,
    mode: PlaybackStartMode,
    recover = false,
  ): Promise<void> {
    const token = (latestRequest += 1)
    current = video
    if (video.videoId !== loaded?.videoId) resetProgress()

    if (recover) {
      /**
       * A direct press does not wait behind an attempt that has stalled.
       *
       * The queue exists so two requests cannot interleave and leave the older
       * one's command last. A recovery is the one request that must not honour
       * it: the request in front of it is, by definition, the one that is not
       * coming back, and making the visitor wait out its bound is the same
       * unresponsive Play button in a slower disguise. Everything ahead is
       * invalidated by the token bump above, so nothing it might still do can
       * land after this.
       */
      queue = Promise.resolve()
    }

    const run = queue.then(async () => {
      if (token !== latestRequest) return
      if (!container) {
        // The surface has not mounted yet. Held rather than dropped: `attach()`
        // flushes it, which is the documented order — render the visible
        // surface, then wait for player readiness, then load.
        pending = { item: video, mode }
        return
      }
      await perform(video, mode, () => token === latestRequest, recover)
    })

    queue = run.catch(() => {})
    return run
  }

  return {
    attach(next) {
      container = next
      const request = pending
      pending = null

      /**
       * Nothing is built here on spec any more.
       *
       * This used to construct an empty player the moment a surface appeared for
       * a preparation that had been asked for early. That is the construction a
       * phone showed never becoming ready, and building it before there is a
       * video to build it around bought nothing the script preload does not
       * already buy. A player now appears when there is a video for it.
       */
      if (!request) return
      // Through the same queue, so the flushed request takes its place in the
      // same order as everything else. A failure here has no caller left to
      // reject: report it the way any other player failure is reported.
      void enqueue(request.item, request.mode).catch((error: unknown) => {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'YouTube could not play this video.'
        emit((events) => events.onError?.(message))
      })
    },

    detach() {
      stopProgress()
      playing = false
      player?.destroy()
      player = null
      // Bumped rather than merely cleared: a construction still in flight for
      // the container that has just gone away must not install itself into the
      // next one.
      invalidateCreation()
      creationState = 'idle'
      creationTimedOut = false
      container = null
      current = null
      loaded = null
      pending = null
      // Anything still queued was for a player that no longer exists.
      latestRequest += 1
      queue = Promise.resolve()
    },

    hasContainer: () => container !== null,

    async start(item, request) {
      await enqueue(requireYouTubeItem(item), request.mode, request.recover ?? false)
    },

    async prepare(item) {
      const video = requireYouTubeItem(item)
      // Recorded as the requested item without a command being issued, so the
      // stage's remount-restore branch can tell an in-flight start from an idle
      // engine and stays quiet rather than cueing over it.
      current = video
      // A different video is about to open: whatever position is on the rail
      // belongs to the one being left, and must not be shown against this one.
      if (video.videoId !== loaded?.videoId) resetProgress()
      if (player) return true

      /**
       * The script, and only the script.
       *
       * `prepareApi` is the existing loader in `iframe-adapter` — one script
       * loader in the codebase, no second one, and no Data API request of any
       * kind. A factory that does not offer it (a test double) simply has
       * nothing to preload, which is not a failure.
       */
      try {
        await factory.prepareApi?.()
        apiReady = true
        return true
      } catch {
        // A script that will not load is reported by the start that follows,
        // which has a caller to tell and a Play button to fall back to.
        return false
      }
    },

    isReady: () => player !== null,
    isApiReady: () => apiReady,

    describeCreation: () => ({
      state: creationState,
      generation: creationGeneration,
      timedOut: creationTimedOut,
    }),

    async whenReady(timeoutMs = PLAYER_READY_TIMEOUT_MS) {
      if (player) return true
      // Nothing is being built and nothing is queued: waiting would be waiting
      // for something nobody asked for.
      if (!creating && !pending && latestRequest === 0) return false

      return await new Promise<boolean>((resolve) => {
        let settled = false
        const finish = (ready: boolean) => {
          if (settled) return
          settled = true
          clearTimeout(cap)
          readyWaiters.delete(finish)
          resolve(ready)
        }
        // Notified the moment the player is assigned rather than polled for it.
        // A poll would answer up to its own interval late, and this wait sits
        // directly in front of the visitor's next song.
        readyWaiters.add(finish)
        const cap = setTimeout(() => finish(player !== null), timeoutMs)
      })
    },

    resume() {
      player?.playVideo()
    },

    pause() {
      playing = false
      stopProgress()
      player?.pauseVideo()
    },

    stop() {
      playing = false
      stopProgress()
      player?.stopVideo()
    },

    seek(seconds) {
      if (!player || !Number.isFinite(seconds)) return
      // Clamp against the player's own duration rather than the store's, so a
      // stale store value can never ask for a position the video does not have.
      const total = player.getDuration()
      const clamped = total > 0 ? Math.min(Math.max(seconds, 0), total) : Math.max(seconds, 0)
      player.seekTo(clamped, true)
      // Publish the new position at once. The 1s progress timer only runs while
      // the player is playing, so without this a seek on a *paused* video would
      // leave the rail showing the old position indefinitely.
      emit((events) => events.onTimeUpdate?.(player?.getCurrentTime() ?? clamped, total))
    },

    getCurrentItem: () => current,
    isPlaying: () => playing,

    describeIframe() {
      const iframe = player?.getIframe() ?? null
      if (!iframe) return null
      const allow = iframe.getAttribute('allow') ?? ''
      const box = iframe.getBoundingClientRect()
      return {
        allow,
        allowsAutoplay: allowsAutoplay(allow),
        width: Math.round(box.width),
        height: Math.round(box.height),
      }
    },

    subscribe(events) {
      listeners.add(events)
      return () => {
        listeners.delete(events)
      }
    },

    destroy() {
      stopProgress()
      listeners.clear()
      player?.destroy()
      player = null
      invalidateCreation()
      creationState = 'idle'
      creationTimedOut = false
      container = null
      current = null
      loaded = null
      pending = null
      playing = false
    },
  }
}

let engine: YouTubeEngine | null = null

/** Lazily created so importing this module never touches the DOM or network. */
export function getYouTubeEngine(): YouTubeEngine {
  engine ??= createYouTubeIframeEngine()
  return engine
}

/** Test seam, and the HMR teardown hook. */
export function setYouTubeEngine(next: YouTubeEngine | null): void {
  if (engine && engine !== next) engine.destroy()
  engine = next
}

/** True when a YouTube player exists at all — used to avoid pointless work. */
export function hasYouTubeEngine(): boolean {
  return engine !== null
}
