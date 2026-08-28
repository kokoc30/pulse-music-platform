import { beforeAll, describe, expect, it } from 'vitest'
import type { TestContext } from 'vitest'
import { handleYouTubeRequest } from './handler.js'
import type { YouTubeVideoPayload } from './sanitize.js'
import { PAYLOAD_KEYS } from './sanitize.js'
import { assertYouTubeSmokeCredential } from './smoke-env.js'
import { blockedByTransport, classifyLiveResponse, describeBlock } from './smoke-outcome.js'
import type { SmokeOutcome } from './smoke-outcome.js'
import { RESULT_COUNT } from './upstream.js'

/**
 * Optional real-provider smoke check (agents/27_PHASE3_TESTING_QA.md → "Live
 * Smoke").
 *
 * It is NOT part of `pnpm test:run`. Run it deliberately:
 *
 *   YOUTUBE_SMOKE=1 pnpm test:smoke
 *
 * The key is read from the project's .env by vitest.smoke.config.ts, so it does
 * not need exporting by hand; an explicit shell value still wins.
 *
 * **This suite spends real quota, so it makes exactly ONE search.** The whole
 * project gets 100 `search.list` calls a day
 * (docs/youtube-policy-audit.md §1), so every assertion below runs against a
 * single shared response captured in `beforeAll`. Adding a second `search()`
 * call to this file would be a 1% dent in the day's allowance — and
 * `liveRequests` is printed on any failure so an accidental one is visible.
 *
 * It exercises the *real* serverless handler against the live YouTube Data API,
 * so it proves the endpoints, the parameters, the batching, the status fields
 * and the sanitization all still match what Google actually serves today.
 *
 * It never downloads media and never touches the player: metadata only.
 *
 * ## Two questions, in order
 *
 * The suite asks *did the live API answer?* before it asks *is the answer
 * correct?*, because one unanswered call used to produce five failures. A
 * quota-exhausted run reported "expected 200, received 429" and then, from the
 * same root cause, "expected Armenian query, received undefined", "no duration
 * enrichment", "no MadeForKids value" and "no parsed duration" — four
 * descriptions of an empty array, none of them a defect.
 *
 * Now the first test owns liveness and fails once, loudly, naming the cause;
 * the eleven content tests are **skipped**, because there is no response for
 * them to describe. Skipped, never passed: a blocked run is still a failed run
 * and the command still exits non-zero.
 *
 * Nothing is weakened. A 200 satisfies exactly the assertions it always did.
 */
const ENABLED = process.env.YOUTUBE_SMOKE === '1'
const describeSmoke = ENABLED ? describe : describe.skip

