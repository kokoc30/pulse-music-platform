# 18 — Phase 2 Testing and QA

## Baseline Rule

All existing Phase 1 tests must remain green.

Do not reduce coverage or delete tests.

## New Unit Tests

### Jamendo normalization

Cover:

- normal album track,
- single,
- missing image,
- string duration,
- invalid duration,
- missing audio,
- missing source URL,
- license URL,
- malformed provider response.

### Jamendo server request

Cover:

- correct endpoint,
- query encoding,
- relevance order,
- both singles/album tracks,
- limit clamping,
- UTF-8 Arabic/Cyrillic preservation,
- provider-level error handling.

### Security

Cover:

- missing `JAMENDO_CLIENT_ID`,
- client ID redaction,
- sanitized output excludes `audiodownload`,
- arbitrary upstream params rejected,
- unsupported action rejected,
- non-GET rejected.

### Multi-provider merge

Cover:

- Audius only,
- Jamendo only,
- both,
- Audius failure + Jamendo success,
- Jamendo failure + Audius success,
- both fail,
- no strong matches,
- same provider IDs do not collide.

### Cross-provider deduplication

Cover:

- high-confidence same recording,
- remix remains separate,
- live remains separate,
- acoustic remains separate,
- different artist remains separate,
- deterministic winner.

### Ranking

Cover:

- exact Jamendo beats unrelated Audius,
- exact Audius beats unrelated Jamendo,
- provider popularity does not overwhelm text relevance,
- Arabic/Cyrillic/Armenian regressions still pass.

## Player Tests

Test mixed queues:

```text
Audius -> Jamendo
Jamendo -> Audius
Jamendo -> Jamendo
```

Verify source changes, metadata, ended, race safety, recovery.

## Component Tests

Add:

- Jamendo attribution,
- safe external link,
- provider-neutral UI,
- missing Jamendo config does not expose raw error.

## API Function Tests

Mock Jamendo upstream.

Verify credentials sent upstream only and never returned downstream.

## E2E

Use deterministic mocked Audius and Jamendo data.

Critical flow:

1. search,
2. both providers respond,
3. unified ranking,
4. Jamendo result visible,
5. attribution visible,
6. Jamendo playback,
7. switch to Audius,
8. switch back,
9. navigation persistence,
10. mobile,
11. Jamendo unavailable -> Audius works,
12. Audius unavailable -> Jamendo works,
13. both unavailable -> error.

## Live Jamendo Smoke Test

Add opt-in:

```text
JAMENDO_SMOKE=1
```

Verify:
- live search,
- normalized track,
- source URL,
- HTTPS audio URL,
- small stream/range availability check if practical.

Do not download an entire track.

## Full Gate

Run:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
```

Then Audius and Jamendo live smoke tests.

## Bundle Security Gate

Search built client output for the actual Jamendo client ID.

Expected:

```text
0 matches
```

Browser metadata request should be `/api/jamendo`, not a direct credential-bearing Jamendo API URL.

## Local Manual QA

Test:

- known Audius query,
- generic Jamendo-friendly query,
- Arabic,
- Cyrillic,
- gibberish/no-match,
- rapid typing,
- rapid provider switching,
- mixed queue,
- mobile.

## Performance QA

Measure provider request count and total latency.

No unbounded alias multiplication.

## Failure Policy

Any Phase 1 regression is a blocker.
