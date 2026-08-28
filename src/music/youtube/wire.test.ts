import { describe, expect, it } from 'vitest'
import { WIRE_KEYS, parseYouTubeSearchPayload, parseYouTubeVideoPayload } from './wire'
import { youtubePayload, youtubeSearchResponse } from '@/test/fixtures/youtube'

describe('the YouTube wire contract', () => {
  it('mirrors the server payload key list exactly', () => {
    // Transcribed from `PAYLOAD_KEYS` in server/youtube/sanitize.ts rather than
    // imported: the client project does not compile the server tree, and the
    // two sides are meant to be independent. `server/youtube/sanitize.test.ts`
    // asserts the same list from its own side, so a field added on one side and
    // forgotten on the other fails a test rather than rendering `undefined`.
    expect([...WIRE_KEYS].sort()).toEqual(
      [
        'videoId',
        'title',
        'channelTitle',
        'channelId',
        'thumbnailUrl',
        'thumbnailWidth',
        'thumbnailHeight',
        'publishedAt',
        'durationSeconds',
        'embeddable',
        'madeForKids',
        'liveBroadcast',
      ].sort(),
    )
  })

  it('accepts a well-formed payload unchanged', () => {
    expect(parseYouTubeVideoPayload(youtubePayload())).toEqual(youtubePayload())
  })

  it('re-validates everything rather than trusting our own endpoint', () => {
    expect(parseYouTubeVideoPayload(null)).toBeNull()
    expect(parseYouTubeVideoPayload('nope')).toBeNull()
    expect(parseYouTubeVideoPayload(youtubePayload({ videoId: 'has spaces' }))).toBeNull()
    expect(parseYouTubeVideoPayload(youtubePayload({ videoId: '' }))).toBeNull()
    expect(parseYouTubeVideoPayload(youtubePayload({ title: '   ' }))).toBeNull()
  })

  it('refuses a thumbnail that is not https', () => {
    expect(
      parseYouTubeVideoPayload(youtubePayload({ thumbnailUrl: 'http://i.ytimg.com/x.jpg' })),
    ).toBeNull()
    expect(
      parseYouTubeVideoPayload(youtubePayload({ thumbnailUrl: 'javascript:alert(1)' })),
    ).toBeNull()
    expect(parseYouTubeVideoPayload(youtubePayload({ thumbnailUrl: '' }))).toBeNull()
  })

  it('never reads a missing or malformed embeddable flag as permission', () => {
    const raw = { ...youtubePayload() } as Record<string, unknown>
    delete raw.embeddable
    expect(parseYouTubeVideoPayload(raw)?.embeddable).toBe(false)
    expect(parseYouTubeVideoPayload({ ...raw, embeddable: 'true' })?.embeddable).toBe(false)
    expect(parseYouTubeVideoPayload({ ...raw, embeddable: 1 })?.embeddable).toBe(false)
  })

  it('keeps madeForKids a tri-state, with unknown distinct from false', () => {
    const raw = { ...youtubePayload() } as Record<string, unknown>
    delete raw.madeForKids
    expect(parseYouTubeVideoPayload(raw)?.madeForKids).toBeNull()
    expect(parseYouTubeVideoPayload({ ...raw, madeForKids: 'false' })?.madeForKids).toBeNull()
    expect(parseYouTubeVideoPayload({ ...raw, madeForKids: false })?.madeForKids).toBe(false)
    expect(parseYouTubeVideoPayload({ ...raw, madeForKids: true })?.madeForKids).toBe(true)
  })

  it('drops non-positive numeric fields instead of rendering them', () => {
    const parsed = parseYouTubeVideoPayload(
      youtubePayload({ durationSeconds: 0, thumbnailWidth: -5, thumbnailHeight: Number.NaN }),
    )
    expect(parsed).not.toHaveProperty('durationSeconds')
    expect(parsed).not.toHaveProperty('thumbnailWidth')
    expect(parsed).not.toHaveProperty('thumbnailHeight')
  })

  it('parses a whole search body and de-duplicates by video id', () => {
    const body = youtubeSearchResponse([youtubePayload(), youtubePayload(), youtubePayload({ videoId: 'bbbbbbbbbbb' })])
    expect(parseYouTubeSearchPayload(body).map((item) => item.videoId)).toEqual([
      'aaaaaaaaaaa',
      'bbbbbbbbbbb',
    ])
  })

  it('returns nothing for a body that is not the expected envelope', () => {
    expect(parseYouTubeSearchPayload(null)).toEqual([])
    expect(parseYouTubeSearchPayload({ results: 'nope' })).toEqual([])
    expect(parseYouTubeSearchPayload({ error: { code: 'QUOTA' } })).toEqual([])
  })
})
