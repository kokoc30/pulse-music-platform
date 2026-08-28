# Search Confidence + YouTube Fallback Correction — Final Report

**Date:** 2026-08-28 · **Project:** `C:\music-platform` (Pulse — Music Discovery)
**Scope:** a narrow post-Phase-3 correction to open-catalog relevance confidence. No architectural
change, no change to the YouTube quota model, playback architecture or `refe/`.

---

## Status — **PASS**

The correction is **fully implemented and manually verified against the live application**. Every
objective in the brief is met, and the decisive case was confirmed end to end with real credentials:

> `aram asatryan` now shows **0 song rows, no Top Result, "No strong matches found."** and the
> **prominent Search YouTube** button. Pressing it makes **exactly one** `/api/youtube` request and
> returns real Aram Asatryan material.

| Gate | Result |
|---|---|
| typecheck · lint · unit · build · e2e · bundle | **all PASS** |
| YouTube live smoke | **12/12 PASS** |
| Jamendo live smoke | **8/8 PASS** |
| Audius live smoke | **6/6 PASS** |
| **Live smoke total** | **26/26 PASS** |

### Historical note — the intermittent Audius TLS failure

This report was originally filed at **PARTIAL**, because one Audius live test —
`serves real audio bytes over a range request` — was red at the time. **It has since been rerun and
passes 6/6, bringing the suite to 26/26.** The diagnosis is kept below in full, because it is the
evidence that the failure was external and that the correction pass did not cause it.

The cause was **Audius content nodes serving broken TLS**. Measured directly, outside the test
harness, at the time of writing:

```
healthy content nodes: 4/8   broken TLS: 4/8

v.monophonic.digital               FAIL ERR_SSL_PACKET_LENGTH_TOO_LONG
v.monophonic.digital               FAIL ERR_SSL_PACKET_LENGTH_TOO_LONG
audius-02.staked.cloud             OK 206
v.monophonic.digital               FAIL ERR_SSL_PACKET_LENGTH_TOO_LONG
audius-creator-9.theblueprint.xyz  FAIL ERR_SSL_PACKET_LENGTH_TOO_LONG
```

It was unrelated to this pass by construction — nothing here touches stream resolution, content-node
selection or TLS — and it was intermittent even then: in three isolated re-runs of the Audius suite
it passed **2 of 3** times, decided purely by which node `api.audius.co` handed out. It is the exact
flakiness the application already routes around at runtime (`content-nodes.ts` marks a failing
origin and `player-actions.ts` retries with a fresh URL); the single-shot smoke test models no such
rotation, which is why it is the part that flakes rather than the product.

**The test was left unchanged throughout** — repairing a red live test during a correction pass is
precisely how a real regression gets hidden. It went green on its own, against unmodified code,
which is the outcome that actually confirms the diagnosis.

---

## Root cause

`MIN_RELEVANCE` is 0.34. Measured before any edit, every one of the three real Jamendo rows scored
**0.375**:

```
aram asatryan | Eternos Rivales - Fil d'aram  | Eternos Rivales | score=0.375
aram asatryan | 01. Météo sombre (prod. Aram) | L.IAM           | score=0.375
aram asatryan | Orom Aram                     | Joël Vanoli     | score=0.375
```

All three earned that score the same way. `fieldScore` walks the query's significant tokens
(`aram`, `asatryan`), and `aram` matched **exactly** — `tokenMatchScore` 1.0. The mean over two
tokens is 0.5, damped by the existing `breadth` factor (0.5 + 0.5 × 1/2 = 0.75) to **0.375**. The
token that actually identifies the artist, `asatryan`, contributed nothing at all.

0.375 clears 0.34, so all three were admitted, ranked, and — being the only candidates — one became
**Top Result**. Two consequences followed:

1. the visitor was told their artist had been found when it had not;
2. `tracks.length > 0` put the YouTube fallback into its **subtle** *"Search YouTube for more"*
   variant, hiding the prominent button at the one moment it mattered.

Confirmed against the live endpoint — Jamendo really does return exactly these three rows:

```
GET /api/jamendo?action=search&q=aram%20asatryan
count: 3
 - Orom Aram                     |  Joël Vanoli
 - 01. Météo sombre (prod. Aram) |  L!AM
 - Eternos Rivales - Fil d'aram  |  Eternos Rivales
```

**Why raising the threshold was the wrong fix.** Two measurements rule it out:

* `kassandra` → the track titled `Kosandra` scores **0.700** — a genuine fuzzy match that any
  threshold above 0.375 keeps, but that shows how little headroom there is;
