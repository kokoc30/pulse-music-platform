import { describe, expect, it } from 'vitest'
import {
  DAY,
  makeEntry,
  makeSearch,
  makeState,
  memoryStorage,
  NOW,
} from '@/test/fixtures/personalization'
import { YOUTUBE_RETENTION_DAYS } from './config'
import { buildProfile } from './profile'
import { toPersisted, writeState } from './storage'
import { recentShelf } from './selectors'
import { toYouTubeItem } from './replay'
import { pruneHistory, recordPlaySession } from './history'
import { makePlayedItem, makeSession } from '@/test/fixtures/personalization'
import { PERSONALIZATION_STORAGE_KEY } from './types'
import {
  canReplayStoredYouTubeEntry,
  isExpiredYouTubeEntry,
  purgeExpiredYouTube,
  purgeExpiredYouTubeFromState,
  youtubeExpiryCutoff,
} from './youtube-retention'

/**
 * The Phase 4 half of the YouTube policy audit, expressed as tests.
 *
 * Each block names the rule it enforces. If one of these fails, the application
 * is out of compliance, not merely misbehaving — see
 * docs/youtube-personalization-policy-audit.md.
 */
describe('YouTube retention (Developer Policies §III.E.4.d — 30 calendar days)', () => {
  it('never permits a retention window longer than 30 days', () => {
    expect(YOUTUBE_RETENTION_DAYS).toBeLessThanOrEqual(30)
  })

  it('computes the cutoff from the retention constant', () => {
    expect(youtubeExpiryCutoff(NOW)).toBe(NOW - YOUTUBE_RETENTION_DAYS * DAY)
  })

  it('keeps an entry inside the window', () => {
    const entry = makeEntry({ id: 'v', provider: 'youtube', storedDaysAgo: 29 })
    expect(isExpiredYouTubeEntry(entry, NOW)).toBe(false)
  })

  it('expires an entry at the limit', () => {
    const entry = makeEntry({ id: 'v', provider: 'youtube', storedDaysAgo: 30 })
    expect(isExpiredYouTubeEntry(entry, NOW)).toBe(true)
  })

  it('expires an entry past the limit', () => {
    const entry = makeEntry({ id: 'v', provider: 'youtube', storedDaysAgo: 45 })
    expect(isExpiredYouTubeEntry(entry, NOW)).toBe(true)
  })

  it('never expires a catalogue entry under the YouTube rule', () => {
    const entry = makeEntry({ id: 't', provider: 'audius', storedDaysAgo: 120 })
    expect(isExpiredYouTubeEntry(entry, NOW)).toBe(false)
  })

  it('purges expired YouTube rows and keeps everything else', () => {
    const history = [
      makeEntry({ id: 'fresh', provider: 'youtube', storedDaysAgo: 2 }),
      makeEntry({ id: 'stale', provider: 'youtube', storedDaysAgo: 31 }),
      makeEntry({ id: 'song', provider: 'audius', storedDaysAgo: 100, daysAgo: 100 }),
    ]
    expect(purgeExpiredYouTube(history, NOW).map((entry) => entry.providerItemId)).toEqual([
      'fresh',
      'song',
    ])
  })

  it('returns the same array when nothing expired, so no needless write happens', () => {
    const history = [makeEntry({ id: 'fresh', provider: 'youtube', storedDaysAgo: 1 })]
    expect(purgeExpiredYouTube(history, NOW)).toBe(history)
  })

  it('purges at the state level and marks the state as changed', () => {
    const state = makeState({
      listeningHistory: [makeEntry({ id: 'stale', provider: 'youtube', storedDaysAgo: 40 })],
    })
    const purged = purgeExpiredYouTubeFromState(state, NOW)
    expect(purged.listeningHistory).toEqual([])
    expect(purged).not.toBe(state)
  })

  it('applies the YouTube rule before the catalogue caps', () => {
    const history = [
      makeEntry({ id: 'stale', provider: 'youtube', storedDaysAgo: 31, daysAgo: 1 }),
      makeEntry({ id: 'song', provider: 'audius', daysAgo: 1 }),
    ]
    // The row is recent by the catalogue rule but expired by the YouTube rule.
    expect(pruneHistory(history, NOW).map((entry) => entry.provider)).toEqual(['audius'])
  })

  it('restarts the window when the video is genuinely played again', () => {
    const history = recordPlaySession(
      [makeEntry({ id: 'v', provider: 'youtube', storedDaysAgo: 29 })],
      makeSession({
        item: makePlayedItem({
          provider: 'youtube',
          providerItemId: 'v',
          sourceUrl: 'https://www.youtube.com/watch?v=v',
          embeddable: true,
          madeForKids: false,
        }),
        playedSeconds: 60,
      }),
      NOW,
    )
    expect(history[0].storedAt).toBe(NOW)
    expect(isExpiredYouTubeEntry(history[0], NOW)).toBe(false)
  })
})

