/**
 * Unicode-safe text normalization for search comparison.
 *
 * Two rules govern everything here:
 *
 * 1. **Provider requests always use the original text.** Everything produced by
 *    this module is for *local comparison only*. Audius indexes Arabic, Cyrillic
 *    and Armenian metadata, so folding a query before sending it would lose
 *    matches (verified: `Мияги` returns a real Cyrillic-titled track, and the
 *    same query transliterated returns nothing).
 * 2. **Folding must never destroy a script.** Diacritic stripping is applied
 *    through NFD → strip combining marks → NFC, which is the standard fold for
 *    Arabic harakat and Russian ё/й while leaving Hangul and Armenian intact.
 *    Homoglyph folding is deliberately *scoped* — see `foldConfusables`.
 */

/** Characters that separate words once punctuation is normalized. */
const PUNCTUATION = /[!-/:-@[-`{-~¡-¿‐-‧‰-⁞،؛؟۔։՝՞]/gu

const COMBINING_MARKS = /\p{M}+/gu

/**
 * Cyrillic and Greek letters that are visually identical to Latin ones. Real
 * catalogue data mixes them: Audius has a track titled `kosandrа` whose final
 * character is Cyrillic U+0430, which no Latin query can match.
 */
const CONFUSABLES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't',
  у: 'y', х: 'x', ѕ: 's', і: 'i', ј: 'j', ԁ: 'd', ԛ: 'q', ԝ: 'w', ѐ: 'e', ё: 'e',
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
}

export type Script = 'latin' | 'cyrillic' | 'arabic' | 'armenian' | 'other'

const SCRIPT_TESTS: Array<[Script, RegExp]> = [
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['armenian', /\p{Script=Armenian}/u],
]

/** Dominant script of a string, by letter count. */
export function detectScript(value: string): Script {
  let best: Script = 'other'
  let bestCount = 0
  for (const [script, test] of SCRIPT_TESTS) {
    const pattern = new RegExp(test.source, 'gu')
    const count = (value.match(pattern) ?? []).length
    if (count > bestCount) {
      best = script
      bestCount = count
    }
  }
  return bestCount > 0 ? best : 'other'
}

/**
 * Whitespace and punctuation cleanup that is safe to send to the provider:
 * NFKC, punctuation to spaces, collapsed runs, trimmed. Case and script are
 * preserved, so Arabic/Cyrillic/Armenian survive intact.
 */
export function normalizeForProvider(value: string): string {
  return value.normalize('NFKC').replace(PUNCTUATION, ' ').replace(/\s+/gu, ' ').trim()
}

/** Removes diacritics without decomposing scripts that rely on composition. */
export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC')
}

/**
 * Folds Cyrillic/Greek homoglyphs to Latin **only inside tokens that are already
 * predominantly Latin**.
 *
 * Scoping matters: folding blindly would turn `кассандра` into `kaccahdpa`,
 * destroying a legitimate Cyrillic query. Scoped, it repairs `kosandrа`
 * (Latin word, one Cyrillic `а`) while leaving fully-Cyrillic text alone.
 */
export function foldConfusables(value: string): string {
  return value
    .split(' ')
    .map((token) => {
      if (!token) return token
      const chars = [...token]
      let latin = 0
      let foldable = 0
      let otherScript = 0
      for (const char of chars) {
        if (/\p{Script=Latin}/u.test(char)) latin += 1
        else if (CONFUSABLES[char]) foldable += 1
        else if (/\p{L}/u.test(char)) otherScript += 1
      }
      // Only a token that is mostly Latin already may be repaired.
      if (latin === 0 || otherScript > 0 || latin <= foldable) return token
      return chars.map((char) => CONFUSABLES[char] ?? char).join('')
    })
    .join(' ')
}

export interface NormalizedText {
  /** Safe to send to the provider: original script and case preserved. */
  provider: string
  /** Lowercased, punctuation-normalized. */
  normalized: string
  /** Comparison form: diacritics stripped, homoglyphs repaired. */
  folded: string
  /** `folded` split on whitespace. */
  tokens: string[]
  /** `folded` with all whitespace removed — matches `al swas` to `alswas`. */
  compact: string
  script: Script
}

const EMPTY: NormalizedText = {
  provider: '',
  normalized: '',
  folded: '',
  tokens: [],
  compact: '',
  script: 'other',
}

/** Every comparison form of one string, computed once. */
export function normalizeText(value: string): NormalizedText {
  const provider = normalizeForProvider(value)
  if (!provider) return EMPTY

  const normalized = provider.toLowerCase()
  const folded = foldConfusables(stripDiacritics(normalized))
  const tokens = folded.split(' ').filter(Boolean)

  return {
    provider,
    normalized,
    folded,
    tokens,
    compact: tokens.join(''),
    script: detectScript(provider),
  }
}

/**
 * Particles that attach to the following word in transliterated names, so
 * `sara al swas` and `sara alswas` describe the same person. Language-neutral
 * and data-driven — extend the list, not the code.
 */
export const JOINABLE_PARTICLES = new Set([
  'al', 'el', 'ال', 'la', 'le', 'de', 'del', 'da', 'di', 'du', 'van', 'von',
  'bin', 'ibn', 'abu', 'mc', 'mac', 'st',
])

/** Tokens too common to carry relevance on their own. */
export const LOW_SIGNAL_TOKENS = new Set([
  ...JOINABLE_PARTICLES,
  'the', 'a', 'an', 'of', 'and', 'ft', 'feat', 'featuring', 'official', 'audio',
  'video', 'remix', 'edit', 'version', 'lyrics', 'music', 'mp3', 'hd', 'full',
])

export function isLowSignal(token: string): boolean {
  return token.length <= 1 || LOW_SIGNAL_TOKENS.has(token)
}
