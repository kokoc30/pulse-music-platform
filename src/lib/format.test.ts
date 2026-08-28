import { describe, expect, it } from 'vitest'
import { formatCount, formatDuration, formatPercent, formatTimeAnnouncement } from './format'

describe('formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9)).toBe('0:09')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(184)).toBe('3:04')
    expect(formatDuration(3599)).toBe('59:59')
  })

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(36_000)).toBe('10:00:00')
  })

  it('truncates fractional seconds rather than rounding up', () => {
    expect(formatDuration(59.9)).toBe('0:59')
  })

  it('renders a placeholder for unusable input', () => {
    expect(formatDuration(Number.NaN)).toBe('--:--')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('--:--')
    expect(formatDuration(-1)).toBe('--:--')
    expect(formatDuration(undefined)).toBe('--:--')
    expect(formatDuration(null)).toBe('--:--')
  })
})

describe('formatCount', () => {
  it('compacts thousands and millions', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1_200)).toBe('1.2K')
    expect(formatCount(12_000)).toBe('12K')
    expect(formatCount(1_250_000)).toBe('1.3M')
    expect(formatCount(12_000_000)).toBe('12M')
  })

  it('is safe for missing or invalid values', () => {
    expect(formatCount(undefined)).toBe('0')
    expect(formatCount(-5)).toBe('0')
    expect(formatCount(Number.NaN)).toBe('0')
  })
})

describe('formatPercent', () => {
  it('clamps to 0-100', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.645)).toBe('65%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(-2)).toBe('0%')
    expect(formatPercent(9)).toBe('100%')
    expect(formatPercent(Number.NaN)).toBe('0%')
  })
})

describe('formatTimeAnnouncement', () => {
  it('reads as an accessible slider value', () => {
    expect(formatTimeAnnouncement(42, 184)).toBe('0:42 of 3:04')
  })
})
