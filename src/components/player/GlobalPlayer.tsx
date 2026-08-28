import { useCurrentTrack } from '@/player/player-selectors'
import { JoinStrip } from './JoinStrip'
import { PlayerControls } from './PlayerControls'
import { PlayerTrackInfo } from './PlayerTrackInfo'
import { VolumeControl } from './VolumeControl'

/**
 * The reference's `.music-player`, or its `.join-strip` when nothing is loaded.
 *
 * Rendered once in the app shell, outside the router, so navigating never
 * remounts it (agents/07_PLAYER_BEHAVIOR.md → "Navigation Persistence"). The
 * same component is the desktop player and, via the reference's own <=560px
 * rules, the mobile mini-player.
 */
export function GlobalPlayer() {
  const currentTrack = useCurrentTrack()

  if (!currentTrack) return <JoinStrip />

  return (
    <section className="music-player" aria-label="Now playing">
      <PlayerTrackInfo track={currentTrack} />
      <PlayerControls />
      <VolumeControl />
    </section>
  )
}
