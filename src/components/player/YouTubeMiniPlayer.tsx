import { useEffect, useState } from 'react'
import { ExternalLink, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useUiStore } from '@/app/ui-store'
import { LikeButton } from '@/components/library/LikeButton'
import { YouTubeThumbnail } from '@/components/youtube/YouTubeThumbnail'
import { formatDuration } from '@/lib/format'
import { trackRefFromYouTube } from '@/library/track-ref'
import type { YouTubeVideoItem } from '@/music/types'
import {
  hasYouTubeSessionStep,
  playYouTubeSessionStep,
  toggleYouTubePlayback,
} from '@/player/youtube-actions'
import { useYouTubeStore } from '@/player/youtube-store'

/**
 * The bottom bar, while YouTube owns playback.
 *
 * It answers one reported bug precisely. Starting a YouTube video left the bar
 * announcing the Audius track from before — because `GlobalPlayer` read the
 * audio store and only the audio store, while `activateYouTube` deliberately
 * *keeps* that track loaded so it can be resumed. Two surfaces then disagreed
 * about what "now playing" meant. The audio state was never the problem and is
 * not touched here; the bar simply asks the coordinator whose turn it is and
 * renders that engine.
 *
 * **Nothing here drives the audio engine.** Every control calls a YouTube
 * action: no `togglePlay`, no `playNext`, no `seek`, no queue movement. The
 * audio queue, position and track sit untouched underneath, which is what makes
 * closing the video return to a paused Audius track rather than to nothing.
 *
 * **The official player stays the authority.** This is supplemental UI beside
 * it, never over it: the time readout is informational, there is no scrubber —
 * seeking belongs to YouTube's own controls — and tapping the bar points at the
 * visible player rather than opening a second view of it. Nothing here creates
 * an iframe, hides one, or covers native YouTube UI (agents/25;
 * docs/youtube-policy-audit.md).
 */
export function YouTubeMiniPlayer({ item }: { item: YouTubeVideoItem }) {
  const status = useYouTubeStore((state) => state.status)
  const sessionItems = useYouTubeStore((state) => state.sessionItems)
  const sessionIndex = useYouTubeStore((state) => state.sessionIndex)
  const focusVideo = useUiStore((state) => state.focusVideo)

  const playing = status === 'playing'
  const busy = status === 'loading'

  /**
   * Whether stepping is possible, recomputed only when the session moves.
   *
   * `hasYouTubeSessionStep` walks the list applying the same embeddability rule
   * the rows and the player use, so a made-for-kids or embedding-disabled result
   * is skipped by exactly the rule that made it unplayable. A standalone video —
   * one opened from Recently Played or the library — has no session, so both
   * controls are correctly disabled rather than pretending to lead somewhere.
   */
  const [steps, setSteps] = useState({ next: false, previous: false })
  useEffect(() => {
    setSteps({ next: hasYouTubeSessionStep(1), previous: hasYouTubeSessionStep(-1) })
  }, [sessionItems, sessionIndex])

  return (
    <section className="music-player yt-mini" aria-label="Now playing" data-engine="youtube">
      <div className="player-track">
        {/* Mouse convenience, matching the audio bar: the real, announceable
            route to the player is the button in the controls below. */}
        <div
          className="player-track-text yt-mini-text"
          onClick={focusVideo}
          data-testid="youtube-mini-item"
        >
          <b title={item.title}>{item.title}</b>
          <span title={item.channelTitle}>
            {item.channelTitle}
            <span className="yt-mini-source"> · YouTube</span>
          </span>
        </div>

        {/* The same heart the result rows, the audio bar and every library row
            render, reading the same store — so a video liked from a search row
            is already liked here, with no second copy of the state. The saved
            reference is the temporary, metadata-only YouTube record
            (agents/44; src/library/youtube-policy.ts), not a YouTube account
            action: Pulse has no YouTube OAuth and the label says so. */}
        <LikeButton
          itemKey={item.id}
          title={item.title}
          toRef={() => trackRefFromYouTube(item)}
          variant="prominent"
          size={18}
        />

        {/* The watch-page backlink, in the slot the audio bar gives the
            provider link. Required Minimum Functionality asks for a real link
            to the video, and `noreferrer` is deliberately absent because the
            same rules forbid suppressing the referrer. */}
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener"
          aria-label={`Watch ${item.title} on YouTube`}
        >
          <ExternalLink size={18} aria-hidden="true" />
        </a>
      </div>

      <div className="player-controls">
        <div>
          <button
            type="button"
            onClick={() => void playYouTubeSessionStep(-1)}
            disabled={!steps.previous}
            aria-label="Previous YouTube result"
          >
            <SkipBack size={18} fill="currentColor" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="round-play"
            onClick={() => toggleYouTubePlayback()}
            disabled={busy}
            aria-label={playing ? 'Pause the YouTube video' : 'Play the YouTube video'}
          >
            {playing ? (
              <Pause size={19} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={19} fill="currentColor" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void playYouTubeSessionStep(1)}
            disabled={!steps.next}
            aria-label="Next YouTube result"
          >
            <SkipForward size={18} fill="currentColor" aria-hidden="true" />
          </button>
        </div>
        <YouTubeMiniProgress fallbackDuration={item.durationSeconds ?? 0} />
      </div>

      <div className="yt-mini-art">
        <button type="button" onClick={focusVideo} aria-label="Show the YouTube player">
          <YouTubeThumbnail item={item} width={64} />
        </button>
      </div>
    </section>
  )
}

/**
 * The one part that changes on every progress tick, and therefore the only part
 * that re-renders on one.
 *
 * Split out for exactly that reason: the title, the channel and the transport
 * change when the *item* changes, which is rare, while this changes several
 * times a second (agents/03_ARCHITECTURE.md → "Performance").
 *
 * Informational only — there is no thumb and no drag. Scrubbing a YouTube video
 * is done in the player's own controls, which is where a visitor already expects
 * it and where the policy expects it to stay.
 */
function YouTubeMiniProgress({ fallbackDuration }: { fallbackDuration: number }) {
  const currentTime = useYouTubeStore((state) => state.currentTime)
  const duration = useYouTubeStore((state) => state.duration)
  const total = duration || fallbackDuration || 0
  const ratio = total > 0 ? Math.min((currentTime / total) * 100, 100) : 0

  return (
    <div className="player-progress yt-mini-progress">
      <span>{formatDuration(currentTime)}</span>
      <div className="yt-mini-rail" aria-hidden="true">
        <i style={{ width: `${ratio}%` }} />
      </div>
      <span>{formatDuration(total)}</span>
    </div>
  )
}
