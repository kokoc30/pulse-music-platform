import { providerLabel } from '@/music/provider-labels'
import type { Track } from '@/music/types'

/**
 * Source attribution for provider catalogues that require it.
 *
 * Jamendo's API terms require an application to credit the artist, credit
 * Jamendo as the provider, and link each item back to its own Jamendo page
 * (agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md). Audius asks for none of that,
 * so an Audius track renders nothing here and the reference layout is untouched.
 *
 * **`link` is the default and the compliant variant**, and every surface that
 * renders an individual Jamendo track uses it: search rows, the top result,
 * queue rows, cards and the now-playing cluster. The terms require a backlink
 * from *each* displayed content item, not from a representative few.
 *
 * `text` remains only for a surface that genuinely cannot host an anchor. No
 * such surface exists today — `.song-row` was the one blocker and was
 * restructured so it no longer is (see `TrackRow`). It is kept because the
 * fallback below still needs it: a Jamendo track whose provider gave no
 * `sourceUrl` has nothing to link to, and must still credit its source.
 */

interface ProviderCreditProps {
  track: Track
  /** Defaults to `link`: a credit without its backlink is the non-compliant case. */
  variant?: 'text' | 'link'
}

export function ProviderCredit({ track, variant = 'link' }: ProviderCreditProps) {
  if (!track.attributionRequired) return null

  const label = providerLabel(track.provider)

  if (variant === 'link' && track.sourceUrl) {
    return (
      <span className="provider-credit">
        <span aria-hidden="true">·</span>{' '}
        <a
          className="provider-credit-link"
          href={track.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          // Stops the backlink from also triggering the card's play action.
          onClick={(event) => event.stopPropagation()}
          aria-label={`View “${track.title}” on ${label}`}
        >
          {label}
        </a>
      </span>
    )
  }

  return (
    <span className="provider-credit">
      <span aria-hidden="true">·</span> <span>{label}</span>
    </span>
  )
}
