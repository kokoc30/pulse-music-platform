import { describe, expect, it } from 'vitest'
import type { Artist, Track } from '@/music/types'
import {
  MIN_RELEVANCE,
  MIN_STRONG_COVERAGE,
  bestScoreAcross,
  importantTokens,
  isStrongMatch,
  scoreArtist,
  scoreTrack,
  tokenCoverage,
} from './relevance'
import { expandQuery } from './expand'
import { normalizeText } from './text'

/**
 * Query-token coverage: the evidence requirement that sits alongside the
 * relevance score.
 *
 * Every "weak" fixture below is a **real row the live Jamendo catalogue
 * returned** for the query `aram asatryan`. Each one scored 0.375 — comfortably
 * over `MIN_RELEVANCE` — on the strength of a single generic token, `aram`,
 * while carrying no evidence whatsoever for `asatryan`. One of them was
 * therefore promoted to Top Result, telling the visitor their artist had been
 * found, and demoting the YouTube fallback to its subtle variant at exactly the
 * moment the prominent one was needed.
 *
 * The fix is deliberately *not* a higher score threshold. Raising
 * `MIN_RELEVANCE` past 0.375 would have thrown away genuine fuzzy matches
 * (`kassandra` → `Kosandra` scores 0.70) and would *still* have admitted
 * `Some Song` by `Asatryan` at 0.626. Only coverage separates those.
 */

function track(title: string, artistName: string, extra: Partial<Track> = {}): Track {
  return {
    id: `jamendo:${title}:${artistName}`,
    mediaKind: 'audio',
    provider: 'jamendo',
    providerId: title,
    title,
    artistName,
    artwork: {},
    durationSeconds: 200,
    isStreamable: true,
    ...extra,
  }
}

const classify = (query: string, item: Track) => {
  const relevance = scoreTrack(normalizeText(query), item)
  return { ...relevance, strong: isStrongMatch(relevance) }
}

/* ------------------------------------------------------------------ Step 2 */

describe('the live Jamendo rows that broke "aram asatryan"', () => {
  const QUERY = 'aram asatryan'

  const WEAK: Array<[string, string]> = [
    ["Eternos Rivales - Fil d'aram", 'Eternos Rivales'],
    ['01. Météo sombre (prod. Aram)', 'L.IAM'],
    ['Orom Aram', 'Joël Vanoli'],
  ]

  it.each(WEAK)('classifies %s / %s as weak, not strong', (title, artist) => {
    const result = classify(QUERY, track(title, artist))
    // It still scores above the noise floor — that is exactly why a score
    // threshold alone could never have caught it.
    expect(result.score).toBeGreaterThan(MIN_RELEVANCE)
    expect(result.coverage).toBeLessThan(MIN_STRONG_COVERAGE)
    expect(result.strong).toBe(false)
  })

  it('covers only one of the two query concepts in every weak row', () => {
    for (const [title, artist] of WEAK) {
      expect(classify(QUERY, track(title, artist)).coverage).toBeCloseTo(0.5, 5)
    }
  })

  it('keeps the genuine artist match strong', () => {
    const result = classify(QUERY, track('Barov Ari', 'Aram Asatryan'))
    expect(result.coverage).toBe(1)
    expect(result.score).toBeGreaterThan(0.9)
    expect(result.strong).toBe(true)
  })

  it('ranks the genuine match above every weak row', () => {
    const genuine = classify(QUERY, track('Barov Ari', 'Aram Asatryan')).score
    for (const [title, artist] of WEAK) {
      expect(genuine).toBeGreaterThan(classify(QUERY, track(title, artist)).score)
    }
  })
})

/* ------------------------------------------------------------------ Step 3 */

