import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_KEYS,
  PAYLOAD_KEYS,
  decodeHtmlEntities,
  parseIso8601Duration,
  pickThumbnail,
  readVideoId,
  sanitizeYouTubeVideo,
  sanitizeYouTubeVideos,
} from './sanitize.js'

/** A complete `videos.list` item, in the shape the live API documents. */
function videoItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'youtube#video',
    etag: 'etag-should-never-survive',
    id: 'dQw4w9WgXcQ',
    snippet: {
      publishedAt: '2019-10-24T06:36:00Z',
      channelId: 'UC1234',
      title: 'Sirusho &amp; Friends — Qele Qele',
      channelTitle: 'Sirusho &quot;official&quot;',
      liveBroadcastContent: 'none',
      thumbnails: {
        default: { url: 'https://i.ytimg.com/vi/x/default.jpg', width: 120, height: 90 },
        medium: { url: 'https://i.ytimg.com/vi/x/mqdefault.jpg', width: 320, height: 180 },
        high: { url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', width: 480, height: 360 },
        maxres: { url: 'https://i.ytimg.com/vi/x/maxresdefault.jpg', width: 1280, height: 720 },
      },
      tags: ['should', 'never', 'survive'],
      description: 'a long description nobody needs',
    },
    contentDetails: { duration: 'PT3M33S', regionRestriction: { blocked: ['DE'] } },
    status: {
      uploadStatus: 'processed',
      privacyStatus: 'public',
      embeddable: true,
      madeForKids: false,
      license: 'youtube',
    },
    statistics: { viewCount: '1400000000' },
    player: { embedHtml: '<iframe …>' },
    ...overrides,
  }
}

