import { Youtube } from 'lucide-react'

interface YouTubeFallbackActionProps {
  onRun: () => void
  loading: boolean
  /** `prompt` is the no-results call to action; `more` is the subtle one. */
  variant: 'prompt' | 'more'
  disabled?: boolean
}

/**
 * The only thing in the application that can spend a YouTube search.
 *
 * A real `<button>`, reached only by a deliberate press. There is no hover
 * prefetch, no focus prefetch and no "run it once the section scrolls into
 * view": one press, one search (agents/22 → "Quota Constraint").
 */
export function YouTubeFallbackAction({
  onRun,
  loading,
  variant,
  disabled = false,
}: YouTubeFallbackActionProps) {
  return (
    <button
      type="button"
      className={variant === 'prompt' ? 'yt-fallback-button' : 'yt-fallback-link'}
      onClick={onRun}
      disabled={disabled || loading}
      data-testid={variant === 'prompt' ? 'youtube-fallback' : 'youtube-fallback-more'}
    >
      <Youtube size={variant === 'prompt' ? 17 : 15} aria-hidden="true" />
      {loading
        ? 'Searching YouTube…'
        : variant === 'prompt'
          ? 'Search YouTube'
          : 'Search YouTube for more'}
    </button>
  )
}
