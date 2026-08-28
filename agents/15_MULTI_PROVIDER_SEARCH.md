# 15 — Multi-Provider Search, Merge, Deduplication, and Ranking

## Goal

The user searches once.

They should not need to know which provider has the song.

The application should produce one coherent result set from:

- Audius.
- Jamendo.

## Preserve Existing Smart Search

The current Audius smart-search implementation has already solved:

- alternate spellings,
- Arabic/Cyrillic/Armenian preservation,
- aliases,
- exact artist/title weighting,
- false-positive rejection,
- request ceilings,
- stale requests,
- artist lookup.

Do not throw this code away.

Phase 2 should place an aggregation layer **above** or adjacent to the existing search implementation.

## Recommended Boundary

Conceptual:

```ts
interface SearchSourceResult {
  provider: MusicProviderId
  tracks: Track[]
  status: 'success' | 'unavailable' | 'error'
}

interface MultiProviderSearchResult {
  tracks: RankedTrack[]
  providers: SearchSourceResult[]
  hasStrongMatches: boolean
}
```

Possible service:

```text
src/music/aggregator/
  multi-provider-search.ts
  merge.ts
  cross-provider-dedupe.ts
  provider-budget.ts
```

Adapt to the existing tree rather than forcing these exact filenames.

## Search Execution

On a debounced user search:

1. keep the current stale-request/abort discipline,
2. search Audius using the existing smart-search path,
3. search Jamendo through `/api/jamendo`,
4. run independent provider calls concurrently where practical,
5. normalize provider results,
6. merge,
7. cross-provider deduplicate conservatively,
8. run one global relevance ranking pass,
9. apply the existing "strong match" philosophy,
10. render one result set.

## Provider Failure Tolerance

Use partial success.

- Audius succeeds, Jamendo fails -> show Audius.
- Jamendo succeeds, Audius fails -> show Jamendo.
- Both fail -> show the existing provider error state.
- Neither has strong results -> show the existing no-strong-match state.

## Result Identity

Internal identity:

```text
provider + providerId
```

Examples:

```text
audius:abc123
jamendo:1880336
```

Never dedupe solely by numeric/string provider ID.

## Cross-Provider Deduplication

Do not aggressively collapse results.

A high-confidence duplicate may require:

- normalized title similarity very high,
- normalized artist similarity very high,
- duration close within a small tolerance,
- no obvious remix/live/acoustic/version conflict.

Prefer false negatives over false-positive deduplication.

## Duplicate Winner

If two tracks are classified as the same recording, choose the visible winner using:

1. higher text relevance,
2. public streamability,
3. better metadata/artwork completeness,
4. stable provider reliability/tie-break rule,
5. deterministic order.

Do not introduce a large provider bias.

## Global Ranking

The existing textual relevance model remains authoritative.

Provider popularity must remain a small tie-breaker.

Recommended priorities:

1. exact track title,
2. exact artist,
3. exact title + artist token coverage,
4. strong normalized/fuzzy match,
5. alternate-script/alias equivalence,
6. weak popularity/quality tie-breakers.

## Jamendo Alias Budget

The existing query expander may create several variants.

Do not call Jamendo for all of them automatically.

Recommended:

```text
Initial:
- original query

Conditional fallback:
- one best alternate variant
```

Use fallback only when:
- initial Jamendo result quality is weak, and
- the variant materially changes matching potential.

## Search Latency

The UI should not wait forever for a slow secondary provider.

Use timeout/AbortController discipline.

## Search Result Presentation

Keep the existing reference UI.

A Jamendo result may require a small provider attribution/source link for compliance.

Do not:
- create provider tabs,
- split results into provider sections,
- redesign the search page.

## Top Result

The "Top result" must be the globally highest strong match, regardless of provider.

## Queue

The queue may contain tracks from both providers.

The existing player should switch stream sources transparently based on `track.provider`.

No page refresh.

No second player.

## Discovery

Search + playback is the mandatory Phase 2 milestone.

Only after that is correct, the agent may augment discovery shelves with Jamendo where it improves coverage without changing the reference composition.

## Logging

Never log:
- `JAMENDO_CLIENT_ID`,
- full credential-bearing Jamendo request URLs.

Redact query-string credentials from error messages.