describe('YouTube payload sanitization', () => {
  it('publishes exactly the key list the browser parser mirrors', () => {
    // The client's `WIRE_KEYS` in src/music/youtube/wire.ts holds the same list
    // and asserts it independently. Neither side imports the other, so this
    // pair is what keeps the wire contract from drifting.
    expect([...PAYLOAD_KEYS].sort()).toEqual(
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

  it('emits only the documented wire keys', () => {
    const payload = sanitizeYouTubeVideo(videoItem())
    expect(payload).not.toBeNull()
    for (const key of Object.keys(payload as object)) {
      expect(PAYLOAD_KEYS).toContain(key)
    }
  })

  it('drops every forbidden upstream field', () => {
    const payload = sanitizeYouTubeVideo(videoItem()) as unknown as Record<string, unknown>
    for (const key of FORBIDDEN_KEYS) {
      expect(payload).not.toHaveProperty(key)
    }
    // Spot-check the ones an accidental spread would carry through.
    expect(JSON.stringify(payload)).not.toContain('1400000000')
    expect(JSON.stringify(payload)).not.toContain('embedHtml')
    expect(JSON.stringify(payload)).not.toContain('etag-should-never-survive')
  })

  it('carries the fields the UI and the player actually need', () => {
    expect(sanitizeYouTubeVideo(videoItem())).toEqual({
      videoId: 'dQw4w9WgXcQ',
      title: 'Sirusho & Friends — Qele Qele',
      channelTitle: 'Sirusho "official"',
      channelId: 'UC1234',
      thumbnailUrl: 'https://i.ytimg.com/vi/x/maxresdefault.jpg',
      thumbnailWidth: 1280,
      thumbnailHeight: 720,
      publishedAt: '2019-10-24T06:36:00Z',
      durationSeconds: 213,
      embeddable: true,
      madeForKids: false,
    })
  })

  it('reads the video id from both `search.list` and `videos.list` shapes', () => {
    expect(readVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(readVideoId({ kind: 'youtube#video', videoId: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ')
    expect(readVideoId({ kind: 'youtube#channel', channelId: 'UC1' })).toBe('')
    expect(readVideoId('not a video id at all')).toBe('')
    expect(readVideoId(null)).toBe('')
  })
})

describe('16:9 thumbnail selection', () => {
  /**
   * The documented sizes: `medium` 320x180 and `maxres` 1280x720 are 16:9;
   * `default` 120x90, `high` 480x360 and `standard` 640x480 are 4:3. Choosing
   * `high` because it sounds bigger would put a pillarboxed 4:3 image in a 16:9
   * frame (docs/youtube-policy-audit.md §3).
   */
  it('prefers maxres, the largest natively 16:9 key', () => {
    expect(pickThumbnail(videoItem().snippet && (videoItem().snippet as { thumbnails: unknown }).thumbnails))
      .toEqual({ url: 'https://i.ytimg.com/vi/x/maxresdefault.jpg', width: 1280, height: 720 })
  })

  it('falls back to medium — also 16:9 — before any 4:3 key', () => {
    expect(
      pickThumbnail({
        default: { url: 'https://i.ytimg.com/vi/x/default.jpg', width: 120, height: 90 },
        medium: { url: 'https://i.ytimg.com/vi/x/mqdefault.jpg', width: 320, height: 180 },
        high: { url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', width: 480, height: 360 },
      }),
    ).toEqual({ url: 'https://i.ytimg.com/vi/x/mqdefault.jpg', width: 320, height: 180 })
  })

  it('keeps the real dimensions of a 4:3 fallback so the UI can letterbox it', () => {
    expect(
      pickThumbnail({ high: { url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', width: 480, height: 360 } }),
    ).toEqual({ url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', width: 480, height: 360 })
  })

  it('refuses a non-https or malformed thumbnail', () => {
    expect(pickThumbnail({ maxres: { url: 'http://i.ytimg.com/x.jpg' } })).toBeNull()
    expect(pickThumbnail({ maxres: { url: '' } })).toBeNull()
    expect(pickThumbnail(null)).toBeNull()
    expect(sanitizeYouTubeVideo(videoItem({ snippet: { title: 'x', thumbnails: {} } }))).toBeNull()
  })
})

describe('HTML entity decoding', () => {
  it('decodes the named entities the API escapes, as text', () => {
    expect(decodeHtmlEntities('Rock &amp; Roll')).toBe('Rock & Roll')
    expect(decodeHtmlEntities('&quot;Live&quot;')).toBe('"Live"')
    expect(decodeHtmlEntities('It&#39;s here')).toBe("It's here")
    expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>')
  })

  it('decodes numeric and hex references, including non-Latin scripts', () => {
    // 1400 decimal is U+0578, Armenian small letter vo.
    expect(decodeHtmlEntities('&#1400;&#1400;')).toBe('ոո')
    expect(decodeHtmlEntities('&#x627;&#x644;')).toBe('ال')
    expect(decodeHtmlEntities('&#x41A;&#x438;&#x43D;&#x43E;')).toBe('Кино')
  })

  it('leaves unknown entities alone rather than guessing', () => {
    expect(decodeHtmlEntities('&notreal; &amp;')).toBe('&notreal; &')
  })

  it('never produces markup that could be mistaken for HTML to render', () => {
    // The decoded value is plain text. It is rendered as a React child, never
    // through `dangerouslySetInnerHTML` (agents/22 → "HTML Entities").
    const payload = sanitizeYouTubeVideo(
      videoItem({
        snippet: {
          ...(videoItem().snippet as object),
          title: '&lt;script&gt;alert(1)&lt;/script&gt;',
        },
      }),
    )
    expect(payload?.title).toBe('<script>alert(1)</script>')
  })
})

describe('ISO 8601 duration parsing', () => {
  it('parses the documented duration formats', () => {
    expect(parseIso8601Duration('PT3M33S')).toBe(213)
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723)
    expect(parseIso8601Duration('PT45S')).toBe(45)
    expect(parseIso8601Duration('PT2M')).toBe(120)
    expect(parseIso8601Duration('PT3M33.5S')).toBe(214)
    expect(parseIso8601Duration('P1D')).toBe(86_400)
  })

  it('returns undefined rather than a wrong number for anything unparseable', () => {
    expect(parseIso8601Duration('P0D')).toBeUndefined()
    expect(parseIso8601Duration('PT0S')).toBeUndefined()
    expect(parseIso8601Duration('')).toBeUndefined()
    expect(parseIso8601Duration(undefined)).toBeUndefined()
    expect(parseIso8601Duration('3:33')).toBeUndefined()
    // Anything past 24 hours is a stuck livestream placeholder, not a track.
    expect(parseIso8601Duration('P1DT1S')).toBeUndefined()
    expect(parseIso8601Duration('P400D')).toBeUndefined()
  })
})

describe('status handling', () => {
  it('reads madeForKids as a real tri-state', () => {
    const yes = videoItem({ status: { embeddable: true, madeForKids: true, privacyStatus: 'public' } })
    const no = videoItem({ status: { embeddable: true, madeForKids: false, privacyStatus: 'public' } })
    const unknown = videoItem({ status: { embeddable: true, privacyStatus: 'public' } })
    expect(sanitizeYouTubeVideo(yes)?.madeForKids).toBe(true)
    expect(sanitizeYouTubeVideo(no)?.madeForKids).toBe(false)
    expect(sanitizeYouTubeVideo(unknown)?.madeForKids).toBeNull()
  })

  it('never reports embeddable true unless the API said so explicitly', () => {
    expect(sanitizeYouTubeVideo(videoItem({ status: {} }))?.embeddable).toBe(false)
    expect(sanitizeYouTubeVideo(videoItem({ status: undefined }))?.embeddable).toBe(false)
    expect(
      sanitizeYouTubeVideo(videoItem({ status: { embeddable: 'true', privacyStatus: 'public' } }))
        ?.embeddable,
    ).toBe(false)
  })

  it('drops a video that is not public or not processed', () => {
    expect(
      sanitizeYouTubeVideo(videoItem({ status: { privacyStatus: 'private', embeddable: true } })),
    ).toBeNull()
    expect(
      sanitizeYouTubeVideo(
        videoItem({ status: { privacyStatus: 'public', uploadStatus: 'rejected', embeddable: true } }),
      ),
    ).toBeNull()
  })

  it('marks a live or upcoming broadcast so the UI can keep it external', () => {
    const snippet = videoItem().snippet as object
    expect(
      sanitizeYouTubeVideo(videoItem({ snippet: { ...snippet, liveBroadcastContent: 'live' } }))
        ?.liveBroadcast,
    ).toBe('live')
    expect(
      sanitizeYouTubeVideo(videoItem({ snippet: { ...snippet, liveBroadcastContent: 'none' } })),
    ).not.toHaveProperty('liveBroadcast')
  })
})

describe('sanitizeYouTubeVideos', () => {
  it('drops unusable rows and de-duplicates by video id', () => {
    const list = sanitizeYouTubeVideos([
      videoItem(),
      videoItem(),
      videoItem({ id: 'abcdefghijk' }),
      null,
      'nonsense',
      { id: 'no-snippet-here' },
    ])
    expect(list.map((item) => item.videoId)).toEqual(['dQw4w9WgXcQ', 'abcdefghijk'])
  })

  it('returns an empty list for anything that is not an array', () => {
    expect(sanitizeYouTubeVideos(undefined)).toEqual([])
    expect(sanitizeYouTubeVideos({ items: [] })).toEqual([])
  })

  it('refuses to publish a row that somehow contains the API key', () => {
    const key = 'AIzaSyA-1234567890abcdefghijklmnopqrstu'
    const leaky = videoItem({
      snippet: { ...(videoItem().snippet as object), title: `Song ${key}` },
    })
    expect(sanitizeYouTubeVideo(leaky, { apiKey: key })).toBeNull()
    expect(sanitizeYouTubeVideos([leaky, videoItem({ id: 'abcdefghijk' })], { apiKey: key })).toHaveLength(
      1,
    )
  })
})
