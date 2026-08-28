import type { YouTubeVideoPayload } from '@/music/youtube'

/**
 * Wire-shaped YouTube doubles, matching exactly what `/api/youtube` returns
 * after server-side sanitization. Nothing here is a raw Google response: the
 * browser never sees one.
 */

export function youtubePayload(overrides: Partial<YouTubeVideoPayload> = {}): YouTubeVideoPayload {
  return {
    videoId: 'aaaaaaaaaaa',
    title: 'Qele Qele',
    channelTitle: 'Sirusho',
    channelId: 'UC-sirusho',
    thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg',
    thumbnailWidth: 1280,
    thumbnailHeight: 720,
    durationSeconds: 213,
    embeddable: true,
    madeForKids: false,
    ...overrides,
  }
}

export const YOUTUBE_PAYLOADS: YouTubeVideoPayload[] = [
  youtubePayload(),
  youtubePayload({
    videoId: 'bbbbbbbbbbb',
    title: 'PreGomesh',
    channelTitle: 'Sirusho',
    durationSeconds: 245,
  }),
  youtubePayload({
    videoId: 'ccccccccccc',
    title: 'Kids Song Collection',
    channelTitle: 'Little Tunes',
    // The MadeForKids case: visible, attributed, but never embedded.
    madeForKids: true,
    durationSeconds: 180,
  }),
  youtubePayload({
    videoId: 'ddddddddddd',
    title: 'Embedding Disabled Live Set',
    channelTitle: 'Some Label',
    embeddable: false,
    durationSeconds: 300,
  }),
]

export interface YouTubeSearchBodyFixture {
  provider: 'youtube'
  action: 'search'
  query: string
  count: number
  results: YouTubeVideoPayload[]
}

export function youtubeSearchResponse(
  payloads: YouTubeVideoPayload[] = YOUTUBE_PAYLOADS,
  query = 'sirusho',
): YouTubeSearchBodyFixture {
  return {
    provider: 'youtube',
    action: 'search',
    query,
    count: payloads.length,
    results: payloads,
  }
}
