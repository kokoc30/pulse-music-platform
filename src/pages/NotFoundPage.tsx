import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/feedback/EmptyState'

export function NotFoundPage() {
  return (
    <div className="browse-content">
      <EmptyState
        icon={<Compass size={32} aria-hidden="true" />}
        title="Page not found"
        description="That page does not exist. Head back to browse the catalogue."
        action={
          <Link className="retry-button" to="/" style={{ display: 'inline-block', lineHeight: '34px' }}>
            Back to home
          </Link>
        }
      />
    </div>
  )
}
