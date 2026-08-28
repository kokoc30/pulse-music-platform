import { describe, expect, it } from 'vitest'
import {
  DAY,
  makeEntry,
  makePlayedItem,
  makeSession,
  makeState,
  memoryStorage,
  NOW,
} from '@/test/fixtures/personalization'
import { MAX_ARTWORK_MIRRORS } from './config'
import {
  displayRecency,
  recentlyPlayed,
  recordPlaySession,
  touchReplayStart,
} from './history'
import { buildProfile } from './profile'
import { effectiveWeight } from './scoring'
import { recentShelf } from './selectors'
import { sanitizeListenEntry, toPersisted, writeState } from './storage'
import { PERSONALIZATION_STORAGE_KEY } from './types'

/**
 * The two Recently Played defects, as regressions.
 *
 * Both were found in the real application, so both are pinned by tests that
 * describe the observable symptom rather than the implementation.
 */

describe('artwork survives an unhealthy content node', () => {
  /**
   * The root cause, stated as a test: a history row that keeps a single URL has
   * one candidate, and Audius content nodes fail routinely. Everywhere else in
   * the app the mirror origins provide the failover, so a history row must carry
   * them too.
   */
  it('persists the mirror origins alongside the primary URL', () => {
    const history = recordPlaySession(
      [],
      makeSession({
        item: makePlayedItem({
          artworkUrl: 'https://cn4.example.audius/content/abc/480x480.jpg',
          artworkMirrors: ['https://cn0.example.audius', 'https://mirror.example.audius'],
        }),
        playedSeconds: 60,
      }),
      NOW,
    )

    expect(history[0].artworkUrl).toBe('https://cn4.example.audius/content/abc/480x480.jpg')
    expect(history[0].artworkMirrors).toEqual([
      'https://cn0.example.audius',
      'https://mirror.example.audius',
    ])
  })

  it('writes the mirrors through the allow-list to storage', () => {
    const storage = memoryStorage()
    writeState(
      makeState({
        listeningHistory: [
          {
            ...makeEntry({ id: 'a' }),
            artworkMirrors: ['https://cn0.example.audius'],
          },
        ],
      }),
      storage,
    )
    const raw = storage.getItem(PERSONALIZATION_STORAGE_KEY) ?? ''
    expect(raw).toContain('artworkMirrors')
    expect(raw).toContain('https://cn0.example.audius')
  })

  describe('mirrors are validated like every other stored value', () => {
    const sanitize = (mirrors: unknown) =>
      sanitizeListenEntry({
        provider: 'audius',
        providerItemId: 'x',
        title: 'T',
        artist: 'A',
        artworkUrl: 'https://cn4.example.audius/content/abc/480x480.jpg',
        artworkMirrors: mirrors,
      })?.artworkMirrors

    it('keeps only http(s) origins', () => {
      expect(sanitize(['https://ok.example', 'javascript:alert(1)', 'ftp://nope.example'])).toEqual([
        'https://ok.example',
      ])
    })

    it('reduces a full URL to its origin', () => {
      expect(sanitize(['https://cn0.example.audius/content/abc/480x480.jpg'])).toEqual([
        'https://cn0.example.audius',
      ])
    })

    it('drops non-strings and duplicates without throwing', () => {
      expect(sanitize(['https://ok.example', 42, null, 'https://ok.example'])).toEqual([
        'https://ok.example',
      ])
      expect(sanitize('not an array')).toBeUndefined()
      expect(sanitize(undefined)).toBeUndefined()
    })

    it('caps the list so a provider cannot inflate storage', () => {
      const many = Array.from({ length: 20 }, (_, index) => `https://mirror${index}.example`)
      expect(sanitize(many)).toHaveLength(MAX_ARTWORK_MIRRORS)
    })
  })

  it('keeps artwork already known when a later response arrives without it', () => {
    const withArt = recordPlaySession(
      [],
      makeSession({
        item: makePlayedItem({
          artworkUrl: 'https://cn4.example.audius/content/abc/480x480.jpg',
          artworkMirrors: ['https://cn0.example.audius'],
        }),
        playedSeconds: 60,
      }),
      NOW,
    )
    const withoutArt = recordPlaySession(
      withArt,
      makeSession({ item: makePlayedItem(), playedSeconds: 60 }),
      NOW + DAY,
    )

    expect(withoutArt[0].artworkUrl).toBe('https://cn4.example.audius/content/abc/480x480.jpg')
    expect(withoutArt[0].artworkMirrors).toEqual(['https://cn0.example.audius'])
  })

  it('repairs an old row that was recorded without artwork, on replay', () => {
    // A row written before mirrors were captured, or by a provider response that
    // carried no image at all.
    const legacy = [{ ...makeEntry({ id: 'trk1' }), artworkUrl: undefined, artworkMirrors: undefined }]
    expect(legacy[0].artworkUrl).toBeUndefined()

    const repaired = touchReplayStart(
      legacy,
      makePlayedItem({
        providerItemId: 'trk1',
        artworkUrl: 'https://cn4.example.audius/content/abc/480x480.jpg',
        artworkMirrors: ['https://cn0.example.audius'],
      }),
      NOW,
    )

    expect(repaired[0].artworkUrl).toBe('https://cn4.example.audius/content/abc/480x480.jpg')
    expect(repaired[0].artworkMirrors).toEqual(['https://cn0.example.audius'])
  })

  it('still persists no forbidden field now that mirrors exist', () => {
    const serialized = JSON.stringify(
      toPersisted(
        makeState({
          listeningHistory: [
            {
              ...makeEntry({ id: 'a' }),
              artworkMirrors: ['https://cn0.example.audius'],
              streamUrl: 'https://cdn.example/signed',
              apiKey: 'AIzaSyDEADBEEF',
            } as never,
          ],
        }),
      ),
    )
    expect(serialized).not.toContain('streamUrl')
    expect(serialized).not.toContain('AIzaSyDEADBEEF')
  })

  it('never puts artwork or mirrors on a YouTube row', () => {
    const [row] = toPersisted(
      makeState({
        listeningHistory: [
          {
            ...makeEntry({ id: 'v', provider: 'youtube' }),
            artworkUrl: 'https://x/y.jpg',
            artworkMirrors: ['https://cn0.example.audius'],
          },
        ],
      }),
    ).listeningHistory as Array<Record<string, unknown>>

    expect(row.artworkUrl).toBeUndefined()
    expect(row.artworkMirrors).toBeUndefined()
    expect(row.thumbnailUrl).toContain('i.ytimg.com')
  })
})

