import { describe, expect, it } from 'vitest'
import { audiusTrack, jamendoTrackFixture as jamendoTrack, FIXED_NOW } from '@/test/fixtures/library'

import type { ListenEntry } from '@/personalization/types'
import {
  isCatalogKey,
  isYouTubeKey,
  libraryKey,
  mergeTrackRef,
  parseLibraryKey,
  trackRefFromListenEntry,
  trackRefFromMediaItem,
  trackRefFromTrack,
  trackRefFromYouTube,
  youTubeItemFromRef,
} from './track-ref'
import type { YouTubeVideoItem } from '@/music/types'

const youtubeItem: YouTubeVideoItem = {
  id: 'youtube:aaaaaaaaaaa',
  mediaKind: 'youtube-video',
  provider: 'youtube',
  providerId: 'aaaaaaaaaaa',
  videoId: 'aaaaaaaaaaa',
  title: 'Qele Qele',
  channelTitle: 'Sirusho',
  thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
  durationSeconds: 210,
  sourceUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
  embeddable: true,
  madeForKids: false,
}

describe('identity', () => {
  it('is provider plus the provider s own id', () => {
    expect(libraryKey('audius', 't1')).toBe('audius:t1')
    expect(libraryKey('youtube', 'aaaaaaaaaaa')).toBe('youtube:aaaaaaaaaaa')
  })

  it('round-trips, including ids that contain a colon', () => {
    expect(parseLibraryKey('jamendo:188:336')).toEqual({
      provider: 'jamendo',
      providerItemId: '188:336',
    })
  })

  it('rejects anything that is not one of ours', () => {
    for (const key of ['', 'audius:', ':t1', 'spotify:t1', 'nonsense']) {
      expect(parseLibraryKey(key)).toBeNull()
    }
  })

  it('separates catalogue keys from YouTube ones', () => {
    expect(isCatalogKey('audius:t1')).toBe(true)
    expect(isCatalogKey('jamendo:1')).toBe(true)
    expect(isCatalogKey('youtube:a')).toBe(false)
    expect(isYouTubeKey('youtube:a')).toBe(true)
  })
})

describe('a saved reference carries no way to play anything', () => {
  it('never copies a Jamendo stream URL, which the source track does have', () => {
    const track = jamendoTrack()
    expect(track.streamUrl).toBeTruthy()

    const ref = trackRefFromTrack(track, FIXED_NOW)
    expect(JSON.stringify(ref)).not.toContain(track.streamUrl!)
    expect('streamUrl' in ref).toBe(false)
    // The backlink Jamendo's terms require survives; the audio does not.
    expect(ref.sourceUrl).toBe(track.sourceUrl)
  })

  it('keeps only display metadata from an Audius track', () => {
    const ref = trackRefFromTrack(audiusTrack(), FIXED_NOW)
    expect(ref.provider).toBe('audius')
    expect(ref.title).toBeTruthy()
    expect(ref.artist).toBeTruthy()
    expect('isStreamable' in ref).toBe(false)
    expect('playCount' in ref).toBe(false)
  })

  it('carries the artwork mirrors so a saved row fails over like every other', () => {
    const ref = trackRefFromTrack(
      { ...audiusTrack(), artwork: { medium: 'https://a.example/x.jpg', mirrors: ['https://b.example'] } },
      FIXED_NOW,
    )
    expect(ref.artwork?.url).toBe('https://a.example/x.jpg')
    expect(ref.artwork?.mirrors).toEqual(['https://b.example'])
  })
})

