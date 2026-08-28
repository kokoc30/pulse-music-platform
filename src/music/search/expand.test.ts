import { describe, expect, it } from 'vitest'
import { MAX_QUERY_VARIANTS, expandQuery } from './expand'
import { PHRASE_ALIASES, TOKEN_ALIASES, phraseAliasesFor, tokenAliasesFor } from './aliases'

const queriesOf = (input: string) => expandQuery(input).map((variant) => variant.query)

describe('alias dictionary', () => {
  it('is bidirectional within each group', () => {
    for (const group of [...PHRASE_ALIASES, ...TOKEN_ALIASES]) {
      for (const member of group) {
        const lookup = group === PHRASE_ALIASES.find((g) => g === group) ? phraseAliasesFor : tokenAliasesFor
        const others = lookup(member)
        for (const sibling of group) {
          if (sibling === member) continue
          expect(others).toContain(sibling)
        }
      }
    }
  })

  it('returns nothing for unknown terms', () => {
    expect(phraseAliasesFor('completely unknown thing')).toEqual([])
    expect(tokenAliasesFor('zzzz')).toEqual([])
  })
})

describe('expandQuery', () => {
  it('always puts the original query first, in its original script', () => {
    expect(queriesOf('Кассандра')[0]).toBe('Кассандра')
    expect(queriesOf('سارة السواس')[0]).toBe('سارة السواس')
    expect(queriesOf('  Skrillex  ')[0]).toBe('Skrillex')
  })

  it('expands a Latin transliteration to its Cyrillic form', () => {
    const variants = queriesOf('kosandra')
    expect(variants).toContain('kosandra')
    expect(variants).toContain('kassandra')
    expect(variants).toContain('кассандра')
  })

  it('expands a Cyrillic query to its Latin transliteration', () => {
    const variants = queriesOf('кассандра')
    expect(variants[0]).toBe('кассандра')
    expect(variants).toContain('kosandra')
  })

  it('expands a misspelled Arabic transliteration, including the Arabic script form', () => {
    const variants = queriesOf('sara al swas')
    expect(variants[0]).toBe('sara al swas')
    expect(variants).toContain('sara al sawas')
    expect(variants).toContain('سارة السواس')
  })

  it('joins name particles without any dictionary', () => {
    expect(queriesOf('mohamed al amin')).toContain('mohamed alamin')
    expect(queriesOf('ludwig van beethoven')).toContain('ludwig vanbeethoven')
  })

  it('substitutes one token at a time so variants stay close to the query', () => {
    const variants = queriesOf('miyagi andy panda')
    expect(variants).toContain('мияги andy panda')
    // Never a wholesale rewrite of every token at once.
    expect(variants).not.toContain('мияги andy панда')
  })

  it('never exceeds the variant cap', () => {
    for (const query of ['sara al swas', 'kosandra', 'miyagi andy panda', 'a b c d e f']) {
      expect(expandQuery(query).length).toBeLessThanOrEqual(MAX_QUERY_VARIANTS)
    }
  })

  it('de-duplicates variants', () => {
    const variants = queriesOf('kosandra')
    expect(new Set(variants).size).toBe(variants.length)
  })

  it('returns nothing for a blank query', () => {
    expect(expandQuery('   ')).toEqual([])
    expect(expandQuery('')).toEqual([])
  })

  it('produces a single variant when nothing is known and nothing is joinable', () => {
    expect(queriesOf('Skrillex')).toEqual(['Skrillex'])
  })
})
