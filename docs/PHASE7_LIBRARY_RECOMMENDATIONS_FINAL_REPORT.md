# Phase 7 — Your Library, Liked Songs, Playlists and Recommendation Upgrade

**Final report.** Written after the work, from the code and the recorded gate output.

---

## 1. Status

**PASS on every local criterion** in `agents/47_DEFINITION_OF_DONE.md` — library, player
integration, recommendations, provider safety, security and all six gates — **with one
criterion open**: the deployed Functions were not exercised, because the Vercel deployment
is behind Deployment Protection. See §17; it is reported as unverified, not assumed.

Limitations are listed in §20; the one deliberate policy decision is recorded in §14.

| Gate | Baseline (before) | After | Result |
| --- | --- | --- | --- |
| `pnpm typecheck` | clean | clean | **PASS** |
| `pnpm lint` (`--max-warnings 0`) | clean | clean | **PASS** |
| `pnpm test:run` | 74 files / 1338 tests | **87 files / 1627 tests** | **PASS** |
| `pnpm build` | ✓ | ✓ | **PASS** |
| `pnpm test:e2e` | 273 passed / 15 skipped | **344 passed / 24 skipped** | **PASS** |
| `pnpm verify:bundle` | PASS, 0 matches / 12 files | **PASS, 0 matches / 12 files** | **PASS** |

Net new deterministic coverage: **+13 test files, +289 unit/component tests, +71 E2E
tests**. No existing test was deleted or weakened; the five that changed are itemised
in §18, each with the reason.

The work is committed and pushed (`5658924`), and **Vercel built it successfully**.
The live Functions could not be exercised because the deployment sits behind Vercel
Deployment Protection, which no credential in this environment can pass. That is
recorded exactly as observed in §17, and is **not** counted as a pass.

---

## 2. Baseline

Recorded before any file was edited, on the tree at `abf7c65`:

```
typecheck      clean
lint           clean
test:run       74 files, 1338 tests passed
build          ✓ built (dist/ 6 assets)
test:e2e       273 passed, 15 skipped
verify:bundle  PASS — 0 matches across 12 files
```

The architecture was read end to end first — player store and actions, the playback
coordinator, the autoplay planner, the personalization store/profile/scoring/retention
layers, the provider adapters, the service-worker and PWA registration, the Vercel
function import graph and the split `tsconfig` — before the first line was written.
Nothing in this phase rewrites any of it.

---

## 3. Library architecture

A new domain at `src/library/`, deliberately separate from `src/personalization/`:

```
src/library/
  types.ts            entities, bounds, failure reasons
  track-ref.ts        projections from playable items to saved references
  storage.ts          sanitize, allow-list, IndexedDB + memory repositories
  migrations.ts       version handling
  actions.ts          pure reducers (likes, playlists, reorder, hide, GC)
  store.ts            zustand store, hydration, persistence, subscribers
  selectors.ts        derived views (sorting, covers, search, explicit intent)
  hooks.ts            memoized React bindings
  library-actions.ts  imperative helpers: playback routing, toasts, clear
  mixes.ts            made-for-you mixes, composed from existing scorers
  youtube-policy.ts   30-day retention and the expiry cascade
  bridge.ts           the one link to the preference profile
  index.ts            public surface
  fake-repository.ts  test double honouring the production allow-list
```

**Why separate.** Personalization is a behavioural record the visitor may switch off
entirely; the library is a set of things they deliberately saved. Merging them would
mean either losing playlists when consent is withdrawn, or retaining a behavioural
profile after it was refused. The two have separate namespaces, separate versions,
separate storage and separate clear controls.

The dependency arrow points one way: **library → personalization**, never back.
Personalization exposes a registration seam (`explicit-intent.ts`); the library
registers a reader at start-up. Neither store imports the other's state.

---

## 4. Persistence

**IndexedDB**, behind one typed `LibraryRepository` interface, with an in-memory
fallback.

The audit that produced this choice: personalization is a rolling window with hard caps
(250 items, 50 searches) that never exceeds a few tens of kilobytes and is read once at
start-up — synchronous `localStorage` costs nothing there. A library is the opposite: it
is meant to accumulate, a visitor is entitled to a thousand liked songs and a hundred
playlists, and every `localStorage` access blocks the main thread. Parsing a
megabyte-scale JSON string during hydration and re-serialising all of it on every heart
click is precisely the stall `agents/41` warns about.

Volume, mute, autoplay and repeat **stay in `localStorage`**: tiny, and needed before the
first frame.

