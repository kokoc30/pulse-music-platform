# Search-seed autoplay and YouTube visible continuous play

A narrow playback-semantics correction. Two real-device bugs, one shared theme:
**what should play next.**

---

## Status

| Area | Result |
| --- | --- |
| Audio search-seed autoplay | **PASS** |
| Audius/Jamendo background continuation | **Unchanged and still working**; screen-lock behaviour needs a physical device — see §14 |
| YouTube visible continuous results | **PASS** |
| YouTube screen-off / background playback | **Intentionally unsupported by policy** — not a bug, not "fixed" |

| Gate | Before | After | Result |
| --- | --- | --- | --- |
| `pnpm typecheck` | clean | clean | **PASS** |
| `pnpm lint` (`--max-warnings 0`) | clean | clean | **PASS** |
| `pnpm test:run` | 87 files / 1627 tests | **91 files / 1714 tests** | **PASS** |
| `pnpm build` | ✓ | ✓ | **PASS** |
| `pnpm test:e2e` | 344 passed / 24 skipped | **370 passed / 24 skipped** | **PASS** |
| `pnpm verify:bundle` | PASS | PASS — 0 matches / 12 files | **PASS** |

**+4 test files, +87 unit/component tests, +26 E2E tests.** No test was deleted or
weakened; the six that changed are itemised in §12, each with its reason.

---

## Real-device issues reported

**1 — audio.** Search *Kosandra* / *кассандра*, play *Miyagi & Andy Panda — Kosandra*.
It plays correctly, including in the background. When it ends, Pulse plays the **next
search result** — frequently another upload of the same recording. Autoplay behaved like
"play the search rows in order" rather than "continue with something similar".

**2 — YouTube.** Search an Arabic artist, get no strong Audius/Jamendo match, play a
YouTube result. It plays in the visible official iframe. At its natural end YouTube shows
its replay screen and **Pulse does nothing**.

---

## Audio root cause

Confirmed in the code before any change:

- `src/features/search/SearchResults.tsx` called
  `playFromShelf(tracks, index, searchContext)`.
- `src/features/discovery/playShelf.ts` → `playFromShelf` turns **the whole supplied
  list** into the player queue.
- `src/player/player-actions.ts` → `playNext` precedence is: repeat one → **explicit
  queue** → repeat playlist → Phase 6 autoplay → stop.

So every sibling search result counted as something the visitor had *explicitly queued*,
and the queue outranks anything generated. **Phase 6 autoplay was therefore never reached
after a search** — not broken, simply never consulted. The visitor clicked one song; the
app queued fourteen on their behalf.

That is a semantic error, not a defective function, which is why it survived a green test
suite: several tests asserted the old behaviour and passed.

---

## Audio fix

### Search seed semantics

A new, explicitly named path in `playShelf.ts`:

```ts
export async function playSeedTrack(track, context) {
  await playTrack(track, { queue: [track], index: 0, context })
}
```

The single-item queue is **passed explicitly and must stay explicit**. `playTrack` falls
back to the store's existing queue when given none, so omitting it would let a stale queue
— the last playlist, the last chart — survive a search click and silently continue. A
regression test covers exactly that case.

`SearchResults.tsx` now uses it for both the Top Result and every track row. After clicking
*Kosandra* the queue is `[Kosandra]`, not the result page. **The other results stay on the
page**; they are simply not queued on the visitor's behalf.

### Explicit collection semantics — deliberately unchanged

`playFromShelf` keeps whole-list queue behaviour, and every one of its callers was audited:

| Surface | Semantics | Why |
| --- | --- | --- |
| Playlist Play / row click | collection | the visitor asked for a list |
| Liked Songs Play | collection | same |
| Charts, stations, underground | collection | "Play chart" means play the chart |
| Home shelves (trending, month, recommended, because, artists, mixes) | collection | a curated shelf is a list, and playing on through it is the existing, defensible behaviour |
| Recently Played card | seed (already was) | `playHistoryEntry` always passed `queue: [track]` |
| **Search row / Top Result** | **seed (changed)** | the only conversion in this fix |

Search rows are the only surface converted. Home shelf cards were considered and
deliberately left alone: a shelf is a curated group, the visitor sees all four cards at
once, and continuing through them is not the "sequential search rows" complaint.

### One necessary consequence: *Add to queue*

