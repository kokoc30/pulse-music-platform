import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeYouTubeVideo } from '@/music/youtube'
import type { Track, YouTubeVideoItem } from '@/music/types'
import { youtubePayload } from '@/test/fixtures/youtube'
import {
  PLAYED_SESSION_LIMIT,
  clearPlayedSession,
  describeSeed,
  detectLanguage,
  fetchRelated,
  hasPlayedInSession,
  notePlayed,
  playedSessionIds,
  relatedQuery,
} from './related-fetcher'

/**
 * Finding the next track when the queue has nothing left to offer.
 *
 * Two failures are being guarded against at once, and they are opposites. One
 * is silence — the queue running dry and the session ending, which is what the
 * reports described. The other is the *wrong* continuation: a Russian pop song
 * followed by an English one, or, worse, followed by another upload of itself.
 *
 * Every provider call here goes through a seam, so what is asserted is the
 * question asked and the answer filtered — never a live catalogue.
 */

let counter = 0

function audiusTrack(overrides: Partial<Track> = {}): Track {
  counter += 1
  return {
    id: `audius:t${counter}`,
    mediaKind: 'audio',
    provider: 'audius',
    providerId: `t${counter}`,
    title: `Track ${counter}`,
    artistName: `Artist ${counter}`,
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    ...overrides,
  }
}

function jamendoTrack(overrides: Partial<Track> = {}): Track {
  return audiusTrack({
    id: `jamendo:j${counter + 1}`,
    provider: 'jamendo',
    providerId: `j${counter + 1}`,
    streamUrl: 'https://prod.jamendo.test/stream.mp3',
    ...overrides,
  })
}

function youtubeItem(overrides: Partial<Parameters<typeof youtubePayload>[0]> = {}) {
  return normalizeYouTubeVideo(youtubePayload(overrides))
}

beforeEach(() => {
  counter = 0
  clearPlayedSession()
})

describe('reading a seed', () => {
  it('takes tags, genre and provider straight from an audio track', () => {
    const seed = describeSeed(
      audiusTrack({ title: 'Harbour Lights', genre: 'Pop', tags: ['pop', 'vocal'] }),
    )
    expect(seed.provider).toBe('audius')
    expect(seed.genre).toBe('Pop')
    expect(seed.tags).toEqual(['pop', 'vocal'])
  })

  /**
   * A channel is very often a re-uploader rather than the act, so a title that
   * confidently parses as `Artist - Title` is believed over it. Same helper, and
   * the same reasoning, that keeps autoplay from following Kosandra with
   * Kosandra.
   */
  it('prefers the artist a video title states over the channel name', () => {
    const seed = describeSeed(
      youtubeItem({ title: 'Miyagi & Andy Panda - Kosandra', channelTitle: 'tttyyu7' }),
    )
    // Folded by `artistHintFromTitle`: lowercased and punctuation-normalized,
    // which is the right form for a search query and the wrong one for a credit.
    expect(seed.artist).toBe('miyagi andy panda')
  })

  it('falls back to the channel when the title says nothing about an artist', () => {
    const seed = describeSeed(youtubeItem({ title: 'Qele Qele', channelTitle: 'Sirusho' }))
    expect(seed.artist).toBe('Sirusho')
  })
})

describe('detecting a language', () => {
  it('reads Cyrillic as Russian', () => {
    expect(detectLanguage({ title: 'Косандра', artist: 'Мияги' })).toBe('ru')
  })

  it('reads Armenian and Arabic scripts too', () => {
    expect(detectLanguage({ title: 'Քելե Քելե', artist: 'Սիրուշո' })).toBe('hy')
    expect(detectLanguage({ title: 'الف ليلة', artist: 'ام كلثوم' })).toBe('ar')
  })

  /**
   * Latin is shared by a dozen languages, so the alphabet says nothing and a tag
   * has to. Returning nothing is a real answer: the query is then built from
   * tags and genre, which is the right question for it.
   */
  it('says nothing for Latin text with no language tag', () => {
    expect(detectLanguage({ title: 'Harbour Lights', artist: 'Rell Vance' })).toBeUndefined()
  })

  it('believes a provider tag over the alphabet', () => {
    expect(detectLanguage({ title: 'Corazon', artist: 'Luz', tags: ['reggaeton', 'dance'] })).toBe(
      'es',
    )
  })
})

