interface TrackListSkeletonProps {
  rows?: number
}

/** Loading placeholder built on the reference's `.song-row` geometry. */
export function TrackListSkeleton({ rows = 6 }: TrackListSkeletonProps) {
  return (
    <div className="song-list" aria-hidden="true" data-testid="track-list-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span />
          <span className="skeleton skeleton-art" />
          <span className="skeleton-stack">
            <span className="skeleton skeleton-line" style={{ margin: 0, width: '46%' }} />
            <span className="skeleton skeleton-line short" />
          </span>
          <span />
        </div>
      ))}
    </div>
  )
}
