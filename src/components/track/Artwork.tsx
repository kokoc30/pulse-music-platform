import { useEffect, useMemo, useState } from 'react'
import { buildArtworkCandidates } from '@/music/normalize'
import type { Artwork as ArtworkModel } from '@/music/types'

/** 1x1 transparent GIF: keeps the element in the layout so the surrounding
 *  `--color-art-placeholder` background reads as the reference's empty tile. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

interface ArtworkProps {
  artwork: ArtworkModel
  size: 'small' | 'medium' | 'large'
  /** Reference markup uses decorative artwork with the title rendered beside it. */
  alt?: string
  loading?: 'lazy' | 'eager'
}

/**
 * Artwork with mirror failover. A dead or TLS-broken content node falls through
 * to the next mirror Audius published, then to a transparent pixel so the
 * reference's dark placeholder tile shows instead of a broken-image glyph.
 */
export function Artwork({ artwork, size, alt = '', loading = 'lazy' }: ArtworkProps) {
  const candidates = useMemo(() => buildArtworkCandidates(artwork, size), [artwork, size])
  const [attempt, setAttempt] = useState(0)

  useEffect(() => setAttempt(0), [candidates])

  const src = candidates[attempt] ?? BLANK

  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      draggable={false}
      onError={() => setAttempt((current) => (current < candidates.length ? current + 1 : current))}
    />
  )
}
