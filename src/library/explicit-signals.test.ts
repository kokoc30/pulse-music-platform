import { beforeEach, describe, expect, it } from 'vitest'
import { audiusRef, jamendoRef, libraryWith, playlist, youtubeRef, FIXED_NOW } from '@/test/fixtures/library'
import {
  EXPLICIT_LIKE_WEIGHT,
  EXPLICIT_MIN_DECAY,
  EXPLICIT_PLAYLIST_WEIGHT,
  MAX_REPEAT_FACTOR,
  WEIGHTS,
} from '@/personalization/config'
import { readExplicitIntent, setExplicitIntentSource } from '@/personalization/explicit-intent'
import type { ExplicitIntent } from '@/personalization/explicit-intent'
import { artistKey, buildProfile, explicitWeight } from '@/personalization/profile'
import { usePersonalizationStore } from '@/personalization/store'
import { createEmptyState } from '@/personalization/types'
import type { PersonalizationState } from '@/personalization/types'
import { connectLibraryToPersonalization } from './bridge'
import { explicitIntentFrom } from './selectors'
import { useLibraryStore } from './store'
import { createEmptyLibrary } from './types'

/**
 * Explicit library intent as a recommendation signal.
 *
 * Three properties matter and each is tested independently: the signal exists
 * and is strong, it is *bounded* so membership cannot multiply it, and it is
 * gated on personalization consent (agents/43).
 */

const consented = (): PersonalizationState => ({
  ...createEmptyState(FIXED_NOW),
  consent: 'granted',
})

beforeEach(() => {
  setExplicitIntentSource(null)
  useLibraryStore.getState().replaceState(createEmptyLibrary(FIXED_NOW))
})

describe('what the library reports to the profile', () => {
  it('reports one item per track, carrying two booleans', () => {
    const intent = explicitIntentFrom(
      libraryWith({
        tracks: [audiusRef(), jamendoRef()],
        liked: ['audius:t1'],
        playlists: [playlist({ itemKeys: ['jamendo:1880336'] })],
      }),
    )

    expect(intent.items).toHaveLength(2)
    expect(intent.items.find((i) => i.key === 'audius:t1')).toEqual(
      expect.objectContaining({ liked: true, inPlaylist: false }),
    )
    expect(intent.items.find((i) => i.key === 'jamendo:1880336')).toEqual(
      expect.objectContaining({ liked: false, inPlaylist: true }),
    )
  })

  it('reports a track in many playlists exactly once, with no count anywhere', () => {
    const lists = Array.from({ length: 5 }, (_, index) =>
      playlist({ id: `pl_${index}`, name: `List ${index}`, itemKeys: ['audius:t1'] }),
    )
    const intent = explicitIntentFrom(
      libraryWith({ tracks: [audiusRef()], playlists: lists }),
    )

    expect(intent.items).toHaveLength(1)
    expect(intent.items[0].inPlaylist).toBe(true)
    // There is no field that could carry "five".
    expect(JSON.stringify(intent.items[0])).not.toContain('5')
  })

  it('never reports a YouTube save, at the source', () => {
    const intent = explicitIntentFrom(
      libraryWith({
        tracks: [audiusRef(), youtubeRef()],
        liked: ['youtube:aaaaaaaaaaa', 'audius:t1'],
        playlists: [playlist({ itemKeys: ['youtube:aaaaaaaaaaa'] })],
      }),
    )

    expect(intent.items.map((item) => item.key)).toEqual(['audius:t1'])
    expect(JSON.stringify(intent.items)).not.toContain('youtube')
    expect(JSON.stringify(intent.items)).not.toContain('Sirusho')
  })

  it('reports hidden keys for every provider, because a shelf can hold any', () => {
    const intent = explicitIntentFrom(
      libraryWith({ hidden: ['audius:h1', 'youtube:aaaaaaaaaaa'] }),
    )
    expect(intent.hiddenKeys).toEqual(['audius:h1', 'youtube:aaaaaaaaaaa'])
  })
})

