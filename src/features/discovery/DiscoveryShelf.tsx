import type { ReactNode } from 'react'
import { ErrorState } from '@/components/feedback/ErrorState'
import { SectionHeader } from '@/components/track/SectionHeader'

interface DiscoveryShelfProps {
  id: string
  title: string
  anchor: string
  status: 'loading' | 'ready'
  error?: string | undefined
  onRetry?: () => void
  onShowAll?: () => void
  skeleton: ReactNode
  children: ReactNode
  className?: string
  /**
   * One short line under the heading. Phase 4 uses it for the on-device
   * disclosure a personalized shelf needs — "Kept on this device only" — which
   * belongs beside the shelf it describes rather than buried in a policy page
   * (STEP 17).
   */
  description?: string
}

/**
 * One reference `.music-section`. A failed shelf shows an inline retry rather
 * than collapsing, so the rest of the page keeps working
 * (agents/01_PROJECT_CONTRACT.md → "Home / discovery").
 */
export function DiscoveryShelf({
  title,
  anchor,
  status,
  error,
  onRetry,
  onShowAll,
  skeleton,
  children,
  className,
  description,
}: DiscoveryShelfProps) {
  return (
    <section className={className ? `music-section ${className}` : 'music-section'} id={anchor}>
      <SectionHeader title={title} onAction={onShowAll} />
      {description ? <p className="section-note">{description}</p> : null}
      {status === 'loading' ? (
        skeleton
      ) : error ? (
        <div className="shelf-error" role="alert">
          <span>{error}</span>
          {onRetry ? (
            <button type="button" className="retry-button" onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
      ) : (
        children
      )}
    </section>
  )
}

/** Inline error used when a shelf loaded nothing but did not error. */
export function ShelfEmpty({ message }: { message: string }) {
  return <ErrorState title="Nothing here yet" message={message} />
}