describe('multi-token coverage', () => {
  it('counts presence, not degree — one perfect token cannot cover two', () => {
    // `aram` matches exactly (tokenMatchScore 1.0) and still yields 0.5.
    expect(tokenCoverage(normalizeText('aram asatryan'), ['orom', 'aram'])).toBeCloseTo(0.5, 5)
  })

  it('requires both tokens of a two-token query', () => {
    expect(MIN_STRONG_COVERAGE).toBeGreaterThan(0.5)
    expect(tokenCoverage(normalizeText('aram asatryan'), ['aram', 'asatryan'])).toBe(1)
  })

  it('tolerates one missing token in a three-token query', () => {
    // 2/3 = 0.67 — the longer the query, the less a single absence proves.
    const coverage = tokenCoverage(normalizeText('miyagi andy panda'), ['miyagi', 'andy'])
    expect(coverage).toBeCloseTo(2 / 3, 5)
    expect(coverage).toBeGreaterThanOrEqual(MIN_STRONG_COVERAGE)
  })

  it('ignores low-signal words, so they neither help nor hurt', () => {
    expect(importantTokens(normalizeText('the official aram asatryan audio'))).toEqual([
      'aram',
      'asatryan',
    ])
    // `the`/`official`/`audio` are absent from the metadata and cost nothing.
    expect(
      tokenCoverage(normalizeText('the official aram asatryan audio'), ['aram', 'asatryan']),
    ).toBe(1)
  })

  it('never divides by zero for a query made only of low-signal words', () => {
    expect(tokenCoverage(normalizeText('the official audio'), ['the'])).toBeGreaterThan(0)
    expect(tokenCoverage(normalizeText('the'), [])).toBe(0)
  })

  it('accepts a spelling variant as evidence, not just an exact token', () => {
    // `swas` ↔ `sawas` is a transliteration difference, not a missing concept.
    expect(tokenCoverage(normalizeText('sara swas'), ['sara', 'sawas'])).toBe(1)
  })
})

/* ------------------------------------------------------------------ Step 4 */

describe('artist-name confidence', () => {
  const artist = (name: string): Artist => ({
    id: `audius:${name}`,
    provider: 'audius',
    providerId: name,
    name,
    handle: name.toLowerCase().replace(/\s+/g, ''),
    artwork: {},
    isVerified: false,
  })

  it('treats a complete multi-token artist name as very strong', () => {
    expect(scoreArtist(normalizeText('aram asatryan'), artist('Aram Asatryan'))).toBe(1)
  })

  it('treats one component of a multi-token artist name as incomplete', () => {
    const score = scoreArtist(normalizeText('aram asatryan'), artist('Aram'))
    expect(score).toBeLessThan(0.5)
    // And a track by that artist is not strong either.
    expect(classify('aram asatryan', track('Some Song', 'Aram')).strong).toBe(false)
  })

  it('treats the surname alone as incomplete, despite a high score', () => {
    // 0.626 — over `STRONG_RELEVANCE`. Coverage is the only thing that stops it.
    const result = classify('aram asatryan', track('Some Song', 'Asatryan'))
    expect(result.score).toBeGreaterThan(0.6)
    expect(result.coverage).toBeCloseTo(0.5, 5)
    expect(result.strong).toBe(false)
  })

  it('treats a title name-drop with an unrelated artist as weak', () => {
    expect(classify('aram asatryan', track('Orom Aram', 'Joël Vanoli')).strong).toBe(false)
  })

  it('keeps a punctuated multi-token artist name strong', () => {
    // "Miyagi Andy Panda" vs "Miyagi & Andy Panda" — the ampersand is noise.
    const result = classify('miyagi andy panda', track('Kosandra', 'Miyagi & Andy Panda'))
    expect(result.coverage).toBe(1)
    expect(result.strong).toBe(true)
  })
})

/* ------------------------------------------------------------------ Step 5 */

describe('title and artist evidence combine', () => {
  it('accepts a query split across both fields', () => {
    const result = classify('barov ari aram asatryan', track('Barov Ari', 'Aram Asatryan'))
    expect(result.coverage).toBe(1)
    expect(result.strong).toBe(true)
  })

  it('does not require every token to live in one field', () => {
    expect(classify('adele hello', track('Hello', 'Adele')).strong).toBe(true)
    expect(classify('skrillex bangarang', track('Bangarang', 'Skrillex')).strong).toBe(true)
  })

  it('reads the artist handle as evidence too', () => {
    const result = classify(
      'aram asatryan',
      track('Barov Ari', 'Aram', { artistHandle: 'asatryan' }),
    )
    expect(result.coverage).toBe(1)
  })

  it('still refuses when the tokens are split across two different entities', () => {
    // `aram` in the title, `asatryan` nowhere — a coincidence, not a match.
    expect(classify('aram asatryan', track('Fil d aram', 'Eternos Rivales')).coverage).toBeLessThan(
      MIN_STRONG_COVERAGE,
    )
  })
})