describe('the weight one explicit item carries', () => {
  const item = (overrides: Partial<ExplicitIntent['items'][number]> = {}) => ({
    key: 'audius:t1',
    provider: 'audius' as const,
    title: 'Neon Corridor',
    artist: 'Aster Vale',
    liked: false,
    inPlaylist: false,
    savedAt: FIXED_NOW,
    ...overrides,
  })

  it('is zero for something neither liked nor playlisted', () => {
    expect(explicitWeight(item(), FIXED_NOW)).toBe(0)
  })

  it('makes a like the strongest single explicit statement', () => {
    expect(explicitWeight(item({ liked: true }), FIXED_NOW)).toBe(EXPLICIT_LIKE_WEIGHT)
  })

  it('makes playlist membership weaker than a like, but real', () => {
    const playlisted = explicitWeight(item({ inPlaylist: true }), FIXED_NOW)
    expect(playlisted).toBe(EXPLICIT_PLAYLIST_WEIGHT)
    expect(playlisted).toBeLessThan(EXPLICIT_LIKE_WEIGHT)
    expect(playlisted).toBeGreaterThan(0)
  })

  it('adds the two once each, and no more', () => {
    expect(explicitWeight(item({ liked: true, inPlaylist: true }), FIXED_NOW)).toBe(
      EXPLICIT_LIKE_WEIGHT + EXPLICIT_PLAYLIST_WEIGHT,
    )
  })

  it('outranks one ordinary listen but not a genuinely repeated one', () => {
    // A like is a deliberate statement; pressing play once is not.
    expect(EXPLICIT_LIKE_WEIGHT).toBeGreaterThan(WEIGHTS.qualified)
    // But someone who has come back to a track for weeks still outweighs it.
    const repeatedListen = (WEIGHTS.qualified + WEIGHTS.completion + WEIGHTS.distinctDay) *
      MAX_REPEAT_FACTOR
    expect(EXPLICIT_LIKE_WEIGHT + EXPLICIT_PLAYLIST_WEIGHT).toBeLessThan(repeatedListen)
  })

  it('fades with age but never below half, because a like is a statement', () => {
    const old = explicitWeight(
      item({ liked: true, savedAt: FIXED_NOW - 400 * 86_400_000 }),
      FIXED_NOW,
    )
    expect(old).toBeCloseTo(EXPLICIT_LIKE_WEIGHT * EXPLICIT_MIN_DECAY, 5)
    expect(old).toBeLessThan(EXPLICIT_LIKE_WEIGHT)
  })
})

