import { describe, expect, it } from 'vitest'
import { audiusRef, audiusTrack, trackPool, FIXED_NOW } from '@/test/fixtures/library'
import { MAX_TRACKS_PER_ARTIST } from '@/personalization/config'
import { artistKey, buildProfile, emptyProfile } from '@/personalization/profile'
import type { PersonalizationProfile } from '@/personalization/profile'
import { createEmptyState } from '@/personalization/types'
import type { ListenEntry } from '@/personalization/types'
import type { Track } from '@/music/types'
import { buildMixes, hasMixEvidence, MIX_MINIMUM, MIX_TARGET } from './mixes'
import type { MixInput } from './mixes'
import type { LibraryTrackRef } from './types'

/**
 * Made-for-you mixes.
 *
 * The load-bearing property is honesty: a mix appears only when there is
 * evidence behind it, is deterministic so it does not reshuffle between renders,
 * and never contains something the visitor asked not to see (agents/43).
 */

/** A pool wide enough that a mix could be filled, if the evidence allows it. */
const pool = (count = 90) => trackPool(count, { artists: 45, genre: 'Electronic' })

const warmProfile = (overrides: Partial<PersonalizationProfile> = {}): PersonalizationProfile => ({
  ...emptyProfile(FIXED_NOW),
  stage: 'warm',
  qualifiedListenCount: 5,
  explicitItemCount: 4,
  artistWeights: { [artistKey('Pool Artist 0')]: 0.6, [artistKey('Pool Artist 1')]: 0.4 },
  genreWeights: { electronic: 1 },
  ...overrides,
})

const savedRefs = (count = 4): LibraryTrackRef[] =>
  Array.from({ length: count }, (_, index) =>
    audiusRef({
      key: `audius:p${index}`,
      providerItemId: `p${index}`,
      title: `Pool Track ${index}`,
      artist: `Pool Artist ${index % 45}`,
    }),
  )

const input = (overrides: Partial<MixInput> = {}): MixInput => ({
  profile: warmProfile(),
  saved: savedRefs(),
  candidates: pool(),
  now: FIXED_NOW,
  ...overrides,
})

describe('cold start is honest', () => {
  it('offers nothing at all with an empty profile and an empty library', () => {
    expect(hasMixEvidence(emptyProfile(FIXED_NOW))).toBe(false)
    expect(buildMixes(input({ profile: emptyProfile(FIXED_NOW), saved: [] }))).toEqual([])
  })

  it('offers nothing on one or two saves', () => {
    const profile = { ...emptyProfile(FIXED_NOW), explicitItemCount: 2 }
    expect(hasMixEvidence(profile)).toBe(false)
    expect(buildMixes(input({ profile, saved: savedRefs(2) }))).toEqual([])
  })

  it('accepts either enough listening or enough saving as evidence', () => {
    expect(hasMixEvidence({ ...emptyProfile(FIXED_NOW), explicitItemCount: 3 })).toBe(true)
    expect(hasMixEvidence({ ...emptyProfile(FIXED_NOW), stage: 'warm' })).toBe(true)
    expect(hasMixEvidence({ ...emptyProfile(FIXED_NOW), stage: 'early' })).toBe(false)
  })

  it('offers nothing when the pool cannot fill even one mix', () => {
    expect(buildMixes(input({ candidates: pool(5) }))).toEqual([])
  })

  it('never returns a mix shorter than the minimum, rather than a thin one', () => {
    for (const size of [MIX_MINIMUM + 5, 40, 90]) {
      for (const mix of buildMixes(input({ candidates: pool(size) }))) {
        expect(mix.tracks.length).toBeGreaterThanOrEqual(MIX_MINIMUM)
      }
    }
  })
})

