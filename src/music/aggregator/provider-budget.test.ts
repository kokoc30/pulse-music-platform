import { describe, expect, it } from 'vitest'
import { expandQuery } from '@/music/search/expand'
import { STRONG_RELEVANCE } from '@/music/search/relevance'
import { MAX_JAMENDO_REQUESTS, selectJamendoFallback, shouldSpendJamendoFallback } from './provider-budget'

describe('Jamendo request budget', () => {
  it('caps Jamendo at two round-trips per search', () => {
    expect(MAX_JAMENDO_REQUESTS).toBe(2)
  })

  it('prefers a variant in a different script, which reaches a disjoint index', () => {
    const variants = expandQuery('kassandra')
    const fallback = selectJamendoFallback(variants)
    // The curated alias set bridges Latin and Cyrillic spellings of this title.
    expect(fallback).not.toBeNull()
    expect(fallback?.query).not.toBe(variants[0]?.query)
  })

  it('never picks a variant that is the same string once normalized', () => {
    const variants = [
      { query: 'sara al swas', source: 'original' as const },
      { query: 'Sara  Al  Swas', source: 'phrase-alias' as const },
    ]
    expect(selectJamendoFallback(variants)).toBeNull()
  })

  it('does not spend a request on a purely structural re-spacing', () => {
    const variants = [
      { query: 'sara al swas', source: 'original' as const },
      { query: 'sara alswas', source: 'particle' as const },
    ]
    // A particle join is a same-script rewrite the provider's own index already
    // handles; it does not earn a second network call.
    expect(selectJamendoFallback(variants)).toBeNull()
  })

  it('has no fallback for a query with no variants at all', () => {
    expect(selectJamendoFallback([])).toBeNull()
    expect(selectJamendoFallback(expandQuery('reverie'))).toBeNull()
  })
})

describe('when the fallback request is justified', () => {
  const base = { status: 'success' as const, strongThreshold: STRONG_RELEVANCE, hasFallbackVariant: true }

  it('spends it only when the first Jamendo answer was weak', () => {
    expect(shouldSpendJamendoFallback({ ...base, bestJamendoScore: 0.2 })).toBe(true)
    expect(shouldSpendJamendoFallback({ ...base, bestJamendoScore: 0.99 })).toBe(false)
  })

  it('never retries a provider that is down or unconfigured', () => {
    expect(shouldSpendJamendoFallback({ ...base, status: 'error', bestJamendoScore: 0 })).toBe(false)
    expect(shouldSpendJamendoFallback({ ...base, status: 'unavailable', bestJamendoScore: 0 })).toBe(false)
  })

  it('never spends a request when there is no meaningful variant to spend it on', () => {
    expect(shouldSpendJamendoFallback({ ...base, bestJamendoScore: 0, hasFallbackVariant: false })).toBe(false)
  })
})