describe('building the query', () => {
  it('puts the language in front of the tags when the tags do not carry one', () => {
    const seed = describeSeed(
      audiusTrack({ title: 'Косандра', genre: 'Pop', tags: ['pop', 'vocal'] }),
    )
    expect(relatedQuery(seed)).toBe('russian pop vocal')
  })

  it('does not say it twice when a tag already does', () => {
    const seed = describeSeed(audiusTrack({ title: 'Косандра', tags: ['russian', 'rap'] }))
    expect(relatedQuery(seed)).toBe('russian rap')
  })

  it('falls back to language and genre when there are no tags', () => {
    const seed = describeSeed(audiusTrack({ title: 'Косандра', genre: 'Pop' }))
    expect(relatedQuery(seed)).toBe('russian Pop')
  })

  it('falls back to the act when nothing describes the track at all', () => {
    const seed = describeSeed(audiusTrack({ title: 'Harbour Lights', artistName: 'Rell Vance' }))
    expect(relatedQuery(seed)).toBe('Rell Vance')
  })

  /**
   * The one thing the query may never be.
   *
   * A search for the title returns the song that just played and every re-upload
   * of it — thirteen of them, in the case this project has on file. That is
   * indistinguishable from the looping bug being fixed.
   */
  it('never searches for the title', () => {
    const seed = describeSeed(
      audiusTrack({ title: 'Kosandra', artistName: 'Miyagi', genre: 'Pop', tags: ['pop'] }),
    )
    expect(relatedQuery(seed).toLowerCase()).not.toContain('kosandra')
  })

  it('asks YouTube for the act and its language, not for the video', () => {
    const seed = describeSeed(
      youtubeItem({ title: 'Мияги - Косандра (Official Audio)', channelTitle: 'ssss' }),
    )
    expect(relatedQuery(seed)).toBe('мияги russian music')
  })

  it('drops a tag that only repeats the title or the artist', () => {
    const seed = describeSeed(
      audiusTrack({
        title: 'Harbour Lights',
        artistName: 'Otavo',
        tags: ['otavo', 'harbour', 'dub'],
      }),
    )
    expect(relatedQuery(seed)).toBe('dub')
  })
})

describe('fetching', () => {
  it('excludes the track it was asked about', async () => {
    const seed = audiusTrack({ genre: 'Pop' })
    const other = audiusTrack({ genre: 'Pop' })
    const searchAudius = vi.fn(() => Promise.resolve([seed, other]))

    const found = await fetchRelated(describeSeed(seed), { searchAudius })

    expect(found.map((item) => item.id)).toEqual([other.id])
  })

  it('excludes everything this sitting has already played', async () => {
    const seed = audiusTrack({ genre: 'Pop' })
    const heard = audiusTrack({ genre: 'Pop' })
    const fresh = audiusTrack({ genre: 'Pop' })
    notePlayed(heard.id)
    const searchAudius = vi.fn(() => Promise.resolve([heard, fresh]))

    const found = await fetchRelated(describeSeed(seed), { searchAudius })

    expect(found.map((item) => item.id)).toEqual([fresh.id])
  })

  it('excludes anything the caller names as well', async () => {
    const seed = audiusTrack({ genre: 'Pop' })
    const queued = audiusTrack({ genre: 'Pop' })
    const fresh = audiusTrack({ genre: 'Pop' })
    const searchAudius = vi.fn(() => Promise.resolve([queued, fresh]))

    const found = await fetchRelated(describeSeed(seed), {
      searchAudius,
      exclude: [queued.id],
    })

    expect(found.map((item) => item.id)).toEqual([fresh.id])
  })

  it('never returns a track the app cannot stream', async () => {
    const seed = audiusTrack({ genre: 'Pop' })
    const gated = audiusTrack({ genre: 'Pop', isStreamable: false })
    const searchAudius = vi.fn(() => Promise.resolve([gated]))

    expect(await fetchRelated(describeSeed(seed), { searchAudius })).toEqual([])
  })

  it('carries the detected language into the question it asks', async () => {
    const seed = audiusTrack({ title: 'Косандра', genre: 'Pop' })
    const searchAudius = vi.fn(() => Promise.resolve([]))

    await fetchRelated(describeSeed(seed), { searchAudius })

    expect(searchAudius).toHaveBeenCalledWith('russian Pop', expect.objectContaining({ limit: 20 }))
  })

  it('asks Jamendo through Jamendo, and Audius through the provider', async () => {
    const searchAudius = vi.fn(() => Promise.resolve([]))
    const searchJamendo = vi.fn(() => Promise.resolve({ status: 'success' as const, tracks: [] }))

    await fetchRelated(describeSeed(jamendoTrack({ genre: 'Rock' })), {
      searchAudius,
      searchJamendo,
    })

    expect(searchJamendo).toHaveBeenCalledTimes(1)
    expect(searchAudius).not.toHaveBeenCalled()
  })

  it('returns nothing, rather than failing, when the catalogue is empty', async () => {
    const searchAudius = vi.fn(() => Promise.resolve([]))
    await expect(
      fetchRelated(describeSeed(audiusTrack({ genre: 'Pop' })), { searchAudius }),
    ).resolves.toEqual([])
  })

  it('returns nothing, rather than throwing, when the provider fails outright', async () => {
    const searchAudius = vi.fn(() => Promise.reject(new Error('provider down')))
    await expect(
      fetchRelated(describeSeed(audiusTrack({ genre: 'Pop' })), { searchAudius }),
    ).resolves.toEqual([])
  })

  it('caps what it returns', async () => {
    const seed = audiusTrack({ genre: 'Pop' })
    const many = Array.from({ length: 40 }, () => audiusTrack({ genre: 'Pop' }))
    const searchAudius = vi.fn(() => Promise.resolve(many))

    expect(await fetchRelated(describeSeed(seed), { searchAudius })).toHaveLength(10)
    expect(await fetchRelated(describeSeed(seed), { searchAudius, limit: 3 })).toHaveLength(3)
  })
})

