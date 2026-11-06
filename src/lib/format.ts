/**
 * Formats seconds as the reference's `m:ss` (or `h:mm:ss` past an hour).
 * Anything invalid renders the reference's neutral placeholder rather than NaN.
 */
export function formatDuration(totalSeconds: number | undefined | null): string {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '--:--'
  }
  const seconds = Math.floor(totalSeconds % 60)
  const minutes = Math.floor((totalSeconds / 60) % 60)
  const hours = Math.floor(totalSeconds / 3600)
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/**
 * `1_234_567` → `1.2M`, matching the compact metadata density of the design.
 * Values just below a unit boundary are rounded first and then re-scaled, so
 * `999_999` reads `1.0M` (not `1000K`) and `9_999` reads `10K` (not `10.0K`).
 */
export function formatCount(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '0'
  if (value >= 1_000_000) return compactUnit(value / 1_000_000, 'M')
  if (value >= 1_000) {
    const thousands = value / 1_000
    // 999.5K and above round up to 1000K, which is really 1.0M.
    return Math.round(thousands) >= 1_000
      ? compactUnit(value / 1_000_000, 'M')
      : compactUnit(thousands, 'K')
  }
  return String(Math.floor(value))
}

/** One decimal below 10, none from 10 up — and never `10.0` (it becomes `10`). */
function compactUnit(scaled: number, suffix: 'K' | 'M'): string {
  const oneDecimal = scaled.toFixed(1)
  return `${Number(oneDecimal) >= 10 ? scaled.toFixed(0) : oneDecimal}${suffix}`
}

export function formatPercent(ratio: number): string {
  const clamped = Math.min(Math.max(Number.isFinite(ratio) ? ratio : 0, 0), 1)
  return `${Math.round(clamped * 100)}%`
}

/** Screen-reader value for the progress slider. */
export function formatTimeAnnouncement(currentTime: number, duration: number): string {
  return `${formatDuration(currentTime)} of ${formatDuration(duration)}`
}
