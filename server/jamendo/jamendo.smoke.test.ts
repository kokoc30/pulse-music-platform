import { beforeAll, describe, expect, it } from 'vitest'
import { handleJamendoRequest } from './handler'
import { assertSmokeCredential } from './smoke-env'
import { normalizeJamendoLike } from './smoke-normalize'
import type { JamendoTrackPayload } from './sanitize'

/**
 * Optional real-provider smoke check (agents/18_PHASE2_TESTING_QA.md → "Live
 * Jamendo Smoke Test").
 *
 * It is NOT part of `pnpm test:run`. Run it deliberately:
 *
 *   JAMENDO_SMOKE=1 pnpm test:smoke
 *
 * The credential is read from the project's .env by vitest.smoke.config.ts, so
 * it does not need exporting by hand; an explicit shell value still wins.
 *
 * It exercises the *real* serverless handler against the live Jamendo API, so
 * it proves the endpoint, the parameters, the envelope handling and the
 * sanitization all still match what Jamendo actually serves today.
 *
 * It never downloads a whole track: the availability probe is a HEAD, falling
 * back to a one-byte ranged GET.
 */
const ENABLED = process.env.JAMENDO_SMOKE === '1'
const describeSmoke = ENABLED ? describe : describe.skip

describeSmoke('Jamendo real-provider smoke', () => {
  const env = { JAMENDO_CLIENT_ID: process.env.JAMENDO_CLIENT_ID }
  let results: JamendoTrackPayload[] = []

  beforeAll(() => assertSmokeCredential(process.env))

  async function search(query: string, limit = 5): Promise<Response> {
    return handleJamendoRequest(
      new Request(`https://pulse.local/api/jamendo?action=search&q=${encodeURIComponent(query)}&limit=${limit}`),
      { env },
    )
  }

  it('answers a live search through the real handler', async () => {
    const response = await search('piano')
    expect(response.status).toBe(200)

    const body = (await response.json()) as { provider: string; results: JamendoTrackPayload[] }
    expect(body.provider).toBe('jamendo')
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results.length).toBeGreaterThan(0)
    results = body.results
  })

  it('returns rows that normalize into the shared Track model', () => {
    expect(results.length).toBeGreaterThan(0)
    for (const payload of results) {
      const track = normalizeJamendoLike(payload)
      expect(track.id.startsWith('jamendo:')).toBe(true)
      expect(track.providerId.length).toBeGreaterThan(0)
      expect(track.title.length).toBeGreaterThan(0)
      expect(track.artistName.length).toBeGreaterThan(0)
      expect(track.durationSeconds).toBeGreaterThanOrEqual(0)
      expect(track.attributionRequired).toBe(true)
    }
  })

  it('gives at least one track a Jamendo source URL for the required backlink', () => {
    const withSource = results.filter((track) => track.sourceUrl)
    expect(withSource.length).toBeGreaterThan(0)
    for (const track of withSource) {
      expect(new URL(track.sourceUrl!).protocol).toBe('https:')
      expect(new URL(track.sourceUrl!).hostname).toMatch(/jamen/i)
    }
  })

  it('serves every audio URL over HTTPS and never as a download endpoint', () => {
    const playable = results.filter((track) => track.audioUrl)
    expect(playable.length).toBeGreaterThan(0)
    for (const track of playable) {
      expect(new URL(track.audioUrl!).protocol).toBe('https:')
      expect(track.audioUrl).not.toContain('/download/')
    }
  })

  it('never returns the credential or a download URL to the browser', async () => {
    const response = await search('piano')
    const text = await response.text()
    const clientId = process.env.JAMENDO_CLIENT_ID!.trim()
    expect(text).not.toContain(clientId)
    expect(text).not.toContain('client_id')
    expect(text).not.toContain('audiodownload')
  })

  it('preserves a non-Latin query end to end', async () => {
    // Jamendo may legitimately have no match; what matters is that the request
    // is accepted and the query survives intact rather than being mangled.
    const response = await search('пиано')
    expect(response.status).toBe(200)
    expect(((await response.json()) as { query: string }).query).toBe('пиано')
  })

  it('finds a streamable track whose audio host actually answers', async () => {
    const track = results.find((item) => item.audioUrl)
    expect(track).toBeDefined()

    // Availability only — a HEAD, or a single byte. Never the whole song.
    let status: number
    try {
      status = (await fetch(track!.audioUrl!, { method: 'HEAD' })).status
    } catch {
      // Some storage hosts reject HEAD outright; fall through to the ranged GET.
      status = 0
    }
    if (status === 0 || status >= 400) {
      const ranged = await fetch(track!.audioUrl!, { headers: { range: 'bytes=0-0' } })
      status = ranged.status
      // Release the socket without reading the body.
      await ranged.body?.cancel()
    }
    expect(status).toBeGreaterThanOrEqual(200)
    expect(status).toBeLessThan(400)
  })

  it('degrades to "unavailable" when the credential is removed', async () => {
    const response = await handleJamendoRequest(new Request('https://pulse.local/api/jamendo?q=piano'), {
      env: {},
    })
    expect(response.status).toBe(503)
  })
})