* `Some Song` by artist **`Asatryan`** scores **0.626** — *above* `STRONG_RELEVANCE` (0.62) — while
  covering only one of the two query concepts. **No score threshold can separate that from a real
  match.** Only coverage can.

---

## Algorithm change

One new, orthogonal signal. Existing thresholds are untouched.

### `RelevanceBreakdown.coverage`

The fraction of the query's **important** tokens for which the candidate carries evidence, measured
across **title, artist and artist handle together**.

```ts
export const MIN_STRONG_COVERAGE = 0.6   // strong-match floor
export const TOKEN_EVIDENCE      = 0.5   // a token counts as present at this tokenMatchScore
export const PHRASE_EVIDENCE     = 0.86  // whole query found intact ⇒ coverage 1

export function isStrongMatch(r: RelevanceBreakdown): boolean {
  return r.score >= MIN_RELEVANCE && r.coverage >= MIN_STRONG_COVERAGE
}
```

Five properties make it safe:

1. **Presence, not degree.** A token either has evidence or it does not. One perfect token can never
   stand in for a missing one — the exact failure being corrected.
2. **Low-signal words are excluded.** `the`, `official`, `audio`, `feat`, and the joinable particles
   (`al`, `de`, `van`, …) neither help nor hurt. `the official aram asatryan audio` has the same two
   important tokens as `aram asatryan`.
3. **Cross-field evidence.** `barov ari aram asatryan` covers fully against title `Barov Ari` +
   artist `Aram Asatryan`. No token is required to live in one particular field.
4. **Phrase short-circuit.** A field score ≥ 0.86 means the whole query was found intact, so coverage
   is 1 by construction. Without this, `miyagiandypanda` typed without spaces — a perfect compact
   match for `Miyagi & Andy Panda` — would score coverage 0, because its single 15-character token
   matches none of that name's three short tokens individually.
5. **Coverage travels with the winning variant.** `bestScoreAcross` already picks the best-scoring
   query variant; coverage is now carried on that same breakdown. **This is what keeps the alias
   table working.** Scored directly against the Latin-titled `Kosandra`, the Cyrillic `кассандра`
   has coverage **0** — the curated alias variant `kosandra` is what carries it to **1**. A naive
   token-count rule would have destroyed exactly this case.

0.6 is chosen so a **two-token query needs both** tokens (1/2 = 0.5 fails) while a **three-token
query may miss one** (2/3 = 0.67 passes) — the shorter the query, the more a missing token means a
different entity.

### Where it is applied

| File | Change |
|---|---|
| `src/music/search/relevance.ts` | `coverage` added to `RelevanceBreakdown`; `tokenCoverage`, `importantTokens`, `isStrongMatch` added |
| `src/music/search/smart-search.ts` | final filter uses `isStrongMatch` instead of the bare score; a **confirmed** artist (≥ `STRONG_ARTIST_RELEVANCE`) passes its coverage floor to its own catalogue, exactly as it already passes its score |
| `src/music/aggregator/multi-provider-search.ts` | same gate applied to Jamendo candidates; new `hasStrongOpenCatalogMatch` on the result |
| `src/features/search/useTrackSearch.ts` | flag threaded into `TrackSearchState` |
| `src/features/search/SearchResults.tsx` | results branch keyed on the flag; empty-state copy made truthful |

**No global threshold was raised.** `MIN_RELEVANCE`, `STRONG_RELEVANCE`, `STRONG_ARTIST_RELEVANCE`
and `MIN_WHOLE_STRING_OVERLAP` are all unchanged.

---

## Before / after

Scores are identical before and after — coverage is what changed the classification.

| Query | Title | Artist | Score | Coverage | Before | After |
|---|---|---|---|---|---|---|
| `aram asatryan` | Eternos Rivales - Fil d'aram | Eternos Rivales | 0.375 | **0.50** | shown, **became Top Result** | **filtered** |
| `aram asatryan` | 01. Météo sombre (prod. Aram) | L.IAM | 0.375 | **0.50** | shown | **filtered** |
| `aram asatryan` | Orom Aram | Joël Vanoli | 0.375 | **0.50** | shown | **filtered** |
| `aram asatryan` | Some Song | **Aram** | 0.375 | **0.50** | shown | **filtered** |
| `aram asatryan` | Some Song | **Asatryan** | **0.626** | **0.50** | shown (above `STRONG_RELEVANCE`) | **filtered** |
| `aram asatryan` | **Barov Ari** | **Aram Asatryan** | 0.950 | **1.00** | shown | **shown, strong** |
| `barov ari aram asatryan` | Barov Ari | Aram Asatryan | 0.950 | **1.00** | shown | **shown, strong** |

