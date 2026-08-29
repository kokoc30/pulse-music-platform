import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isSameSongVariant } from '@/music/song-identity'
import type { Track } from '@/music/types'
import { resetPersonalizationForTests } from '@/personalization'
import { bufferedCandidates, clearAutoplayBuffer, refillBuffer, takeFromBuffer } from './buffer'
import { clearSessionPool, rememberTracks } from './session-pool'

/**
 * Autoplay against a catalogue full of re-uploads.
 *
 * Every row below is the shape the live Audius API really returns for
 * `Kosandra`: the same recording uploaded thirteen times by throwaway accounts
 * (`tttyyu7`, `ldhcuhu`, `ssss`, …), plus a handful of unrelated rows that
 * happen to share the word.
 *
 * That data is what broke the reported flow. The uploader lands in
 * `artistName`, so the same-song rule compared `tttyyu7` against `dfghjb`,
 * concluded "different artists, therefore different songs", and let autoplay
 * follow Kosandra with Kosandra — thirteen times over.
 */

/** `[title, uploader, genre, bpm]`, verbatim from the live search. */
const KOSANDRA_ROWS: Array<[string, string, string | null, number | null]> = [
  ['Miyagi & Andy Panda - Kosandra (Official Audio)', 'tttyyu7', 'Experimental', 142.1],
  ['Miyagi & Andy Panda - Kosandra (Official Audio)', 'ldhcuhu', 'Hip-Hop/Rap', 142.1],
  ['Kosandra Miyagi & Andy Panda Nitrixx Bass House Remix', 'Nick11', null, 140],
  ['Miyagi & Andy Panda - Kosandra (Official Audio)', 'ssss', 'Hip-Hop/Rap', 142.1],
  ['Miyagi & Andy Panda - Kosandra (Official Audio)', 'eee4456', 'Metal', 142.1],
  ['Miyagi & Andy Panda - Kosandra (Official Audio)', 'ihiuhb', 'Hip-Hop/Rap', 142.1],
  ['Miyagi & Andy Panda - Kosandra (Official Audio)', 'eeeeeeeerrrrrrr', 'Experimental', 142.1],
  ['Miyagi & Andy Panda - Kosandra (Official Audio)', 'sdfbgfr', 'Electronic', 142.1],
  ['Miyagi & Andy Panda - Kosandra (Official Audio)', 'dfghjb', 'Experimental', 142.1],
  ['Miyagi & Andy Panda - Kosandra (Official Audio)', 'htythy', 'Punk', 142.1],
]

const rows: Track[] = KOSANDRA_ROWS.map(([title, uploader, genre, bpm], index) => ({
  id: `audius:k${index}`,
  mediaKind: 'audio',
  provider: 'audius',
  providerId: `k${index}`,
  title,
  artistName: uploader,
  artwork: {},
  durationSeconds: 200,
  isStreamable: true,
  ...(genre ? { genre } : {}),
  ...(bpm ? { bpm } : {}),
}))

const seed = rows[0]

/**
 * Only the re-uploads — the genuinely exhausted case.
 *
 * The full page also carries a remix, which is a different take and a perfectly
 * good thing to play next, so a test about running out has to exclude it.
 */
const REUPLOADS_ONLY = rows.filter((row) => row.title.startsWith('Miyagi'))

function otherTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'audius:other',
    mediaKind: 'audio',
    provider: 'audius',
    providerId: 'other',
    title: 'A Completely Different Song',
    artistName: 'Someone Else',
    artwork: {},
    durationSeconds: 180,
    isStreamable: true,
    genre: 'Experimental',
    ...overrides,
  }
}

beforeEach(() => {
  resetPersonalizationForTests()
  clearSessionPool()
  clearAutoplayBuffer()
})

