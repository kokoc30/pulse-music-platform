import { Home as HomeIcon, ListMusic, Menu } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useUiStore } from '@/app/ui-store'
import { BrandMark } from '@/components/navigation/BrandMark'
import { SearchBar } from '@/components/search/SearchBar'
import { SHELF_ANCHORS, SHELF_TITLES } from '@/features/discovery/shelves'
import { useDiscovery } from '@/features/discovery/useDiscovery'
import { playTrack } from '@/player/player-actions'

/**
 * The reference's `.site-header`.
 *
 * Geometry is unchanged. The reference's Premium / Support / Download links and
 * its Install-App / Sign-up / Log-in cluster describe accounts, subscriptions and
 * a desktop app that V1 explicitly does not have, so each slot carries a truthful
 * action of the same size instead (docs/reference-deviations.md D-04, D-05).
 */
export function SiteHeader() {
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen)
  const queueOpen = useUiStore((s) => s.queueOpen)
  const toggleQueue = useUiStore((s) => s.toggleQueue)
  const { trending } = useDiscovery()

  return (
    <header className="site-header">
      <button
        type="button"
        className="mobile-menu"
        aria-label="Open menu"
        aria-expanded={false}
        onClick={() => setMobileNavOpen(true)}
      >
        <Menu size={20} aria-hidden="true" />
      </button>

      <Link className="brand" to="/" aria-label="Pulse home">
        <BrandMark />
        <span className="visually-hidden">PULSE</span>
      </Link>

      <Link className="home-button" to="/" aria-label="Home">
        <HomeIcon size={21} fill="currentColor" aria-hidden="true" />
      </Link>

      <SearchBar />

      <nav className="utility-links" aria-label="Browse sections">
        <Link to={`/#${SHELF_ANCHORS.trending}`}>Trending</Link>
        <Link to={`/#${SHELF_ANCHORS.artists}`}>Artists</Link>
        <Link to={`/#${SHELF_ANCHORS.stations}`}>Stations</Link>
      </nav>

      <span className="nav-rule" />

      <button
        type="button"
        className="install-button"
        aria-pressed={queueOpen}
        aria-expanded={queueOpen}
        onClick={toggleQueue}
      >
        <ListMusic size={16} aria-hidden="true" /> Queue
      </button>

      <button
        type="button"
        className="login-button"
        aria-label="Play trending"
        disabled={!trending.length}
        onClick={() => {
          const first = trending[0]
          if (!first) return
          void playTrack(first, {
            queue: trending,
            index: 0,
            context: { id: 'shelf:trending', label: SHELF_TITLES.trending },
          })
        }}
      >
        {/* The label shortens below 830px so the pill keeps the reference's
            78px / 69px width and the search field keeps its measured size. */}
        <span className="label-wide">Play trending</span>
        <span className="label-narrow">Play</span>
      </button>
    </header>
  )
}
