# Automatic YouTube Fallback — Final Report

**Date:** 2026-08-28 · **Project:** `C:\music-platform` (Pulse — Music Discovery)
**Scope:** a frontend-only correction. No change to the YouTube server endpoint, Google API key
handling, provider architecture, playback engine, search relevance algorithm, quota budget or the
iframe implementation.

---

## Status — **PASS**

An explicit search that Audius and Jamendo cannot answer now searches YouTube on its own. Nobody has
to press a second button. Search-as-you-type still costs nothing.

Verified live, with real credentials:

| Query | Typing | Explicit submit | HTTP | Result |
|---|---|---|---|---|
| `sara al sawas` | **0** requests | **1** request | **200** | **8** YouTube rows, automatically |
| `aram asatryan` | **0** requests | **1** request | **200** | **8** YouTube rows, automatically |
| `Adele Hello` | **0** requests | **0** automatic requests | — | 20 Audius/Jamendo rows, subtle *for more* control |

---

## Exact frontend root cause

**`useYouTubeFallback` had no effect that could start a request.** Its own doc comment said so, and
that was deliberate — it was written as *"a hook with a function you call"* so that nothing could
spend quota without a click:

```ts
// before
const run = useCallback(() => { /* the only path to searchYouTubeVideos */ }, [])

useEffect(() => {
  // the only effect on `query` — it DISCARDS results, it never fetches
  setState({ query, status: 'idle', videos: [] })
}, [query])
```

`run` was referenced in exactly one place: the `onClick` of `YouTubeFallbackAction`. So when
`multiProviderSearch` returned `hasStrongOpenCatalogMatch: false`, `SearchResults` rendered the
prominent **Search YouTube** button and stopped. **Nothing in the application observed that flag.**
The Network panel showed Audius and Jamendo and no `/api/youtube`, exactly as reported — and the
endpoint was never at fault, which is why calling it directly returned 200 and eight results.

So this was not a broken code path. It was a **missing** one: the decision "the open catalogues came
back empty, therefore ask YouTube" had no implementation.

### Why it could not simply be made automatic on `query`

Because `query` changes while someone is typing. `SearchBar` debounces and navigates on every
settled keystroke, so typing `sara al sawas` produces several *completed* Audius + Jamendo searches
on the way (`sara`, `sara al`, …). Auto-running YouTube on query change would have spent several of
the deployment's 100 daily searches on one person typing one phrase.

The fix therefore needed a signal for *submission* that is distinct from *the text changed*.

---

## The submission signal — already in the codebase

`SearchBar` has drawn this distinction since Phase 1, for an unrelated reason (not flooding the back
button):

```ts
// search-as-you-type
void navigate(`/search?q=${encodeURIComponent(query)}`, { replace: true })   // REPLACE

// pressing Enter
if (event.key === 'Enter') { … void navigate(`/search?q=${encodeURIComponent(query)}`) }  // PUSH
```

Every other way to start a search in this app is also a push — the footer's genre links, the station
cards, and the *Search for &lt;artist&gt;* action on an artist card are all `<Link>`s or programmatic
pushes. **So `PUSH` already *was* the explicit-submission signal**, and nothing new had to be invented
or threaded through the router:

```ts
// src/features/search/useSubmittedSearch.ts
export function useSubmittedSearchKey(): string | null {
  const navigationType = useNavigationType()
  const location = useLocation()
  return navigationType === NavigationType.Push ? location.key : null
}
```

`location.key` is unique per history entry, which makes it a stable identity for one submission —
constant across re-renders, different for a second press.

**Deliberately excluded:**

* **`REPLACE`** — search-as-you-type. This is the quota guarantee.
* **`POP`** — deep links, refresh, the back button. A refresh loop would otherwise spend a search
  every time, and the per-tab cache is empty after a reload. These keep the manual button, which is
  exactly the behaviour they had before. It also means all 789 pre-existing tests, which render at a
  route directly, kept passing unchanged.

---

## New behaviour

```
explicit submission (Enter / genre link / artist card)
        │
        ▼
Audius + Jamendo run, as before
        │
        ├── hasStrongOpenCatalogMatch === true
        │     → normal results, ZERO automatic YouTube calls,
        │       "Search YouTube for more" still available manually
        │
        └── hasStrongOpenCatalogMatch === false
              → "Searching YouTube…"
              → exactly one /api/youtube?action=search&q=…
              → YouTube results section renders automatically

search-as-you-type  →  ZERO YouTube calls, ever, prominent button offered
deep link / refresh →  ZERO YouTube calls, prominent button offered
```

