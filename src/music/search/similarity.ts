/**
 * Script-agnostic string similarity.
 *
 * Character bigrams (Sørensen–Dice) are the workhorse: they need no language
 * knowledge, behave sensibly on Arabic, Cyrillic and Armenian, and are cheap
 * enough to run over a few hundred candidates per keystroke-debounced search.
 */

function bigrams(value: string): string[] {
  const chars = [...value]
  if (chars.length < 2) return chars
  const grams: string[] = []
  for (let index = 0; index < chars.length - 1; index += 1) {
    grams.push(`${chars[index] ?? ''}${chars[index + 1] ?? ''}`)
  }
  return grams
}

/** Sørensen–Dice coefficient over character bigrams, in `0..1`. */
export function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  const left = bigrams(a)
  const right = bigrams(b)
  if (left.length === 0 || right.length === 0) return 0

  const counts = new Map<string, number>()
  for (const gram of left) counts.set(gram, (counts.get(gram) ?? 0) + 1)

  let shared = 0
  for (const gram of right) {
    const available = counts.get(gram) ?? 0
    if (available > 0) {
      counts.set(gram, available - 1)
      shared += 1
    }
  }

  return (2 * shared) / (left.length + right.length)
}

/** Levenshtein distance, bounded so a pathological pair cannot stall the UI. */
export function levenshtein(a: string, b: string, maxLength = 64): number {
  const left = [...a].slice(0, maxLength)
  const right = [...b].slice(0, maxLength)
  if (left.length === 0) return right.length
  if (right.length === 0) return left.length

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      )
    }
    previous = current
  }
  return previous[right.length] ?? 0
}

/** Edit-distance similarity in `0..1`, tolerant of one or two typos. */
export function editSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const longest = Math.max([...a].length, [...b].length)
  if (longest === 0) return 1
  return Math.max(0, 1 - levenshtein(a, b) / longest)
}

/** Best of the two fuzzy measures — Dice handles reordering, edits handle typos. */
export function fuzzySimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  return Math.max(diceCoefficient(a, b), editSimilarity(a, b))
}

/**
 * How well one query token is represented in a candidate's tokens.
 * Exact hit beats prefix, prefix beats containment, containment beats fuzzy.
 */
/**
 * How much of the longer word the shorter one accounts for. A short query token
 * buried inside a much longer word is a coincidence, not a match: `sara` and
 * `swas` are both substrings of `jesusWASARapper`, which the live API really
 * does return for `sara al swas`.
 */
function lengthProportion(a: string, b: string): number {
  const longest = Math.max(a.length, b.length)
  return longest === 0 ? 0 : Math.min(a.length, b.length) / longest
}

/** Below this, one word is simply not a variant of the other. */
const MIN_TOKEN_PROPORTION = 0.6

export function tokenMatchScore(queryToken: string, candidateTokens: readonly string[]): number {
  let best = 0
  for (const candidate of candidateTokens) {
    if (candidate === queryToken) return 1

    const proportion = lengthProportion(queryToken, candidate)
    // `sara` is a prefix of `sarabande` and a substring of `jesuswasarapper`;
    // neither is the same word. Both rules therefore require the two words to be
    // of comparable length before they count at all.
    if (proportion >= MIN_TOKEN_PROPORTION) {
      if (candidate.startsWith(queryToken) || queryToken.startsWith(candidate)) {
        const shorter = Math.min(queryToken.length, candidate.length)
        // Scaled by proportion so `skrill`→`skrillex` still scores well while a
        // bare prefix of a much longer word cannot reach the same level.
        best = Math.max(best, shorter >= 3 ? 0.6 + 0.35 * proportion : 0.5)
        continue
      }
      if (queryToken.length >= 4 && candidate.includes(queryToken)) {
        best = Math.max(best, 0.55 + 0.3 * proportion)
        continue
      }
    }

    const fuzzy = fuzzySimilarity(queryToken, candidate)
    // Below this, a "match" is coincidental bigram overlap, not a spelling variant.
    if (fuzzy >= 0.72) best = Math.max(best, fuzzy * 0.9)
  }
  return best
}
