import { useEffect, useRef } from 'react'
import { Compass, Disc3, Flame, Heart, Home, Library, ListMusic, Radio, Search, Users, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useUiStore } from '@/app/ui-store'
import { SHELF_ANCHORS } from '@/features/discovery/shelves'
import { playUnderground } from '@/features/discovery/playShelf'
import { LIBRARY_ROUTES } from '@/library/library-actions'
import { AUDIUS_LINKS } from '@/lib/links'

/**
 * Production addition: below 830px the reference hides the sidebar entirely and
 * its `.mobile-menu` button has no handler at all, so nothing behind it is
 * reachable. This drawer gives that button the sidebar's content
 * (docs/reference-deviations.md D-11).
 */
export function MobileNavDrawer() {
  const open = useUiStore((s) => s.mobileNavOpen)
  const setOpen = useUiStore((s) => s.setMobileNavOpen)
  const focusSearch = useUiStore((s) => s.focusSearch)
  const setQueueOpen = useUiStore((s) => s.setQueueOpen)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  if (!open) return null

  const close = () => setOpen(false)

  return (
    <>
      <button
        type="button"
        className="mobile-nav-backdrop"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={close}
      />
      <nav className="mobile-nav" aria-label="Main menu">
        <div className="library-heading">
          <strong>Your Library</strong>
          <button ref={closeRef} type="button" onClick={close} aria-label="Close menu">
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <div className="mobile-nav-links">
          <Link to="/" onClick={close}>
            <Home size={18} aria-hidden="true" /> Home
          </Link>
          <button type="button" onClick={focusSearch}>
            <Search size={18} aria-hidden="true" /> Search
          </button>
          {/* Phase 7: the library reaches the same navigation the sidebar does,
              because below 830px the sidebar is hidden entirely and this drawer
              is the only way to anything (docs/reference-deviations.md D-11). */}
          <Link to={LIBRARY_ROUTES.library} onClick={close}>
            <Library size={18} aria-hidden="true" /> Your Library
          </Link>
          <Link to={LIBRARY_ROUTES.liked} onClick={close}>
            <Heart size={18} aria-hidden="true" /> Liked Songs
          </Link>
          <Link to={`/#${SHELF_ANCHORS.trending}`} onClick={close}>
            <Flame size={18} aria-hidden="true" /> Trending
          </Link>
          <Link to={`/#${SHELF_ANCHORS.artists}`} onClick={close}>
            <Users size={18} aria-hidden="true" /> Popular artists
          </Link>
          <Link to={`/#${SHELF_ANCHORS.month}`} onClick={close}>
            <Disc3 size={18} aria-hidden="true" /> Popular this month
          </Link>
          <Link to={`/#${SHELF_ANCHORS.stations}`} onClick={close}>
            <Radio size={18} aria-hidden="true" /> Stations
          </Link>
          <Link to={`/#${SHELF_ANCHORS.charts}`} onClick={close}>
            <Compass size={18} aria-hidden="true" /> Charts
          </Link>
          <button
            type="button"
            onClick={() => {
              close()
              setQueueOpen(true)
            }}
          >
            <ListMusic size={18} aria-hidden="true" /> Play queue
          </button>
        </div>

        <div className="side-card">
          <h3>Hear what is rising underground</h3>
          <p>Tracks gaining ground outside the mainstream</p>
          <button
            type="button"
            onClick={() => {
              close()
              void playUnderground()
            }}
          >
            Play underground
          </button>
        </div>

        <div className="sidebar-bottom">
          <div className="legal-links">
            <a href={AUDIUS_LINKS.app} target="_blank" rel="noopener noreferrer">
              Audius
            </a>
            <a href={AUDIUS_LINKS.docs} target="_blank" rel="noopener noreferrer">
              Developer docs
            </a>
            <a href={AUDIUS_LINKS.terms} target="_blank" rel="noopener noreferrer">
              Terms
            </a>
            <a href={AUDIUS_LINKS.privacy} target="_blank" rel="noopener noreferrer">
              Privacy
            </a>
          </div>
        </div>
      </nav>
    </>
  )
}
