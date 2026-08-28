import { describe, expect, it } from 'vitest'
import type { Artist, Track } from '@/music/types'
import {
  MAX_POPULARITY_BONUS,
  MIN_RELEVANCE,
  STRONG_RELEVANCE,
  popularityBonus,
  scoreArtist,
  scoreTrack,
} from './relevance'
import { diceCoefficient, editSimilarity, fuzzySimilarity, tokenMatchScore } from './similarity'
import { normalizeText } from './text'

const track = (title: string, artistName: string, extra: Partial<Track> = {}): Track => ({
  id: `audius:${title}`,
  mediaKind: 'audio',
  provider: 'audius',
  providerId: title,
  title,
  artistName,
  artwork: {},
  durationSeconds: 200,
  isStreamable: true,
  ...extra,
})

const artist = (name: string, handle = name.toLowerCase()): Artist => ({
  id: `audius:${handle}`,
  provider: 'audius',
  providerId: handle,
  name,
  handle,
  artwork: {},
  isVerified: false,
})

const score = (query: string, candidate: Track) => scoreTrack(normalizeText(query), candidate).score

describe('similarity primitives', () => {
  it('dice is 1 for identical and 0 for disjoint strings', () => {
    expect(diceCoefficient('kosandra', 'kosandra')).toBe(1)
    expect(diceCoefficient('abc', 'xyz')).toBe(0)
  })

  it('dice works on non-Latin scripts', () => {
    expect(diceCoefficient('кассандра', 'кассандра')).toBe(1)
    expect(diceCoefficient('سارة', 'سارة')).toBe(1)
    expect(diceCoefficient('كاسندرا', 'سارة')).toBeLessThan(0.5)
  })

  it('edit similarity tolerates a single typo', () => {
    expect(editSimilarity('kosandra', 'kosandrx')).toBeGreaterThan(0.8)
    expect(fuzzySimilarity('skrillex', 'skrilex')).toBeGreaterThan(0.8)
  })

  it('token matching prefers exact over prefix over fuzzy', () => {
    expect(tokenMatchScore('kosandra', ['kosandra'])).toBe(1)
    expect(tokenMatchScore('kosandra', ['kosandras'])).toBeGreaterThan(0.9)
    expect(tokenMatchScore('kosandra', ['nothing', 'unrelated'])).toBeLessThan(0.3)
  })

  it('ignores coincidental short overlap', () => {
    expect(tokenMatchScore('swas', ['washiwasha'])).toBeLessThan(0.6)
  })

  it('refuses a short token buried inside a much longer word', () => {
    // Both are real substrings of a real Audius title.
    expect(tokenMatchScore('swas', ['jesuswasarapper'])).toBeLessThan(0.5)
    expect(tokenMatchScore('sara', ['jesuswasarapper'])).toBeLessThan(0.5)
    expect(tokenMatchScore('sara', ['sarabande'])).toBeLessThan(0.5)
  })

  it('still rewards a genuine prefix of a comparable word', () => {
    expect(tokenMatchScore('skrill', ['skrillex'])).toBeGreaterThan(0.8)
    expect(tokenMatchScore('sawas', ['alsawas'])).toBeGreaterThan(0.7)
  })
})

describe('scoreTrack — exact matches', () => {
  it('scores an exact title match at the top', () => {
    expect(score('Kosandra', track('Kosandra', 'Miyagi'))).toBeGreaterThanOrEqual(0.9)
  })

  it('scores an exact artist match strongly', () => {
    expect(score('Skrillex', track('Kliptown Empyrean', 'Skrillex'))).toBeGreaterThanOrEqual(
      STRONG_RELEVANCE,
    )
  })

  it('rewards matching both title and artist', () => {
    const both = score('miyagi kosandra', track('Kosandra', 'Miyagi & Andy Panda'))
    const titleOnly = score('miyagi kosandra', track('Kosandra', 'Unrelated Uploader'))
    expect(both).toBeGreaterThan(titleOnly)
  })

  it('finds the query inside a long, noisy title', () => {
    const noisy = track('Miyagi & Andy Panda - Kosandra (Official Audio)', 'tttyyu7')
    expect(score('kosandra', noisy)).toBeGreaterThanOrEqual(STRONG_RELEVANCE)
  })
})

describe('scoreTrack — spelling and punctuation', () => {
  it('is unaffected by punctuation differences', () => {
    const plain = score('sara al swas', track('Sara Al Swas', 'Someone'))
    const punctuated = score('sara al-swas!', track('Sara  Al  Swas', 'Someone'))
    expect(punctuated).toBeCloseTo(plain, 5)
  })

  it('matches across the particle join', () => {
    expect(score('sara al swas', track('Sara Alswas', 'Someone'))).toBeGreaterThanOrEqual(
      STRONG_RELEVANCE,
    )
  })

  it('tolerates a small misspelling', () => {
    expect(score('skrilex', track('Kliptown Empyrean', 'Skrillex'))).toBeGreaterThanOrEqual(
      MIN_RELEVANCE,
    )
  })

  it('is diacritic-insensitive', () => {
    expect(score('beyonce', track('Halo', 'Beyoncé'))).toBeGreaterThanOrEqual(STRONG_RELEVANCE)
  })

  it('repairs a Cyrillic homoglyph inside a Latin title', () => {
    // Real Audius data: `kosandrа` ends with Cyrillic U+0430.
    expect(score('kosandra', track('miyagi, andy panda - kosandrа', 'Pure Thrill'))).toBeGreaterThanOrEqual(
      STRONG_RELEVANCE,
    )
  })
})