- **Namespace:** database `pulse.library.v1`, object store `state`, one record.
- **Atomicity:** the whole state is a single value under one key, so a write lands
  completely or not at all. "Add the track metadata *and* append the playlist key"
  cannot half-apply — there is no interleaving that could leave a playlist pointing at a
  track that was never written.
- **Refused mutations write nothing.** Every reducer returns the *same state instance*
  when it declines; `commit` compares by identity before persisting. Asserted in
  `store.test.ts` by counting repository writes.
- **Unavailable storage:** the memory repository keeps the session working, the store
  reports `storageAvailable: false`, and Settings and `/library` each say so once,
  without blocking anything.
- **Versioning:** a newer record is left on disk untouched and not reinterpreted; an
  unrecognisable one is discarded; older ones migrate forward when a step exists.
- **No React component touches storage.** No component imports `storage.ts` or
  IndexedDB. Every mutation goes through a store action.
- **Export-ready:** the persisted shape is exactly what `agents/48` asks a future backend
  to reuse, and `LibraryRepository` is the seam a `CloudLibraryRepository` would slot into.

### What is stored, and what cannot be

`toPersistedLibrary` builds the record field by field and never spreads a source object.
There is no code path by which a stream URL, a signed URL, an API key, an OAuth token, a
raw provider response or a YouTube statistic can reach disk — the only way to persist a
new field is to add a line to that function. Tests force forbidden fields onto a
reference and assert they do not appear in the serialised output.

---

## 5. Liked Songs

A **virtual system collection**, not a playlist object: there is only a membership list,
so there is no record to rename or delete. `/library/liked` renders no rename or delete
control, and no code path could produce one.

- Route `/library/liked`; most-recently-liked first; sortable by Recently liked / Title /
  Artist.
- One heart component (`LikeButton`) on **search rows, home cards, Recently Played, the
  player bar, the queue and every library row** — one component reading one store, which
  is why two surfaces can never disagree.
- Accessible names say what actually happens: *Save “X” to Liked Songs in Pulse* /
  *Remove “X” from Liked Songs in Pulse*.
- Like persists immediately, creates or refreshes the saved reference, and updates every
  mounted surface in the same tick.
- Unlike removes membership only. It does not delete listening history, does not create a
  negative signal, and garbage-collects the reference only once nothing else points at it.
- Identity is `provider:providerItemId` throughout. A Jamendo cover and the Audius
  original are two saves; nothing deduplicates on title or artist.

---

## 6. Playlist CRUD

Create, rename, describe, delete, add, remove, reorder — all local, all immediate, no
provider request anywhere in the path.

- Pulse-local ids (`pl_<uuid>`), never a provider id.
- Names are visitor text: trimmed, length-capped, Unicode preserved exactly (Armenian,
  Arabic and emoji names are tested). Nothing interprets a name as markup.
- Duplicates within one playlist are refused by default and reported as *Already added*;
  the menu entry for an item already present is disabled and labelled.
- The same track may live in any number of playlists, held by one reference.
- Deleting requires an in-place confirmation that names the playlist, and **does not
  unlike its songs** — verified at the reducer, store and E2E levels.
- Bounds: 100 playlists, 1000 tracks per playlist, 10 000 saved references, 5000 likes,
  500 hidden keys. Enforced on write *and* on read.
- Garbage collection removes a reference only when neither Liked Songs nor any playlist
  names it. Hidden keys deliberately do not hold a reference alive.

### Reordering

Move up / Move down / Move to top / Move to bottom, as ordinary menu items — keyboard,
screen reader and thumb, with no pointer gesture anywhere in the path. `agents/42`
forbids drag-only reordering; there is no drag-only path here. Order persists on the
mutation and is asserted to survive a reload in E2E. Reordering is hidden while a filter
is applied, because moving "row 2" of a filtered view would move something invisible.

### Covers

Up to four artwork **addresses** arranged in a CSS grid — no canvas, no composite, no
data URI, no stored bytes. Each tile fails over through the same mirror list every other
cover uses. Zero artwork falls back to a mark. YouTube thumbnails are excluded from
collages: a 16:9 still cropped into a quarter of a square would present a video as album
art, which this app has declined to do since Phase 3.

---

## 7. Playlist playback

**One playback path.** Both Play and Shuffle call `playPlaylist`, which resolves
references through the existing provider path and hands the result to the existing queue.
No playlist audio element, no second engine, no separate Next.