describe('replaying a retained YouTube entry', () => {
  it('allows an embeddable, explicitly non-kids, in-window entry', () => {
    const entry = makeEntry({ id: 'v', provider: 'youtube', embeddable: true, madeForKids: false })
    expect(canReplayStoredYouTubeEntry(entry, NOW)).toBe(true)
  })

  it('refuses an expired entry', () => {
    const entry = makeEntry({ id: 'v', provider: 'youtube', storedDaysAgo: 31 })
    expect(canReplayStoredYouTubeEntry(entry, NOW)).toBe(false)
  })

  it('refuses a non-embeddable entry', () => {
    const entry = makeEntry({ id: 'v', provider: 'youtube', embeddable: false })
    expect(canReplayStoredYouTubeEntry(entry, NOW)).toBe(false)
  })

  it('refuses a made-for-kids entry', () => {
    const entry = makeEntry({ id: 'v', provider: 'youtube', madeForKids: true })
    expect(canReplayStoredYouTubeEntry(entry, NOW)).toBe(false)
  })

  it('refuses an entry whose made-for-kids state YouTube never reported', () => {
    const entry = makeEntry({ id: 'v', provider: 'youtube', madeForKids: null })
    expect(canReplayStoredYouTubeEntry(entry, NOW)).toBe(false)
  })

  it('rebuilds a YouTube item that keeps its attribution and 16:9 thumbnail', () => {
    const item = toYouTubeItem(makeEntry({ id: 'abc', provider: 'youtube' }))
    expect(item).not.toBeNull()
    expect(item?.provider).toBe('youtube')
    expect(item?.mediaKind).toBe('youtube-video')
    expect(item?.sourceUrl).toBe('https://www.youtube.com/watch?v=abc')
    expect(item?.thumbnailUrl).toContain('i.ytimg.com')
  })

  it('never rebuilds a catalogue entry as a YouTube item', () => {
    expect(toYouTubeItem(makeEntry({ id: 't', provider: 'audius' }))).toBeNull()
  })
})

describe('Recently Played hides what may not be shown', () => {
  const state = makeState({
    listeningHistory: [
      makeEntry({ id: 'ok', provider: 'youtube', daysAgo: 0 }),
      makeEntry({ id: 'expired', provider: 'youtube', daysAgo: 1, storedDaysAgo: 40 }),
      makeEntry({ id: 'kids', provider: 'youtube', daysAgo: 2, madeForKids: true }),
      makeEntry({ id: 'blocked', provider: 'youtube', daysAgo: 3, embeddable: false }),
      makeEntry({ id: 'song', provider: 'audius', daysAgo: 4 }),
    ],
  })

  it('shows a valid YouTube entry and the catalogue track', () => {
    expect(recentShelf(state, NOW, 10).map((entry) => entry.providerItemId)).toEqual(['ok', 'song'])
  })

  it('drops the expired entry', () => {
    expect(recentShelf(state, NOW, 10).some((entry) => entry.providerItemId === 'expired')).toBe(
      false,
    )
  })

  it('drops made-for-kids and non-embeddable entries', () => {
    const ids = recentShelf(state, NOW, 10).map((entry) => entry.providerItemId)
    expect(ids).not.toContain('kids')
    expect(ids).not.toContain('blocked')
  })
})

