import { ExternalLink } from 'lucide-react'
import { Artwork } from '@/components/track/Artwork'
import { ProviderCredit } from '@/components/track/ProviderCredit'
import { providerLabel } from '@/music/provider-labels'
import type { Track } from '@/music/types'

/**
 * The reference's `.player-track` cluster. Its "Like" heart needs an account
 * store, which V1 does not have, so the slot carries the provider backlink
 * instead (docs/reference-deviations.md D-06).
 *
 * The now-playing cluster is the one context every played track passes through,
 * which makes it the right home for Jamendo's required per-item backlink: while
 * a Jamendo track is loaded, its Jamendo page is always one click away
 * (agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md → "Track Attribution").
 */
export function PlayerTrackInfo({ track }: { track: Track }) {
  const label = providerLabel(track.provider)

  // Below 560px the reference collapses the player to a mini-player and hides
  // `.player-track > a` outright. That is fine for the Audius convenience link,
  // but Jamendo's backlink is a licence obligation and may not disappear on a
  // phone (agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md; agents/18 → "mobile
  // attribution"). So an attributed track carries its backlink on the credit
  // itself, which lives in the always-visible artist line, and drops the icon
  // rather than linking to the same page twice.
  const attributed = Boolean(track.attributionRequired && track.sourceUrl)
  const iconLink = attributed ? undefined : track.permalink

  return (
    <div className="player-track">
      <Artwork artwork={track.artwork} size="small" loading="eager" />
      <div>
        <b title={track.title}>{track.title}</b>
        <span title={track.artistName}>
          {track.artistName}
          <ProviderCredit track={track} variant="link" />
        </span>
      </div>
      {iconLink ? (
        <a
          href={iconLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${track.title} on ${label}`}
        >
          <ExternalLink size={18} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  )
}
