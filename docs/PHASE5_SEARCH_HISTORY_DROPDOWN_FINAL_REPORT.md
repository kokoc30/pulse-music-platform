# Phase 5 — Search history dropdown + Recently Played search UX

## Status

**PASS.**

Every condition set for a PASS is met and evidenced:

- the dropdown works on desktop and on a phone viewport;
- recent queries persist, and reusing one moves it back to the top;
- clicking a query goes through the *same* submit path as pressing Enter;
- remove-one and clear-all both work, persist, and touch search history only;
- Recently Played replays through the existing engines — audio for Audius/Jamendo, the IFrame
  player for YouTube;
- full keyboard support, with a standards-compatible combobox/listbox pattern;
- **opening, arrowing through, filtering and removing all generate zero provider traffic**;
- YouTube quota semantics are unchanged;
- every deterministic gate passes.

---

## Baseline

| Gate | Phase 4 baseline | After Phase 5 |
| --- | --- | --- |
| `pnpm test:run` | 1093 tests, 64 files | **1199 tests, 68 files** |
| `pnpm test:e2e` | 211 passed, 15 skipped | **245 passed, 15 skipped** |
| `pnpm typecheck` | clean | clean |
| `pnpm lint` | clean (`--max-warnings 0`) | clean |
| `pnpm build` | succeeds | succeeds |
| `pnpm verify:bundle` | 0 matches | 0 matches |
| Live smoke | 26/26 | 26/26 best observed (see [Live smoke](#live-smoke)) |

All 1093 pre-existing tests still pass. **106 tests were added** — 64 for Phase 5, 23 for the
Recently Played corrections documented in `RECENTLY_PLAYED_ARTWORK_LIVE_ORDER_FIX.md`, and 19 for
the live-smoke triage classifier described under [Live smoke](#live-smoke). No test was weakened or
skipped.

---

## UX behavior

Focusing or clicking the search field opens a panel anchored beneath it:

```
┌──────────────────────────────────────────────┐
│ 🔍 What do you want to play?                 │
├──────────────────────────────────────────────┤
│ RECENT SEARCHES                        Clear │
│ ↺  Кино Группа крови                     ×   │
│ ↺  Adele Hello                           ×   │
│ ↺  aram asatryan                         ×   │
│ ↺  sara al sawas                         ×   │
│ ─────────────────────────────────────────────│
│ RECENTLY PLAYED                              │
│ [art] Peak — iLLPeTiLL · Audius              │
│ [16:9] Night Signal — Aster Vale · YouTube   │
└──────────────────────────────────────────────┘
```

Not a modal, not full-screen, no navigation, no provider call. Bounded at **6** recent searches and
**4** recently played rows, with internal scrolling only if the panel would otherwise grow tall.

**Recently Played appears only while the field is empty.** Once someone is typing they are narrowing
towards a query, and a list that cannot narrow with them is noise pushing the matches off screen.

**Nothing false is ever shown.** With no history the dropdown does not open at all — an empty panel
covering the page and saying nothing is worse than none. With personalization off, no history is
shown in any state. Search itself is untouched in all three consent states.

---

## Search-history source

The existing Phase 4 `searchHistory`. **No second store, no second persistence layer, no new
`localStorage` key, and no schema change** for this phase. Components never touch storage; they read
the personalization store through `useSearchSuggestions`.

`src/personalization/search-suggestions.ts` holds three pure selectors — `recentSearches`,
`filterRecentSearches`, `recentlyPlayedSuggestions` — over state the store already has in memory.

Each row shows a history icon, the query **exactly as it was typed**, and a remove control.
Unicode is never transliterated or case-folded for display: `سارة السواس`, `Արամ Ասատրյան` and
`Кино Группа крови` render byte-exact, verified live and in tests.

One store action was added: `removeSearch(normalizedQuery)`, addressing a row by the same normalized
form the history model already deduplicates on.

---

## Recently-played source

The existing Phase 4 `listeningHistory`, through `recentShelf` — **the same canonical selector the
home page renders**, differing only in how many rows it takes.

That is load-bearing. `recentShelf` is where the ordering, the YouTube 30-day retention purge *and*
the embeddable / made-for-kids eligibility rules live. An earlier draft built its own list from
`recentlyPlayed()` and consequently offered a made-for-kids video the home page correctly refused;
a test caught it, and it was fixed by deleting the second implementation rather than copying the
rules into it.

Rows carry artwork (or a 16:9 YouTube thumbnail, never cropped square), title, artist/channel and a
provider label. Artwork uses the shared `historyArtwork` resolver, so a dead Audius content node
fails over here exactly as it does on the home shelf.

---

## Open/close rules

| Opens on | Closes on |
| --- | --- |
| Input focus | Escape |
| Input click | Selecting a row |
| Keyboard focus (Ctrl/⌘-K) | Submitting a search |
| Typing | A click outside |
| | Navigating away |

**Clicking inside never closes it**, which is what lets the remove and clear controls work.

Two subtleties, both found by testing rather than reasoning:

- **The outside-click listener runs in the capture phase.** React handles events on its root, which
  is inside `document`, so a bubble-phase listener fires *after* the row has re-rendered — and a
  clicked Clear or Remove button is detached by then, making `contains(target)` report it as an
  outside click and dismissing the panel the visitor was still using.
- **Navigation does not close it while the field still has focus.** Emptying the field to browse
  history returns to `/` after the 300 ms debounce; dismissing the list a third of a second after
  the visitor opened it would be baffling. A real navigation moves focus, so links still close it.

---

## Keyboard navigation

| Key | Behaviour |
| --- | --- |
| `ArrowDown` / `ArrowUp` | Move through rows, wrapping at both ends |
| `Enter` | Activate the highlighted row; with none highlighted, submit the typed query as before |
| `Escape` | Close the panel, keep focus **and** the typed text |
| `Tab` | Ordinary navigation — focus is never trapped |
| `Delete` / `Backspace` | Remove the highlighted recent search (only when the field is empty, so it never fights ordinary editing) |

**Arrowing never rewrites the field.** Highlighting is visual and `aria-activedescendant` only;
the query is set when a row is actually activated. Escape leaves the typed text exactly as it was.

Escape retains its prior meaning — clearing the field — when the dropdown is not open.

---

## Accessibility

The WAI-ARIA combobox/listbox pattern: `role="combobox"` on the input with `aria-expanded`,
`aria-controls`, `aria-autocomplete="list"` and `aria-activedescendant`; `role="listbox"` on the
panel; `role="option"` on each row. Focus never leaves the input, so typing and stepping through
history coexist.

- Options carry explicit accessible names: *"Search again for aram asatryan"*, *"Play Peak by
  iLLPeTiLL from Audius"*.
- Remove buttons: *"Remove “aram asatryan” from recent searches"*.
- Rows are 40px minimum (44px on touch); the remove control is a 30px circular target, always
  visible on touch pointers where there is no hover.
- Hover, `data-active` and `:focus-visible` share one visual treatment.
- `prefers-reduced-motion` disables the transitions.

**One compromise, recorded rather than glossed:** the remove button sits inside its option, which a
screen reader in browse mode may not reach. Mitigated two ways — Delete/Backspace removes the
highlighted row, and each option's explicit `aria-label` keeps its accessible name the query alone
rather than absorbing the button's label.

---

## Route/submission integration

`submitQuery()` is **the only function in the app that navigates to a search**, and Enter, a clicked
row and a keyboard-activated row all call it. Behaviour cannot diverge because there is nothing to
diverge from.

It performs a real history **push** — the exact signal `useSubmittedSearchKey` reads. So a reused
query is an explicit submission in every sense: it runs the normal provider search, records itself
in search history through `useSearchHistory`, and is eligible for the automatic YouTube fallback
under unchanged rules.

Browser Back returns to the previous search; the debounced search-as-you-type still uses `replace`,
so history is not flooded. Covered by an E2E test that searches `night`, picks `Adele Hello` from
the dropdown, and goes back to `night`.

---

## Search-history deduplication

Unchanged — the dropdown renders the existing deduplicated list rather than a raw log. `Adele
Hello`, `ADELE HELLO` and `Adele   Hello` are one row, showing the most recent original form, and
reusing a query updates `submittedAt`/`submitCount` instead of adding a row.

Local filtering uses the project's existing `normalizeText`, so it folds case, punctuation and
spacing without transliterating: `ara` finds both `aram asatryan` and `sara al sawas`; `alsawas`
finds `sara al sawas`; `Кино` finds the Cyrillic query and `kino` does not.

---

## Network request audit

| Action | Provider requests |
| --- | --- |
| Focusing the field | **0** |
| Opening the dropdown | **0** |
| Arrow navigation / highlighting | **0** |
| Filtering recent history | **0** |
| Removing a recent query | **0** |
| Clearing search history | **0** |
| Rendering a YouTube row | **0** |
| Choosing a recent query | Exactly what an identical typed submission costs |
| Playing a Recently Played row | Exactly the Phase 4 replay resolution (one request) |

No autocomplete API, no suggestion endpoint, no extra Audius/Jamendo/YouTube call. Filtering is an
in-memory pass over a list already capped at 50 rows, so it is free on every keystroke.

Asserted in both suites — a component test counts Audius searches across open/arrow/filter, and an
E2E test records all provider traffic after discovery has settled. Verified live: *"Opening it made
zero provider requests"* and *"Filtering made zero provider requests"*.

---

## Consent behavior

| Consent | Dropdown | Search |
| --- | --- | --- |
| `granted` | Full history | Works |
| `denied` | Never shown | Works |
| `unset` | Never shown, and nothing is recorded | Works |

No second consent mechanism was added; the check is one read of the existing store, in one place.

---

## YouTube quota preservation

Unchanged in every respect. Phase 5 adds no YouTube code path.

- Typing, opening, arrowing, filtering, removing: **0** YouTube requests, as before.
- Choosing a recent query is an explicit submission, so the existing rule applies exactly:
  Audius + Jamendo first; a strong open-catalog match spends **0** automatic YouTube searches; no
  strong match spends **exactly one**, once.
- A retained YouTube row can be rendered and replayed in the dropdown; **rendering it costs no Data
  API call**, and playing it loads only YouTube's own player, as Phase 3 established.
- The E2E assertion separates the two precisely: `/api/youtube` calls stay at zero while
  `youtube.com` player-script requests are expected on playback.

---

## Files changed

**New (7):**

| File | Purpose |
| --- | --- |
| `personalization/search-suggestions.ts` | The three pure selectors |
| `personalization/search-suggestions.test.ts` | 16 tests |
| `features/search/useSearchSuggestions.ts` | Store-backed hook, consent-gated |
| `components/search/SearchSuggestions.tsx` | The listbox |
| `components/search/suggestion-rows.ts` | Flattened row model + row ids |
| `components/search/SearchSuggestions.test.tsx` | 48 tests |
| `styles/search-suggestions.css` | Panel, rows, responsive |
| `tests/e2e/search-dropdown.spec.ts` | Scenarios A–H |

**Modified (6):**

| File | Change |
| --- | --- |
| `components/search/SearchBar.tsx` | Open/close state, highlight index, combobox ARIA, one `submitQuery` path |
| `personalization/history.ts` | `removeSubmittedSearch` reducer |
| `personalization/store.ts` | `removeSearch` action |
| `personalization/config.ts` | `RECENT_SEARCH_SUGGESTIONS`, `RECENT_PLAYED_SUGGESTIONS` |
| `personalization/index.ts` | Exports |
| `styles/index.css` | Imports the new stylesheet |

Plus 11 selector updates in three existing test files (`getByRole('searchbox')` → accessible name),
a consequence of the deliberate ARIA role change; and `docs/reference-deviations.md` D-38, D-39.

**Not touched:** search architecture, provider APIs, YouTube quota behaviour, personalization
scoring, playback engines, the storage key or schema version, `refe/`.

---

## Tests added

**Component / unit — 64 for this phase:**

`SearchSuggestions.test.tsx` (48): opening on focus and on keyboard focus; staying closed with no
history; `aria-expanded`/`aria-controls`; ordering; the display cap; four non-Latin scripts
byte-exact; deduplication; selection runs the normal search, closes the panel and moves the query
to the top; local filtering including the Cyrillic/Latin boundary; **zero provider requests to
build or filter suggestions**; remove-one (removes only that row, runs no search, keeps the panel
open, persists, leaves listening history alone); clear-all (removes searches only, keeps listening
history, consent and volume); full keyboard set including wrap-around, no-text-mutation-while-
arrowing, Delete-to-remove and Tab not trapping; click-outside and navigation closing; recently
played ordering, Audius replay, YouTube replay through the iframe, expired / made-for-kids /
non-embeddable omitted, live reorder; all three consent states.

`search-suggestions.test.ts` (16): ordering, bounds, empty state; filtering (empty term, substring,
case, spacing-insensitive, script separation, Arabic, no match, bound); recently played ordering,
bound, **identity with `recentShelf`**, and inherited YouTube eligibility.

**E2E — 17 scenarios × 2 projects = 34:** A (open, choose, move to top, Back), B (filter + zero
provider traffic), C (keyboard), D (remove persists), E (clear keeps Recently Played), F (replay
through the audio engine), G (YouTube iframe, zero Data API), H (mobile fit and touch), consent,
plus the three Recently Played artwork/ordering scenarios.

---

## Unit/component final count

**1199 passing, 68 files** — 1180 for Phase 5 and the Recently Played fix, plus 19 for the live-smoke
triage classifier added in the follow-up above.

## E2E final count

**245 passing, 15 skipped.**

---

## Live smoke

**Best observed 26/26** — Audius 6/6, Jamendo 8/8, YouTube 12/12.

Across eight runs the result alternated between 26/26 and two diagnosed external failures. Neither
was hidden or worked around, and no unrelated code or test was changed:

1. **Audius `ERR_SSL_PACKET_LENGTH_TOO_LONG`** — an OpenSSL record-layer error from a remote Audius
   content node, on the range-request assertion. Client code cannot cause it; the codebase already
   documents and retries around this condition. It is the same infrastructure fault that produced
   the artwork bug this pass fixed.
2. **YouTube HTTP 429 — daily quota exhausted.** `[youtube] YouTube search answered HTTP 429.` The
   Data API allows 100 searches per day for the whole deployment, and this session spent them across
   repeated smoke runs and live manual QA, whose multilingual queries each legitimately trigger one
   automatic fallback search. The documented quota model behaving correctly; it recovers when the
   quota resets.

### Follow-up: the quota outage now reports once, not five times

*Test diagnostics only — no production code, quota handling or YouTube API behaviour changed.*

That 429 was producing **five** failures from one root cause. Only the first was real; the other
four — *"expected Armenian query, received undefined"*, *"no duration enrichment"*, *"no MadeForKids
value"*, *"no parsed duration"* — were four different descriptions of an empty results array, and
they buried the one line worth reading.

The suite now asks two questions in order:

| | Question | Behaviour |
| --- | --- | --- |
| 1 | Did the live API answer? | One test. Fails once, naming the cause. |
| 2 | Is the answer correct? | Eleven tests, **skipped** when there is no answer to describe. |

A blocked run now reads:

```
FAIL  YouTube real-provider smoke > answers a live search through the real handler
Error: YouTube live smoke: BLOCKED — HTTP 429 daily quota exhausted

      The whole deployment shares 100 search.list calls a day. This is the documented
      quota model working, not a defect — the handler answered 429 and the app surfaces
      its quota message. Re-run after the quota resets (midnight Pacific).

      Live search requests made by this suite: 1 (expected exactly 1).
      The remaining response-content checks are reported as skipped, not passed:
      there was no successful response for them to describe.

Tests  1 failed | 14 passed | 11 skipped (26)          → exit code 1
```

Skipped, never passed, and still non-zero — a blocked run remains a failed run.

**Nothing was weakened.** A 200 still has to satisfy every original assertion: status, query
preservation, video identity, `videos.list` enrichment, embeddability, MadeForKids, ISO-8601
duration parsing, sanitized keys, entity decoding, no key leakage, no media URLs, no CORS/cache.
The suite is still 12 tests, so an available quota still reports **YouTube 12/12**.

**Retry was audited, and the answer is now proven rather than assumed.** `vitest.smoke.config.ts`
sets `retry: 1`; a retry re-runs the *test*, not `beforeAll`, so a failing assertion cannot buy a
second search. The run above shows the retry happening (the `FAIL` line appears twice) while
`liveRequests` stayed at 1. That counter is printed in every blocked diagnostic, so an accidental
second request would be impossible to miss. The suite still makes exactly one `search.list` — the
minimum that can validate the provider — plus the one batched `videos.list` the enrichment
assertions exist to prove.

The triage itself lives in `server/youtube/smoke-outcome.ts`, a pure classifier with **19
deterministic tests** in `pnpm test:run`. That is what lets the *success* path and every block
reason be covered without waiting for a real outage or spending a single unit of quota.

> **Not re-verified live:** the 12/12 success path. The quota was still exhausted at the time of
> this change, and re-running to check would have been both futile and against the brief. The
> success path is covered deterministically and its assertions are unchanged from the version that
> last reported 12/12.

---

## Manual QA

Real dev server, live Audius, real Chromium, real `localStorage`. **35/35 checks passed.**

| # | Check | Result |
| --- | --- | --- |
| 0 | Built real history — 4 searches, 2 qualifying listens | PASS |
| 4 | Focusing the field opens the dropdown | PASS |
| 4b | Opening it made **zero** provider requests | PASS |
| 4c | Recent searches listed, most recent first | PASS — `Кино Группа крови | Adele Hello | aram asatryan | sara al sawas` |
| 4d | Non-Latin queries display byte-exact | PASS |
| 4e | Compact Recently played section present | PASS |
| 5 | Choosing a recent query runs the normal search | PASS — `/search?q=aram%20asatryan` |
| 5b | The dropdown closed | PASS |
| 5c | …and it really did search | PASS — 3 provider calls |
| 6 | The reused query moved back to the top | PASS |
| 7 | Typing filters recent history locally | PASS — `ade` → `Adele Hello` |
| 7b | Filtering made **zero** provider requests | PASS |
| 7c | Escape closes and keeps the typed text | PASS |
| 8 | Removing one recent search removes just that row | PASS |
| 8b | Removing ran no search | PASS |
| 8c | The dropdown stayed open | PASS |
| 9 | Clear removes every recent search | PASS |
| 9b | Recently Played survives the clear | PASS — 2 items |
| 9c | The dropdown still shows Recently played | PASS |
| 10 | A Recently played row plays through the audio engine | PASS — *Play Peak by iLLPeTiLL from Audius* |
| 10b | The dropdown closed on selection | PASS |
| 11 | Search history stayed cleared after reload | PASS |
| 11b | Listening history persisted | PASS |
| 11c | Storage contains no secret | PASS |
| 12 | Usable on a 390px viewport and fits inside it | PASS — `x=10 w=370` |
| 12b | No horizontal page scrollbar | PASS |
| 13 | No page errors throughout | PASS |

(Checks 1–3 belong to the Recently Played artwork/ordering fix and are listed in its own report.)

---

## Known limitations

1. **The dropdown filters by whatever is in the field**, including a query the URL put there. A
   visitor on `/search?q=night` who focuses the field sees history filtered by `night`, and must
   clear it to browse everything. Consistent with typing, and the alternative — ignoring the field's
   contents — is more surprising.
2. **Recently Played hides while typing.** Deliberate: it cannot narrow with the query, so it would
   only push matches off screen.
3. **No fuzzy matching.** Filtering is substring-based over the normalized form; a typo will not
   find a stored query. Appropriate for a history list, where the visitor is recalling something
   they typed themselves.
4. **Delete-to-remove requires an empty field**, so it never fights ordinary text editing. Mouse and
   touch users are unaffected.
5. **The remove button lives inside its option**, with the mitigations described under
   Accessibility. A separate `role="grid"` treatment would be more strictly correct at the cost of a
   pattern most screen-reader users encounter less often.
6. **No "clear one" confirmation.** Settings confirms its destructive actions in place; the dropdown
   does not, because removing a single suggestion is a small, obvious, immediately-visible
   correction. *Clear* is the same action Settings offers behind a confirmation — a deliberate
   asymmetry, noted here rather than left implicit.