describe('no prohibited derived metric (§III.E.4.h)', () => {
  it('excludes YouTube from every cross-provider preference weight', () => {
    const profile = buildProfile(
      makeState({
        listeningHistory: [
          makeEntry({ id: 'v1', provider: 'youtube', artist: 'A Channel', playCount: 50 }),
          makeEntry({ id: 'v2', provider: 'youtube', artist: 'B Channel', playCount: 50 }),
        ],
      }),
      NOW,
    )

    expect(profile.artists).toEqual([])
    expect(profile.artistWeights).toEqual({})
    expect(profile.genreWeights).toEqual({})
    expect(profile.tokenWeights).toEqual({})
    expect(profile.qualifiedListenCount).toBe(0)
    expect(Object.values(profile.scriptWeights).every((value) => value === 0)).toBe(true)
  })

  it('produces an identical profile with and without YouTube history', () => {
    const catalogue = [makeEntry({ id: 't', artist: 'Nova Sound', playCount: 3 })]
    const searches = [makeSearch({ query: 'nova' })]

    const withoutYouTube = buildProfile(
      makeState({ listeningHistory: catalogue, searchHistory: searches }),
      NOW,
    )
    const withYouTube = buildProfile(
      makeState({
        listeningHistory: [
          ...catalogue,
          makeEntry({ id: 'v', provider: 'youtube', artist: 'Loud Channel', playCount: 99 }),
        ],
        searchHistory: searches,
      }),
      NOW,
    )

    expect(withYouTube.artistWeights).toEqual(withoutYouTube.artistWeights)
    expect(withYouTube.scriptWeights).toEqual(withoutYouTube.scriptWeights)
    expect(withYouTube.stage).toBe(withoutYouTube.stage)
  })
})

describe('what is never persisted', () => {
  it('stores no media bytes, only metadata and URLs', () => {
    const persisted = toPersisted(
      makeState({ listeningHistory: [makeEntry({ id: 'v', provider: 'youtube' })] }),
    )
    const serialized = JSON.stringify(persisted)
    expect(serialized).not.toContain('data:')
    expect(serialized).not.toContain('blob:')
    expect(serialized).not.toContain('googlevideo.com')
  })

  it('stores no YouTube statistics field of any kind', () => {
    const serialized = JSON.stringify(
      toPersisted(makeState({ listeningHistory: [makeEntry({ id: 'v', provider: 'youtube' })] })),
    )
    for (const forbidden of [
      'viewCount',
      'likeCount',
      'dislikeCount',
      'favoriteCount',
      'commentCount',
      'subscriberCount',
      'statistics',
      'engagement',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('stores no API key under any casing', () => {
    const storage = memoryStorage()
    writeState(
      makeState({ listeningHistory: [makeEntry({ id: 'v', provider: 'youtube' })] }),
      storage,
    )
    const raw = (storage.getItem(PERSONALIZATION_STORAGE_KEY) ?? '').toLowerCase()
    for (const forbidden of ['youtube_api_key', 'jamendo_client_id', 'apikey', 'clientsecret']) {
      expect(raw).not.toContain(forbidden)
    }
  })

  it('keeps only the metadata already displayed on screen', () => {
    const [entry] = toPersisted(
      makeState({ listeningHistory: [makeEntry({ id: 'v', provider: 'youtube' })] }),
    ).listeningHistory as Array<Record<string, unknown>>

    expect(Object.keys(entry).sort()).toEqual(
      [
        'artist',
        'completionRatio',
        'context',
        'durationSeconds',
        'embeddable',
        'lastPlayedAt',
        'madeForKids',
        'playCount',
        'playedDays',
        'playedSeconds',
        'provider',
        'providerItemId',
        'qualifiedAt',
        'skipCount',
        'sourceUrl',
        'startedAt',
        'storedAt',
        'thumbnailUrl',
        'title',
      ].sort(),
    )
  })

  it('never stores artwork or genre against a YouTube row', () => {
    const [entry] = toPersisted(
      makeState({
        listeningHistory: [
          { ...makeEntry({ id: 'v', provider: 'youtube' }), artworkUrl: 'https://x/y.jpg', genre: 'Pop' },
        ],
      }),
    ).listeningHistory as Array<Record<string, unknown>>

    expect(entry.artworkUrl).toBeUndefined()
    expect(entry.genre).toBeUndefined()
  })
})
