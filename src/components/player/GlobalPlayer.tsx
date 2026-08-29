import { useUiStore } from '@/app/ui-store'
import { YouTubeStageHost } from '@/components/youtube/YouTubeStageHost'
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
 * beyond "is anything loaded at all", and none in `PlayerBar` or
 * `NowPlayingSheet` either — they ask the snapshot's capabilities instead.
 *
 * The stage is mounted **here** rather than inside the bar or the sheet, and
 * that placement is load-bearing: re-parenting an `<iframe>` reloads it, so a
 * stage rendered by whichever surface happened to be open would restart the
 * video every time the sheet opened or closed. One element, never re-parented,
 * repositioned by an attribute (`YouTubeStageHost`).
 */
export function GlobalPlayer() {
  const snapshot = usePlaybackSnapshot()
  const nowPlayingOpen = useUiStore((state) => state.nowPlayingOpen)

  if (snapshot.engine === 'none') return <JoinStrip />

  return (
    <>
      {snapshot.stageItem ? (
        <YouTubeStageHost
          item={snapshot.stageItem}
          placement={nowPlayingOpen ? 'sheet' : 'bar'}
        />
      ) : null}
      <PlayerBar snapshot={snapshot} />
      <NowPlayingSheet snapshot={snapshot} />
    </>
  )
}
