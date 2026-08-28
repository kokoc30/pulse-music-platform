import { describe, expect, it } from 'vitest'
import {
  SMOKE_BLOCK_PREFIX,
  blockedByTransport,
  classifyLiveResponse,
  describeBlock,
  isSearchBody,
} from './smoke-outcome'

/**
 * Deterministic cover for the live smoke's triage.
 *
 * The point of putting this logic in its own module is that it can be tested
 * here — including the success path — instead of only being exercised when the
 * real quota happens to be available. These tests spend nothing and run in
 * `pnpm test:run`.
 */

const searchBody = {
  provider: 'youtube',
  action: 'search',
  query: 'Սիրուշո',
  count: 1,
  results: [{ videoId: 'abc', title: 'T', channelTitle: 'C' }],
}

const errorBody = (code: string) => ({ error: { code, message: 'user-safe copy' } })

describe('recognising the success envelope', () => {
  it('accepts the documented search body', () => {
    expect(isSearchBody(searchBody)).toBe(true)
  })

  it('rejects an error envelope, an array, and a non-object', () => {
    expect(isSearchBody(errorBody('QUOTA'))).toBe(false)
    expect(isSearchBody([searchBody])).toBe(false)
    expect(isSearchBody(null)).toBe(false)
    expect(isSearchBody('nope')).toBe(false)
  })

  it('rejects a body missing any documented field', () => {
    expect(isSearchBody({ ...searchBody, provider: 'jamendo' })).toBe(false)
    expect(isSearchBody({ ...searchBody, action: 'lookup' })).toBe(false)
    expect(isSearchBody({ ...searchBody, count: '1' })).toBe(false)
    expect(isSearchBody({ ...searchBody, results: undefined })).toBe(false)
    expect(isSearchBody({ ...searchBody, query: undefined })).toBe(false)
  })
})

describe('classifying a live response', () => {
  it('passes a real 200 through, so every content assertion still runs', () => {
    const outcome = classifyLiveResponse({ status: 200, body: searchBody })
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.body.query).toBe('Սիրուշո')
    expect(outcome.body.results).toHaveLength(1)
  })

  it('blocks a 200 whose body is not the search envelope', () => {
    const outcome = classifyLiveResponse({ status: 200, body: { unexpected: true } })
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'malformed' })
  })

  describe('quota exhaustion — the case this exists for', () => {
    it('is recognised from HTTP 429', () => {
      const outcome = classifyLiveResponse({ status: 429, body: errorBody('QUOTA') })
      expect(outcome).toMatchObject({ kind: 'blocked', reason: 'quota' })
    })

    it('is recognised from the QUOTA code even if the status ever moved', () => {
      const outcome = classifyLiveResponse({ status: 403, body: errorBody('QUOTA') })
      expect(outcome).toMatchObject({ kind: 'blocked', reason: 'quota' })
    })

    it('says exactly what happened, in one line', () => {
      const outcome = classifyLiveResponse({ status: 429, body: errorBody('QUOTA') })
      if (outcome.kind !== 'blocked') throw new Error('expected blocked')
      expect(outcome.summary).toBe('HTTP 429 daily quota exhausted')
    })

    it('is never mistaken for a pass', () => {
      expect(classifyLiveResponse({ status: 429, body: errorBody('QUOTA') }).kind).toBe('blocked')
    })
  })

  it('separates a missing credential from an outage', () => {
    expect(classifyLiveResponse({ status: 503, body: errorBody('UNAVAILABLE') })).toMatchObject({
      reason: 'unavailable',
    })
  })

  it('groups genuine upstream faults together', () => {
    expect(classifyLiveResponse({ status: 502, body: errorBody('UPSTREAM') })).toMatchObject({
      reason: 'upstream',
    })
    expect(classifyLiveResponse({ status: 504, body: errorBody('TIMEOUT') })).toMatchObject({
      reason: 'upstream',
    })
  })

  it('falls back to a rejection, naming the status', () => {
    const outcome = classifyLiveResponse({ status: 400, body: errorBody('BAD_REQUEST') })
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'rejected' })
    if (outcome.kind !== 'blocked') return
    expect(outcome.detail).toContain('400')
    expect(outcome.detail).toContain('BAD_REQUEST')
  })

  it('survives a body that would not parse', () => {
    expect(classifyLiveResponse({ status: 429, body: undefined })).toMatchObject({
      reason: 'quota',
    })
    expect(classifyLiveResponse({ status: 500, body: undefined }).kind).toBe('blocked')
  })

  it('reports a request that never completed', () => {
    const outcome = blockedByTransport(new Error('getaddrinfo ENOTFOUND'))
    expect(outcome).toMatchObject({ kind: 'blocked', reason: 'transport' })
    if (outcome.kind !== 'blocked') return
    expect(outcome.detail).toContain('ENOTFOUND')
  })
})

describe('the blocked diagnostic', () => {
  const outcome = classifyLiveResponse({ status: 429, body: errorBody('QUOTA') })

  it('leads with a greppable banner naming the root cause', () => {
    const text = describeBlock(outcome, 1)
    expect(text.startsWith(SMOKE_BLOCK_PREFIX)).toBe(true)
    expect(text).toContain('HTTP 429 daily quota exhausted')
  })

  it('states how many live requests were actually made', () => {
    expect(describeBlock(outcome, 1)).toContain('Live search requests made by this suite: 1')
    expect(describeBlock(outcome, 2)).toContain('Live search requests made by this suite: 2')
  })

  it('explains that the remaining checks are skipped rather than passed', () => {
    expect(describeBlock(outcome, 1)).toContain('skipped, not passed')
  })

  it('never leaks the credential or an upstream URL', () => {
    const text = describeBlock(outcome, 1)
    expect(text).not.toContain('AIza')
    expect(text).not.toContain('key=')
    expect(text).not.toContain('googleapis.com/youtube')
  })

  it('says nothing at all for a successful run', () => {
    expect(describeBlock({ kind: 'ok', body: searchBody as never }, 1)).toBe('')
  })
})
