import { BookOpen, Github, Globe } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SHELF_ANCHORS } from '@/features/discovery/shelves'
import { AUDIUS_LINKS } from '@/lib/links'

/**
 * The reference's `.site-footer`.
 *
 * Column count, density and the circular social cluster are preserved. The
 * reference's Company / Communities / Pulse Plans columns describe a company, an
 * artist programme and paid tiers that do not exist, so the columns carry links
 * that work (docs/reference-deviations.md D-10).
 */
export function SiteFooter() {
  return (
    <footer className="site-footer" id="about">
      <div className="footer-links">
        <div>
          <h3>Pulse</h3>
          <Link to="/">Home</Link>
          <Link to={`/#${SHELF_ANCHORS.trending}`}>Trending</Link>
          <Link to={`/#${SHELF_ANCHORS.charts}`}>Charts</Link>
          {/* agents/26 asks for a lightweight, reachable privacy disclosure. */}
          <Link to="/privacy">Privacy</Link>
          {/* Phase 4: where local listening history can be cleared (STEP 16). */}
          <Link to="/settings">Settings</Link>
        </div>
        <div>
          <h3>Browse</h3>
          <Link to={`/#${SHELF_ANCHORS.artists}`}>Popular artists</Link>
          <Link to={`/#${SHELF_ANCHORS.month}`}>Popular this month</Link>
          <Link to={`/#${SHELF_ANCHORS.stations}`}>Radio stations</Link>
          <Link to="/search?q=electronic">Search electronic</Link>
          <Link to="/search?q=lofi">Search lo-fi</Link>
        </div>
        <div>
          <h3>Powered by Audius</h3>
          <a href={AUDIUS_LINKS.app} target="_blank" rel="noopener noreferrer">
            Audius
          </a>
          <a href={AUDIUS_LINKS.docs} target="_blank" rel="noopener noreferrer">
            Developer docs
          </a>
          <a href={AUDIUS_LINKS.source} target="_blank" rel="noopener noreferrer">
            Open source
          </a>
          <a href={AUDIUS_LINKS.terms} target="_blank" rel="noopener noreferrer">
            Terms of use
          </a>
        </div>
        <div>
          <h3>Stations</h3>
          <Link to="/search?q=house">House</Link>
          <Link to="/search?q=techno">Techno</Link>
          <Link to="/search?q=hip%20hop">Hip-Hop</Link>
          <Link to="/search?q=ambient">Ambient</Link>
          <Link to="/search?q=drum%20and%20bass">Drum and Bass</Link>
          <Link to="/search?q=deep%20house">Deep House</Link>
        </div>
        <div className="socials">
          <a href={AUDIUS_LINKS.app} target="_blank" rel="noopener noreferrer" aria-label="Audius">
            <Globe size={17} aria-hidden="true" />
          </a>
          <a
            href={AUDIUS_LINKS.docs}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Audius developer documentation"
          >
            <BookOpen size={17} aria-hidden="true" />
          </a>
          <a
            href={AUDIUS_LINKS.source}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Audius on GitHub"
          >
            <Github size={17} aria-hidden="true" />
          </a>
        </div>
      </div>
      <div className="copyright">
        © 2026 Pulse · Catalogue provided by Audius
      </div>
    </footer>
  )
}
