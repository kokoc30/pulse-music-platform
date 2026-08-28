import { CirclePlus, Globe2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useUiStore } from '@/app/ui-store'
import { SHELF_ANCHORS } from '@/features/discovery/shelves'
import { playUnderground } from '@/features/discovery/playShelf'
import { AUDIUS_LINKS } from '@/lib/links'

/**
 * The reference's `.shell-sidebar`.
 *
 * Its two cards advertise playlist creation and podcast following, both outside
 * V1 scope, so they keep the exact `.side-card` geometry and offer real actions
 * instead (docs/reference-deviations.md D-03).
 */
export function LibrarySidebar() {
  const focusSearch = useUiStore((s) => s.focusSearch)
  const toggleQueue = useUiStore((s) => s.toggleQueue)

  return (
    <aside className="shell-sidebar" aria-label="Library controls">
      <div className="library-heading">
        <strong>Your Library</strong>
        <button type="button" onClick={toggleQueue} aria-label="Open the play queue">
          <CirclePlus size={24} aria-hidden="true" />
        </button>
      </div>

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