Open-catalog state for `aram asatryan`: `hasStrongOpenCatalogMatch` **false** → `outcome:
'no-strong-match'` → `tracks: []` → prominent fallback. Add the genuine row and it flips to **true**,
with that row the only one displayed.

---

## Open-catalog state

Weak provider noise can no longer suppress the prominent fallback, because the decision no longer
depends on row count at all:

```
before:  tracks.length > 0                  → subtle "Search YouTube for more"
after:   hasStrongOpenCatalogMatch === true  → subtle
         hasStrongOpenCatalogMatch === false → prominent "Search YouTube"
```

Verified live (real Audius + Jamendo, no stubs):

| State | Query | Song rows | Top result | Empty state | Fallback |
|---|---|---|---|---|---|
| weak | `aram asatryan` | **0** | **none** | *No strong matches found.* | **PROMINENT** |
| strong | `Adele Hello` | 20 | Adele - Hello | — | subtle |

"Nothing good" is still distinguished from "provider down": both catalogues continue to report
`status: 'success'` in `providers[]` when they answer with only weak rows, so a genuine outage stays
visible in diagnostics.

Weak rows are **filtered out**, not shown under a secondary heading. A "Possible matches" section
would have added a new heading and list to the reference layout — a material change the brief
allows omitting — and truthful empty-state UX was the stated preference.

---

## International regression

All verified live against the real catalogues, plus 32 deterministic unit assertions.

| Query | Live result | Fallback | Verdict |
|---|---|---|---|
| `kosandra` | 20 rows, incl. *Miyagi & Andy Panda - Kosandra (Official Audio)* | subtle | **unchanged** |
| `кассандра` | 20 rows, **identical set** to `kosandra` | subtle | **alias intact** |
| `kassandra` (unit) | `Kosandra` scores 0.700, coverage 1.00 | — | **strong** |
| `Miyagi Andy Panda` (unit) | vs `Miyagi & Andy Panda`, coverage 1.00 | — | **strong** |
| `Skrillex` | 20 rows | subtle | **unchanged** |
| `Adele Hello` | 20 rows, top *Adele - Hello* | subtle | **unchanged** |
| `أم كلثوم` (Arabic) | 4 rows, top *سيرة الحب - ام كلثوم* | subtle | **unchanged** |
| `سارة السواس` (Arabic) | 0 strong rows | prominent | correct — catalogues have none |
| `Кино Группа крови` (Cyrillic) | 2 rows, top *Кино - Группа крови (Игла)* | subtle | **unchanged** |
| `Արամ Ասատրյան` (Armenian) | 0 rows | prominent | correct — catalogues have none |
| `Սիրուշո` (Armenian) | 0 rows | prominent | correct — catalogues have none |

Unit-level preservation additionally proves: the Cyrillic→Latin alias path, the Cyrillic artist alias
(`мияги`), the Arabic transliteration group (`sara al swas` / `sarah al sawas` / `سارة السواس`),
Armenian script matching **and** its guard (`Արամ Ասատրյան` vs artist `Արամ` → weak), a homoglyph in
catalogue data (`kosandrа` with Cyrillic U+0430), diacritics (`Météo`), punctuation (`L.IAM`,
`Miyagi & Andy Panda`), and the compact space-free phrase (`miyagiandypanda`).

---

## YouTube

Untouched. `YOUTUBE_API_KEY` server-only, `/api/youtube`, the official Data API and IFrame API,
MadeForKids external-only handling, the privacy route, `Referrer-Policy`, visible-iframe rules,
background pause, quota handling, session cache and bundle scanning are all exactly as Phase 3 left
them.

* **Still explicit-only.** No automatic request, no alias fanout, no pagination, no prefetch.
* **Zero search calls before the click** — measured live at 0 for all ten QA queries, and enforced in
  tests by MSW's `onUnhandledRequest: 'error'` with no default `/api/youtube` handler.
* **Exactly one call after the click**, confirmed live.
* **Relevant real results after the click** for `aram asatryan`:

```
Aram Asatryan   Barov Ari          —  zeytun818
Lusnyak Gishernere                 —  Aram Asatryan - Topic
Tangarjhek Manyak                  —  Aram Asatryan - Topic
Yes Qo Gisherva Hyurn Em           —  Aram Asatryan - Topic
Tashkinak                          —  Aram Asatryan - Topic
Sirum Em, Sirum Em                 —  Aram Asatryan - Topic
Yed Dartsir                        —  Aram Asatryan - Topic
Trakhdi Peri                       —  Aram Asatryan - Topic
```

