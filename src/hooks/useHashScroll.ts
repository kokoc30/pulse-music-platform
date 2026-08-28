import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * React Router does not restore hash targets, and the header's section links
 * rely on them. Scrolling is deferred a frame so freshly-rendered shelves exist.
 */
export function useHashScroll(): void {
  const { hash, pathname } = useLocation()

  useEffect(() => {
    if (!hash) return
    const id = hash.slice(1)
    if (!id) return

    let frame = 0
    const attempt = (remaining: number) => {
      const target = document.getElementById(id)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      if (remaining > 0) frame = requestAnimationFrame(() => attempt(remaining - 1))
    }
    frame = requestAnimationFrame(() => attempt(30))
    return () => cancelAnimationFrame(frame)
  }, [hash, pathname])
}