Seed semantics removes the *implicit* way a visitor used to build a queue from search — the
result list itself. Leaving no replacement would have been a regression dressed as a fix,
so the row and card overflow menus gained **Add to queue**, wired to the existing
`addToQueue` action. It is offered only for a streamable audio `Track`; a YouTube row
passes nothing, because a video cannot enter the audio queue.

### Precedence — unchanged

```
1. repeat one            → replay the current track
2. explicit queue        → whatever the visitor actually queued
3. repeat playlist       → wrap to the start of that list
4. Phase 6 autoplay      → a generated similar track
5. stop
```

No line of `playNext` was edited. **User intent still outranks recommendations** — the fix
was to stop pretending fourteen search results were user intent.

---

## Duplicate-song suppression

`src/music/song-identity.ts` — new, centralised, heavily tested (36 assertions).

Exact-id exclusion cannot tell that *Kosandra*, *Kosandra (Official Audio)* and *Kosandra
(Remastered)* are one song with three ids, so autoplay would happily follow a track with a
cosmetic reissue of itself.

An identity is three parts:

| Part | Meaning |
| --- | --- |
| `artist` | folded artist name |
| `coreTitle` | folded title with **cosmetic** decoration removed |
| `variant` | the **substantive** version markers, sorted |

- **Cosmetic** (same song): official, audio, video, lyrics, visualizer, hd/4k, full,
  **remaster/remastered**, clip… and `music` *only* inside "official music video", so
  *Sheet Music* can never collapse into *Sheet*.
- **Substantive** (different song, allowed to play): remix, live, acoustic, instrumental,
  cover, karaoke, edit, radio, extended, slowed, reverb, nightcore…

Two rows are the same song only when the artists are near-identical (≥ 0.9), the core
titles are near-identical (≥ 0.92) **and** the substantive markers match exactly.

Applied in `planAutoplay` in two places: candidates that duplicate the **seed** are
excluded, and no two cosmetic versions may appear in the same buffered run.

### Why this is not `cross-provider-dedupe.ts`

