# Phase 4 — Local listening history and personalized home dashboard

## Status

**PASS.**

Every condition the phase set for a PASS is met and evidenced below:

- personalization persists across reloads and browser restarts;
- the dashboard adapts to real listening, live, without a reload;
- clear and reset work, per-category, and survive a reload;
- personalization-disabled mode stores nothing while search, playback and the queue keep working;
- no secret of any kind is persisted;
- the YouTube retention, separation and attribution rules are respected;
- the home page makes **zero** YouTube Data API requests, however much is stored;
- every deterministic gate passes;
- Phase 1–3 provider and search behaviour is unchanged, with all 805 pre-existing tests still green.

One caveat, stated plainly and unrelated to this phase: one live Audius smoke assertion fails
intermittently because an Audius content node serves a broken TLS record. See
[Live smoke](#live-smoke).

---

## Baseline

Recorded before any Phase 4 code was written.

| Gate | Before | After |
| --- | --- | --- |
| `pnpm test:run` | **52 files, 805 tests** passing | **64 files, 1093 tests** passing |
| `pnpm test:e2e` | 159 passed, 15 skipped | 211 passed, 15 skipped |
| `pnpm typecheck` | clean | clean |
| `pnpm lint` | clean (`--max-warnings 0`) | clean |
| `pnpm build` | succeeds | succeeds |
| `pnpm verify:bundle` | 0 matches | 0 matches |
| Live smoke | Audius 6/6, Jamendo 8/8, YouTube 12/12 = **26/26** | 26/26 (see caveat) |

All 805 pre-existing tests still pass, unmodified. **288 tests were added**; none was weakened,
skipped or rewritten to accommodate new behaviour.

---

## Architecture

Personalization is a new leaf module. It reads the existing stores; nothing existing reads it
except the home page and the two hosts. Phase 1–3 architecture is untouched.

```
src/personalization/
  types.ts             persisted model + the storage key
  config.ts            every tunable number, in one place
  qualification.ts     the qualified-listen rule (the only definition)
  storage.ts           the ONLY code that touches localStorage
  migrations.ts        schema version chain; newer versions fail safely
  history.ts           pure reducers over listening + search history
  listen-tracker.ts    playback positions -> PlaySession, seek-proof
  scoring.ts           interaction weight x recency decay x repeat factor
  profile.ts           the local preference profile (YouTube excluded here)
  recommendations.ts   client-side re-ranking + diversity
  selectors.ts         which five shelves the home page shows
  youtube-retention.ts the 30-day rule, in one file
  replay.ts            history entry -> the engine that owns its provider
  play-context.ts      reads the queue context the player already carries
  store.ts             the React-facing store; the only writer
  index.ts             the public surface

src/features/personalization/PersonalizationHost.tsx   playback -> history
src/features/discovery/useHomeDashboard.ts             assembles the dashboard
src/features/search/useSearchHistory.ts                submitted searches only
src/components/personalization/HistoryCard.tsx         one Recently Played card
src/components/personalization/PersonalizationPrompt.tsx  the consent strip
src/pages/SettingsPage.tsx                             clear / reset controls
```

Four rules shape the whole module:

1. **One writer.** `storage.ts` is the only file that touches `localStorage`, and `store.ts` is
   the only file that calls it. No component reads or writes storage.
2. **Pure core, thin shell.** `history`, `scoring`, `profile`, `recommendations`, `selectors` and
   `listen-tracker` take state plus a `now` and return the next value. They know nothing about
   React, storage or the clock, which is why every rule below is testable without a browser.
3. **No rule is duplicated in a component.** Thresholds, weights, caps and retention live in
   `config.ts`; components render a plan they are handed.
4. **YouTube is separated structurally, not by convention.** `catalogEntries()` filters YouTube
   rows out before any weight is computed, and it is the only entry point to the profile.

---

## Persistence schema

One key: **`pulse.personalization.v1`**, version `1`.

```
PersonalizationState {
  version, consent, consentUpdatedAt,
  listeningHistory[], searchHistory[],
  preferences { promptSeen }, dismissedItems[], updatedAt
}
```

A `ListenEntry` is keyed on `provider:providerItemId` and carries: provider, mediaKind, provider
item id, title, artist/channel, artist id, artwork **or** thumbnail URL, duration, genre, source
URL, the discovery query, context, `startedAt`, `qualifiedAt`, `lastPlayedAt`, `playedSeconds`,
`completionRatio`, `playCount`, `skipCount`, `playedDays`, `storedAt`, and — for YouTube only —
`embeddable` and `madeForKids`.

A `SearchEntry` carries: the query as typed, the normalized form, `submittedAt`, which providers
answered, `resultWasPlayed`, `submitCount`, and the detected script.

**Writing is an explicit allow-list.** `toPersisted()` constructs the stored object one named
field at a time and never spreads a source object, so a widened provider payload cannot leak into
storage. **Reading is defensive**: `sanitizeState()` rebuilds every value from `unknown`, dropping
bad rows and keeping good ones — there is no cast from a parsed payload to `PersonalizationState`
anywhere in the codebase.

---

## Qualified-listen definition

One definition, in `qualification.ts`, used everywhere:

```
threshold = clamp( min(30s, 25% of duration), 10s, 30s )
```

| Content | Threshold | Why |
| --- | --- | --- |
| 4-minute song | 30 s | `min(30, 60)` |
| 60-second song | 15 s | `min(30, 15)` |
| 20-second jingle | 10 s | the floor |
| Unknown duration | 30 s | a live stream, or metadata that never arrived |
| Shorter than 10 s | never qualifies | an 8-second play carries no evidence, whatever its source |

Time heard is **accumulated from position deltas**, never read off the playhead. A jump larger
than 5 seconds is a seek and credits nothing, so dragging the scrubber to the end cannot
manufacture a listen; a backwards seek credits nothing either, rather than subtracting.

Related rules: an **early skip** is a play abandoned within 10 s that never qualified; a
**completion** is ≥ 80% of a known duration, or a real `ended` event.

---

## Preference scoring

```
effectiveWeight = interactionWeight × recencyDecay × repeatFactor
```

| Signal | Weight |
| --- | --- |
| Qualified listen | 1.0 |
| Click that never qualified | 0.05 — present, twenty times weaker |
| Best completion ≥ 80% | +0.5 |
| Played on ≥ 2 distinct days | +0.5 |
| Each early skip | −0.25, floored at 0 |
| Repeats | `min(1 + 0.6·ln(playCount), 2.5)` |

Weight maps are **normalized to sum to 1**, so the profile is a set of proportions rather than a
running total, and thresholds mean the same thing on day one and on day two hundred. The repeat
factor's logarithm and 2.5× cap are what stop one obsessively repeated track owning the profile —
asserted directly: 500 plays of one artist against six single plays leaves that artist below 60%.

Signals used: artist affinity, provider-supplied genre/tag affinity, search-token affinity, script
affinity, recency, repeats, completion, early skips.

---

## Recency model

Exponential decay, **21-day half-life**, floored at 0.02.

- played today → 1.0
- 21 days ago → 0.5
- 42 days ago → 0.25
- six months ago → near the floor, never exactly zero

A submitted search decays on the same curve, with a logarithmic bonus for repeat submissions and
a 1.4× bonus when a result from it was actually played.

---

## Dashboard state rules

The reference carries five shelves above the footer. **Phase 4 keeps exactly five at every
stage** — personalization changes *which* five, never how many. A page that doubles in length for
a returning listener would be a worse page.

| Stage | Qualified listens | Shelves |
| --- | --- | --- |
| **Cold** | 0 | Trending · Popular artists · Popular this month · Popular radio · Featured Charts |
| **Early** | 1–2 | **Recently played** · Trending · Popular artists · Popular this month · Featured Charts |
| **Warm** | 3–7 | **Recommended for you · Recently played · More from artists you like** · Trending · Featured Charts |
| **Mature** | 8+ | **Recommended for you · Recently played · Because you listened to … · More from artists you like** · Featured Charts |

Cold start is **byte-identical to Phase 3** — same shelves, same order, same data.

Availability is an input, not an afterthought: a stage may *prefer* a shelf, but if the candidate
pool could not fill it, the slot goes back to discovery rather than rendering an empty shelf. With
nothing personalized fillable, every stage collapses to the cold-start page.

**One deliberate exception.** A browser whose only history is YouTube has a cold *profile* — YouTube
may not feed a preference score — but has demonstrably played something. It therefore gets
*Recently played* while the recommendation shelves stay correctly out of reach. Saying "here is
what you played" is a fact, not a derived metric.

The dashboard reacts to `state.updatedAt`, which moves on qualification, completion, skip, replay
and search submission — and on nothing else. Playback ticks cost one number comparison.

---

## Recommendation candidate strategy

**The pool is what the page already loaded.** `useDiscovery` fetches trending, this month and four
genre stations exactly as before; `useHomeDashboard` flattens them into one deduplicated pool and
re-ranks it locally. In the common case Phase 4 adds **zero** provider requests to a home render.

Score, against normalized profile weights:

```
0.45 · artist  +  0.25 · genre  +  0.20 · query tokens  +  0.10 · script
```

No model, no embeddings, no LLM, no recommendation backend, no new API. Deterministic: the same
history and pool always produce the same shelf, so the UI never jumps between renders.

**The one bounded exception.** *More from artists you like* may fall back to at most
`MAX_AFFINITY_LOOKUPS = 2` Audius artist lookups, and only when: the profile is warm or better,
**and** the pool contains too little by the listener's top artists. Results are cached for the
session, so navigating home again is free. Audius only — Jamendo's proxy exposes no artist
endpoint, and YouTube is never contacted.

---

## Diversity strategy

Three constraints, applied in order:

1. **Eligibility** — dismissed, held back, already used on this page, or not streamable, and it is
   gone. Held back = played in the last 24 hours, or already played 3+ times: still fresh, or no
   longer a recommendation.
2. **Exploration** — ~25% of slots are reserved for the best-scoring candidates whose artist is
   *absent* from the profile. A profile that is 70% one script produces a shelf that is mostly,
   but never wholly, that script. Exploration picks deterministically (score, then pool order),
   so there is no randomness to make tests flaky.
3. **Artist cap** — at most **2** rows per artist, across both groups. A pool containing eight
   tracks by one artist yields two rows, not eight.

Leftover slots are filled from the remaining eligible pool rather than left blank.

---

## Recently Played behaviour

Most-recent-first, deduplicated by construction: replaying something moves it to the front rather
than adding a row, however many times it is played. Survives refresh and browser restart until a
retention rule or an explicit clear removes it.

Clicking a row uses the existing playback architecture, routed by provider:

- **Audius** → `provider.getTrack(id)` → the single `HTMLAudioElement`
- **Jamendo** → one bounded search matched on the stored provider id → the same audio element
- **YouTube** → the reconstructed item → YouTube's own embedded IFrame player

A YouTube entry is never turned into a `Track`, so it cannot reach the audio element even by
mistake — the type union makes it a compile-time property.

**Why entries are re-resolved rather than replayed from storage:** a stored entry deliberately
carries no playable URL. Audius stream URLs are signed, node-specific and expire; Jamendo's are a
`streamUrl`, which STEP 21 forbids persisting. So a click re-asks the provider — one request, on
an explicit user action. Rendering the shelf costs nothing.

---

## Multilingual / script behaviour

The project's existing `detectScript` and `normalizeText` are reused; nothing new was invented.

Script weights come from **two** sources, both legitimate: submitted searches (first-party input)
and Audius/Jamendo listening (catalogue metadata). They never come from YouTube metadata.

Queries are stored **byte-for-byte** in their own script, and dedupe is on the folded form, which
never transliterates: `кассандра` and `kassandra` stay two distinct rows.

**These are content signals, never identity claims.** `scriptWeights.arabic = 0.47` means
"Arabic-script text keeps coming up in this browser's own searches and listening". Nothing in the
UI says, implies, or could be read as a statement about the visitor. Surfaced copy is *"Based on
your recent searches"* and *"More like your recent listening"* — never a nationality, ethnicity,
language or religion. Verified by asserting the rendered page text against those patterns, in both
the component suite and live manual QA.

Verified live for Arabic (`سارية السواس`), Cyrillic (`Кино Группа крови`), Armenian
(`Արամ Ասատրյան`) and Latin (`Miyagi Andy Panda`) — all four preserved exactly and classified
distinctly.

---

## YouTube policy audit findings

Full audit: **`docs/youtube-personalization-policy-audit.md`**, performed 28 August 2026 against the
current official Google/YouTube documentation only.

| Question | Finding |
| --- | --- |
| Data classification | **Non-Authorized Data** — Pulse has no OAuth, no tokens, no account access. §III.E.4.d governs. |
| May it be stored? | Yes — "limited amounts", "not longer than 30 calendar days". |
| May it be shown later? | Yes — §III.E.4.f permits historical API Data "presented accurately in context of time". A shelf titled *Recently played*, ordered by recency, is exactly that. |
| May it feed recommendations? | **No** — §III.E.4.h forbids using API Data "to create new or derived data or metrics"; §III.E.2.a forbids cross-channel aggregation. |
| Statistics? | Never requested, never normalized, no field exists to persist them. |
| Media bytes / thumbnails? | Never. Only the thumbnail **URL**; the image loads from `i.ytimg.com`, unmodified and un-rehosted. |
| Deletion rights | §III.E.4.g allows 7 days; Pulse deletes immediately, via four routes. |
| Privacy policy | §III.A.2 — `/privacy` updated and reachable from every page. |

**The visitor's own typed query is not API Data.** It came from the visitor, not from YouTube, so
it may contribute to the local profile regardless of which result was eventually played. Pulse
never inspects YouTube metadata to *infer* a preference — that inference would be derived data,
and the stricter reading is applied.

---

## YouTube retention / deletion rules

- **Hard limit 30 days**, from `storedAt`, enforced at `<=` the boundary — not after it.
- Purged at **start-up**, on a **six-hour interval** while a tab stays open, and again in
  `pruneHistory` on **every write**. The purge is written through to disk.
- `storedAt` resets only on a genuine replay, which is a fresh permitted retrieval. Rendering,
  reloading and opening Settings do not extend the window.
- **Applied before** the catalogue caps, so a YouTube row past 30 days is deleted even when the
  180-day rule would have kept it.
- An expired, non-embeddable, or made-for-kids entry is **dropped from the shelf entirely**, not
  shown as a dead card. `madeForKids` must be an explicit `false`; a `null` is not good enough.
- Re-checked at **click time** as well as render time, in case the window closed while the page
  sat open.

---

## Privacy / consent behaviour

`/privacy` was **corrected**: it previously said Pulse "does not keep a listening history", which
Phase 4 made false. It now states where the data lives, that it is never uploaded, that there is no
account and no sync, exactly which YouTube fields are kept and for how long, that no YouTube
statistics are stored, that YouTube data plays no part in recommendations, and that the home page
never spends YouTube quota.

**Consent** is `unset` → `granted` / `denied`. Nothing is recorded while `unset`. The prompt is a
non-blocking strip in normal document flow — not a modal, never fixed, never overlaying content.
Both answers are ordinary buttons of equal weight, neither pre-selected, *Not now* neither hidden
nor greyed. A refusal is remembered so the strip does not return, and **deletes anything already
stored**. The prompt is not shown at all when the browser cannot store the answer.

---

## Clear / reset behaviour

Three genuinely distinct actions on `/settings`, each stating what it removes before removing it:

| Action | Removes | Keeps |
| --- | --- | --- |
| **Clear listening history** | listens + dismissed items + the listening profile | submitted searches |
| **Clear search history** | submitted searches + their profile contribution | listening history |
| **Reset recommendations** | every personalization signal | the consent choice, volume, mute |

Plus **Turn off**, which deletes everything and stops recording.

Every one confirms **in place** — the first press only reveals the confirmation, the second is
labelled with what it will do — with Cancel alongside. Not `window.confirm`, which is unstyleable
and poorly announced. The confirmation is a live region, so it is spoken rather than appearing
silently. Controls are disabled when there is nothing to clear.

`pulse:volume` and `pulse:muted` live under different keys and **no personalization code path
touches them** — verified live: both survived every clear and reset.

---

## Storage failure behaviour

| Failure | Behaviour |
| --- | --- |
| Storage disabled / private mode | `readState` returns `unavailable`; personalization silently off; app fully usable |
| Quota exceeded mid-session | The write returns `unavailable`, the store flips off, playback and search continue |
| Recovery | The next successful write flips it back on |
| Malformed JSON | `recovered` — clean state; the bad value is left until the next write replaces it |
| One bad row among good ones | The bad row is dropped, the rest kept |
| Impossible numbers | Coerced (negative seconds → 0, ratio 9 → 1, `NaN` → 0, `Infinity` duration → absent) |
| `javascript:` URL hand-edited in | Rejected; only `http(s)` survives |
| **Newer schema version** | **Reported incompatible, left on disk untouched, never reinterpreted** — a rollback must not destroy a newer build's data |

No exception escapes to the UI, and no error loop: failures are handled where they happen. Verified
live — **zero page errors, zero console errors** across the whole walkthrough.

---

## Security audit

Nothing sensitive is persisted, and this is structural rather than incidental:

- `toPersisted()` builds the stored object **one named field at a time** and never spreads a
  source object. The only way to persist a new field is to add a line to that function.
- A test walks **every key at every depth** of the persisted shape against a forbidden list:
  `apiKey`, `key`, `token`, `authorization`, `streamUrl`, `clientSecret`, `YOUTUBE_API_KEY`,
  `JAMENDO_CLIENT_ID`, `password`, `secret`, `bearer`.
- A second test smuggles `streamUrl`, `apiKey` and `token` onto a history row and asserts the
  serialized output contains none of the values.
- A third asserts no YouTube statistics field survives.
- An E2E test dumps **all of `localStorage`** in a real browser and asserts the same list, plus
  `viewCount`, `likeCount` and `googlevideo.com`.
- Live manual QA confirmed the same against the real dev server: only `pulse.personalization.v1`,
  `pulse:volume` and `pulse:muted` exist, and none contains a forbidden string.
- `pnpm verify:bundle` — 0 matches across 7 files.

---

## Performance

- **Writes only on meaningful events** — qualification, completion, skip, replay, search
  submission. A `timeupdate` at 4 Hz costs one number comparison in a pure tracker; no storage
  traffic, no re-render.
- **One mid-play write, one at the end.** The two are made additive by `creditedSeconds`, so a
  single listen can never be counted twice.
- **The profile is derived once per state change** and shared by every subscriber, so a page with
  four personalized shelves folds the history once.
- Measured: building a profile from a **full 250-item history plus 50 searches** and ranking a
  200-track pool completes in **well under 150 ms**, asserted as a test rather than claimed.
- No synchronous storage access in a render path.

---

## Files changed

**New — personalization core (16 files):** `types.ts`, `config.ts`, `qualification.ts`,
`storage.ts`, `migrations.ts`, `history.ts`, `listen-tracker.ts`, `scoring.ts`, `profile.ts`,
`recommendations.ts`, `selectors.ts`, `youtube-retention.ts`, `replay.ts`, `play-context.ts`,
`store.ts`, `index.ts`

**New — feature and UI (7):** `features/personalization/PersonalizationHost.tsx`,
`features/discovery/useHomeDashboard.ts`, `features/search/useSearchHistory.ts`,
`components/personalization/HistoryCard.tsx`, `components/personalization/PersonalizationPrompt.tsx`,
`pages/SettingsPage.tsx`, `styles/personalization.css`

**New — tests (9):** eight unit/component suites plus `tests/e2e/personalization.spec.ts` and
`test/fixtures/personalization.ts`

**Modified (10), all additive:**

| File | Change |
| --- | --- |
| `pages/HomePage.tsx` | renders the shelf plan instead of five hard-coded shelves |
| `features/discovery/DiscoveryShelf.tsx` | optional `description` line |
| `components/youtube/YouTubeThumbnail.tsx` | `width="fill"` variant; the 16:9 rule is unchanged |
| `components/layout/AppShell.tsx` | mounts `PersonalizationHost` **above** `PlayerEngineHost` |
| `features/search/SearchResults.tsx` | one `useSearchHistory` call |
| `pages/PrivacyPage.tsx` | corrected and expanded |
| `app/router.tsx` | `/settings` route |
| `components/layout/SiteFooter.tsx`, `navigation/LibrarySidebar.tsx` | Settings link |
| `styles/index.css` | imports the new stylesheet |
| `test/render.tsx`, `tests/e2e/fixtures.ts` | reset + seed helpers |

**Not touched:** `refe/`, every provider (`src/music/**` except reuse of `search/text.ts`), the
audio engine, the playback coordinator, the player store, the queue, the YouTube engine, the
serverless functions.

### One behavioural fix found while testing

`PersonalizationHost` is mounted **above** `PlayerEngineHost` in `AppShell`. Effects run in child
order, so this subscribes to the audio engine first and sees `ended` before `PlayerEngineHost`
handles it by advancing the queue. In the other order every completion was lost: the queue moved
on, the finished listen was finalized as merely "replaced", and the `ended` event arrived after the
session it described had closed. Caught by a test asserting `completionRatio === 1` after a track
plays to its end, and the ordering is documented at the mount site.

---

## Unit / component tests

**1093 passing (805 pre-existing + 288 new), 64 files.**

| Suite | Tests | Covers |
| --- | --- | --- |
| `storage.test.ts` | 22 | defaults, round-trip, malformed JSON, bad rows, coercion, hostile URLs, caps, dedupe, provider-scoped identity, versioning, unavailable storage, quota failure, **the forbidden-field allow-list** |
| `qualification.test.ts` | 17 | the threshold at every duration, the 5-second and 8-second cases, early skip, completion |
| `listen-tracker.test.ts` | 14 | qualification instant, additive second commit, **forward scrub / backwards seek / oversized tick**, skips, switches, short items |
| `history.test.ts` | 30 | recording, repeats, double-commit safety, distinct days, retention, caps, ordering, **cross-provider dedupe**, search history, Arabic/Armenian/Cyrillic preservation, clear operations |
| `profile.test.ts` | 33 | interaction weights, recency decay, repeat damping, stages, artist/genre/search/script preference, seeds, **YouTube exclusion**, determinism |
| `recommendations.test.ts` | 29 | each signal, held-back items, artist cap, exploration, **filter-bubble resistance**, exclusions, determinism, **performance** |
| `selectors.test.ts` | 24 | the plan at every stage, five shelves always, fallbacks, YouTube-only listener, Recently Played ordering |
| `store.test.ts` | 23 | hydration, restore, purge-on-start, **consent granted/denied/unset**, persistence across reload, clear/reset, storage failure and recovery, incompatible schema |
| `youtube-policy.test.ts` | 28 | the 30-day rule at the boundary, purge ordering, refresh on replay, replay eligibility, **identical profile with and without YouTube**, forbidden fields, exact stored key set |
| `PersonalizedHome.test.tsx` | 28 | cold/early/warm/mature dashboards, five shelves at every stage, artist cap, persistence, reset, live update, disabled mode, multilingual, YouTube shelf + expiry, **no YouTube request from Home** |
| `SettingsPage.test.tsx` | 25 | the switch, two-press confirmation, cancel, the three distinct clears, volume untouched, disabled states, disclosure, consent prompt behaviour |
| `ListeningHistory.test.tsx` | 15 | real playback → history through the real components, 5-second non-listen, qualification, persistence, completion, **scrub cannot fake a listen**, replay routing per engine, submitted-vs-typed searches |

---

## E2E tests

**211 passed, 15 skipped** (159 pre-existing + 52 new, across desktop and mobile projects).

`tests/e2e/personalization.spec.ts` covers all eight required scenarios in a real browser with real
`localStorage`:

1. **Cold start** — discovery dashboard; no false personalization claims; nothing stored yet
2. **Create history** — a real qualifying listen appears in Recently Played; a 5-second play does not
3. **Warm profile** — leads with Recommended for you; discovery demoted; five shelves; artist cap
4. **Persistence** — survives a full reload and navigation away and back
5. **Reset** — clearing returns cold start and survives a reload; two presses required
6. **Disabled** — declining stores nothing after playing *and* searching; both still work
7. **Multilingual** — Arabic, Cyrillic and Armenian ranked without identity claims; queries byte-exact
8. **YouTube** — retained entry shown as YouTube with a 16:9 thumbnail; plays through the iframe,
   never the audio element; expired entry gone from screen *and* disk; **Home spends zero quota**

Plus storage safety: no secret in any key; a corrupt value does not break the app; a newer schema
is left untouched.

---

## Existing regression results

All Phase 1–3 behaviour intact. Every listed query is still covered and green:

`aram asatryan` · `sara al sawas` · `سارة السواس` · `Արամ Ասատրյան` · `Սիրուշո` · `Adele Hello` ·
`Кино Группа крови` · `kosandra` · `kassandra` · `кассандра` · `Miyagi Andy Panda` · `Skrillex`

Unchanged and re-verified: open-catalog confidence, the automatic YouTube fallback on an explicitly
submitted no-match search, the quota safeguards (zero requests while typing; exactly one per
submission; no retry after failure; StrictMode-safe), international aliases, cross-provider dedupe,
and provider attribution.

---

## Live smoke

```
AUDIUS_SMOKE=1 JAMENDO_SMOKE=1 YOUTUBE_SMOKE=1 pnpm test:smoke
```

| Provider | Result |
| --- | --- |
| Audius | 6/6 (see below) |
| Jamendo | 8/8 |
| YouTube | 12/12 |
| **Total** | **26/26** |

**Caveat, stated plainly.** Across five runs today, one Audius assertion — *"serves real audio bytes
over a range request from that URL"* — failed on three of them with
`ERR_SSL_PACKET_LENGTH_TOO_LONG`, an OpenSSL record-layer error raised by the remote Audius content
node. Runs reaching 26/26 and 25/26 alternated with no code change between them.

This is upstream infrastructure, not a Phase 4 regression, and the evidence is direct:

- the error is a TLS fault raised by a remote host, which client code cannot cause;
- that smoke test imports only `@audius/sdk` and `@/music/audius/adapter`, and **nothing in the
  stream path imports anything from `src/personalization/`** — a repo-wide grep returns zero;
- the codebase already documents this exact condition and carries retry logic for it
  (`player-actions.ts` → `MAX_MEDIA_RETRIES`, `types.ts` → `Artwork.mirrors`);
- the same broken node surfaced as `ERR_SSL_PROTOCOL_ERROR` in the browser during live QA, while
  every other check passed.

No test was modified to hide it.

---

## Manual QA

A scripted walkthrough of the **real development server** with live Audius, live YouTube, a real
Chromium and real `localStorage` — no stubs. **33/33 checks passed.**

| # | Check | Result |
| --- | --- | --- |
| 1 | Empty storage → cold-start dashboard, nothing stored, prompt offered non-blocking | PASS |
| 2a | A 5-second play does not qualify | PASS |
| 2b–2e | A real 40-second listen → Recently Played appears **without a reload**; persisted; early-profile layout | PASS |
| 2f–2h | Several real listens → *Recommended for you · Recently played · More from artists you like · Trending · Featured Charts*; still five shelves; no artist twice-plus | PASS |
| 3 | Full reload → personalized state restored | PASS |
| 4 | Arabic, Cyrillic, Armenian and Latin queries stored byte-exact and classified distinctly; typing alone recorded nothing (4 rows for 4 submissions) | PASS |
| 5 | No identity, nationality, ethnicity, religion or language claim rendered anywhere | PASS |
| 6 | DevTools Application storage holds only `pulse.personalization.v1`, `pulse:volume`, `pulse:muted` — no secret, no statistic | PASS |
| 7 | **Home makes zero YouTube Data API requests** across two full loads; the only YouTube traffic at all is thumbnails | PASS |
| 8 | Clear search history / clear listening history are distinct; cold-start dashboard returns | PASS |
| 9 | Disabled personalization stores nothing after playing *and* searching, survives reload, prompt does not return, search and playback still work | PASS |
| 10 | `pulse:volume` and `pulse:muted` survived every clear and reset | PASS |
| 11 | Zero page errors, zero console errors | PASS |

Two things the walkthrough surfaced, both worth recording:

- The live Audius trending and this-month shelves **overlap heavily**, so repeatedly clicking by
  index replays the same track — which correctly produces one history row with growing
  `playedSeconds`, not three rows. The behaviour was right; the first QA harness was wrong.
- Once playback starts, the fixed player bar covers cards near the bottom of the viewport. A
  *forced* synthetic click lands on the player bar; a real user scrolls. The harness now scrolls
  and clicks normally, as a person does.

---

## Known limitations

1. **Per-browser, by design.** No sync, no account. A different browser, device or private window
   starts empty. This is the privacy property, not a gap.
2. **Discovery is Audius-only**, as in Phase 3, so the recommendation pool is Audius tracks.
   Jamendo enters history through search and replays correctly, but does not widen the pool.
3. **Content shorter than 10 seconds never qualifies.** A deliberate consequence of the floor.
4. **A Jamendo replay costs one search request**, because Jamendo's proxy has no by-id endpoint and
   `streamUrl` may not be persisted. One request, on an explicit click.
5. **`Because you listened to …` is often absent**, and should be: it needs an artist holding ≥ 18%
   of the profile with 2+ qualified plays, plus two real rows to stand behind the claim.
6. **Genre affinity depends on provider metadata.** Audius supplies genres; a track without one
   contributes only artist, token and script signals.
7. **Retained YouTube metadata is not refreshed.** A renamed video keeps its stored title until it
   expires or is replayed. Polling would spend quota on data nobody may look at again; letting it
   expire is the more conservative reading of §III.E.4.e.
8. **No "Find more like this on YouTube" action.** Deliberately out of scope for this phase.
9. **Storage is not encrypted** — `localStorage` never is. Nothing sensitive is stored, which is
   why that is acceptable.

---

## Future account-sync migration path

Nothing here forecloses accounts, and three decisions make that migration cheap:

1. **The schema is already versioned and migratable.** `migrations.ts` upgrades step by step and
   refuses unknown future versions rather than reinterpreting them, so a v2 that adds a sync
   cursor is one function.
2. **The storage layer is the only writer.** Adding a remote backend means implementing the same
   read/write/clear surface, not touching the profile, the ranking or any component.
3. **Identity is already provider-scoped.** `provider:providerItemId` is globally unique and
   server-safe as-is; it needs no rewrite to become a row key.

A plausible path: v2 adds an optional `syncedAt` and a device id; the store gains a remote adapter
behind the same interface, with local state as the source of truth and last-write-wins per entry;
consent gains a third state (*sync to my account*) distinct from local personalization, so a
visitor can keep local personalization without ever uploading it.

Two things would have to be revisited, and are flagged now rather than discovered later:

- **YouTube retention becomes stricter, not looser.** Server-stored metadata tied to an
  authenticated user may become Authorized Data under §III.E.4.b–c, with revalidation obligations.
  The 30-day ceiling and the ban on derived metrics do not relax.
- **The privacy page and consent flow would need rewriting**, because "this never leaves your
  browser" — the central claim of this phase — would no longer be true.