describe('Recently Played reflects a replay immediately', () => {
  const skrillex = makeEntry({ id: 'skrillex', title: 'RATATA', artist: 'Skrillex', daysAgo: 0 })
  const miyagi = makeEntry({ id: 'miyagi', title: 'Kosandra', artist: 'Miyagi', daysAgo: 2 })
  const history = [skrillex, miyagi]

  it('orders by the most recent play before anything is replayed', () => {
    expect(recentlyPlayed(history, NOW).map((entry) => entry.title)).toEqual([
      'RATATA',
      'Kosandra',
    ])
  })

  it('moves a replayed item to the front the moment playback starts', () => {
    const next = touchReplayStart(
      history,
      makePlayedItem({ providerItemId: 'miyagi', title: 'Kosandra', artist: 'Miyagi' }),
      NOW + 1000,
    )
    expect(recentlyPlayed(next, NOW + 1000).map((entry) => entry.title)).toEqual([
      'Kosandra',
      'RATATA',
    ])
  })

  it('creates no duplicate row when the current track is replayed', () => {
    const next = touchReplayStart(
      history,
      makePlayedItem({ providerItemId: 'miyagi' }),
      NOW + 1000,
    )
    expect(next).toHaveLength(2)
    expect(next.filter((entry) => entry.providerItemId === 'miyagi')).toHaveLength(1)
  })

  it('ignores a track that is not already in history', () => {
    // A brand-new item still has to earn its row by qualifying, so a misclick
    // cannot put an unknown track on the shelf.
    const next = touchReplayStart(history, makePlayedItem({ providerItemId: 'brand-new' }), NOW)
    expect(next).toBe(history)
    expect(next).toHaveLength(2)
  })

  it('resolves a same-millisecond tie in favour of the item just started', () => {
    const tied = [
      { ...skrillex, lastPlayedAt: NOW, lastStartedAt: undefined },
      { ...miyagi, lastPlayedAt: NOW, lastStartedAt: NOW },
    ]
    expect(recentlyPlayed(tied, NOW).map((entry) => entry.title)).toEqual(['Kosandra', 'RATATA'])
  })

  it('flows through the shelf selector both Home and the search dropdown read', () => {
    const next = touchReplayStart(
      history,
      makePlayedItem({ providerItemId: 'miyagi', title: 'Kosandra', artist: 'Miyagi' }),
      NOW + 1000,
    )
    const shelf = recentShelf(makeState({ listeningHistory: next }), NOW + 1000)
    expect(shelf.map((entry) => entry.title)).toEqual(['Kosandra', 'RATATA'])
  })
})