describe('the profile built from explicit intent', () => {
  const intentFor = (state = libraryWith({
    tracks: [audiusRef()],
    liked: ['audius:t1'],
  })) => explicitIntentFrom(state)

  it('gives a liked artist real weight without a single listen', () => {
    const profile = buildProfile(consented(), FIXED_NOW, intentFor())
    expect(profile.artistWeights[artistKey('Aster Vale')]).toBeGreaterThan(0)
    expect(profile.genreWeights.electronic).toBeGreaterThan(0)
    expect(profile.explicitItemCount).toBe(1)
  })

  it('does not multiply weight with playlist count', () => {
    const one = buildProfile(
      consented(),
      FIXED_NOW,
      explicitIntentFrom(
        libraryWith({
          tracks: [audiusRef(), jamendoRef()],
          playlists: [playlist({ id: 'pl_a', itemKeys: ['audius:t1'] })],
          liked: ['jamendo:1880336'],
        }),
      ),
    )
    const five = buildProfile(
      consented(),
      FIXED_NOW,
      explicitIntentFrom(
        libraryWith({
          tracks: [audiusRef(), jamendoRef()],
          playlists: Array.from({ length: 5 }, (_, index) =>
            playlist({ id: `pl_${index}`, name: `L${index}`, itemKeys: ['audius:t1'] }),
          ),
          liked: ['jamendo:1880336'],
        }),
      ),
    )

    // Normalized shares are identical, which is only possible if the raw
    // contribution did not grow with membership count.
    expect(five.artistWeights[artistKey('Aster Vale')]).toBeCloseTo(
      one.artistWeights[artistKey('Aster Vale')],
      10,
    )
  })

  it('lets a like outrank playlist membership for the same artist', () => {
    const profile = buildProfile(
      consented(),
      FIXED_NOW,
      explicitIntentFrom(
        libraryWith({
          tracks: [audiusRef(), jamendoRef()],
          liked: ['audius:t1'],
          playlists: [playlist({ itemKeys: ['jamendo:1880336'] })],
        }),
      ),
    )
    expect(profile.artistWeights[artistKey('Aster Vale')]).toBeGreaterThan(
      profile.artistWeights[artistKey('Lumen Field')],
    )
  })

  it('removes the contribution when the like is removed', () => {
    const liked = buildProfile(consented(), FIXED_NOW, intentFor())
    const unliked = buildProfile(
      consented(),
      FIXED_NOW,
      explicitIntentFrom(libraryWith({ tracks: [], liked: [] })),
    )

    expect(liked.artistWeights[artistKey('Aster Vale')]).toBeGreaterThan(0)
    expect(unliked.artistWeights[artistKey('Aster Vale')]).toBeUndefined()
    expect(unliked.explicitItemCount).toBe(0)
  })

  it('carries hidden keys as an exclusion list, not as a negative weight', () => {
    const profile = buildProfile(
      consented(),
      FIXED_NOW,
      explicitIntentFrom(
        libraryWith({ tracks: [audiusRef()], liked: ['audius:t1'], hidden: ['audius:h9'] }),
      ),
    )

    expect(profile.hiddenItemIds).toEqual(['audius:h9'])
    // Every weight stays non-negative: one refusal is never generalised into an
    // opinion about an artist, a genre or a script.
    for (const map of [profile.artistWeights, profile.genreWeights, profile.tokenWeights]) {
      for (const value of Object.values(map)) expect(value).toBeGreaterThanOrEqual(0)
    }
  })

  it('does not let a liked artist masquerade as a listened-to one', () => {
    const profile = buildProfile(consented(), FIXED_NOW, intentFor())
    const artist = profile.artists.find((a) => a.key === artistKey('Aster Vale'))
    // "Because you listened to …" needs real plays, and a like is not one.
    expect(artist?.plays).toBe(0)
    expect(profile.qualifiedListenCount).toBe(0)
  })
})

describe('consent gating', () => {
  it('reads nothing when no source is registered', () => {
    expect(readExplicitIntent()).toEqual({ items: [], hiddenKeys: [] })
  })

  it('survives a source that throws, rather than taking the page down', () => {
    setExplicitIntentSource(() => {
      throw new Error('boom')
    })
    expect(readExplicitIntent()).toEqual({ items: [], hiddenKeys: [] })
  })

  it('keeps the library working while refusing to train the profile', () => {
    usePersonalizationStore.getState().setConsent('denied')
    connectLibraryToPersonalization()

    useLibraryStore.getState().like(audiusRef())

    // The like landed…
    expect(useLibraryStore.getState().state.likedTrackKeys).toEqual(['audius:t1'])
    // …and taught the profile nothing.
    const { profile } = usePersonalizationStore.getState()
    expect(profile.artistWeights).toEqual({})
    expect(profile.explicitItemCount).toBe(0)
  })

  it('feeds the profile once consent is granted', () => {
    usePersonalizationStore.setState({ state: consented() })
    connectLibraryToPersonalization()

    useLibraryStore.getState().like(audiusRef())

    const { profile } = usePersonalizationStore.getState()
    expect(profile.explicitItemCount).toBe(1)
    expect(profile.artistWeights[artistKey('Aster Vale')]).toBeGreaterThan(0)
  })

  it('recomputes the profile on every library change, without writing to personalization storage', () => {
    usePersonalizationStore.setState({ state: consented() })
    connectLibraryToPersonalization()
    const before = usePersonalizationStore.getState().state.updatedAt

    useLibraryStore.getState().like(audiusRef())
    useLibraryStore.getState().unlike('audius:t1')

    expect(usePersonalizationStore.getState().profile.explicitItemCount).toBe(0)
    // Library activity is not behavioural history and must not appear in it.
    expect(usePersonalizationStore.getState().state.updatedAt).toBe(before)
    expect(usePersonalizationStore.getState().state.listeningHistory).toEqual([])
  })
})
