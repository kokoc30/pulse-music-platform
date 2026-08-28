import { useCallback, useEffect, useRef, useState } from 'react'

interface RangeRailProps {
  /** 0..1 */
  value: number
  onChange: (ratio: number) => void
  /** Called once on pointer release, for commit-on-drop semantics. */
  onCommit?: (ratio: number) => void
  ariaLabel: string
  ariaValueText: string
  disabled?: boolean
  /** Keyboard arrow step as a ratio. */
  step?: number
}

/**
 * The reference draws progress and volume as a static `<div><i/></div>` bar.
 * This keeps that exact 4px visual and makes it a real slider: pointer drag,
 * click-to-seek, arrow/Home/End keys, and proper ARIA
 * (agents/07_PLAYER_BEHAVIOR.md → "Accessibility").
 */
export function RangeRail({
  value,
  onChange,
  onCommit,
  ariaLabel,
  ariaValueText,
  disabled = false,
  step = 0.05,
}: RangeRailProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const clamped = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1)

  const ratioFromClientX = useCallback((clientX: number): number => {
    const rail = railRef.current
    if (!rail) return 0
    const rect = rail.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
  }, [])

  useEffect(() => {
    if (!dragging) return

    const handleMove = (event: PointerEvent) => onChange(ratioFromClientX(event.clientX))
    const handleUp = (event: PointerEvent) => {
      setDragging(false)
      onCommit?.(ratioFromClientX(event.clientX))
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [dragging, onChange, onCommit, ratioFromClientX])

  const commit = (ratio: number) => {
    onChange(ratio)
    onCommit?.(ratio)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const keyed: Record<string, number> = {
      ArrowRight: clamped + step,
      ArrowUp: clamped + step,
      ArrowLeft: clamped - step,
      ArrowDown: clamped - step,
      PageUp: clamped + step * 2,
      PageDown: clamped - step * 2,
      Home: 0,
      End: 1,
    }
    const next = keyed[event.key]
    if (next === undefined) return
    event.preventDefault()
    commit(Math.min(Math.max(next, 0), 1))
  }

  return (
    <div
      ref={railRef}
      className="rail-hit"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuetext={ariaValueText}
      aria-disabled={disabled || undefined}
      data-dragging={dragging ? 'true' : 'false'}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return
        event.preventDefault()
        railRef.current?.focus()
        setDragging(true)
        onChange(ratioFromClientX(event.clientX))
      }}
    >
      <div>
        <i style={{ width: `${clamped * 100}%` }} />
      </div>
    </div>
  )
}
