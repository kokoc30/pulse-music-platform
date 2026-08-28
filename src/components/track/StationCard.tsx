import type { Track } from '@/music/types'
import type { StationShelfItem } from '@/features/discovery/shelves'
import { Artwork } from './Artwork'

interface StationCardProps {
  station: StationShelfItem
  tracks: Track[]
  onPlay: () => void
}

/**
 * The reference's tinted `.station-card`. A station is a real genre queue from
 * Audius, so the subtitle names the artists actually in it.
 */
export function StationCard({ station, tracks, onPlay }: StationCardProps) {
  const cover = tracks[0]
  const artists = tracks
    .slice(0, 3)
    .map((track) => track.artistName)
    .filter((name, index, all) => all.indexOf(name) === index)
  const subtitle = artists.length ? `With ${artists.join(', ')}…` : `${station.label} on Audius`

  return (
    <article className="media-card station-card">
      <button
        type="button"
        className={`station-cover ${station.tone}`}
        onClick={onPlay}
        disabled={!tracks.length}
        aria-label={`Play the ${station.label} station`}
      >
        {cover ? <Artwork artwork={cover.artwork} size="medium" /> : null}
        <span className="mini-brand" aria-hidden="true">
          P
        </span>
        <b aria-hidden="true">RADIO</b>
        <strong>{station.label}</strong>
      </button>
      <h3 title={subtitle}>{subtitle}</h3>
      <p>{subtitle}</p>
    </article>
  )
}
