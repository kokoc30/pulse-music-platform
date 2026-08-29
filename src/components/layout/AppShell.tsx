import { Outlet } from 'react-router-dom'
import { NoticeToast } from '@/components/feedback/NoticeToast'
import { LibrarySidebar } from '@/components/navigation/LibrarySidebar'
import { MobileNavDrawer } from '@/components/navigation/MobileNavDrawer'
import { GlobalPlayer } from '@/components/player/GlobalPlayer'
import { QueuePanel } from '@/components/queue/QueuePanel'
import { LibraryHost } from '@/features/library/LibraryHost'
import { PersonalizationHost } from '@/features/personalization/PersonalizationHost'
import { MediaSessionHost } from '@/features/playback/MediaSessionHost'
import { PlayerEngineHost } from '@/features/playback/PlayerEngineHost'
import { useHashScroll } from '@/hooks/useHashScroll'
import { RightRail } from './RightRail'
import { SiteHeader } from './SiteHeader'

/**
 * The reference's `.pulse-app` frame.
 *
 * Only `<Outlet/>` changes between routes. Header, sidebar, rail, player, queue
 * and the audio engine all live above the router, so navigation can never reset
 * playback (agents/07_PLAYER_BEHAVIOR.md → "Navigation Persistence").
 */
export function AppShell() {
  useHashScroll()

  return (
    <div className="pulse-app">
      {/* Beside the audio engine and for the same reason: a listen in progress
          must survive SPA navigation. Renders nothing, and records nothing at
          all unless personalization is switched on for this browser.

          Mounted *above* `PlayerEngineHost` deliberately. Effects run in child
          order, so this subscribes to the engine first and therefore sees
          `ended` before `PlayerEngineHost` handles it by advancing the queue.
          The other order loses every completion: the queue would move to the
          next track, the store subscription would finalize the finished listen
          as merely "replaced", and the `ended` event would arrive after the
          session it describes had already closed. */}
      <PersonalizationHost />
      {/* Your Library: hydration, the YouTube retention sweep, and the one link
          between explicit saves and the preference profile. Renders nothing,
          and lives above the router so a like survives navigation. */}
      <LibraryHost />
      <PlayerEngineHost />
      {/* OS media controls for the audio engine only. Cleared whenever YouTube
          claims playback, so no lock-screen button can reach a hidden video. */}
      <MediaSessionHost />
      <SiteHeader />

      <div className="app-frame" id="top">
        <LibrarySidebar />
        <main className="browse-surface">
          <Outlet />
        </main>
        <RightRail />
      </div>

      <MobileNavDrawer />
      <QueuePanel />
      <NoticeToast />
      {/* One player for all three providers — bar, expanded sheet, and the
          embedded YouTube stage when a video holds the engine. Above the
          router, like the audio engine: a YouTube embed must stay visible while
          it plays, so navigation may not unmount it (agents/25 → "Visible
          Player Surface"). */}
      <GlobalPlayer />
    </div>
  )
}