/* ------------------------------------------------------------------ Step 6 */

describe('international matching is preserved', () => {
  /**
   * Coverage is computed for the query variant that actually won, which is what
   * keeps the alias table working. `кассандра` covers nothing in a Latin-titled
   * `Kosandra` on its own — the curated alias variant is what carries it.
   */
  function bestFor(rawQuery: string, item: Track) {
    const variants = expandQuery(rawQuery).map((variant) => normalizeText(variant.query))
    const { relevance } = bestScoreAcross(variants, item)
    return { ...relevance, strong: isStrongMatch(relevance) }
  }

  const kosandra = track('Kosandra', 'Miyagi & Andy Panda')

  it('keeps the Latin spelling strong', () => {
    expect(bestFor('kosandra', kosandra).strong).toBe(true)
  })

  it('keeps the alternate Latin spelling strong', () => {
    const result = bestFor('kassandra', kosandra)
    expect(result.coverage).toBe(1)
    expect(result.strong).toBe(true)
  })

  it('keeps the Cyrillic spelling strong through the curated alias', () => {
    // Scored directly against a Latin title, `кассандра` covers 0. The alias
    // variant is the whole reason it still works — a naive token-count rule
    // would have destroyed exactly this case.
    const direct = scoreTrack(normalizeText('кассандра'), kosandra)
    expect(direct.coverage).toBe(0)

    const result = bestFor('кассандра', kosandra)
    expect(result.coverage).toBe(1)
    expect(result.strong).toBe(true)
  })

  it('keeps the Cyrillic artist alias strong', () => {
    expect(bestFor('мияги', track('Kosandra', 'Miyagi & Andy Panda')).strong).toBe(true)
  })

  it('keeps the Arabic artist and its transliterations strong', () => {
    const sara = track('Ya Hayati', 'Sara Al Sawas')
    expect(bestFor('sara al swas', sara).strong).toBe(true)
    expect(bestFor('sarah al sawas', sara).strong).toBe(true)
    expect(bestFor('سارة السواس', track('يا حياتي', 'سارة السواس')).strong).toBe(true)
  })

  it('keeps Armenian script matching intact', () => {
    expect(bestFor('Արամ Ասատրյան', track('Բարով արի', 'Արամ Ասատրյան')).strong).toBe(true)
    // And the same guard applies in Armenian: one name component is not a name.
    expect(bestFor('Արամ Ասատրյան', track('Ինչ որ բան', 'Արամ')).strong).toBe(false)
  })

  it('keeps Cyrillic title + artist queries strong', () => {
    expect(bestFor('кино группа крови', track('Кино - Группа крови', 'Кино')).strong).toBe(true)
  })

  it('keeps single-token Latin queries strong', () => {
    expect(bestFor('skrillex', track('Bangarang', 'Skrillex')).strong).toBe(true)
    expect(bestFor('adele hello', track('Adele - Hello', 'Adele')).strong).toBe(true)
  })

  it('survives a homoglyph in the catalogue data', () => {
    // Real Audius data: a title whose final `а` is Cyrillic U+0430.
    expect(bestFor('kosandra', track('kosandrа', 'Miyagi & Andy Panda')).strong).toBe(true)
  })

  it('survives diacritics and punctuation on both sides', () => {
    expect(bestFor('meteo sombre', track('01. Météo sombre', 'L.IAM')).strong).toBe(true)
  })

  it('treats a compact, space-free query as a full phrase match', () => {
    // One 15-character token matches none of the three short name tokens
    // individually; the phrase short-circuit is what saves it.
    expect(bestFor('miyagiandypanda', track('Kosandra', 'Miyagi & Andy Panda')).coverage).toBe(1)
  })
})