- Play starts the first playable item and the remainder becomes the **explicit queue**.
- Clicking a row starts there; the continuation is the playlist order from that point.
- Playing a *filtered* view still uses the real stored order, mapping the clicked row
  back to its true position.
- Two phases, so something is heard before the whole list has re-resolved: resolve
  forward to the first playable item and start it, then resolve the remainder (bounded
  concurrency 4, capped at 100 items) and hand over the full continuation — applied only
  while the track started in phase one is still loaded, so a visitor who presses Next
  during resolution keeps control.
- An item the provider no longer has is skipped, bounded at 5 consecutive attempts, stays
  visible so it can be removed, and never retries in a loop.
- Removing the currently playing track from a playlist does not interrupt playback: the
  queue is a snapshot of what was asked for.
- A saved YouTube item is never placed in an audio queue; starting a saved list *on* one
  plays it in YouTube's own player and leaves the queue alone.

---

## 8. Shuffle and repeat

Implemented in `src/player/queue-order.ts` as arithmetic over the queue.

**The queue is never rearranged.** Shuffle is a separate permutation of *indices*, so
"shuffling must not mutate the persisted playlist order" is true by construction, and
turning shuffle off restores the original sequence exactly, mid-track, with no reload.

- Deterministic: a seeded Mulberry32 PRNG, not `Math.random`. The same seed and queue
  always produce the same order, so Next/Previous are predictable and the tests describe
  exact sequences rather than statistics.
- The current item is placed first in the permutation, so switching shuffle on interrupts
  nothing and the very next item is genuinely different — the "no immediate repeat" rule,
  satisfied structurally.
- One running order per session; advancing does not redraw it. A genuinely different list
  draws a new one; the same list merely advanced keeps its own.
- Repeat: **off → repeat playlist → repeat one → off**. Repeat mode persists under
  `pulse:repeat`, like volume and autoplay. Shuffle does **not** persist: its running
  order is session-only, and silently resuming a shuffle a week later with a different
  order is the more surprising behaviour.
- `useHasNext` / `useHasPrevious` call the same `nextQueueIndex` / `previousQueueIndex`
  the actions do, so a control's enabled state can never disagree with what pressing it
  does.

### Reachability

The reference collapses to a mini-player below 560px and hides everything but play/pause,
which would have left repeat unreachable on a phone. Shuffle and repeat are therefore
**also** in the queue panel — the one surface that shows the queue at every width, and
where the controls conceptually belong. Same store, same actions.

---

## 9. Queue precedence

Exact, in `playNext`, and identical for the on-page control, the Media Session's Next and
a track ending naturally:

```
1. repeat one              → replay the current track
2. explicit queue          → next item in the running order in force
3. repeat playlist         → wrap to the start of that same list
4. Phase 6 autoplay        → a generated similar track
5. stop
```

Steps 2 and 3 are one call into `nextQueueIndex`, which is what stops shuffle and
repeat-playlist becoming two competing notions of "next". **Autoplay is consulted last,
unconditionally last**, so nothing generated can pre-empt a repeat or jump ahead of a
queued item. Everything the visitor set outranks everything the app produced.

Previous follows the same running order — a shuffled session is navigable in both
directions — but repeat-one deliberately does not apply to it: a visitor pressing Previous
is asking to move.

**Media Session is unchanged.** Its handlers already called `playNext` / `playPrevious`;
because the precedence lives in those actions rather than in either caller, the lock
screen honours shuffle and repeat for free. No file under `src/player/media-session/` was
modified.

---

## 10. Explicit recommendation signals

No second engine. The existing Phase 4 profile is extended: a like and a listen are
evidence about the same thing, so they belong in one set of weights.

| Signal | Weight | Notes |
| --- | --- | --- |
| Pulse Like | `EXPLICIT_LIKE_WEIGHT = 2` | Twice an ordinary qualified listen |
| In ≥ 1 playlist | `EXPLICIT_PLAYLIST_WEIGHT = 1` | Added **once**, regardless of count |
| Decay floor | `EXPLICIT_MIN_DECAY = 0.5` | A like fades but never below half |
| Not interested | exclusion | Never a negative weight — see below |

Calibrated rather than picked: a like outranks one ordinary listen (2 > 1) but stays below
what a genuinely repeated, completed listen reaches (2 × `MAX_REPEAT_FACTOR`), so a single
heart cannot outrank a track the visitor has returned to for weeks. Asserted directly in
`explicit-signals.test.ts`.