describe('fetching for YouTube', () => {
  const seed = youtubeItem({ title: 'Qele Qele', channelTitle: 'Sirusho' })

  function searchWith(videos: YouTubeVideoItem[]) {
    return vi.fn(() => Promise.resolve({ status: 'success' as const, videos, requests: 1 }))
  }

  it('returns other videos, minus the one playing', async () => {
    const other = youtubeItem({ videoId: 'bbbbbbbbbbb', title: 'PreGomesh' })
    const searchYouTube = searchWith([seed, other])

    const found = await fetchRelated(describeSeed(seed), { searchYouTube })

    expect(found.map((item) => item.id)).toEqual([other.id])
  })

  /**
   * A video the app may not embed is not a continuation — it is a dead end that
   * would strand the listener on an error, so it is filtered by the same
   * predicate that stopped it being playable in the first place.
   */
  it('drops anything it may not embed', async () => {
    const kids = youtubeItem({ videoId: 'kkkkkkkkkkk', madeForKids: true })
    const blocked = youtubeItem({ videoId: 'nnnnnnnnnnn', embeddable: false })
    const good = youtubeItem({ videoId: 'ggggggggggg' })
    const searchYouTube = searchWith([kids, blocked, good])

    const found = await fetchRelated(describeSeed(seed), { searchYouTube })

    expect(found.map((item) => item.id)).toEqual([good.id])
  })

  it('spends no widened limit on a scarce endpoint', async () => {
    const searchYouTube = searchWith([])
    await fetchRelated(describeSeed(seed), { searchYouTube })
    // Query and an optional signal, and nothing else: the route takes no limit.
    expect(searchYouTube).toHaveBeenCalledWith('Sirusho music', {})
  })
})

describe('the session memory', () => {
  it('remembers what started, in order', () => {
    notePlayed('a')
    notePlayed('b')
    expect(playedSessionIds()).toEqual(['a', 'b'])
    expect(hasPlayedInSession('a')).toBe(true)
    expect(hasPlayedInSession('c')).toBe(false)
  })

  it('moves a replayed id to the newest position rather than keeping its place', () => {
    notePlayed('a')
    notePlayed('b')
    notePlayed('a')
    expect(playedSessionIds()).toEqual(['b', 'a'])
  })

  it('evicts the oldest rather than growing without bound', () => {
    for (let index = 0; index < PLAYED_SESSION_LIMIT + 10; index += 1) notePlayed(`id-${index}`)

    expect(playedSessionIds()).toHaveLength(PLAYED_SESSION_LIMIT)
    expect(hasPlayedInSession('id-0')).toBe(false)
    expect(hasPlayedInSession(`id-${PLAYED_SESSION_LIMIT + 9}`)).toBe(true)
  })
})
