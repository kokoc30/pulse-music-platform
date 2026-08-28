import { detectScript, normalizeText } from '@/music/search/text'
import type { QueryVariant } from '@/music/search/expand'

/**
 * How many Jamendo round-trips one search may cost.
 *
 * The smart-search expander can produce up to four Audius variants. Firing all
 * of them at a second provider as well would quadruple the request count for a
 * catalogue that is a supplement, not the primary source. So Jamendo gets the
 * original query always, and at most one conditional fallback
 * (agents/15_MULTI_PROVIDER_SEARCH.md → "Jamendo Alias Budget").
 */

/** Hard ceiling on Jamendo round-trips per search. Asserted in tests. */
export const MAX_JAMENDO_REQUESTS = 2

/**
 * Picks the single fallback variant worth spending a request on.
 *
 * "Worth it" means the variant reaches a genuinely different part of Jamendo's
 * index — a different script first (`кассандра` vs `kassandra` match disjoint
 * rows), then a curated alias respelling. A variant that merely re-spaces the
 * same Latin words is not worth a network call.
 */
export function selectJamendoFallback(variants: readonly QueryVariant[]): QueryVariant | null {
  const primary = variants[0]
  if (!primary) return null
  const primaryScript = detectScript(primary.query)
  const primaryCompact = normalizeText(primary.query).compact

  let sameScriptAlias: QueryVariant | null = null

  for (const variant of variants.slice(1)) {
    if (normalizeText(variant.query).compact === primaryCompact) continue
    if (detectScript(variant.query) !== primaryScript) return variant
    // A curated alias is a real respelling; a structural particle join is not.
    if (!sameScriptAlias && variant.source !== 'particle') sameScriptAlias = variant
  }

  return sameScriptAlias
}

/**
 * Whether the fallback request is justified at all.
 *
 * Only when Jamendo actually answered and what it returned is weak. A Jamendo
 * outage must not be retried under a different spelling, and a strong first
 * answer needs no second opinion.
 */
export function shouldSpendJamendoFallback(input: {
  status: 'success' | 'unavailable' | 'error'
  bestJamendoScore: number
  strongThreshold: number
  hasFallbackVariant: boolean
}): boolean {
  if (input.status !== 'success') return false
  if (!input.hasFallbackVariant) return false
  return input.bestJamendoScore < input.strongThreshold
}