describe('scoreTrack — non-Latin scripts', () => {
  it('matches an Arabic query to an Arabic title', () => {
    expect(score('سارة السواس', track('سارة السواس - أغنية', 'فنان'))).toBeGreaterThanOrEqual(
      STRONG_RELEVANCE,
    )
  })

  it('matches a Cyrillic query to a Cyrillic title', () => {
    expect(score('мияги', track('мияги&эндшпиль - Музыка', 'Amateus'))).toBeGreaterThanOrEqual(
      STRONG_RELEVANCE,
    )
  })

  it('matches an Armenian query to an Armenian title', () => {
    expect(score('Սերժ', track('Սերժ Թանկյան', 'Artist'))).toBeGreaterThanOrEqual(MIN_RELEVANCE)
  })

  it('does not match across unrelated scripts', () => {
    expect(score('سارة السواس', track('Kosandra', 'Miyagi'))).toBeLessThan(MIN_RELEVANCE)
    expect(score('кассандра', track('Cinta Terbaik', 'Cassandra'))).toBeLessThan(MIN_RELEVANCE)
  })
})

describe('scoreTrack — rejecting noise', () => {
  /** Verbatim rows the live Audius API returns for `sara al swas`. */
  const noise = [
    track("Shit (Washiwasha 'SOY MODERNO POR PONERLE DEMBOW A LA MÚSICA BASS' 2021 Edit) - Marauda", 'djwashiwasha'),
    track('EMAS HANTARAN - ARIEF FT. YOLLANDA (LIVE) PENDOPO LAWAS TRI SUAKA NABILA MAHARANI', 'agon'),
    track('Radio Wasteland - Paranormal Oddities with Benjamin Radford (3)', 'Radio Wasteland'),
    track('PARAS - LOWAS GV RMX', 'luis garcia vasquez'),
    track('carwash (die by the sword) - bladee prod. whitearmor', 'parasite'),
  ]

  it('rejects every unrelated row the provider returned', () => {
    for (const candidate of noise) {
      expect(score('sara al swas', candidate)).toBeLessThan(MIN_RELEVANCE)
    }
  })

  it('rejects the widest real false positives too', () => {
    // Every one of these is a verbatim live API row for `sara al swas`.
    const wider = [
      track('JesusWasARapper', '8th-Light'),
      track('Game Of Thrones Ringtone Guitar _ Free Ringtones Download', 'Sagar Biswas'),
      track('Ayawaska Kara Karar', 'ayahuasca songs'),
      track('trackwasher - sarabande', 'trackwasher'),
    ]
    for (const candidate of wider) {
      expect(score('sara al swas', candidate)).toBeLessThan(MIN_RELEVANCE)
    }
  })

  it('still accepts a genuine match for the same query', () => {
    expect(score('sara al swas', track('Sara Al Sawas - Ya Habibi', 'Sara Al Sawas'))).toBeGreaterThanOrEqual(
      STRONG_RELEVANCE,
    )
  })
})

describe('popularity is only a tie-breaker', () => {
  it('is capped', () => {
    expect(popularityBonus(1_000_000_000)).toBeLessThanOrEqual(MAX_POPULARITY_BONUS)
    expect(popularityBonus(0)).toBe(0)
    expect(popularityBonus(undefined)).toBe(0)
    expect(popularityBonus(Number.NaN)).toBe(0)
  })

  it('cannot lift an irrelevant but wildly popular track over a relevant one', () => {
    const popularNoise = score('kosandra', track('Something Else Entirely', 'Nobody', { playCount: 500_000_000 }))
    const relevant = score('kosandra', track('Kosandra', 'Miyagi', { playCount: 1 }))
    expect(relevant).toBeGreaterThan(popularNoise)
    expect(popularNoise).toBeLessThan(MIN_RELEVANCE)
  })

  it('breaks ties between equally relevant tracks', () => {
    const popular = score('kosandra', track('Kosandra', 'Miyagi', { playCount: 1_000_000 }))
    const obscure = score('kosandra', track('Kosandra', 'Miyagi', { playCount: 0 }))
    expect(popular).toBeGreaterThan(obscure)
    expect(popular - obscure).toBeLessThanOrEqual(MAX_POPULARITY_BONUS)
  })
})

describe('scoreArtist', () => {
  it('scores an exact artist name at the top', () => {
    expect(scoreArtist(normalizeText('Skrillex'), artist('Skrillex'))).toBe(1)
  })

  it('matches on handle when the display name differs', () => {
    expect(scoreArtist(normalizeText('skrillex'), artist('Unreleased', 'skrillex1'))).toBeGreaterThan(0.8)
  })

  it('rejects a coincidental substring artist', () => {
    expect(scoreArtist(normalizeText('kosandra'), artist('salamandra'))).toBeLessThan(0.8)
    expect(scoreArtist(normalizeText('sara al swas'), artist('Sarah de Warren'))).toBeLessThan(0.8)
  })
})