| | Old | New |
|---|---|---|
| Typing a no-match query | button, 0 calls | button, **0 calls** (unchanged) |
| **Submitting** a no-match query | button, **0 calls** — the bug | **1 call**, results render automatically |
| Submitting a strong-match query | results + *for more* | results + *for more*, **0 automatic calls** |
| Deep link to a no-match query | button, 0 calls | button, **0 calls** (unchanged) |
| While YouTube is pending | *No strong matches found.* | **“Searching YouTube…”** |
| After YouTube returns rows | *No strong matches found.* above the rows | rows only — the headline is suppressed |

That last row is a correction the change surfaced: leaving a large *No strong matches found.*
headline above eight real results contradicts the page. The YouTube section carries its own heading
and explanation, so it now speaks for itself once it has something to say.

---

## Quota safety

One submission spends **at most one** `search.list` + one batched `videos.list`. Four independent
guards:

1. **Gated on `submissionKey`**, which is `null` for typing, deep links and the back button.
2. **Gated on settled state** — `autoRunWhen` is `status === 'success' && !hasStrongOpenCatalogMatch`,
   so an in-flight catalogue search can never trigger it.
3. **Idempotent via a ref**, not state:

   ```ts
   const key = `${submissionKey}\u0000${trimmed}`
   if (autoRanRef.current === key) return
   autoRanRef.current = key
   ```

   A ref survives every re-render and StrictMode's deliberate double-invocation, so one
   `(submission, query)` pair can pass exactly once. It is never cleared on success **or failure**,
   which is what prevents an automatic retry loop after a YouTube error.
4. **The existing exact-query session cache** absorbs anything that somehow got past the above,
   reporting `requests: 0`.

Nothing was added to the debounce path, no alias fanout, no pagination, no prefetch, no retry.

**Quota spent by this whole correction pass: 2 `search.list` + 2 `videos.list`** (the two live QA
submissions), plus the one from the live smoke — out of 100/day.

---

## Files changed

**New (2)**

| File | Purpose |
|---|---|
| `src/features/search/useSubmittedSearch.ts` | `useSubmittedSearchKey()` — the PUSH-based explicit-submission identity |
| `src/features/search/AutoYouTubeFallback.test.tsx` | 16 regression tests for this exact bug |

**Modified (5)**

| File | Change |
|---|---|
| `src/features/search/useYouTubeFallback.ts` | optional `{ submissionKey, autoRunWhen }`; idempotent auto-run effect; `autoRan` exposed |
| `src/features/search/SearchResults.tsx` | passes the submission signal; adds the *Searching YouTube…* state; suppresses the stale failure headline once YouTube has rows |
| `src/test/render.tsx` | optional `strict` flag so a test can render under `<StrictMode>` |
| `src/features/search/YouTubeFallback.test.tsx` | one existing test adapted — see below |
| `tests/e2e/youtube-fallback.spec.ts` | 5 new network-assertion tests; one existing test adapted |

**Untouched:** `/api/youtube`, `server/youtube/*`, the API key handling, `src/music/youtube/client.ts`,
the aggregator, the relevance algorithm, the playback engine, the iframe implementation, `vercel.json`,
`refe/`.

### The two adapted tests, and why

Both asserted *"pressing the fallback button twice costs one search"* by clicking the button a second
time **after results had rendered**. Once the stale-headline suppression landed, the button is no
longer on screen in that state — so the scenario they described can no longer occur in the UI.

Neither test was deleted or weakened. Both now use a YouTube response with **no** rows, which keeps
the manual control on screen, so they still assert exactly what they always did: a second press is
answered from the session cache and costs nothing. The repeat-submission path is additionally covered
by a new test (*“submitting the same query twice costs one upstream search”*).

---

## Tests

| Suite | Before | After | Added |
|---|---|---|---|
| Unit / component | 51 files, **789** | 52 files, **805** | **+16** |
| E2E | **149** | **159** | **+10** (5 × 2 projects) |
| Live smoke | 26 | 26 | unchanged |

