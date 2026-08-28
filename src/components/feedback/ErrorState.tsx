import { AlertTriangle } from 'lucide-react'
import { EmptyState } from './EmptyState'

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <EmptyState
      variant="error"
      icon={<AlertTriangle size={32} aria-hidden="true" />}
      title={title}
      description={message}
      action={
        onRetry ? (
          <button type="button" className="retry-button" onClick={onRetry}>
            Try again
          </button>
        ) : undefined
      }
    />
  )
}
