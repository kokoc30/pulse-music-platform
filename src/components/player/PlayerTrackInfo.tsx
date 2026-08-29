import { useCallback } from 'react'
import { ChevronUp, ExternalLink } from 'lucide-react'
import { useUiStore } from '@/app/ui-store'
import { LikeButton } from '@/components/library/LikeButton'
import { Artwork } from '@/components/track/Artwork'
import { ProviderCredit } from '@/components/track/ProviderCredit'
import { trackRefFromTrack } from '@/library/track-ref'
import { providerLabel } from '@/music/provider-labels'
import type { Track } from '@/music/types'
import { isInteractiveTarget, useVerticalSwipe } from './swipe'

/**
 * The reference's `.player-track` cluster.
 *
 * The reference drew a "Like" heart here and V1 had nowhere to put the state, so
 * the slot carried the provider backlink instead (docs/reference-deviations.md
 * D-06). Phase 7 restores the heart, and it is the *same* component the search
 * rows and home cards use, reading the same store — the backlink stays, because
 * Jamendo's attribution requirement did not go away.
 *
 * The now-playing cluster is the one context every played track passes through,
 * which makes it the right home for Jamendo's required per-item backlink: while
 * a Jamendo track is loaded, its Jamendo page is always one click away
 * (agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md → "Track Attribution").
 */
export function PlayerTrackInfo({ track }: { track: Track }) {
  const label = providerLabel(track.provider)
  const setNowPlayingOpen = useUiStore((state) => state.setNowPlayingOpen)
  const open = useCallback(() => setNowPlayingOpen(true), [setNowPlayingOpen])

  /**
   * Swiping up on the info region opens Now Playing.
   *
   * `useVerticalSwipe` ignores a gesture that starts on a control, so the heart,
   * the provider backlink and the transport keep their own presses. A swipe is
   * additive: the chevron and a click on the text both do the same thing, which
   * is what keeps this reachable by keyboard and on a desktop.
   */
  const swipe = useVerticalSwipe({ onSwipeUp: open })

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
    <div className="player-track" {...swipe}>
      {/* A real button rather than a click handler on the row: the expansion has
          to be reachable by keyboard and announceable, and the row also contains
          a link and a heart that must keep their own activation. */}
      <button type="button" className="player-expand" onClick={open} aria-label="Open Now Playing">
        <ChevronUp size={16} aria-hidden="true" />
      </button>
      <Artwork artwork={track.artwork} size="small" loading="eager" />
      {/* Mouse convenience only, the same arrangement `TrackRow` uses: the
          keyboard and assistive-technology route is the real button above, so
          this handler is not the only way in and needs no key handling of its
          own. The guard keeps the provider backlink inside it clickable — it
          must open its own page, not the sheet. */}
      <div
        className="player-track-text"
        onClick={(event) => {
          if (isInteractiveTarget(event.target)) return
          open()
        }}
      >
        <b title={track.title}>{track.title}</b>
        <span title={track.artistName}>
          {track.artistName}
          <ProviderCredit track={track} variant="link" />
        </span>
      </div>
      <LikeButton
        itemKey={track.id}
        title={track.title}
        toRef={() => trackRefFromTrack(track)}
        variant="prominent"
        size={18}
      />
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
