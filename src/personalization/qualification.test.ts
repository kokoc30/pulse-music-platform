import { describe, expect, it } from 'vitest'
import { EARLY_SKIP_SECONDS, QUALIFY_MIN_SECONDS } from './config'
import {
  completionRatioFor,
  isCompletion,
  isEarlySkip,
  isQualifiedListen,
  qualifyThresholdSeconds,
} from './qualification'

describe('the qualified-listen rule', () => {
  describe('threshold', () => {
    it('asks 30 seconds of a four-minute song', () => {
      expect(qualifyThresholdSeconds(240)).toBe(30)
    })

    it('asks a quarter of a one-minute song', () => {
      expect(qualifyThresholdSeconds(60)).toBe(15)
    })

    it('never asks less than the floor, however short the item', () => {
      expect(qualifyThresholdSeconds(20)).toBe(QUALIFY_MIN_SECONDS)
      expect(qualifyThresholdSeconds(8)).toBe(QUALIFY_MIN_SECONDS)
      expect(qualifyThresholdSeconds(1)).toBe(QUALIFY_MIN_SECONDS)
    })

    it('falls back to 30 seconds when the duration is unknown or nonsense', () => {
      expect(qualifyThresholdSeconds(undefined)).toBe(30)
      expect(qualifyThresholdSeconds(0)).toBe(30)
      expect(qualifyThresholdSeconds(-5)).toBe(30)
      expect(qualifyThresholdSeconds(Number.NaN)).toBe(30)
      expect(qualifyThresholdSeconds(Number.POSITIVE_INFINITY)).toBe(30)
    })

    it('never exceeds the 30-second ceiling for very long content', () => {
      expect(qualifyThresholdSeconds(3600)).toBe(30)
    })
  })

  describe('qualification', () => {
    it('qualifies a four-minute song at 30 seconds, not at 29', () => {
      expect(isQualifiedListen(29.9, 240)).toBe(false)
      expect(isQualifiedListen(30, 240)).toBe(true)
    })

    it('qualifies a one-minute song at 15 seconds', () => {
      expect(isQualifiedListen(14.9, 60)).toBe(false)
      expect(isQualifiedListen(15, 60)).toBe(true)
    })

    it('does not qualify a five-second accidental play', () => {
      expect(isQualifiedListen(5, 240)).toBe(false)
      expect(isQualifiedListen(5, 60)).toBe(false)
      expect(isQualifiedListen(5, undefined)).toBe(false)
    })

    it('does not qualify an eight-second play of any item', () => {
      expect(isQualifiedListen(8, 8)).toBe(false)
      expect(isQualifiedListen(8, 240)).toBe(false)
    })

    it('treats zero and negative listening time as no listen', () => {
      expect(isQualifiedListen(0, 240)).toBe(false)
      expect(isQualifiedListen(-10, 240)).toBe(false)
      expect(isQualifiedListen(Number.NaN, 240)).toBe(false)
    })
  })

  describe('early skip', () => {
    it('counts a play abandoned inside the early window', () => {
      expect(isEarlySkip(4, 240)).toBe(true)
      expect(isEarlySkip(EARLY_SKIP_SECONDS, 240)).toBe(true)
    })

    it('does not count a play abandoned after the window', () => {
      expect(isEarlySkip(EARLY_SKIP_SECONDS + 0.1, 240)).toBe(false)
      expect(isEarlySkip(120, 240)).toBe(false)
    })

    it('never counts a qualified listen as a skip', () => {
      // A 40-second track qualifies at 10s, which is also the skip window.
      expect(isQualifiedListen(10, 40)).toBe(true)
      expect(isEarlySkip(10, 40)).toBe(false)
    })

    it('ignores a play that never started', () => {
      expect(isEarlySkip(0, 240)).toBe(false)
    })
  })

  describe('completion', () => {
    it('measures the fraction heard, clamped to one', () => {
      expect(completionRatioFor(120, 240)).toBe(0.5)
      expect(completionRatioFor(300, 240)).toBe(1)
    })

    it('is zero when the duration is unknown', () => {
      expect(completionRatioFor(120, undefined)).toBe(0)
      expect(completionRatioFor(120, 0)).toBe(0)
    })

    it('treats 80% or more as a completion', () => {
      expect(isCompletion(191, 240)).toBe(false)
      expect(isCompletion(192, 240)).toBe(true)
    })
  })
})
