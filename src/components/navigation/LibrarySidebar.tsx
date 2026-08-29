import { CirclePlus, Globe2, Heart, ListMusic } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useUiStore } from '@/app/ui-store'
import { SHELF_ANCHORS } from '@/features/discovery/shelves'
import { playUnderground } from '@/features/discovery/playShelf'
import { useLikedCount, usePlaylistSummaries } from '@/library/hooks'
import { LIBRARY_ROUTES } from '@/library/library-actions'
import { AUDIUS_LINKS } from '@/lib/links'

/**
 * The reference's `.shell-sidebar`.
 *
 * Its two cards advertised playlist creation and podcast following, neither of
 * which existed in V1, so they kept the `.side-card` geometry and offered real
 * actions instead (docs/reference-deviations.md D-03). Phase 7 makes the first
 * of those promises real: *Your Library* is now a destination rather than a
 * label, and the card above the shortcuts leads to it.
 *
 * The playlist list is capped at four entries. The sidebar is a shortcut, not a
 * second library page, and a hundred playlists must not push the legal links off
 * the bottom of the viewport.
 */
export const SIDEBAR_PLAYLIST_LIMIT = 4

export function LibrarySidebar() {
  const focusSearch = useUiStore((s) => s.focusSearch)
  const toggleQueue = useUiStore((s) => s.toggleQueue)
  const likedCount = useLikedCount()
  const playlists = usePlaylistSummaries('updated')

  return (
    <aside className="shell-sidebar" aria-label="Library controls">
      <div className="library-heading">
        <Link to={LIBRARY_ROUTES.library}>
          <strong>Your Library</strong>
        </Link>
        <button type="button" onClick={toggleQueue} aria-label="Open the play queue">
          <CirclePlus size={24} aria-hidden="true" />
        </button>
      </div>

      <nav className="sidebar-library" aria-label="Your library">
        <Link to={LIBRARY_ROUTES.liked} className="sidebar-library-row">
          <Heart size={16} aria-hidden="true" />
          <span>Liked Songs</span>
          <small>{likedCount}</small>
        </Link>
        {playlists.slice(0, SIDEBAR_PLAYLIST_LIMIT).map((summary) => (
          <Link
            key={summary.playlist.id}
            to={LIBRARY_ROUTES.playlist(summary.playlist.id)}
            className="sidebar-library-row"
          >
            <ListMusic size={16} aria-hidden="true" />
            <span title={summary.playlist.name}>{summary.playlist.name}</span>
            <small>{summary.trackCount}</small>
          </Link>
        ))}
        <Link to={LIBRARY_ROUTES.library} className="sidebar-library-all">
          {playlists.length > SIDEBAR_PLAYLIST_LIMIT ? 'See all playlists' : 'Open Your Library'}
        </Link>
      </nav>

      <div className="side-card">
        <h3>Start with a search</h3>
        <p>Any track or artist on Audius</p>
        <button type="button" onClick={focusSearch}>
          Search music
        </button>
      </div>

      <div className="side-card podcast-card">
        <h3>Hear what is rising underground</h3>
        <p>Tracks rising outside the mainstream</p>
        <button type="button" onClick={() => void playUnderground()}>
          Play underground
        </button>
      </div>

      <div className="sidebar-bottom">
        <div className="legal-links">
          <Link to={`/#${SHELF_ANCHORS.trending}`}>Trending</Link>
          <Link to={`/#${SHELF_ANCHORS.artists}`}>Popular artists</Link>
          <Link to={`/#${SHELF_ANCHORS.month}`}>This month</Link>
          <Link to={`/#${SHELF_ANCHORS.stations}`}>Stations</Link>
          <Link to={`/#${SHELF_ANCHORS.charts}`}>Charts</Link>
          {/* Phase 4: personalization controls, one click from anywhere. */}
          <Link to="/settings">Settings</Link>
          <a href={AUDIUS_LINKS.terms} target="_blank" rel="noopener noreferrer">
            Terms
          </a>
          <a href={AUDIUS_LINKS.privacy} target="_blank" rel="noopener noreferrer">
            Privacy
          </a>
          <a href={AUDIUS_LINKS.docs} target="_blank" rel="noopener noreferrer">
            Developer docs
          </a>
          <a href={AUDIUS_LINKS.app} target="_blank" rel="noopener noreferrer">
            Powered by Audius <i>✓</i>
          </a>
        </div>
        <a className="language-button" href={AUDIUS_LINKS.app} target="_blank" rel="noopener noreferrer">
          <Globe2 size={17} aria-hidden="true" /> Open Audius
        </a>
      </div>
    </aside>
  )
}