**No double-count explosion — structurally.** An `ExplicitItem` carries two *booleans*,
not two counters. A track in five playlists produces one item with `inPlaylist: true`; the
number of playlists holding it is never computed anywhere. A test builds the same library
with one playlist and with five and asserts the normalized artist weights are identical to
ten decimal places.

**YouTube cannot participate.** `ExplicitItem.provider` is typed `ProviderId`, which
cannot be `'youtube'`, and `explicitIntentFrom` skips YouTube references at the source. The
exclusion survives a future edit to that function because the type forbids it.

**Consent gating, in one place.** `buildProfile` reads explicit intent, and it is only
called while personalization is enabled. The library knows nothing about consent; with
consent denied the library works identically and the profile stays empty. Tested both ways.

Unliking removes the contribution entirely. A liked artist enters the affinity list with
`plays: 0`, so *Because you listened to…* — which makes a claim about listening — still
requires real listens.

---

## 11. Not interested

Available on generated recommendation surfaces only (*Recommended for you*, *Because you
listened to…*, *More from artists you like*, mixes). Trending and charts are claims about
the catalogue, not about the visitor, so hiding a row there would have nothing to act on.
Library rows carry no *Not interested* either: a saved item is not a recommendation.

- Records **only the key**. No reason, no category, no inference — the record has nowhere
  to put one.
- Removes the item from every generated shelf and from every mix.
- Persists in the library, so it works with or without personalization consent.
- **Undo lives on the toast**, which is where it has to live: the row has already left the
  shelf, so nothing local is still mounted to own the reversal. The UI store's notice
  gained an optional single action for this, and an actionable toast stays 6s instead of
  2.6s.
- Never touches a provider account, and never deletes listening history — asserted
  explicitly.
- *Reset hidden recommendations* in Settings, behind a confirmation, restores everything
  without affecting Liked Songs or playlists.

**Design decision — the negative signal is an exclusion, not a negative weight.** A
negative weight would generalise one refusal into a claim about an artist, a genre or a
script. That is both weaker evidence than it looks and exactly the inference `agents/43`
rules out. "Not this one" is treated as meaning "not this one". `hiddenItemIds` is carried
on the profile; every weight map is asserted non-negative.

---

## 12. Made-for-you mixes

Up to three virtual mixes, composed from machinery that already exists and is already
tested:

| Mix | Question it asks | Built from |
| --- | --- | --- |
| **Your Mix** | best overall fit | Phase 4 `alignmentScore`, 20% held for exploration |
| **More from your likes** | artists explicitly saved | same scorer, filtered to saved artists |
| **Discovery Mix** | closest to saves, from unknown artists | Phase 6 `scoreCandidate` |

- Target 20 tracks, minimum 15 — a mix below the minimum is not offered at all, because a
  five-track "mix" is a shelf with a grander name.
