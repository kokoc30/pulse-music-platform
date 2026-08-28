import { phraseAliasesFor, tokenAliasesFor } from './aliases'
import { JOINABLE_PARTICLES, detectScript, normalizeText } from './text'
import type { Script } from './text'

/**
 * Bounded query expansion.
 *
 * Every extra variant is an extra provider request, so the list is hard-capped
 * and ordered by confidence: the original query is always first, and the caller
 * decides how far down the list to go (see `smart-search.ts`, which only spends
 * requests on variants when the original query produced nothing strong).
 */
export const MAX_QUERY_VARIANTS = 4

export interface QueryVariant {
  /** Sent to the provider verbatim — original script and case preserved. */
  query: string
  source: 'original' | 'particle' | 'phrase-alias' | 'token-alias'
}

function pushUnique(into: QueryVariant[], seen: Set<string>, variant: QueryVariant): void {
  const key = variant.query.toLowerCase()
  if (!key || seen.has(key)) return
  seen.add(key)
  into.push(variant)
}

/**
 * `sara al swas` → `sara alswas`. Transliterated names attach particles to the
 * following word about as often as they separate them, and Audius indexes the
 * literal string either way.
 */
function joinParticles(tokens: readonly string[]): string[] {
  const results: string[] = []
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]
    if (token === undefined || !JOINABLE_PARTICLES.has(token)) continue
    const joined = [
      ...tokens.slice(0, index),
      `${token}${tokens[index + 1] ?? ''}`,
      ...tokens.slice(index + 2),
    ]
    results.push(joined.join(' '))
  }
  return results
}

/**
 * Ordered, de-duplicated query variants. The first entry is always the original
 * query exactly as the visitor typed it (whitespace-normalized only). Choosing
 * which of the rest to actually spend a request on is the caller's decision —
 * see `selectVariantsForBudget`.
 */
export function expandQuery(rawQuery: string): QueryVariant[] {
  const { provider, normalized, tokens } = normalizeText(rawQuery)
  if (!provider) return []

  const variants: QueryVariant[] = []
  const seen = new Set<string>()
  pushUnique(variants, seen, { query: provider, source: 'original' })

  // Curated whole-query equivalences are the highest-confidence expansion.
  for (const alias of phraseAliasesFor(normalized)) {
    pushUnique(variants, seen, { query: alias, source: 'phrase-alias' })
  }

  // Then per-word equivalences, one substitution at a time so the variant stays
  // close to what the visitor asked for.
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) continue
    for (const alias of tokenAliasesFor(token)) {
      const swapped = [...tokens]
      swapped[index] = alias
      pushUnique(variants, seen, { query: swapped.join(' '), source: 'token-alias' })
    }
  }

  // Finally the purely structural rewrite, which needs no dictionary.
  for (const joined of joinParticles(tokens)) {
    pushUnique(variants, seen, { query: joined, source: 'particle' })
  }

  return variants.slice(0, MAX_QUERY_VARIANTS)
}

/**
 * Picks which variants are worth a request when only `budget` of them can run.
 *
 * A variant in a different script reaches a disjoint region of the provider's
 * index, so one variant per script is taken first; only then are the remaining
 * slots filled with same-script respellings. Searching two Cyrillic spellings
 * before trying the Latin one would waste the whole budget.
 */
export function selectVariantsForBudget(
  variants: readonly QueryVariant[],
  budget: number,
): QueryVariant[] {
  if (budget <= 0) return []
  const extras = variants.slice(1)
  const seenScripts = new Set<Script>([detectScript(variants[0]?.query ?? '')])

  const diverse: QueryVariant[] = []
  const rest: QueryVariant[] = []
  for (const variant of extras) {
    const script = detectScript(variant.query)
    if (seenScripts.has(script)) rest.push(variant)
    else {
      seenScripts.add(script)
      diverse.push(variant)
    }
  }
  return [...diverse, ...rest].slice(0, budget)
}
