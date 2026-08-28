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

/** `1_234_567` → `1.2M`, matching the compact metadata density of the design. */
export function formatCount(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return String(Math.floor(value))
}

export function formatPercent(ratio: number): string {
  const clamped = Math.min(Math.max(Number.isFinite(ratio) ? ratio : 0, 0), 1)
  return `${Math.round(clamped * 100)}%`
}

/** Screen-reader value for the progress slider. */
export function formatTimeAnnouncement(currentTime: number, duration: number): string {
  return `${formatDuration(currentTime)} of ${formatDuration(duration)}`
}
