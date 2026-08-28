/** Loading placeholder for a four-up shelf, using the reference's card geometry. */
export function ShelfSkeleton({ circular = false }: { circular?: boolean }) {
  return (
    <div className={circular ? 'artist-grid' : 'music-grid'} aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div className={circular ? 'artist-card' : 'media-card'} key={index}>
          <div
            className="skeleton skeleton-art"
            style={circular ? { borderRadius: '50%' } : undefined}
          />
          <div className="skeleton skeleton-line" style={{ width: '72%' }} />
          <div className="skeleton skeleton-line short" />
        </div>
      ))}
    </div>
  )
}