describe('shape', () => {
  it('produces between one and three mixes', () => {
    const mixes = buildMixes(input())
    expect(mixes.length).toBeGreaterThanOrEqual(1)
    expect(mixes.length).toBeLessThanOrEqual(3)
  })

  it('targets a real listening session, not a shelf', () => {
    for (const mix of buildMixes(input())) {
      expect(mix.tracks.length).toBeGreaterThanOrEqual(MIX_MINIMUM)
      expect(mix.tracks.length).toBeLessThanOrEqual(MIX_TARGET)
    }
  })

  it('caps each artist, so nobody owns a mix', () => {
    for (const mix of buildMixes(input({ candidates: trackPool(90, { artists: 4 }) }))) {
      const counts = new Map<string, number>()
      for (const track of mix.tracks) {
        const key = artistKey(track.artistName)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      for (const count of counts.values()) expect(count).toBeLessThanOrEqual(MAX_TRACKS_PER_ARTIST)
    }
  })

  it('never repeats a track across two mixes', () => {
    const seen = new Set<string>()
    for (const mix of buildMixes(input())) {
      for (const track of mix.tracks) {
        expect(seen.has(track.id)).toBe(false)
        seen.add(track.id)
      }
    }
  })

  it('labels every mix without claiming anything about the listener', () => {
    for (const mix of buildMixes(input())) {
      const text = `${mix.title} ${mix.description}`.toLowerCase()
      for (const forbidden of [
        'nationality',
        'ethnic',
        'religio',
        'arab people',
        'because you are',
      ]) {
        expect(text).not.toContain(forbidden)
      }
      expect(mix.title.length).toBeGreaterThan(0)
      expect(mix.description.length).toBeGreaterThan(0)
    }
  })
})

describe('determinism', () => {
  it('gives the same mixes for the same inputs', () => {
    const first = buildMixes(input())
    const second = buildMixes(input())
    expect(first.map((m) => m.tracks.map((t) => t.id))).toEqual(
      second.map((m) => m.tracks.map((t) => t.id)),
    )
  })

  it('does not depend on the order the pool happens to arrive in', () => {
    const base = pool()
    const ordered = buildMixes(input({ candidates: base }))
    const reversed = buildMixes(input({ candidates: [...base].reverse() }))
    // Ranking is by score with a stable id tiebreak, so the top mix is the same
    // set regardless of arrival order.
    expect(new Set(reversed[0].tracks.map((t) => t.id))).toEqual(
      new Set(ordered[0].tracks.map((t) => t.id)),
    )
  })
})

describe('exclusions', () => {
  it('leaves out anything marked Not interested', () => {
    const hidden = ['audius:p10', 'audius:p11', 'audius:p12']
    for (const mix of buildMixes(input({ hidden }))) {
      for (const key of hidden) {
        expect(mix.tracks.map((t) => t.id)).not.toContain(key)
      }
    }
  })

  it('leaves out what is already saved — that is the library, not a suggestion', () => {
    const saved = savedRefs(6)
    for (const mix of buildMixes(input({ saved }))) {
      for (const ref of saved) {
        expect(mix.tracks.map((t) => t.id)).not.toContain(ref.key)
      }
    }
  })

  it('leaves out what is already in the queue', () => {
    const queuedIds = ['audius:p20', 'audius:p21']
    for (const mix of buildMixes(input({ queuedIds }))) {
      for (const id of queuedIds) expect(mix.tracks.map((t) => t.id)).not.toContain(id)
    }
  })

  it('suppresses what was just played, and what has been played too often', () => {
    const history: ListenEntry[] = [
      {
        id: 'audius:p30',
        provider: 'audius',
        mediaKind: 'audio',
        providerItemId: 'p30',
        title: 'Pool Track 30',
        artist: 'Pool Artist 30',
        context: 'search',
        startedAt: FIXED_NOW,
        qualifiedAt: FIXED_NOW,
        // Played an hour ago: still fresh in mind.
        lastPlayedAt: FIXED_NOW - 3_600_000,
        playedSeconds: 200,
        completionRatio: 1,
        playCount: 1,
        skipCount: 0,
        playedDays: [],
        storedAt: FIXED_NOW,
      },
      {
        id: 'audius:p31',
        provider: 'audius',
        mediaKind: 'audio',
        providerItemId: 'p31',
        title: 'Pool Track 31',
        artist: 'Pool Artist 31',
        context: 'search',
        startedAt: FIXED_NOW,
        qualifiedAt: FIXED_NOW,
        // Long ago, but played many times: no longer a recommendation.
        lastPlayedAt: FIXED_NOW - 100 * 86_400_000,
        playedSeconds: 2000,
        completionRatio: 1,
        playCount: 9,
        skipCount: 0,
        playedDays: [],
        storedAt: FIXED_NOW,
      },
    ]

    for (const mix of buildMixes(input({ history }))) {
      expect(mix.tracks.map((t) => t.id)).not.toContain('audius:p30')
      expect(mix.tracks.map((t) => t.id)).not.toContain('audius:p31')
    }
  })

  it('leaves out anything that cannot be streamed', () => {
    const candidates: Track[] = pool().map((track, index) =>
      index % 3 === 0 ? { ...track, isStreamable: false } : track,
    )
    for (const mix of buildMixes(input({ candidates }))) {
      for (const track of mix.tracks) expect(track.isStreamable).toBe(true)
    }
  })
})

describe('exploration', () => {
  it('includes artists the profile has never seen', () => {
    const mixes = buildMixes(input())
    const known = new Set(Object.keys(warmProfile().artistWeights))
    const yourMix = mixes.find((mix) => mix.id === 'your-mix')!
    const fresh = yourMix.tracks.filter((track) => !known.has(artistKey(track.artistName)))
    expect(fresh.length).toBeGreaterThan(0)
  })
})

describe('YouTube is absent from the whole pipeline', () => {
  it('cannot receive a YouTube candidate, because the pool is Track[]', () => {
    // A compile-time property, restated at runtime: every candidate has the
    // audio discriminant, so nothing YouTube-shaped can be in the pool at all.
    for (const track of pool()) expect(track.mediaKind).toBe('audio')
  })

  it('produces mixes containing only catalogue providers', () => {
    for (const mix of buildMixes(input())) {
      for (const track of mix.tracks) {
        expect(['audius', 'jamendo']).toContain(track.provider)
      }
    }
  })
})

describe('composition rather than a second engine', () => {
  it('ranks by the existing profile alignment, so a matching genre wins', () => {
    const profile = warmProfile({
      genreWeights: { jazz: 1 },
      artistWeights: {},
    })
    const candidates = [
      ...trackPool(40, { artists: 40, genre: 'Jazz' }),
      ...trackPool(40, { artists: 40, genre: 'Metal' }).map((track, index) => ({
        ...track,
        id: `audius:m${index}`,
        providerId: `m${index}`,
        artistName: `Metal Artist ${index}`,
      })),
    ]
    const yourMix = buildMixes(input({ profile, candidates, saved: [] })).find(
      (mix) => mix.id === 'your-mix',
    )!
    const jazz = yourMix.tracks.filter((track) => track.genre === 'Jazz').length
    expect(jazz).toBeGreaterThan(yourMix.tracks.length / 2)
  })

  it('uses a real derived profile end to end', () => {
    const profile = buildProfile(
      { ...createEmptyState(FIXED_NOW), consent: 'granted' },
      FIXED_NOW,
      {
        items: savedRefs(5).map((ref) => ({
          key: ref.key,
          provider: 'audius' as const,
          title: ref.title,
          artist: ref.artist,
          liked: true,
          inPlaylist: false,
          savedAt: FIXED_NOW,
        })),
        hiddenKeys: [],
      },
    )
    expect(profile.explicitItemCount).toBe(5)
    const mixes = buildMixes(input({ profile, saved: savedRefs(5) }))
    expect(mixes.length).toBeGreaterThan(0)
  })
})

describe('a saved mix is a snapshot', () => {
  it('is an ordinary list of tracks, with nothing tying it back to the generator', () => {
    const mix = buildMixes(input())[0]
    // Exactly what `MixCard` writes into a playlist: an ordered list of tracks.
    expect(Array.isArray(mix.tracks)).toBe(true)
    for (const track of mix.tracks) expect(track).toEqual(expect.objectContaining({ id: expect.any(String) }))
    expect(mix.tracks).not.toBe(buildMixes(input())[0].tracks)
  })

  it('changes when the evidence changes, which is why saving one matters', () => {
    const before = buildMixes(input())[0].tracks.map((t) => t.id)
    const after = buildMixes(
      input({
        profile: warmProfile({
          artistWeights: { [artistKey('Pool Artist 20')]: 1 },
        }),
      }),
    )[0].tracks.map((t) => t.id)
    expect(after).not.toEqual(before)
  })
})

describe('a mix never costs a request', () => {
  it('is a pure function of what the caller already holds', () => {
    // No provider is reachable from `buildMixes`: it takes tracks and returns
    // tracks. This test documents the contract the hook depends on.
    const candidates = pool()
    const result = buildMixes(input({ candidates }))
    expect(result.every((mix) => mix.tracks.every((track) => candidates.includes(track)))).toBe(
      true,
    )
  })

  it('leaves the input untouched', () => {
    const candidates = pool()
    const snapshot = candidates.map((track) => track.id)
    buildMixes(input({ candidates }))
    expect(candidates.map((track) => track.id)).toEqual(snapshot)
  })
})

describe('the audius track fixture', () => {
  it('is a plain catalogue track', () => {
    expect(audiusTrack().provider).toBe('audius')
  })
})