describe('YouTube references', () => {
  it('keep only what is already on the row, plus the deletion deadline', () => {
    const ref = trackRefFromYouTube(youtubeItem, FIXED_NOW)
    expect(ref).toEqual({
      key: 'youtube:aaaaaaaaaaa',
      provider: 'youtube',
      providerItemId: 'aaaaaaaaaaa',
      title: 'Qele Qele',
      artist: 'Sirusho',
      thumbnailUrl: youtubeItem.thumbnailUrl,
      durationSeconds: 210,
      sourceUrl: youtubeItem.sourceUrl,
      embeddable: true,
      madeForKids: false,
      addedAt: FIXED_NOW,
      metadataUpdatedAt: FIXED_NOW,
      youtubeExpiresAt: FIXED_NOW + 30 * 86_400_000,
    })
  })

  it('reconstruct the item the embedded player needs', () => {
    const item = youTubeItemFromRef(trackRefFromYouTube(youtubeItem, FIXED_NOW))
    expect(item).toEqual(expect.objectContaining({ videoId: 'aaaaaaaaaaa', embeddable: true }))
    // Never a Track: there is no field here an audio element could load.
    expect(item?.mediaKind).toBe('youtube-video')
  })

  it('cannot be reconstructed without the watch-page backlink', () => {
    const ref = { ...trackRefFromYouTube(youtubeItem, FIXED_NOW) }
    delete ref.sourceUrl
    expect(youTubeItemFromRef(ref)).toBeNull()
  })
})

describe('a reference built from a history row', () => {
  const entry = (overrides: Partial<ListenEntry> = {}): ListenEntry => ({
    id: 'audius:t1',
    provider: 'audius',
    mediaKind: 'audio',
    providerItemId: 't1',
    title: 'Neon Corridor',
    artist: 'Aster Vale',
    artworkUrl: 'https://art.example/t1.jpg',
    artworkMirrors: ['https://mirror.example'],
    genre: 'Electronic',
    durationSeconds: 200,
    sourceUrl: 'https://audius.co/x',
    context: 'search',
    startedAt: FIXED_NOW,
    qualifiedAt: FIXED_NOW,
    lastPlayedAt: FIXED_NOW,
    playedSeconds: 120,
    completionRatio: 0.6,
    playCount: 1,
    skipCount: 0,
    playedDays: ['2026-08-28'],
    storedAt: FIXED_NOW,
    ...overrides,
  })

  it('maps the display fields across and nothing else', () => {
    const ref = trackRefFromListenEntry(entry(), FIXED_NOW + 500)
    expect(ref.key).toBe('audius:t1')
    expect(ref.artwork?.mirrors).toEqual(['https://mirror.example'])
    // The visitor is saving it now; the metadata is as old as the history row.
    expect(ref.addedAt).toBe(FIXED_NOW + 500)
    expect(ref.metadataUpdatedAt).toBe(FIXED_NOW)
    expect('playCount' in ref).toBe(false)
    expect('completionRatio' in ref).toBe(false)
  })

  it('dates a YouTube save from the original retrieval, not from the save', () => {
    const old = FIXED_NOW - 20 * 86_400_000
    const ref = trackRefFromListenEntry(
      entry({
        id: 'youtube:aaaaaaaaaaa',
        provider: 'youtube',
        mediaKind: 'youtube-video',
        providerItemId: 'aaaaaaaaaaa',
        embeddable: true,
        madeForKids: false,
        storedAt: old,
      }),
      FIXED_NOW,
    )
    // Saving something is not a fresh retrieval of it, so the clock does not
    // restart — the item has ten days left, not thirty.
    expect(ref.youtubeExpiresAt).toBe(old + 30 * 86_400_000)
  })
})

describe('merging fresh metadata', () => {
  it('keeps the moment the visitor saved it', () => {
    const existing = trackRefFromTrack(audiusTrack(), 1000)
    const fresh = trackRefFromTrack({ ...audiusTrack(), title: 'Renamed' }, 9000)
    const merged = mergeTrackRef(existing, fresh)

    expect(merged.title).toBe('Renamed')
    expect(merged.metadataUpdatedAt).toBe(9000)
    expect(merged.addedAt).toBe(1000)
  })
})

describe('the media-item projection routes by type, not by guesswork', () => {
  it('sends a catalogue track down the catalogue path', () => {
    expect(trackRefFromMediaItem(audiusTrack(), FIXED_NOW).provider).toBe('audius')
  })

  it('sends a YouTube video down the YouTube path, with an expiry', () => {
    const ref = trackRefFromMediaItem(youtubeItem, FIXED_NOW)
    expect(ref.provider).toBe('youtube')
    expect(ref.youtubeExpiresAt).toBeDefined()
  })
})
