import { describe, expect, it } from 'vitest'
import {
  detectScript,
  foldConfusables,
  isLowSignal,
  normalizeForProvider,
  normalizeText,
  stripDiacritics,
} from './text'

describe('normalizeForProvider', () => {
  it('trims, collapses whitespace and folds punctuation to spaces', () => {
    expect(normalizeForProvider('  sara   al-swas!  ')).toBe('sara al swas')
    expect(normalizeForProvider('Miyagi & Andy Panda')).toBe('Miyagi Andy Panda')
  })

  it('preserves case and script so the provider query stays faithful', () => {
    expect(normalizeForProvider('Мияги')).toBe('Мияги')
    expect(normalizeForProvider('سارة السواس')).toBe('سارة السواس')
    expect(normalizeForProvider('Սերժ')).toBe('Սերժ')
    expect(normalizeForProvider('Skrillex')).toBe('Skrillex')
  })

  it('normalizes Arabic and Armenian punctuation too', () => {
    expect(normalizeForProvider('سارة، السواس')).toBe('سارة السواس')
  })
})

describe('stripDiacritics', () => {
  it('removes Latin accents', () => {
    expect(stripDiacritics('Beyoncé')).toBe('Beyonce')
    expect(stripDiacritics('Björk')).toBe('Bjork')
  })

  it('removes Arabic harakat without destroying the letters', () => {
    expect(stripDiacritics('سَارَة')).toBe('سارة')
  })

  it('folds Cyrillic ё to е', () => {
    expect(stripDiacritics('ёлка')).toBe('елка')
  })

  it('leaves Armenian and Hangul intact', () => {
    expect(stripDiacritics('Սերժ')).toBe('Սերժ')
    expect(stripDiacritics('한국어')).toBe('한국어')
  })
})

describe('foldConfusables', () => {
  it('repairs a Latin word containing a Cyrillic homoglyph', () => {
    // Audius really does host a track titled `kosandrа` with U+0430.
    expect(foldConfusables('kosandrа')).toBe('kosandra')
  })

  it('never folds genuinely Cyrillic text', () => {
    expect(foldConfusables('кассандра')).toBe('кассандра')
    expect(foldConfusables('мияги эндшпиль')).toBe('мияги эндшпиль')
  })

  it('leaves Arabic and Armenian untouched', () => {
    expect(foldConfusables('سارة السواس')).toBe('سارة السواس')
    expect(foldConfusables('Սերժ')).toBe('Սերժ')
  })
})

describe('detectScript', () => {
  it('identifies the dominant script', () => {
    expect(detectScript('Skrillex')).toBe('latin')
    expect(detectScript('кассандра')).toBe('cyrillic')
    expect(detectScript('سارة السواس')).toBe('arabic')
    expect(detectScript('Սերժ Թանկյան')).toBe('armenian')
    expect(detectScript('12345')).toBe('other')
  })
})

describe('normalizeText', () => {
  it('produces every comparison form at once', () => {
    const result = normalizeText('  Sara AL-Swas  ')
    expect(result.provider).toBe('Sara AL Swas')
    expect(result.normalized).toBe('sara al swas')
    expect(result.folded).toBe('sara al swas')
    expect(result.tokens).toEqual(['sara', 'al', 'swas'])
    expect(result.compact).toBe('saraalswas')
    expect(result.script).toBe('latin')
  })

  it('keeps the provider form in the original script', () => {
    const result = normalizeText('Кассандра')
    expect(result.provider).toBe('Кассандра')
    expect(result.normalized).toBe('кассандра')
    expect(result.folded).toBe('кассандра')
    expect(result.script).toBe('cyrillic')
  })

  it('handles an all-Arabic query', () => {
    const result = normalizeText('سارة السواس')
    expect(result.provider).toBe('سارة السواس')
    expect(result.tokens).toEqual(['سارة', 'السواس'])
    expect(result.script).toBe('arabic')
  })

  it('is empty for whitespace-only input', () => {
    expect(normalizeText('   ').provider).toBe('')
    expect(normalizeText('').tokens).toEqual([])
  })
})

describe('isLowSignal', () => {
  it('treats particles and boilerplate as low signal', () => {
    for (const token of ['al', 'the', 'ft', 'official', 'remix', 'a']) {
      expect(isLowSignal(token)).toBe(true)
    }
  })

  it('treats real words as high signal', () => {
    for (const token of ['kosandra', 'swas', 'skrillex', 'кассандра']) {
      expect(isLowSignal(token)).toBe(false)
    }
  })
})
