import { Loader2, Pause, Play } from 'lucide-react'

interface PlayActionProps {
  onClick: () => void
  label: string
  state?: 'idle' | 'loading' | 'playing'
  disabled?: boolean
}

/** The reference's `.card-play` floating button, with real playback states. */
export function PlayAction({ onClick, label, state = 'idle', disabled = false }: PlayActionProps) {
  const isActive = state !== 'idle'
  return (
    <button
      type="button"
      className="card-play"
      data-active={isActive ? 'true' : 'false'}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {state === 'loading' ? (
        <Loader2 size={18} className="spin" aria-hidden="true" />
      ) : state === 'playing' ? (
        <Pause size={18} fill="currentColor" aria-hidden="true" />
      ) : (
        <Play size={18} fill="currentColor" aria-hidden="true" />
      )}
    </button>
  )
}