**`AutoYouTubeFallback.test.tsx` (16)** — `sara al sawas`: 0 while typing, exactly 1 after submission,
rows render, searching state shown instead of the failure screen. `aram asatryan`: the same, with
weak Jamendo noise present and still no Top Result. `Adele Hello`: 0 automatic, manual *for more*
spends exactly 1. Quota safety: no repeat on re-render, **no double-fire under StrictMode**, repeat
submission served from cache, no automatic retry after failure, stale results cleared on query
change. Unicode: Arabic, Armenian and Cyrillic queries reach `/api/youtube` byte-for-byte.

**E2E (5 × 2 projects)** — 0 requests before submit and exactly 1 after; rows render with no second
click and no stale headline; a strong match makes 0 automatic requests and the manual control then
spends exactly 1; `pressSequentially` with a 120 ms delay (settling the debounce repeatedly) spends
0; a deep link keeps the manual control and spends 0 until pressed. The frontend decision logic is
never stubbed — only the network is.

---

## Live results

### `sara al sawas` — 1 request, HTTP 200, 8 rows automatically

```
Saria Al Sawas - Bas asmae Mini video clip | سارية السواس - بس اسمع مني فيديو كليب
Saria Al Sawas feat. @kosaikhaulii - Wajeh El Goumar (2026) / سارية السواس و قصي خولي - وجه القمر
Ma Mallet
ساريه  السواس شلونو شلونو
```

Audius + Jamendo song rows: **0**. YouTube requests during typing: **0**.

### `aram asatryan` — 1 request, HTTP 200, 8 rows automatically

```
Aram Asatryan   Barov Ari
Lusnyak Gishernere
Tangarjhek Manyak
Trakhdi Peri
```

Audius + Jamendo song rows: **0**. YouTube requests during typing: **0**.

### `Adele Hello` — strong match, 0 automatic requests

20 Audius/Jamendo song rows, Top Result rendered, subtle *Search YouTube for more* offered, and
**zero** `/api/youtube` requests made without a click.

### Typed-only international queries — 0 requests each

`سارة السواس`, `Արամ Ասատրյան`, `Սիրուշո` → 0 rows, **prominent** control retained, 0 requests.
`Кино Группа крови` → 1 row, subtle control, 0 requests.

---

## Gate

```
pnpm typecheck        PASS
pnpm lint             PASS   (--max-warnings 0)
pnpm test:run         PASS   52 files, 805 tests
pnpm build            PASS
pnpm test:e2e         PASS   159 passed, 15 skipped
pnpm verify:bundle    PASS   0 matches across 7 files
                             (configured values: JAMENDO_CLIENT_ID, YOUTUBE_API_KEY)

AUDIUS_SMOKE=1 JAMENDO_SMOKE=1 YOUTUBE_SMOKE=1 pnpm test:smoke
  Audius     6/6   PASS
  Jamendo    8/8   PASS
  YouTube   12/12  PASS
  TOTAL     26/26  PASS
```

No provider flakiness was encountered in this run.

---

## Phase 3 policy rules — all preserved

`YOUTUBE_API_KEY` server-only · `/api/youtube` narrow endpoint · official YouTube Data API · official
IFrame API · visible player requirement · native YouTube controls · MadeForKids external-only ·
`/privacy` route · `Referrer-Policy: strict-origin-when-cross-origin` · no audio extraction · no
background playback · session query cache · bundle secret scanner. None of these files was opened.

The one Phase 3 rule this change *interacts* with is quota discipline, and it is strengthened rather
than relaxed: YouTube still never runs on a keystroke, and it now runs at most once per deliberate
submission that the open catalogues could not answer.

---

## Known limitations

1. **A deep link does not auto-search YouTube.** Opening `/search?q=…` directly, refreshing, or using
   the back button keeps the manual button. This is deliberate: a refresh loop would otherwise spend
   a search each time, and the per-tab cache is empty after a reload. One press covers it.
2. **The signal is the history action.** If a future entry point starts a search with
   `{ replace: true }`, it will be treated as typing and will not auto-search. That is the safe
   default — the deliberate choice is to under-trigger rather than over-spend.
3. **Two adapted tests** now use an empty YouTube response to keep the manual button on screen. The
   assertion they make is unchanged; the UI state they make it in had to move.