describe('two uploads of one song are one song, whoever posted them', () => {
  it('matches them even though the uploaders differ completely', () => {
    expect(isSameSongVariant(rows[0], rows[8])).toBe(true)
  })

  it('matches across every re-upload in the real result page', () => {
    const reuploads = rows.filter((row) => row.title.startsWith('Miyagi'))
    expect(reuploads.length).toBeGreaterThan(5)
    for (const row of reuploads) {
      expect(isSameSongVariant(seed, row)).toBe(true)
    }
  })

  it('still lets the remix through, because a remix is a different take', () => {
    const remix = rows.find((row) => row.title.includes('Remix')) as Track
    expect(isSameSongVariant(seed, remix)).toBe(false)
  })

  it('does not collapse two different songs that merely share a word', () => {
    const indra: Track = otherTrack({ title: 'Indra Indra Madhuchandra ! Kosandra ! Bgm (1)' })
    expect(isSameSongVariant(seed, indra)).toBe(false)
  })
})

describe('planning from that page', () => {
  it('never offers another upload of the song that just played', async () => {
    rememberTracks(rows)
    await refillBuffer({ seed, queuedIds: [seed.id], recentIds: [] })

    for (const candidate of bufferedCandidates()) {
      expect(isSameSongVariant(seed, candidate.track)).toBe(false)
      expect(candidate.track.id).not.toBe(seed.id)
    }
  })

  it('offers a genuinely different song when the page holds one', async () => {
    rememberTracks([...rows, otherTrack()])
    await refillBuffer({ seed, queuedIds: [seed.id], recentIds: [] })

    const next = takeFromBuffer()
    expect(next).not.toBeNull()
    expect(isSameSongVariant(seed, next!)).toBe(false)
  })
})

describe('the bounded genre fallback', () => {
  it('is not spent while the free pool can answer', async () => {
    const fetchByGenre = vi.fn(() => Promise.resolve([otherTrack()]))
    rememberTracks([...rows, otherTrack({ id: 'audius:free', providerId: 'free' })])

    await refillBuffer({ seed, queuedIds: [seed.id], recentIds: [], sources: { fetchByGenre } })

    expect(fetchByGenre).not.toHaveBeenCalled()
  })

  it('is spent exactly once when the free pool is all re-uploads', async () => {
    const fetchByGenre = vi.fn(() => Promise.resolve([otherTrack()]))
    rememberTracks(REUPLOADS_ONLY)

    await refillBuffer({ seed, queuedIds: [seed.id], recentIds: [], sources: { fetchByGenre } })

    expect(fetchByGenre).toHaveBeenCalledTimes(1)
    expect(fetchByGenre).toHaveBeenCalledWith(seed.genre, undefined)
    expect(takeFromBuffer()?.id).toBe('audius:other')
  })

  it('is never retried when it too comes back empty', async () => {
    const fetchByGenre = vi.fn((): Promise<Track[]> => Promise.resolve([]))
    rememberTracks(REUPLOADS_ONLY)

    await refillBuffer({ seed, queuedIds: [seed.id], recentIds: [], sources: { fetchByGenre } })

    expect(fetchByGenre).toHaveBeenCalledTimes(1)
    expect(takeFromBuffer()).toBeNull()
  })

  it('is not spent at all when the seed carries no genre to scope it by', async () => {
    const fetchByGenre = vi.fn(() => Promise.resolve([otherTrack()]))
    const { genre: _dropped, ...withoutGenre } = seed
    rememberTracks(REUPLOADS_ONLY)

    await refillBuffer({
      seed: withoutGenre,
      queuedIds: [seed.id],
      recentIds: [],
      sources: { fetchByGenre },
    })

    expect(fetchByGenre).not.toHaveBeenCalled()
  })

  it('never returns the seed itself, however the fallback answers', async () => {
    const fetchByGenre = vi.fn(() => Promise.resolve([seed, otherTrack()]))
    rememberTracks(REUPLOADS_ONLY)

    await refillBuffer({ seed, queuedIds: [seed.id], recentIds: [], sources: { fetchByGenre } })

    for (const candidate of bufferedCandidates()) {
      expect(candidate.track.id).not.toBe(seed.id)
    }
  })

  it('survives a failing fallback without throwing', async () => {
    const fetchByGenre = vi.fn((): Promise<Track[]> => Promise.reject(new Error('provider down')))
    rememberTracks(REUPLOADS_ONLY)

    await expect(
      refillBuffer({ seed, queuedIds: [seed.id], recentIds: [], sources: { fetchByGenre } }),
    ).resolves.toBeUndefined()
    expect(takeFromBuffer()).toBeNull()
  })
})
