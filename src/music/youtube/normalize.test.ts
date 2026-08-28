import { describe, expect, it } from 'vitest'
import { isAudioTrack, isYouTubeVideoItem } from '@/music/types'
import { youtubePayload } from '@/test/fixtures/youtube'
import {
  YOUTUBE_ID_PREFIX,
  canEmbedYouTubeItem,
  embedBlockReason,
  normalizeYouTubeVideo,
  normalizeYouTubeVideos,
  youtubeWatchUrl,
} from './normalize'

describe('YouTube item normalization', () => {
  it('produces the documented normalized shape', () => {
    expect(normalizeYouTubeVideo(youtubePayload())).toEqual({
      id: 'youtube:aaaaaaaaaaa',
      mediaKind: 'youtube-video',
      provider: 'youtube',
      providerId: 'aaaaaaaaaaa',
      videoId: 'aaaaaaaaaaa',
      title: 'Qele Qele',
      channelTitle: 'Sirusho',
      channelId: 'UC-sirusho',
      thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg',
      thumbnailWidth: 1280,
      thumbnailHeight: 720,
      durationSeconds: 213,
      sourceUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      embeddable: true,
      madeForKids: false,
    })
  })

  it('namespaces the id so it can never collide with an audio track', () => {
    expect(normalizeYouTubeVideo(youtubePayload()).id.startsWith(YOUTUBE_ID_PREFIX)).toBe(true)
  })

  it('is not an audio track, by the type guards the player relies on', () => {
    const item = normalizeYouTubeVideo(youtubePayload())
    expect(isYouTubeVideoItem(item)).toBe(true)
    expect(isAudioTrack(item)).toBe(false)
    expect(item.mediaKind).toBe('youtube-video')
    // The fields that would let it reach an <audio> element simply do not exist.
    expect(item).not.toHaveProperty('streamUrl')
    expect(item).not.toHaveProperty('isStreamable')
    expect(item).not.toHaveProperty('artwork')
  })

  it('builds the real watch URL — the backlink branding requires', () => {
    expect(youtubeWatchUrl('aaaaaaaaaaa')).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa')
    // Never an embed URL, and never anything that could be fed to a media element.
    expect(youtubeWatchUrl('x')).not.toContain('/embed/')
  })

  it('preserves non-Latin titles and channel names byte-for-byte', () => {
    const item = normalizeYouTubeVideo(
      youtubePayload({ title: 'Քելե քելե', channelTitle: 'Սիրուշո' }),
    )
    expect(item.title).toBe('Քելե քելե')
    expect(item.channelTitle).toBe('Սիրուշո')
  })

  it('keeps 16:9 thumbnail metadata so the UI can present it unmodified', () => {
    const item = normalizeYouTubeVideo(youtubePayload())
    expect(item.thumbnailWidth! / item.thumbnailHeight!).toBeCloseTo(16 / 9, 5)
  })

  it('falls back to a neutral channel label rather than an empty line', () => {
    expect(normalizeYouTubeVideo(youtubePayload({ channelTitle: '' })).channelTitle).toBe('YouTube')
  })

  it('normalizes a whole list in order', () => {
    const list = normalizeYouTubeVideos([
      youtubePayload({ videoId: 'aaaaaaaaaaa' }),
      youtubePayload({ videoId: 'bbbbbbbbbbb' }),
    ])
    expect(list.map((item) => item.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])
  })
})

describe('embed eligibility', () => {
  const item = (overrides = {}) => normalizeYouTubeVideo(youtubePayload(overrides))

  it('allows an ordinary embeddable, non-MFK music video', () => {
    expect(canEmbedYouTubeItem(item())).toBe(true)
    expect(embedBlockReason(item())).toBeNull()
  })

  it('never embeds a made-for-kids video', () => {
    // The documented obligation is to "turn off tracking" and warrant COPPA
    // compliance for that player, and no documented IFrame API mechanism lets
    // this app do that (docs/youtube-policy-audit.md §9).
    expect(canEmbedYouTubeItem(item({ madeForKids: true }))).toBe(false)
    expect(embedBlockReason(item({ madeForKids: true }))).toMatch(/made for kids/i)
  })

  it('treats an unstated madeForKids as not known safe', () => {
    expect(canEmbedYouTubeItem(item({ madeForKids: null }))).toBe(false)
    expect(embedBlockReason(item({ madeForKids: null }))).toMatch(/made for kids/i)
  })

  it('never embeds a video whose uploader disabled embedding', () => {
    expect(canEmbedYouTubeItem(item({ embeddable: false }))).toBe(false)
    expect(embedBlockReason(item({ embeddable: false }))).toMatch(/embedding/i)
  })

  it('never embeds a live or upcoming broadcast', () => {
    expect(canEmbedYouTubeItem(item({ liveBroadcast: 'live' }))).toBe(false)
    expect(canEmbedYouTubeItem(item({ liveBroadcast: 'upcoming' }))).toBe(false)
    expect(embedBlockReason(item({ liveBroadcast: 'live' }))).toMatch(/live/i)
  })

  it('keeps a blocked item fully visible and openable on YouTube', () => {
    // Blocked means "not embedded here", never "hidden": the result still
    // carries its title, channel and watch link (agents/26 → "MadeForKids").
    const blocked = item({ madeForKids: true })
    expect(blocked.title).toBeTruthy()
    expect(blocked.channelTitle).toBeTruthy()
    expect(blocked.sourceUrl).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa')
  })
})