* **Live YouTube smoke: 12/12 PASS.**
* Quota spent by this entire correction pass: **5 `search.list` + 5 `videos.list`** (one direct
  endpoint probe, two QA runs, and the gate/final smoke runs) out of the 100/day search bucket.

---

## Tests

| Suite | Before this pass | After | Added |
|---|---|---|---|
| Unit / component | 50 files, **744** | 51 files, **789** | **+45** |
| E2E | **141** passed | **149** passed | **+8** (4 × 2 projects) |
| Live smoke | 26 | 26 | unchanged |

New and extended:

```
src/music/search/coverage.test.ts                    32  NEW — the live weak rows, multi-token
                                                          coverage, artist confidence, cross-field
                                                          evidence, and every international case
src/music/aggregator/multi-provider-search.test.ts   +7  hasStrongOpenCatalogMatch, both catalogues
                                                          gated identically, "weak ≠ provider down"
src/features/search/YouTubeFallback.test.tsx         +6  prominent vs subtle by confidence, no Top
                                                          Result from noise, 0 calls before click,
                                                          exactly 1 after
tests/e2e/youtube-fallback.spec.ts                   +4  same, end to end in a real browser
```

Every one of the three weak rows is a **verbatim fixture of a row the live Jamendo catalogue
returned**, so these are regressions against reality rather than against an invented example.

---

## Gate

```
pnpm typecheck        PASS
pnpm lint             PASS   (--max-warnings 0)
pnpm test:run         PASS   51 files, 789 tests
pnpm build            PASS
pnpm test:e2e         PASS   149 passed, 15 skipped
pnpm verify:bundle    PASS   0 matches across 7 files
                             (configured values: JAMENDO_CLIENT_ID, YOUTUBE_API_KEY)

AUDIUS_SMOKE=1 JAMENDO_SMOKE=1 YOUTUBE_SMOKE=1 pnpm test:smoke
  YouTube   12/12  PASS
  Jamendo    8/8   PASS
  Audius     6/6   PASS   (was 5/6 during this pass — external content-node TLS
                           failures, 4/8 nodes broken at the time; rerun green
                           against unmodified code)
  TOTAL     26/26  PASS
```

---

## Files changed

**Source (5)** — `src/music/search/relevance.ts`, `src/music/search/smart-search.ts`,
`src/music/aggregator/multi-provider-search.ts`, `src/features/search/useTrackSearch.ts`,
`src/features/search/SearchResults.tsx`

**Tests (5)** — `src/music/search/coverage.test.ts` *(new)*,
`src/music/aggregator/multi-provider-search.test.ts`,
`src/music/aggregator/cross-provider-dedupe.test.ts` *(one fixture field)*,
`src/features/search/YouTubeFallback.test.tsx`, `tests/e2e/youtube-fallback.spec.ts`

**Docs (1)** — `docs/SEARCH_CONFIDENCE_FINAL_REPORT.md` *(new)*

Untouched: `refe/`, the entire YouTube stack, playback, the provider architecture, `vercel.json`,
`package.json`, all relevance thresholds.

---

## Known limitations

1. ~~**The Audius audio-bytes live smoke is environmentally red.**~~ — **resolved by rerun; now
   6/6.** The underlying condition remains a real property of the network rather than of this
   project: `api.audius.co` hands out a community-run content node per stream request and some of
   them serve broken TLS, so this single-shot test can flake again. The application itself routes
   around it at runtime. The test was deliberately never modified.
2. **Coverage is threshold-based, not learned.** A two-token query needs both tokens. A visitor
   searching `aram asatryan` when the catalogue holds a track credited only to `Asatryan` will see
   the fallback rather than that track — the brief specifies this as correct (Step 10-C), but it is a
   deliberate trade of recall for precision.
3. **Weak rows are discarded, not offered as "possible matches."** Chosen over adding a new section
   to the reference layout. Anyone wanting them can press *Search YouTube*, which covers the same
   need with better results.
4. **Coverage depends on the alias table for cross-script equivalence.** `кассандра` works because
   `kosandra` is a curated alias. A native-script query with no alias entry and no shared tokens will
   read as weak — correctly, since the app has no evidence — and route to the fallback, which is what
   the Armenian and Arabic live results show.
