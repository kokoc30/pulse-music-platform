/**
 * Alias dictionary — pure data, no behaviour.
 *
 * Audius indexes whatever an uploader typed, so the same release exists under
 * transliterations, alternate spellings and native-script titles. There is no
 * general algorithm for that; a small curated table plus the rule-based
 * expansion in `expand.ts` covers the realistic cases without pretending to
 * transliterate every language.
 *
 * To extend: add a group. Every member of a group expands to every other
 * member, so groups are unordered equivalence sets. Entries are matched after
 * normalization (lowercased, punctuation-folded), so write them in plain form.
 *
 * Keep groups small and specific. A group that is too broad makes searches
 * noisier, not better — the relevance scorer still has to rank whatever comes
 * back.
 */

/** Whole-query equivalences: matched against the full normalized query. */
export const PHRASE_ALIASES: readonly (readonly string[])[] = [
  // Miyagi & Andy Panda — "Kosandra" is widely written "Kassandra"/"Кассандра".
  ['kosandra', 'kassandra', 'косандра', 'кассандра'],
  // Sara Al Sawas — Arabic artist, transliterated many ways.
  ['sara al swas', 'sara al sawas', 'sarah al sawas', 'سارة السواس'],
]

/** Token-level equivalences: matched against individual words in a query. */
export const TOKEN_ALIASES: readonly (readonly string[])[] = [
  ['miyagi', 'мияги'],
  ['endshpil', 'endspiel', 'эндшпиль'],
  ['panda', 'панда'],
  ['sawas', 'swas', 'السواس'],
  ['sara', 'sarah', 'سارة'],
]

type AliasIndex = ReadonlyMap<string, readonly string[]>

function buildIndex(groups: readonly (readonly string[])[]): AliasIndex {
  const index = new Map<string, string[]>()
  for (const group of groups) {
    for (const member of group) {
      const key = member.toLowerCase()
      const others = group.filter((entry) => entry.toLowerCase() !== key)
      index.set(key, [...(index.get(key) ?? []), ...others])
    }
  }
  return index
}

const phraseIndex = buildIndex(PHRASE_ALIASES)
const tokenIndex = buildIndex(TOKEN_ALIASES)

/** Alternate spellings of a whole query, or `[]` when none are known. */
export function phraseAliasesFor(normalizedQuery: string): readonly string[] {
  return phraseIndex.get(normalizedQuery.toLowerCase()) ?? []
}

/** Alternate spellings of a single word, or `[]` when none are known. */
export function tokenAliasesFor(token: string): readonly string[] {
  return tokenIndex.get(token.toLowerCase()) ?? []
}

export function hasAnyAlias(normalizedQuery: string, tokens: readonly string[]): boolean {
  if (phraseAliasesFor(normalizedQuery).length > 0) return true
  return tokens.some((token) => tokenAliasesFor(token).length > 0)
}
