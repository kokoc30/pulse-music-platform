interface SectionHeaderProps {
  title: string
  actionLabel?: string
  onAction?: () => void
}

export function SectionHeader({ title, actionLabel = 'Show all', onAction }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