describeSmoke('YouTube real-provider smoke', () => {
  const env = { YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY }
  const apiKey = process.env.YOUTUBE_API_KEY ?? ''

  let response: Response | null = null
  let outcome: SmokeOutcome
  let raw = ''
  let results: YouTubeVideoPayload[] = []

  /**
   * Live searches this suite has actually issued.
   *
   * `vitest.smoke.config.ts` sets `retry: 1`, and a retry re-runs the *test*,
   * not `beforeAll` — so a failing assertion cannot cost a second search. This
   * counter is what proves that rather than assuming it: it is reported in the
   * blocked diagnostic, where a value other than 1 would be impossible to miss.
   */
  let liveRequests = 0

  beforeAll(async () => {
    // The one thing worth throwing for: asked for a live run, given no key.
    // Nothing has been requested at this point, so no quota is at stake.
    assertYouTubeSmokeCredential(process.env)

    // ONE live search for the whole suite. An Armenian-script query, so the
    // international path is what gets proved rather than an English one.
    liveRequests += 1
    try {
      response = await handleYouTubeRequest(
        new Request(
          `https://pulse.local/api/youtube?action=search&q=${encodeURIComponent('Սիրուշո')}`,
        ),
        { env },
      )
      raw = await response.clone().text()
      outcome = classifyLiveResponse({ status: response.status, body: parseJson(raw) })
    } catch (error) {
      // A transport failure is diagnosed like any other block rather than
      // thrown: throwing here would fail all twelve tests with one stack trace,
      // which is the cascade this suite exists to avoid.
      outcome = blockedByTransport(error)
    }

    if (outcome.kind === 'ok') results = outcome.body.results
  })

  /**
   * Gate for every content assertion.
   *
   * Returns the live results, or skips the test with the root cause attached.
   * `ctx.skip()` aborts, so nothing after it runs.
   */
  function liveResults(ctx: TestContext): YouTubeVideoPayload[] {
    if (outcome.kind !== 'ok') ctx.skip(`${outcome.summary} — see the liveness check above`)
    return results
  }

  /** The live `Response`, for the header and body-shape checks. */
  function liveResponse(ctx: TestContext): Response {
    if (outcome.kind !== 'ok') ctx.skip(`${outcome.summary} — see the liveness check above`)
    if (!response) ctx.skip('no live response was captured')
    return response
  }

  /* ------------------------------------------------------------------ */
  /* 1. Did the live API answer? One test, one failure, one root cause.  */
  /* ------------------------------------------------------------------ */

  it('answers a live search through the real handler', () => {
    if (outcome.kind !== 'ok') {
      // The single explicit diagnostic. Not an assertion diff, because
      // "expected 200, received 429" is the symptom and this is the cause.
      throw new Error(describeBlock(outcome, liveRequests))
    }

    const body = outcome.body
    expect(response?.status).toBe(200)
    expect(body.provider).toBe('youtube')
    expect(body.action).toBe('search')
    expect(body.count).toBe(results.length)
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(RESULT_COUNT)
    // The suite is allowed exactly one live search.
    expect(liveRequests).toBe(1)
  })

  /* ------------------------------------------------------------------ */
  /* 2. Is the answer correct? Only asked when there is an answer.       */
  /* ------------------------------------------------------------------ */

  it('preserves the Armenian query end to end', (ctx) => {
    liveResults(ctx)
    expect(outcome.kind === 'ok' && outcome.body.query).toBe('Սիրուշո')
  })

  it('returns real video identity: id, title, channel, thumbnail', (ctx) => {
    for (const video of liveResults(ctx)) {
      expect(video.videoId).toMatch(/^[A-Za-z0-9_-]{5,20}$/)
      expect(video.title.trim().length).toBeGreaterThan(0)
      expect(video.channelTitle.trim().length).toBeGreaterThan(0)
      expect(video.thumbnailUrl).toMatch(/^https:\/\//)
    }
  })

  it('carries the batched videos.list enrichment, not just search snippets', (ctx) => {
    const videos = liveResults(ctx)
    // `search.list` returns none of these three. Their presence is the proof
    // that the second, batched call ran and was parsed.
    expect(videos.some((video) => typeof video.durationSeconds === 'number')).toBe(true)
    expect(videos.every((video) => typeof video.embeddable === 'boolean')).toBe(true)
    expect(
      videos.every((video) => typeof video.madeForKids === 'boolean' || video.madeForKids === null),
    ).toBe(true)
  })

  it('reports embeddability, which the request already filtered for', (ctx) => {
    // `videoEmbeddable=true` is sent on the search, so live results should be
    // embeddable; the field is still read from `status` rather than assumed.
    expect(liveResults(ctx).every((video) => video.embeddable)).toBe(true)
  })

  it('knows the MadeForKids status of every result before anything is embedded', (ctx) => {
    const videos = liveResults(ctx)
    for (const video of videos) {
      expect(['boolean', 'object']).toContain(typeof video.madeForKids)
    }
    // At least one real value came back — a suite where every field were null
    // would pass the shape check while proving nothing.
    expect(videos.some((video) => typeof video.madeForKids === 'boolean')).toBe(true)
  })

  it('parses real ISO 8601 durations into plausible seconds', (ctx) => {
    const durations = liveResults(ctx)
      .map((video) => video.durationSeconds)
      .filter((seconds): seconds is number => typeof seconds === 'number')
    expect(durations.length).toBeGreaterThan(0)
    for (const seconds of durations) {
      expect(Number.isInteger(seconds)).toBe(true)
      expect(seconds).toBeGreaterThan(0)
      expect(seconds).toBeLessThanOrEqual(86_400)
    }
  })

  it('emits only the sanitized wire keys, with no Google extras', (ctx) => {
    for (const video of liveResults(ctx)) {
      for (const key of Object.keys(video)) {
        expect(PAYLOAD_KEYS).toContain(key)
      }
    }
    for (const forbidden of ['statistics', 'etag', 'player', 'embedHtml', 'topicDetails', 'kind']) {
      expect(raw).not.toContain(forbidden)
    }
  })

  it('decodes HTML entities rather than passing markup through', (ctx) => {
    for (const video of liveResults(ctx)) {
      expect(video.title).not.toMatch(/&(amp|quot|#39|lt|gt);/)
      expect(video.channelTitle).not.toMatch(/&(amp|quot|#39|lt|gt);/)
    }
  })

  it('never returns the API key, in any form', (ctx) => {
    liveResults(ctx)
    expect(apiKey.length).toBeGreaterThan(20)
    expect(raw).not.toContain(apiKey)
    expect(raw).not.toContain('key=')
    expect(raw).not.toContain('googleapis.com')
    expect(raw).not.toContain('AIza')
  })

  it('never returns a media URL of any kind', (ctx) => {
    // Metadata only. No stream, no download, no proxy — the player is
    // YouTube's own embed, loaded by the browser from YouTube.
    const videos = liveResults(ctx)
    expect(raw).not.toContain('googlevideo.com')
    expect(raw).not.toMatch(/\.(mp4|m4a|webm|mp3)/)
    for (const video of videos) {
      expect(video).not.toHaveProperty('audioUrl')
      expect(video).not.toHaveProperty('streamUrl')
    }
  })

  it('sets no CORS header and no cache on the live response', (ctx) => {
    const live = liveResponse(ctx)
    expect(live.headers.get('access-control-allow-origin')).toBeNull()
    expect(live.headers.get('cache-control')).toBe('no-store')
  })
})

/** A body that will not parse is a fact about the response, not a crash. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
