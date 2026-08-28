import type { YouTubeErrorBody, YouTubeSearchBody } from './handler.js'

/**
 * Classification of the single live response the YouTube smoke suite makes.
 *
 * It exists because one root cause was producing five failures. When the daily
 * quota is exhausted the handler correctly answers 429, and every assertion
 * about the *contents* of a response then fails too — "expected Armenian query,
 * received undefined", "no duration enrichment", "no MadeForKids value" — none
 * of which is a real defect, and all of which bury the one line that matters.
 *
 * So the suite now asks two separate questions in order:
 *
 *   1. did the live API answer at all?  → one test, one explicit failure
 *   2. is the answer correct?           → only asked when there is an answer
 *
 * This module answers the first. It is pure and takes no network, so the
 * mapping from status to diagnosis is covered by ordinary deterministic tests
 * rather than by waiting for a real quota outage.
 *
 * Nothing here weakens the suite: a 200 still has to satisfy every original
 * assertion, and a blocked run still fails the command.
 */

/** Why the live call could not be validated. Never a reason to pass. */
export type SmokeBlockReason =
  /** HTTP 429 — the daily `search.list` allowance is spent. */
  | 'quota'
  /** 503 — the deployment has no key configured. */
  | 'unavailable'
  /** 502 / 504 — Google answered badly, or not in time. */
  | 'upstream'
  /** 4xx/5xx the handler classifies some other way. */
  | 'rejected'
  /** The request never completed: DNS, TLS, socket, abort. */
  | 'transport'
  /** HTTP 200, but the body is not the documented search envelope. */
  | 'malformed'

export type SmokeOutcome =
  | { kind: 'ok'; body: YouTubeSearchBody }
  | { kind: 'blocked'; reason: SmokeBlockReason; summary: string; detail: string }

/** The banner every blocked run prints, so the root cause is greppable. */
export const SMOKE_BLOCK_PREFIX = 'YouTube live smoke: BLOCKED'

const SUMMARIES: Record<SmokeBlockReason, string> = {
  quota: 'HTTP 429 daily quota exhausted',
  unavailable: 'HTTP 503 — no YOUTUBE_API_KEY on this deployment',
  upstream: 'YouTube answered badly or too slowly',
  rejected: 'the handler rejected the request',
  transport: 'the request never reached YouTube',
  malformed: 'HTTP 200 with a body that is not the search envelope',
}

const DETAILS: Record<SmokeBlockReason, string> = {
  quota:
    'The whole deployment shares 100 search.list calls a day. This is the documented ' +
    'quota model working, not a defect — the handler answered 429 and the app surfaces ' +
    'its quota message. Re-run after the quota resets (midnight Pacific).',
  unavailable:
    'The suite asked for a live run but the handler reports no credential. Check ' +
    'YOUTUBE_API_KEY in .env, or exported before the run.',
  upstream:
    'A genuine upstream fault: Google returned an error, or the request timed out. ' +
    'Worth re-running once before treating it as a regression.',
  rejected:
    'The handler refused the request before reaching YouTube. That is a defect in the ' +
    'request this suite builds, not an outage.',
  transport:
    'No HTTP response at all. Check network egress, DNS and TLS to googleapis.com.',
  malformed:
    'The status was 200 but the payload did not match YouTubeSearchBody. Either the ' +
    'handler or the sanitizer has regressed.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True when the payload is the documented success envelope. */
export function isSearchBody(value: unknown): value is YouTubeSearchBody {
  if (!isRecord(value)) return false
  return (
    value.provider === 'youtube' &&
    value.action === 'search' &&
    typeof value.query === 'string' &&
    typeof value.count === 'number' &&
    Array.isArray(value.results)
  )
}

function errorCodeOf(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const error = (value as Partial<YouTubeErrorBody>).error
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

function blocked(reason: SmokeBlockReason, extra = ''): SmokeOutcome {
  return {
    kind: 'blocked',
    reason,
    summary: SUMMARIES[reason],
    detail: extra ? `${DETAILS[reason]} ${extra}` : DETAILS[reason],
  }
}

export interface LiveResponseFacts {
  status: number
  /** Parsed JSON body, or `undefined` when the payload would not parse. */
  body: unknown
}

/**
 * Turns one live response into either a validated body or a single diagnosis.
 *
 * The status is trusted first and the error code second, so a handler that
 * changes its status mapping cannot quietly reclassify a quota outage as an
 * ordinary upstream error.
 */
export function classifyLiveResponse({ status, body }: LiveResponseFacts): SmokeOutcome {
  if (status === 200) {
    return isSearchBody(body) ? { kind: 'ok', body } : blocked('malformed')
  }

  const code = errorCodeOf(body)

  if (status === 429 || code === 'QUOTA') return blocked('quota')
  if (status === 503 || code === 'UNAVAILABLE') return blocked('unavailable')
  if (status === 502 || status === 504 || code === 'UPSTREAM' || code === 'TIMEOUT') {
    return blocked('upstream', `(HTTP ${status})`)
  }
  return blocked('rejected', `(HTTP ${status}${code ? `, ${code}` : ''})`)
}

/** The request threw rather than answering. */
export function blockedByTransport(error: unknown): SmokeOutcome {
  const message = error instanceof Error ? error.message : String(error)
  return blocked('transport', `(${message})`)
}

/**
 * The one line a blocked run should be read from.
 *
 * `liveRequests` is included deliberately: this suite is allowed exactly one
 * live search, and printing the count makes any accidental second request — a
 * retried hook, a duplicated call — visible in the failure itself rather than
 * only in a quota bill.
 */
export function describeBlock(outcome: SmokeOutcome, liveRequests: number): string {
  if (outcome.kind === 'ok') return ''
  return [
    `${SMOKE_BLOCK_PREFIX} — ${outcome.summary}`,
    '',
    outcome.detail,
    '',
    `Live search requests made by this suite: ${liveRequests} (expected exactly 1).`,
    'The remaining response-content checks are reported as skipped, not passed:',
    'there was no successful response for them to describe.',
  ].join('\n')
}
