import { useCurrentTrack } from '@/player/player-selectors'
import { useActiveEngine } from '@/player/use-active-engine'
import { useYouTubeStore } from '@/player/youtube-store'
import { JoinStrip } from './JoinStrip'
import { NowPlayingSheet } from './NowPlayingSheet'
import { PlayerControls } from './PlayerControls'
import { PlayerTrackInfo } from './PlayerTrackInfo'
import { VolumeControl } from './VolumeControl'
import { YouTubeMiniPlayer } from './YouTubeMiniPlayer'

/**
 * The reference's `.music-player`, or its `.join-strip` when nothing is loaded.
 *
 * Rendered once in the app shell, outside the router, so navigating never
 * remounts it (agents/07_PLAYER_BEHAVIOR.md → "Navigation Persistence"). The
 * same component is the desktop player and, via the reference's own <=560px
 * rules, the mobile mini-player.
 *
 * **One bar, two engines.** The application has two entirely separate playback
 * engines and keeps them that way — separate stores, separate types, separate
 * actions, arbitrated by `playback-coordinator`. What it must not have is two
 * competing answers to "what is playing right now". So this component asks the
 * coordinator which engine holds the claim and renders that one; the *engines*
 * are not merged, only their presentation is.
 *
 * The order below matters and is deliberate:
 *
 * · **YouTube, while it owns playback.** Starting a video used to leave the bar
 *   announcing the Audius track from before, because `activateYouTube` keeps
 *   that track loaded on purpose so it can be resumed.
 * · **Audio otherwise** — including after the video surface is closed, which
 *   releases the claim and brings the preserved, paused track back with a Play
 *   button. Nothing restarts on its own; resuming stays the visitor's decision.
 * · **The join strip** when neither engine has anything.
 *
 * The expanded Now Playing sheet is mounted here rather than beside it, for the
 * same reason the bar is: it is another view of this player, and it has to
 * survive navigation exactly as the bar does. It is audio-only, and rendering it
 * inside this branch is what keeps it from ever appearing over a video.
 */
export function GlobalPlayer() {
  const engine = useActiveEngine()
  const currentTrack = useCurrentTrack()
  const youTubeItem = useYouTubeStore((state) => state.item)

  if (engine === 'youtube' && youTubeItem) return <YouTubeMiniPlayer item={youTubeItem} />

  if (!currentTrack) return <JoinStrip />

  return (
    <>
      <section className="music-player" aria-label="Now playing" data-engine="audio">
        <PlayerTrackInfo track={currentTrack} />
        <PlayerControls />
        <VolumeControl />
      </section>
      <NowPlayingSheet track={currentTrack} />
    </>
  )
}
