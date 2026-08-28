import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
  variant?: 'empty' | 'error'
}

/** The reference's `.empty-results` block, reused for both empty and error. */
export function EmptyState({ icon, title, description, action, variant = 'empty' }: EmptyStateProps) {
  return (
    <div
      className={variant === 'error' ? 'empty-results is-error' : 'empty-results'}
      role={variant === 'error' ? 'alert' : undefined}
    >
      {icon}
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}
