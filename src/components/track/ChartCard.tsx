import type { ChartShelfItem } from '@/features/discovery/shelves'

interface ChartCardProps {
  chart: ChartShelfItem
  onPlay: () => void
  loading?: boolean
}

/** The reference's gradient `.chart-card`, pointed at real Audius chart queries. */
export function ChartCard({ chart, onPlay, loading = false }: ChartCardProps) {
  return (
    <article className="media-card chart-card">
      <button
        type="button"
        className={`chart-cover ${chart.className}`}
        onClick={onPlay}
        aria-label={`Play ${chart.titleLines.join(' ')} — ${chart.meta}`}
        aria-busy={loading}
      >
        <span className="mini-brand" aria-hidden="true">
          P
        </span>
        <strong>
          {chart.titleLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </strong>
        <em>{chart.eyebrow}</em>
        <small>↗ &nbsp; {chart.meta}</small>
      </button>
      <p>{chart.description}</p>
    </article>
  )
}
