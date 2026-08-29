import { usePlaybackSnapshot } from '@/player/use-playback-snapshot'
import { JoinStrip } from './JoinStrip'
import { NowPlayingSheet } from './NowPlayingSheet'
import { PlayerBar } from './PlayerBar'

/**
 * The reference's `.music-player`, or its `.join-strip` when nothing is loaded.
 *
 * Rendered once in the app shell, outside the router, so navigating never
 * remounts it (agents/07_PLAYER_BEHAVIOR.md → "Navigation Persistence"). The
 * same component is the desktop player and, via the reference's own <=560px
 * rules, the mobile mini-player.
 *
 * **One bar, one sheet, two engines.** The application still has two entirely
 * separate playback engines and keeps them that way — separate stores, separate
 * types, separate actions, arbitrated by `playback-coordinator`. What it no
 * longer has is two *presentations* of them. This component used to resolve the
 * active engine and then return one of two completely different subtrees, which
 * meant every affordance had to be built twice; seek, like and expand were built
 * once and so existed for audio only.
 *
 * Now it reads one snapshot and renders one bar. There is no engine branch here
 * beyond "is anything loaded at all", and none in `PlayerBar` either — it asks
 * the snapshot's capabilities instead. The embedded player is not mounted here:
 * it belongs to the expanded sheet and to nothing else.
 */
export function GlobalPlayer() {
  const snapshot = usePlaybackSnapshot()

  if (snapshot.engine === 'none') return <JoinStrip />

  return (
    <>
      <PlayerBar snapshot={snapshot} />
      <NowPlayingSheet snapshot={snapshot} />
    </>
  )
}