- Max 2 tracks per artist (the shelves' own `MAX_TRACKS_PER_ARTIST`); no track appears in
  two mixes; already-saved, already-queued, hidden, recently-played and overplayed items
  are all excluded.
- ~80% affinity / ~20% exploration in Your Mix.
- **Deterministic**: same profile, library and pool ⇒ same mixes in the same order, so
  they do not reshuffle between renders.
- **Zero requests, ever.** The pool is the discovery shelves the page already loaded plus
  the Phase 6 session pool — tracks the session has already seen, held in memory. The
  builder takes `Track[]` and returns `Track[]`; no provider is reachable from it.
- Recomputed on the profile, library and pool objects, each of which is a new reference
  only when something meaningful happened. A `timeupdate` at 4 Hz does not rebuild a mix.

### Cold-start honesty

Evidence is required, and either kind will do: a warm listening profile, **or** at least
three deliberately saved catalogue tracks. A brand-new browser, a browser with two saves,
a browser with personalization refused, and a browser whose pool is too small all get no
*Made for you* section and the unchanged discovery page. Four separate E2E tests.

**One design correction made during this phase.** `stage` measures *listening*, and
gating mixes on it would have meant a visitor who liked five tracks without finishing a
listen could never see one — the dishonest answer, not the cautious one. `mixes` is
therefore offered at every stage, and the honesty guarantee lives where the evidence does:
`buildMixes` returns nothing without enough of it. The home page still keeps exactly five
shelves at every stage.

### Save as playlist

Snapshots the **current order** into an ordinary local playlist, named after the mix and
the day so repeats stay distinguishable. After saving it is an independent object: a test
moves the evidence underneath it (a dismissal, a hide, a new like) and asserts the saved
order is unchanged.

---

## 13. Provider boundaries

### Audius

Library stays local. **No Audius OAuth was added.** No favourite, repost or playlist
operation is issued. Saved items keep the Audius id plus safe display metadata and
re-resolve through the existing `getTrack` path at play time.

### Jamendo

Library stays local. **No Jamendo OAuth was added.** No `setuser/favorite` or
`setuser/like` call exists in the codebase. Saved items keep the Jamendo id and the
required backlink, and re-resolve through the existing bounded search matched on
*provider id* — never on title similarity, which would risk playing a different recording
than the one saved. `streamUrl` is never persisted, and a test proves it by saving a
Jamendo track that has one.

### Disclosure

Every action says **in Pulse**: *Save “X” to Liked Songs in Pulse*, *Add “X” to “Y” in
Pulse*, *Added to Liked Songs in Pulse*, *Saved to Pulse playlist*. No provider logo
implies a provider-side mutation. An E2E test records every non-GET request during a like
and a playlist creation and asserts none reaches Audius, Jamendo, YouTube or Google.

---

## 14. YouTube policy audit

Re-read against the current YouTube API Services Developer Policies before implementation.
Governing rules applied:

- **§III.E.4.d** — limited Non-Authorized Data may be stored temporarily, no longer than
  **30 calendar days**, then deleted or refreshed.
- **§III.E.4.h** — API Data must not be used to create new or derived data or metrics.
- Background play remains prohibited for this client architecture.

Pulse has **no YouTube OAuth**, so everything it holds is Non-Authorized Data.

| Rule | How it is enforced |
| --- | --- |
| ≤ 30 days | `youtubeExpiresAt` stamped at save time; `YOUTUBE_RETENTION_DAYS` shared with the Phase 4 history rule so the two cannot drift |
| Missing expiry | Treated as **already expired**, never as permanent |
| Expiry on read | Purged at start-up inside `hydrate`, before anything renders, and every 6 hours thereafter |
| No statistics | No view count, like count, rating or comment field exists in the schema; Pulse never requests them |
| No media | No stream URL, no bytes; the thumbnail is an address loaded from YouTube |
| No derived metrics | YouTube saves cannot reach the profile, mixes or similarity — the `ExplicitItem` type forbids it |
| Embed safety | A saved item plays only if within retention, `embeddable === true`, and `madeForKids === false`; silence is treated as refusal |
| No background play | Untouched; no Media Session entry for YouTube |

### The expiry decision — the strict route, deliberately

`agents/44` offers two readings at expiry. Pulse takes the one it names for exactly this
case: *"If legal/policy interpretation is uncertain, take the stricter route and fully
remove the expired YouTube saved item."*

At expiry the reference is **deleted**, and its key is removed from Liked Songs and from
every playlist that held it. No placeholder survives. The reasoning: a membership record
with the video id stripped is not a playable reference, and one that keeps the id keeps
the thing that identifies YouTube's content. A test serialises the purged library and
asserts the video id, title, channel and thumbnail host all disappear.

**No refresh endpoint was added.** The strict route makes it unnecessary — the visitor can
search for the video again and re-save it, which is an ordinary permitted retrieval that
starts a fresh 30 days. Consequently `/api/youtube` gained **no new action**, spends no
extra quota, and remains not-a-generic-proxy. Zero `search.list` and zero `videos.list`
calls were added anywhere in this phase.

### One product decision this forced

A YouTube result that may not be embedded (made-for-kids, embedding disabled, live) now
has **no library actions at all** — no heart, no menu. Saving one would create a library
entry that could never legally play. This was found by an existing Phase 3 test whose
assertion ("no in-app play control") began matching the new heart; the correct fix was to
remove the affordance, not to loosen the test.

---

## 15. Privacy

`/privacy` gained a full section, *Your Library is saved on this device only*, plus edits
throughout. It states:

- The library is in **this browser**, in its own storage, separate from listening history.
- No Pulse account, no cloud sync; another browser, phone or private window starts empty.
- **Pulse is not signed in to Audius, Jamendo or YouTube** and has no login for any of
  them. A heart is a record in this browser; deleting the Pulse library removes nothing
  from those services and never did anything to them.
- Exactly what is stored per saved song, and that stream addresses, keys and credentials
  never are — which is why playing from the library re-asks the provider.
- *Not interested* records one id and no reason.
- **YouTube saves expire within 30 days**, and when they do the whole saved item goes,
  including its place in Liked Songs and any playlist.
- What *Clear Library* removes, and what it does not.
- That the app never acts on a provider account: no favourite, like, follow, subscribe or
  playlist creation, anywhere.

Settings gained a *Your Library* section with the same disclosure and a live count.

### Clear Library

In Settings, behind an in-place confirmation, with the description stating exactly what
goes:

- **Removes:** Liked Songs, playlists, saved references, hidden-recommendation keys.
- **Does not touch:** listening history, search history, consent, volume, mute, autoplay,
  repeat — each under its own separate key with its own separate control.
- **Documented consequence:** because likes and playlist membership *are* the explicit
  signal rather than a copy of it, clearing them clears their influence on
  recommendations. The profile rebuilds from listening history alone. Stated in the
  control's own description, on the privacy page, and asserted by a test.

---

## 16. Performance and network budget

- **Opening the library costs zero provider requests.** A test wraps `fetch` and asserts
  no `/api/youtube`, `/api/jamendo` or catalogue search is issued while rendering Liked
  Songs or `/library`. An E2E test asserts the same for YouTube quota specifically.
- Provider media is resolved **only when playback needs it** — one request for a single
  item, a bounded burst (concurrency 4, cap 100) on an explicit Play.
- Every derived view is memoized on the store's state identity, which changes only when a
  mutation commits. Membership lookups share one derived `Set` per state at module level,
  so a page of fifty rows performs one pass, not fifty.
- Nothing parses a large persisted object on render: hydration reads a structured value
  once, asynchronously, and the store is the source of truth thereafter.
- Mixes recompute on profile/library/pool identity, never on a playback tick.
- Bundle, measured before and after:

  | Asset | Baseline | After | Δ gzip |
  | --- | --- | --- | --- |
  | `index-*.js` | 371.60 kB raw / 116.84 kB gzip | 431.99 kB / 133.03 kB | **+16.19 kB** |
  | `index-*.css` | 122.54 kB / 21.66 kB | 135.78 kB / 23.63 kB | **+1.97 kB** |
  | `react-*.js`, `browser-*.js`, `index.browser.esm-*.js` | unchanged | unchanged | 0 |

  ~18 kB gzip for the whole phase, and **no new dependency** — `package.json` and
  `pnpm-lock.yaml` are byte-identical. The 1.58 MB Audius SDK chunk is untouched and
  remains the dominant cost, as it was before.

---

## 17. Vercel regression verification

**The Vercel fixes are preserved, and nothing in this phase went near them.**

- `git status` confirms **no file under `api/` or `server/`** was modified, and neither
  were `vercel.json` or any `tsconfig*.json`.
- The production build config remains test-pruned: `tsconfig.app.build.json` still
  excludes `src/test` and every `*.test.*`, and `tsconfig.node.build.json` still excludes
  `server/**/*.test.ts` and `tests`.
- `pnpm typecheck` still typechecks **tests**, fixtures and configs through the
  development graph — the new test files are covered by it.
- `server/module-resolution.test.ts` passes (8 assertions): every relative specifier under
  `api/` and `server/` still carries its explicit `.js`, the graph from both entrypoints
  still resolves under Node ESM, no bare import was mangled, and no test module is dragged
  into a Function. This is the guard against the `ERR_MODULE_NOT_FOUND` /
  `FUNCTION_INVOCATION_FAILED` class of failure.
- `pnpm build` passes with the production graph.
- `pnpm verify:bundle` PASS — 0 matches across 12 files.

### Production endpoint verification — **BLOCKED by Deployment Protection**

Pushed and deployed. **The Functions could not be exercised**, for a reason outside this
repository, and this report does not claim a production pass.

What was done and observed:

1. Committed `5658924` and pushed `abf7c65..5658924` to `origin/main`
   (`github.com/kokoc30/pulse-music-platform`).
2. Vercel built it. The GitHub deployment for that exact SHA (`6150567440`) reports
   `state: success`, `environment: Production`, at
   `https://pulse-music-platform-ldh0eelp6-kokos-projects-8df176f4.vercel.app`.
   **The production build passed on Vercel** — which is the failure mode the previous
   phase's build fix addressed, and it is genuinely confirmed.
3. Requesting the endpoints on that URL returns **`302` to `vercel.com/sso-api`**, not an
   application response. The same is true of the project's other aliases
   (`…-kokos-projects-8df176f4.vercel.app`, `…-git-main-…`). The deployment sits behind
   **Vercel Deployment Protection (SSO)**, so every request — Function or asset — is
   intercepted before it reaches the app.
4. There are no Vercel credentials in this environment (`vercel whoami` → *Logged out*),
   no `.vercel/` project link, and no `VERCEL_AUTOMATION_BYPASS_SECRET` configured, so the
   protection cannot be bypassed from here.

**A `302` from the protection layer is not evidence either way about the Functions.** It
proves nothing about `ERR_MODULE_NOT_FOUND`, and it is not being counted as a pass.

### To close it out

Any one of these unblocks it:

- Vercel → Project → Settings → **Deployment Protection** → disable for Production; or
- generate a **Protection Bypass for Automation** secret and request the endpoints with
  `?x-vercel-protection-bypass=<secret>`; or
- simply open the two URLs in a browser already logged in to that Vercel account.

Then confirm neither Function crashes:

- `GET /api/jamendo?action=search&q=hello` → **200** with the sanitized search envelope.
- `GET /api/youtube?action=search&q=hello` → **200**, or **429** on spent quota, or
  **503** if `YOUTUBE_API_KEY` is unset. All three prove the module loaded.
- A **`500 FUNCTION_INVOCATION_FAILED`**, or `ERR_MODULE_NOT_FOUND` in the Function logs,
  would be the regression to look for. Nothing in this phase touched `api/`, `server/`,
  `vercel.json` or any `tsconfig`, and `server/module-resolution.test.ts` passes, so this
  is not expected — but it is unverified, not verified.

Then walk §19 on that origin, and install the PWA on a real phone for the mobile pass.

---

## 18. Files changed

**New (35 files, ~9 990 lines including tests):**

- `src/library/` — 12 modules + 6 test files + 1 test double
- `src/components/library/` — `LikeButton`, `TrackMenu`, `PlaylistCover`, `LibraryTrackRow`
- `src/features/library/` — `LibraryPage`, `LikedSongsPage`, `PlaylistPage`, `LibraryHost`,
  `MixCard`, `useMixes` + 4 test files
- `src/player/queue-order.ts` + `queue-order.test.ts` + `repeat-shuffle.test.ts`
- `src/personalization/explicit-intent.ts`
- `src/styles/library.css`
- `src/test/fixtures/library.ts`
- `tests/e2e/library.spec.ts`

**Modified (33 files).** Notable behaviour changes:

- `player-store.ts` / `player-actions.ts` / `player-selectors.ts` — repeat, shuffle, the
  five-step precedence
- `personalization/profile.ts` / `config.ts` / `store.ts` / `selectors.ts` — explicit
  intent folded into the existing profile; `refreshProfile`; the `mixes` section
- `TrackRow` / `TrackCard` / `HistoryCard` / `PlayerTrackInfo` / `YouTubeResultRow` /
  `QueuePanel` — the canonical heart and menu
- `ui-store.ts` / `NoticeToast.tsx` — actionable toasts, for Undo
- `PrivacyPage.tsx` / `SettingsPage.tsx` — disclosure, Clear Library, Reset hidden
- `router.tsx` / `AppShell.tsx` / `LibrarySidebar.tsx` / `MobileNavDrawer.tsx` — routes,
  host, navigation
- `src/test/render.tsx` — library harness; also now clears the Phase 6 session pool and
  autoplay buffer between tests (a pre-existing isolation gap this phase surfaced)

**Existing tests changed — 5, each for query specificity, none weakened:**

| Test | Why | What changed |
| --- | --- | --- |
| `ProviderCredit` × 2 | rows now hold 3 buttons | named the play button; the anchor-nesting check now runs against **every** button in the row — strictly stronger |
| `YouTubeFallback` "no in-app play control" | — | **unchanged**; fixed by removing library actions from non-embeddable rows |
| `YouTubeFallback` "plays an ordinary result" | row has 3 buttons | named the play button |
| `SettingsPage` "announces the confirmation" | — | **unchanged**; fixed by removing a redundant `role="status"` from a static warning |
| `search-playback` / `multi-provider` gated rows | rows now hold 3 buttons | assert the *play* control is disabled; the heart stays enabled, because a gated track can still be saved for later |

Two E2E tests are **skipped on mobile only**, with the reason in the code: the reference's
mini-player has no Next control below 560px, so repeat-one's effect cannot be triggered by
a button press there. The rules themselves are covered deterministically against the real
`playNext` in `repeat-shuffle.test.ts`, and mobile separately asserts the setting is
reachable and persists.

---

## 19. Test coverage

**Unit / component — 87 files, 1627 tests (+289).**

Storage (29) · reducers (37) · store (14) · track references (15) · YouTube policy (16) ·
queue order (24) · repeat & shuffle (23) · explicit signals (21) · mixes (27) · library UX
(34) · playlist playback (16) · recommendations & settings (17).

**E2E — 344 passed, 24 skipped (+71).** `tests/e2e/library.spec.ts` covers scenarios
A–E from `agents/46`; `tests/e2e/mobile.spec.ts` covers F.

Everything `agents/46` lists is covered, including: transaction failure cannot leave a
dangling playlist reference; caps; no stream URLs or secrets; garbage collection; the
provider-identity rule preventing false cross-provider dedupe; Pulse Like issuing no
provider write; Unicode names; delete-does-not-unlike; reorder surviving reload; shuffle
leaving stored order untouched; the full precedence table; explicit-signal bounding;
five-playlists-do-not-multiply; consent gating both ways; cold-start honesty; mix
determinism, artist caps, exploration and exclusions; save-as-playlist snapshotting; the
30-day expiry and its cascade; no YouTube statistics; no background-play regression; and
the privacy copy.

### Manual QA

The E2E suite performs the §19 walk-through in a real Chromium at both viewports —
liking an Audius and a Jamendo track, verifying the library, reloading, creating a
playlist, adding three tracks, reordering, Play, Next, Shuffle, Repeat, adding the current
song to another playlist, unliking, marking a recommendation *Not interested*, saving a
mix as a playlist, and reloading to verify persistence. **No live-provider smoke run was
performed and no YouTube quota was spent** — every provider is stubbed at the network
layer, which is the existing project rule.

---

## 20. Known limitations

1. **Live Functions not exercised.** The deploy built successfully on Vercel, but every
   request to it is intercepted by Deployment Protection, so `/api/jamendo` and
   `/api/youtube` were not called on production and no manual QA ran on that origin.
   One setting change or a bypass token closes it — see §17. The single open
   Definition-of-Done item.
2. **Playlist playback resolves at most 100 items per Play.** A longer playlist plays its
   first hundred from the chosen row; the rest stay visible and are reachable by starting
   from a later row. A bounded burst on an explicit action was preferred to an unbounded
   fan-out.
3. **Mix candidates are limited to what the session has loaded.** Mixes never spend a
   request, so on a very fresh session the pool may be too small for a mix, and none is
   offered. This is the honest failure mode, not a silent thin one.
4. **Repeat is not on the mobile mini-player**, only in the queue panel — the reference
   leaves no room, and it hides Next/Previous there for the same reason.
5. **A YouTube save expires completely at 30 days**, taking its playlist membership with
   it. That is the deliberate strict reading; a laxer one would keep a placeholder.
6. **Mixes seed similarity only from saves that happen to be in the pool.** Filling that
   gap would cost a request per seed; the profile-driven mixes degrade gracefully instead.
7. **Library search is substring matching** on folded text — accent- and case-insensitive,
   but not fuzzy.
8. **No import/export yet.** The schema is designed for it (§21); it is not implemented.
9. The library uses a **single-record IndexedDB schema**. That is what makes writes
   atomic, and it is right at these bounds; a far larger library would want a per-entity
   schema, which the same `LibraryRepository` interface can accommodate.

---

## 21. Future cloud-sync path

Nothing in `agents/48` was implemented, and nothing was foreclosed.

- `LibraryTrackRef`, `Playlist`, Liked Songs membership and the stable `provider:id`
  identity are exactly the entities a future backend should reuse.
- `LibraryRepository` (`read` / `write` / `clear`) is the seam. Today's
  `IndexedDbLibraryRepository` and `MemoryLibraryRepository` sit behind it; a
  `CloudLibraryRepository` or `SyncedLibraryRepository` would slot in with the store,
  every selector and every component unchanged.
- `toPersistedLibrary` already emits a clean JSON document — a JSON export/import is a
  small, self-contained next step, and is the sensible low-risk feature *before* accounts.
- The versioned schema plus `migrations.ts` gives a migration path, and unknown future
  versions already fail safe by being left untouched.
- Provider OAuth stays out. Audius and Jamendo both offer native library writes, and the
  UI is deliberately worded so that adding "Connect Audius" later would be an addition to
  honest copy rather than a correction of dishonest copy.

**Not added, as instructed:** Pulse accounts, cloud DB, collaborative playlists, provider
OAuth, offline downloads, crossfade, lyrics, social feed.