That module answers a different question — "may I *hide* one of these two search results?"
— and is tuned for it. It refuses to compare two items from the same provider (here that is
the common case), requires durations within three seconds (a "Lyrics" upload often runs
longer), and treats *remastered* as distinguishing (correct for search, wrong for "what
plays next"). Sharing thresholds would give the wrong answer to one of the two questions.
The two share only their primitives, and both remain tested independently.

### Conservative on purpose

A false positive silently removes a legitimate candidate from autoplay forever; a false
negative merely lets one cosmetic duplicate through. Every rule is biased towards *not*
matching. Verified: a different artist with the same title, a remix, a live take, a cover,
an instrumental and a title that is nothing but decoration are all left alone.

### Unicode

`normalizeText` strips diacritics and repairs homoglyphs but **does not transliterate**, so
Cyrillic stays Cyrillic and Armenian stays Armenian. Tested with `Кассандра`,
`Արամ Ասատրյան` and Arabic titles: cosmetic variants match within a script, two different
songs stay apart, and `Кассандра` is never treated as `Kassandra`.

**Known limitation, tested and documented:** `Miyagi & Andy Panda` vs `Miyagi and Andy
Panda` scores 0.889 against a 0.9 threshold, so the guard declines to suppress. That is the
safe direction — a cosmetic duplicate may occasionally play, rather than a genuine
candidate silently vanishing.

---

## Phase 6 recommendation behaviour and request budget

No second engine. `src/player/autoplay/**` is unchanged apart from the duplicate filter.

- **Jamendo seed** — the existing single `/tracks/similar` request.
- **Audius seed** — no request. Similarity is computed from genre, mood, tags, BPM,
  musical key and artist affinity on tracks the session already holds. No invented
  "similar" endpoint, no search fan-out.
- `MAX_REQUESTS_PER_REFILL` is still **1**, and the session pool is still the free
  by-product of browsing.

Search results already enter the session pool via `rememberTracks`, so a seed's siblings
remain *candidates* — they are simply ranked by similarity now instead of being played in
list order, and cosmetic duplicates are filtered out.

---

## YouTube: previous ended behaviour

`bindYouTubeEngineEvents` handled `ended` with one line:

```ts
case 'ended': current.setStatus('ended'); break
```

There was no session, no continuation, and nothing after it. YouTube's replay screen was
the end of the story.

## YouTube session continuation architecture

A small **in-memory** session on `useYouTubeStore`:

```
sessionItems: YouTubeVideoItem[]   the already-fetched result list
sessionIndex: number               where in it we are
sessionQuery: string | null
continuousPlay: boolean
pausedForBackgroundPolicy: boolean
```

- **Never persisted.** Not to IndexedDB, not to `localStorage`. It is a page of search
  results; the Phase 7 30-day rules for *saved* YouTube metadata are a separate, stricter
  thing and are untouched.
- **Never merged with audio.** Not the `HTMLAudioElement`, not `Track[]`, not the Phase 6
  candidate system. A `Track` cannot be a `YouTubeVideoItem` at the type level.
- Started by `playYouTubeResult(videos, item, query)` from `YouTubeResultsSection`, using
  the array the fallback already holds.
- A single video opened from **Recently Played or the saved library** goes through
  `playYouTubeVideo`, which **clears** the session — otherwise a library video would
  continue into results from an unrelated search.
- Closing the surface ends the session; the `continuousPlay` preference survives, because
  it is a statement about how results should behave rather than a property of one list.

### Eligibility

`nextEligibleIndex` reuses `canEmbedYouTubeItem` — the *same* predicate the rows and the
player already use. There is no second copy of the policy check. Non-embeddable,
made-for-kids, live and `madeForKids: null` items are all skipped, and are never handed to
the player.

---

## The visibility rule

Required Minimum Functionality: *an API Client must not initiate an automatic playback
until the player is visible and more than half of the player is visible on the page or
screen.*

`src/player/youtube-visibility.ts` holds a real `IntersectionObserver` ratio, written by the
surface and read **synchronously** by `advanceYouTubeSession` at the instant a video ends —
which is not an instant React renders. It lives outside React for that reason. The default
is **0**, so an unobserved player may never auto-advance.

At a natural end, three gates must all pass:

1. `continuousPlay` is on — the visitor's setting;
2. there is a next eligible result **in the list already fetched**;
3. `mayAutoplay({ userInitiated: false, visibleRatio, documentHidden })` agrees — the same
   helper every other scripted transition uses, with `> 0.5` strictly.

Failing (3) is not failure: the next item is **cued**, `awaitingUserPlay` is set, and it
waits for a press. That is what the policy asks for when visibility is insufficient or
unknown. Failing (1) or (2) leaves the ended state standing.

A real button press (**Next** / **Previous**, outside the iframe) is `userInitiated: true`,
the one case that needs no visibility measurement.

---

## YouTube background-play policy — and why screen-off playback stays disabled

The current YouTube API Services Developer Policies prohibit an API client from allowing
the player to continue when the client's window is closed or minimised. A player that is
not displayed in the page, tab or screen the user is viewing is a background player, and
API clients may not provide one.

`handleDocumentVisibility` therefore still pauses on a hidden document, and **that was not
touched**. None of the following was added, and none may be:

removing the hidden-document pause · continuing iframe audio while hidden · Media Session
entries for YouTube · proxying or extracting YouTube audio · hidden iframes · service-worker
playback · Picture-in-Picture tricks · a native wrapper to route around it · YouTube through
`HTMLAudioElement`.

**Phone locks → YouTube pauses. That is a PASS.**

What this fix adds is an *explanation*, not a workaround: a session-only
`pausedForBackgroundPolicy` flag, surfaced once when the visitor returns, as a dismissible
non-modal line — *"YouTube playback pauses when Pulse is in the background. Audius and
Jamendo tracks keep playing."* It is not shown on every visibility change, it is not a
toast, and it does not call this a bug.

Audius and Jamendo are unaffected and keep full background playback and Media Session.

### `relatedToVideoId`

`search.list`'s `relatedToVideoId` parameter was deprecated and has been unsupported since
August 2023. **It is not used**, and no server endpoint was invented around it. Continuation
uses the relevance-ordered results the search already returned, and nothing else.

### No re-ranking

The session order is exactly what the Data API returned. Nothing reorders it by view count,
likes, duration or channel popularity — deriving a new metric from API Data is precisely
what §III.E.4.h prohibits.

---

## YouTube quota proof

Asserted, not assumed. Unit tests replace `fetch` entirely so that *any* request fails, and
the E2E tests record every YouTube/Google request:

| Action | Data API calls |
| --- | --- |
| Starting a result from the list | **0** |
| Natural end → next result | **0** |
| Next / Previous button | **0** |
| Cueing when not visible enough | **0** |
| Document hidden / phone locked | **0** |
| End of session | **0** — no loop, no new search |

Only the existing explicit *Search YouTube* flow spends quota, exactly as before.

---

## Files changed

**New (7):**

- `src/music/song-identity.ts` + `song-identity.test.ts` — the duplicate guard
- `src/player/youtube-visibility.ts` — measured visibility, outside React
- `src/player/search-seed-autoplay.test.ts` — seed/queue/collection precedence
- `src/player/youtube-session.test.ts` — session, visibility gating, quota
- `src/features/search/SearchSeed.test.tsx` — what a search click queues
- `tests/e2e/search-seed-continuation.spec.ts` — both fixes end to end

**Modified (16):**

- `src/features/discovery/playShelf.ts` — `playSeedTrack`, and the seed/collection split
  documented where both live
- `src/features/search/SearchResults.tsx` — rows and Top Result use the seed path
- `src/player/autoplay/planner.ts` — duplicate filter (seed, and within a run)
- `src/player/youtube-actions.ts` — session, continuation, eligibility, background flag
- `src/player/youtube-store.ts` — session fields, session-only
- `src/components/youtube/YouTubePlayerSurface.tsx` — `IntersectionObserver`, Next/Previous,
  continuous-play toggle, the background explanation, page clearance
- `src/components/youtube/YouTubeResultsSection.tsx` — starts a session from its own results
- `src/components/library/TrackMenu.tsx` — *Add to queue*
- `src/components/track/TrackRow.tsx`, `TrackCard.tsx` — pass the queueable track
- `src/styles/youtube.css` — session controls, all outside the stage
- 6 test files — see §12

**Untouched:** `api/`, `server/`, `vercel.json`, every `tsconfig*.json`, the playback
coordinator, Media Session, the audio engine, the library domain, and
`src/player/autoplay/{similarity,candidates,buffer,session-pool}.ts`.

---

## §12 — Tests changed, and why

None weakened. Six changed because the behaviour they asserted is the behaviour this fix
deliberately replaced.

| Test | Change |
| --- | --- |
| `GlobalPlayer` "steps through the queue" | builds the two-item queue through *Add to queue* — the new deliberate path — instead of relying on the search list |
| `GlobalPlayer` "advances when a track ends" | now asserts the planner answered, rather than naming the next search row |
| `QueuePanel` helper | same: builds a real queue deliberately |
| `search-playback` "next and previous…" | same |
| `search-playback` "a finished track advances…" | renamed to what it now guarantees — playback continues; *which* track is pinned deterministically in the unit tests |
| `search-playback` "queue panel lists the queue" | builds the queue deliberately; the stale comment about the gated row removed |

One Phase 7 E2E locator (`library.spec.ts` shuffle stability) was scoped to the playlist
header: once playback pauses, the player bar's own round control is also named "Play", and
the assertion is about the playlist's buttons.

---

## §13 — Test coverage

**Unit / component — 91 files, 1714 tests (+87).**

- `song-identity.test.ts` (36) — cosmetic vs substantive, artist and title thresholds,
  symmetry, Cyrillic/Armenian/Arabic, transliteration, decoration-only titles
- `search-seed-autoplay.test.ts` (12) — seed reaches autoplay; a cosmetic sibling is not
  chosen; autoplay off stops cleanly; manual queue wins; autoplay only after it drains;
  playlists keep sequential order; planner duplicate rules
- `youtube-session.test.ts` (32) — eligibility incl. made-for-kids/`null`/non-embeddable;
  session adoption and order; continuation; cue-when-not-visible; hidden document; step
  controls; close; quota
- `SearchSeed.test.tsx` (7) — one-track queue from any row, stale queue replaced, other
  results still visible, *Add to queue* offered, and not offered for a gated track

**E2E — 370 passed, 24 skipped (+26).** `search-seed-continuation.spec.ts` covers the seed
queue, the collection regression, YouTube continuation, eligibility skipping, end of
session, the toggle, Next/Previous, controls outside the iframe, and the background pause
with its explanation.

---

## §14 — QA

### Local, automated

The E2E suite performs the walk-through in real Chromium at both viewports: search, play
one result, inspect the queue (**one item, not the result page**), let it finish, confirm
playback continues via the planner, queue a track by hand and confirm it wins, play a
playlist and confirm sequential order, then the full YouTube session flow.

Network assertions are automated rather than eyeballed: an audio seed transition stays
inside the Phase 6 budget, and a YouTube natural end issues **no** `/api/youtube` request.

### Not performed

- **Live provider smoke** — every provider is stubbed at the network layer, the existing
  project rule. No YouTube quota was spent.
- **Physical screen-lock behaviour** — Playwright cannot lock a phone. Automated tests
  assert the `visibilitychange` path; the device checklist below is what actually confirms
  it, and this document does not claim it as verified.

### Physical device checklist

**Audio (Android / installed PWA)**

1. Search *Kosandra*; play *Miyagi & Andy Panda — Kosandra*.
2. Open the queue — it must contain **only** that track.
3. Lock the phone; audio continues.
4. Let it finish; a *similar* track begins — not another Kosandra upload, not the next
   search row.
5. Lock-screen metadata updates (title, artist, artwork).
6. Press Next on the notification; explicit-queue-then-autoplay precedence holds.
7. Recently Played updates once, with no duplicate event.

**YouTube**

1. Search an Arabic artist; open a YouTube result.
2. Keep Pulse visible; let the video end → the next eligible result starts.
3. Lock the phone → **YouTube pauses. This is the expected PASS.**
4. Unlock → the player is still there, the session index is preserved, no new API call, and
   the background explanation appears once.

---

## §15 — Vercel regression

- **No file under `api/` or `server/` was modified**, nor `vercel.json`, nor any
  `tsconfig*.json` — confirmed by `git status`.
- The production build config stays test-pruned; `pnpm typecheck` still typechecks tests.
- `server/module-resolution.test.ts` passes (8 assertions): every relative specifier under
  `api/` and `server/` keeps its explicit `.js`, both Function entrypoints resolve under
  Node ESM, no bare import was mangled, and no test module is pulled into a Function. This
  is the guard against `ERR_MODULE_NOT_FOUND` / `FUNCTION_INVOCATION_FAILED`.
- `pnpm build` and `pnpm verify:bundle` pass.

Bundle cost of this fix: `index-*.js` 431.99 → **438.40 kB** (135.07 kB gzip, **+2.04 kB**);
CSS 135.78 → **137.23 kB** (23.84 kB gzip, **+0.21 kB**). No new dependency —
`package.json` and `pnpm-lock.yaml` are unchanged.

---

## §16 — Known limitations

1. **Screen-lock behaviour is unverified here.** It needs a physical device; see §14.
2. **A near-miss artist spelling is not suppressed.** `&` vs `and` scores 0.889 against a
   0.9 threshold, so a cosmetic duplicate may occasionally play. The safe direction, and
   tested explicitly.
3. **Duplicate suppression is title/artist-based only.** It does not compare audio, and a
   re-upload retitled beyond recognition will not be caught.
4. **The YouTube session is one page of results.** When it runs out, playback ends and the
   replay screen stands; there is no automatic "load more", by design — that would be a
   silent `search.list`.
5. **No YouTube repeat mode.** Reaching the end does not loop to index zero. Not required
   here, and looping is not obviously wanted.
6. **The continuous-play toggle is per session, not persisted.** It resets to on for the
   next search.
7. **Home shelves keep collection semantics.** A card click still plays on through its
   shelf; only search rows were converted. Revisiting that is a product decision, not a bug.
8. **The YouTube surface is a fixed overlay.** On a narrow viewport it covers the lower part
   of the page, so the page now gains bottom padding while it is open, letting content be
   scrolled clear. Adding further rows of chrome to that surface would reintroduce the
   problem.

---

## §17 — What was deliberately not done

No accounts, no database, no provider OAuth, no new provider, no crossfade, no offline
downloads, no lyrics, no unrelated UI. No YouTube background playback, no
`relatedToVideoId`, no YouTube-derived recommendation scoring, and no cross-provider
"YouTube ended → find a similar Audius track" behaviour: YouTube API metadata stays out of
the preference profile, exactly as Phases 3–7 established.