describe('a replay start is not a listen', () => {
  const history = [makeEntry({ id: 'miyagi', title: 'Kosandra', playCount: 1, daysAgo: 2 })]

  it('does not increment the qualified play count', () => {
    const next = touchReplayStart(history, makePlayedItem({ providerItemId: 'miyagi' }), NOW)
    expect(next[0].playCount).toBe(1)
  })

  it('does not move the signal timestamp the profile decays against', () => {
    const next = touchReplayStart(history, makePlayedItem({ providerItemId: 'miyagi' }), NOW)
    expect(next[0].lastPlayedAt).toBe(history[0].lastPlayedAt)
    expect(next[0].lastStartedAt).toBe(NOW)
  })

  it('leaves the recommendation weight exactly where it was', () => {
    const before = effectiveWeight(history[0], NOW)
    const next = touchReplayStart(history, makePlayedItem({ providerItemId: 'miyagi' }), NOW)
    expect(effectiveWeight(next[0], NOW)).toBe(before)
  })

  it('cannot be used to train the profile by pressing play repeatedly', () => {
    let repeated = history
    for (let press = 0; press < 50; press += 1) {
      repeated = touchReplayStart(repeated, makePlayedItem({ providerItemId: 'miyagi' }), NOW + press)
    }
    const before = buildProfile(makeState({ listeningHistory: history }), NOW)
    const after = buildProfile(makeState({ listeningHistory: repeated }), NOW)

    expect(after.qualifiedListenCount).toBe(before.qualifiedListenCount)
    expect(after.artistWeights).toEqual(before.artistWeights)
  })

  it('still counts the listen once the new session actually qualifies', () => {
    const started = touchReplayStart(history, makePlayedItem({ providerItemId: 'miyagi' }), NOW)
    const qualified = recordPlaySession(
      started,
      makeSession({
        item: makePlayedItem({ providerItemId: 'miyagi' }),
        playedSeconds: 60,
        endedAt: NOW + 60_000,
      }),
      NOW + 60_000,
    )
    expect(qualified[0].playCount).toBe(2)
  })

  it('keeps display recency when a replay is abandoned early', () => {
    const started = touchReplayStart(history, makePlayedItem({ providerItemId: 'miyagi' }), NOW)
    const abandoned = recordPlaySession(
      started,
      makeSession({
        item: makePlayedItem({ providerItemId: 'miyagi' }),
        playedSeconds: 5,
        endedAt: NOW + 5000,
      }),
      NOW + 5000,
    )
    // The visitor really did return to it, so it stays at the front…
    expect(displayRecency(abandoned[0])).toBeGreaterThanOrEqual(NOW)
    // …but a five-second play is still not a listen.
    expect(abandoned[0].playCount).toBe(1)
    expect(abandoned[0].skipCount).toBe(1)
  })

  it('never lets display recency go backwards after a session commit', () => {
    const started = touchReplayStart(history, makePlayedItem({ providerItemId: 'miyagi' }), NOW + 5000)
    const committed = recordPlaySession(
      started,
      makeSession({
        item: makePlayedItem({ providerItemId: 'miyagi' }),
        playedSeconds: 60,
        startedAt: NOW + 5000,
        endedAt: NOW + 65_000,
      }),
      NOW + 65_000,
    )
    expect(displayRecency(committed[0])).toBeGreaterThanOrEqual(NOW + 5000)
  })
})
