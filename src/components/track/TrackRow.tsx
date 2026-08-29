import { LikeButton } from '@/components/library/LikeButton'
import { TrackMenu } from '@/components/library/TrackMenu'
import { formatDuration } from '@/lib/format'
import { trackRefFromTrack } from '@/library/track-ref'
import { providerLabel } from '@/music/provider-labels'
import type { Track } from '@/music/types'
import { Artwork } from './Artwork'
import { Equalizer } from './Equalizer'
import { ProviderCredit } from './ProviderCredit'

interface TrackRowProps {
  track: Track
  index: number
  isCurrent: boolean
  isPlaying: boolean
  onPlay: () => void
  /** Queue rows keep the heart but drop the overflow menu, to fit the panel. */
  compact?: boolean
  /** Offered only on generated recommendation surfaces. */
  canHide?: boolean
}

/**
 * The reference's `.song-row`.
 *
 * **Why this is not one big `<button>`.** Jamendo's API terms require a direct
 * backlink from *each* displayed content item to its own Jamendo page
 * (agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md), and an `<a>` may not be nested
 * inside a `<button>`. A row that is itself a button therefore cannot carry the
 * link it is obliged to carry.
 *
 * So the row is a plain container with two real, separate controls:
 *
 * · `.song-row-action` — a genuine `<button>` stretched over the row. It is the
 *   keyboard and assistive-technology affordance, and it carries the row's
 *   accessible name ("Play <title> by <artist>").
 * · the source link — a genuine `<a>` inside the artist line, a *sibling* of
 *   that button rather than a descendant.
 *
 * The button is `pointer-events: none`, so the mouse falls through to the row
 * container's own click handler. That keeps three things the reference had:
 * clicking anywhere on the row plays it, the truncated `title` tooltips still
 * resolve, and the source link stays clickable. Geometry, grid and hover are
 * untouched — the button paints nothing.
 *
 * An Audius row renders exactly the same markup minus the credit, since
 * `ProviderCredit` returns `null` when a provider requires no attribution.
 */
export function TrackRow({
  track,
  index,
  isCurrent,
  isPlaying,
  onPlay,
  compact = false,
  canHide = false,
}: TrackRowProps) {
  const unavailable = !track.isStreamable
  // Provider-credited rows say so in their accessible name too, so a screen
  // reader hears the source without having to reach the backlink.
  const source = track.attributionRequired ? ` on ${providerLabel(track.provider)}` : ''
  const label = unavailable
    ? `${track.title} by ${track.artistName}${source} is not available to stream`
    : `Play ${track.title} by ${track.artistName}${source}`

  return (
    <div
      className="song-row"
      data-current={isCurrent ? 'true' : 'false'}
      data-streamable={unavailable ? 'false' : 'true'}
      aria-current={isCurrent ? 'true' : undefined}
      aria-disabled={unavailable ? 'true' : undefined}
      // Mouse convenience only: the whole row stays clickable exactly as before.
      // Keyboard and AT go through `.song-row-action`, so this is not the only
      // route to the action and needs no key handler of its own.
      onClick={unavailable ? undefined : onPlay}
    >
      <button
        type="button"
        className="song-row-action"
        disabled={unavailable}
        aria-label={label}
        onClick={onPlay}
      />
      <span className="song-index">
        {isCurrent ? <Equalizer paused={!isPlaying} /> : index + 1}
      </span>
      <Artwork artwork={track.artwork} size="small" />
      <span className="song-data">
        <b title={track.title}>{track.title}</b>
        {/* An unattributed row keeps the reference markup exactly as it was;
            only an attributed row takes the extra wrapper and the backlink. */}
        {track.attributionRequired ? (
          <small title={track.artistName} data-attributed="true">
            <span className="artist-name">{track.artistName}</span>
            <ProviderCredit track={track} variant="link" />
          </small>
        ) : (
          <small title={track.artistName}>{track.artistName}</small>
        )}
      </span>
      <span className="song-duration">
        {unavailable ? 'Gated' : formatDuration(track.durationSeconds)}
      </span>
      {/* The reference drew a decorative ⋯ glyph here. Phase 7 gives that slot
          the two real actions the design was always implying: the Pulse heart
          and the overflow menu. The queue panel is narrower, so it keeps the
          heart and drops the menu rather than crowding the row. */}
      <span className="song-row-actions">
        <LikeButton
          itemKey={track.id}
          title={track.title}
          toRef={() => trackRefFromTrack(track)}
        />
        {compact ? null : (
          <TrackMenu
            title={track.title}
            itemKey={track.id}
            toRef={() => trackRefFromTrack(track)}
            canHide={canHide}
            queueableTrack={track}
          />
        )}
      </span>
    </div>
  )
}
