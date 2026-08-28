# Recently Played — artwork and live ordering fix

## Status

**PASS.** Both reported defects are fixed, and both fixes were verified against the real
development server with live Audius data before this report was written.

- Recently Played cards render real artwork, with the same candidate set and the same failover
  every other card in the app has.
- Replaying an existing item moves it to first **immediately**, with no reload, no duplicate row,
  and no effect on the recommendation profile.
- A brand-new track still has to cross the qualified-listen threshold before it appears.
- The order survives a reload.
- Phase 5's search dropdown consumes the same corrected data through the same selector.

---

## Exact artwork root cause

**A history row kept one artwork URL and dropped the mirror origins, so it had nothing to fail
over to.**

Audius serves images from many community-run content nodes, and an individual node is regularly
unhealthy. The app already handles this everywhere: `Artwork` builds a candidate list with
`buildArtworkCandidates(artwork, size)` — the primary URL plus the same path on each origin in
`artwork.mirrors` — and advances through it on every `error` event.

A history row was written with `pickArtwork(track.artwork, 'medium')` alone. One URL, one
candidate. The first dead node exhausted the list and the card fell to the transparent-pixel
placeholder.

That is exactly the asymmetry reported: **the player bar showed the image and Recently Played did
not.** The player bar holds the live `Track.artwork` object, mirrors included, so it fails over
and renders.

### Evidence, not inference

Traced end to end against the live dev server before any code changed:

```
=== PERSISTED HISTORY ROW ===
artworkUrl : https://cn4.mainnet.audiusindex.org/content/01M0N285KFJ6BP28F22X1KEYAJ/480x480.jpg
              ← present, well-formed, http(s). Capture was never broken.

=== IMAGE REQUESTS (failed) ===
https://audius-creator-5.theblueprint.xyz/...  net::ERR_SSL_PROTOCOL_ERROR
https://cn0.mainnet.audiusindex.org/...        net::ERR_SSL_PROTOCOL_ERROR
https://v.monophonic.digital/...               net::ERR_SSL_PROTOCOL_ERROR
https://cn4.mainnet.audiusindex.org/...        net::ERR_BLOCKED_BY_ORB
(29 image requests, 16 bad)
```

Two things this ruled out immediately:

- **Capture, persistence and the reader were all fine.** The URL was in storage and `HistoryCard`
  was reading it.
- **It was never Recently-Played-specific.** The *trending* card for the same track was also blank
  at that moment (`trendingCard: "data:image/gif;base64,..."`). Audius image nodes were broadly
  failing; the difference was only how many chances each card had.

`ERR_BLOCKED_BY_ORB` is Chrome's Opaque Response Blocking — the node answered an image request
with something that was not an image, typically an HTML error page.

---

## Actual stored artwork shape before fix

```jsonc
{
  "provider": "audius",
  "providerItemId": "3oqjbGv",
  "title": "Peak",
  "artist": "iLLPeTiLL",
  "artworkUrl": "https://cn4.mainnet.audiusindex.org/content/01M0N.../480x480.jpg",
  // …and nothing else about artwork. No mirrors, so no failover.
  "lastPlayedAt": 1787944251001
}
```

---

## Artwork normalization change

The schema keeps a normalized, display-safe reference — it is still one URL, and still never a
provider object, a stream URL or media bytes. One field was added beside it:

```ts
artworkUrl?: string
/** Alternate content-node origins for the same image path. */
artworkMirrors?: string[]
```

| Provider | What is stored |
| --- | --- |
| **Audius** | `pickArtwork(track.artwork, 'medium')` — the same 480×480 resolution the track cards use — plus `track.artwork.mirrors` |
| **Jamendo** | The album image URL the provider supplies, unchanged. Jamendo serves one origin, so there are no mirrors |
| **YouTube** | Unchanged: `thumbnailUrl` only, exactly as Phase 4 permitted. Never artwork, never mirrors |

**No duplicate artwork system was built.** `historyArtwork(entry)` in
`src/personalization/artwork.ts` returns `{ medium, mirrors }` — the app's existing `Artwork`
model — and the existing `<Artwork>` component does the rest. A history card and a track card now
run the identical resolver over the identical candidate list.

Storage safety is unchanged: `artworkMirrors` is written through the same explicit allow-list, and
`safeOrigins()` keeps only `http(s)` origins, reduces a full URL to its origin, drops duplicates
and non-strings, and caps the list at `MAX_ARTWORK_MIRRORS = 4`.

### Verified after the fix

```
artworkMirrors: ["https://cn0.mainnet.audiusindex.org",
                 "https://v.monophonic.digital",
                 "https://audius-standardvc-1-validator-3.figment.io"]

HISTORY CARD vs ITS TRENDING TWIN
  historySrc : https://audius-standardvc-1-validator-3.figment.io/... historyLoaded : true
  trendingSrc: https://audius-standardvc-1-validator-3.figment.io/... trendingLoaded: true
```

The card failed over `cn4` (dead) → `cn0` (dead) → `monophonic` (dead) → `figment.io` (loaded),
landing on the same URL as its trending twin.

---

## Existing-history migration strategy

**No migration, no schema version bump, and no history is wiped.** Three properties make that safe:

1. Both new fields are optional, and every reader falls back. A v1 row written before this change
   loads unchanged.
2. A row with no `artworkMirrors` behaves exactly as it did before — one candidate — so nothing
   regresses.
3. **Old rows repair themselves on replay.** `touchReplayStart` refreshes `artworkUrl`,
   `artworkMirrors`, `title`, `artist` and duration from the freshly resolved item, so a row
   recorded without artwork gains it the next time the listener plays it.

No background network request is made to repair old cards. A row that genuinely has no artwork
keeps the existing placeholder tile.

---

## Exact ordering root cause

**`lastPlayedAt` only moved when a play session was *committed*, and a session commits at
qualification or at its end — never at its start.**

The listen tracker deliberately writes at most twice per play: once the moment the listen
qualifies, and once when it finishes. So pressing play on a track from last week changed nothing
until thirty seconds had elapsed, and the shelf kept showing the older ordering.

That behaviour is correct for the *profile* and wrong for the *shelf*, because the two are asking
different questions.

---

## Replay-start semantics

The two questions now have two timestamps:

| Field | Meaning | Moves when | Read by |
| --- | --- | --- | --- |
| `lastPlayedAt` | The **signal** timestamp | A session commits — qualification, completion, skip | Recency decay, retention, the profile |
| `lastStartedAt` | The **display** timestamp | Playback of an item **already in history** starts | Recently Played ordering, only |

`displayRecency(entry) = max(lastPlayedAt, lastStartedAt ?? 0)`, and `recentlyPlayed()` sorts on
it. The `?? 0` is what makes rows written before this change sort exactly as they used to.

`touchReplayStart(history, item, now)` is the whole mechanism. It moves `lastStartedAt`, refreshes
display metadata, and touches **nothing** else: not `playCount`, not `qualifiedAt`, not
`lastPlayedAt`, not `playedSeconds`, not `playedDays`.

It also leaves `storedAt` alone. For YouTube that is the retention clock, and a replay from
history reuses metadata already held rather than retrieving it again — only a real session commit,
which does re-read the item, restarts that window.

**Ties are resolved deterministically.** Switching tracks closes one session and starts the next in
the same tick, so the two timestamps can land on the same millisecond. A press of play is the later
event, and the sort breaks ties on `lastStartedAt` (then on id), so the order is both correct and
stable across renders and test runs.

---

## New-item qualification semantics

Unchanged, and explicitly protected: `touchReplayStart` **ignores an item that is not already in
history** and returns the same array instance.

- Start a brand-new track → no row, nothing on the shelf.
- Abandon it after five seconds → still no qualified listen; the existing early-skip handling
  applies exactly as before.
- Cross `min(30s, 25% of duration)`, floored at 10s → the row is created and appears at position 1
  immediately.

The qualified-listen rule itself was not touched.

---

## Recommendation-signal protection

This was the trap, and it is closed by construction: `effectiveWeight` decays against
`lastPlayedAt`, which `touchReplayStart` never moves.

Pinned by tests that assert the consequence directly:

- `effectiveWeight(entry)` is **identical** before and after a replay start.
- Fifty consecutive replay starts leave `qualifiedListenCount` and every entry in `artistWeights`
  byte-identical.
- A replay that then genuinely qualifies still increments `playCount` exactly once.

Verified live too: after starting a replay with zero listening time, `playCount=1` and
`lastPlayedAt` unchanged, while the shelf had already reordered.

---

## Store / reactivity change

One new store action, `noteReplayStarted(item)`, called from `PersonalizationHost` at the moment
the current track changes — for both the audio engine and the YouTube surface.

No polling, no interval, no storage read on render. The home shelf and the search dropdown both
derive from `state.updatedAt`, the store's existing change token, so the reorder propagates to
every subscriber in the same render.

---

## Persistence behaviour

`noteReplayStarted` goes through the same `commit` path as every other meaningful event, so it
persists once, immediately. Nothing was added to the playback tick path — a `timeupdate` at 4 Hz
still costs one number comparison and no storage traffic.

Meaningful events that write: replay start of an existing row, first qualification, completion,
skip, submitted search, consent change, clear/reset.

Verified live: after the reorder, a full reload restored the new order.

---

## Phase 5 compatibility

Both surfaces read **one canonical selector**. `recentlyPlayedSuggestions` delegates to
`recentShelf` and differs only in how many rows it takes.

That is load-bearing rather than tidy-minded: `recentShelf` is where the ordering, the YouTube
30-day retention purge *and* the embeddable / made-for-kids eligibility rules live. An earlier
draft of the dropdown built its own list from `recentlyPlayed()` and consequently offered a
made-for-kids video the home page correctly refused — caught by a test, and fixed by deleting the
second implementation rather than duplicating the rules into it.

A replay therefore reorders the home shelf and the dropdown together, and neither can drift.

---

## Files changed

**New (2):** `src/personalization/artwork.ts`, `src/personalization/artwork-and-order.test.ts`

**Modified (7):**

| File | Change |
| --- | --- |
| `personalization/types.ts` | `artworkMirrors`, `lastStartedAt`, both optional and documented |
| `personalization/storage.ts` | `safeOrigins()` validator; both fields allow-listed for read and write |
| `personalization/history.ts` | `displayRecency()`, `touchReplayStart()`; `recentlyPlayed()` sorts on display recency with a deterministic tie-break; artwork preserved across commits |
| `personalization/store.ts` | `noteReplayStarted` action |
| `personalization/config.ts` | `MAX_ARTWORK_MIRRORS` |
| `features/personalization/PersonalizationHost.tsx` | Captures mirrors; calls `noteReplayStarted` on track change |
| `components/personalization/HistoryCard.tsx` | Uses the shared `historyArtwork` resolver |

**Not touched:** provider architecture, search, YouTube quota handling, recommendation scoring,
the qualified-listen rule, the storage key, the schema version, `refe/`.

---

## Tests added

**23** in `artwork-and-order.test.ts`:

*Artwork* — mirrors persisted alongside the URL; written through the allow-list; origins validated
(http(s) only, full URL reduced to origin, non-strings and duplicates dropped, capped); artwork
preserved when a later response lacks it; **an old row repaired on replay**; no forbidden field
persisted now that mirrors exist; never artwork or mirrors on a YouTube row.

*Ordering* — initial order; replay moves to front immediately; no duplicate row; a not-yet-known
track is ignored; same-millisecond tie resolved toward the just-started item; flows through the
shared shelf selector.

*Signal protection* — no `playCount` increment; `lastPlayedAt` unmoved; `effectiveWeight`
identical; fifty replay starts change no weight; a genuine replay still counts once; an abandoned
replay keeps display recency but adds a skip, not a listen; display recency never goes backwards.

**E2E (in `search-dropdown.spec.ts`):** a history card renders a real `http(s)` image; replaying an
existing item reorders without a reload, creates no duplicate and survives a reload; a brand-new
track is absent at 5 seconds and first once it qualifies.

Two test doubles were corrected in the process, both of which had been hiding real gaps:

- `stubAudius` had **no `/v1/tracks/{id}` route**, so re-resolving an Audius row from Recently
  Played silently returned nothing. Added — after the named collection routes, because
  `/v1/tracks/trending` also matches "one segment after `/tracks/`".
- `seedPersonalization` re-seeded on **every** navigation, so a "the removal survived a reload"
  assertion would have passed without the app persisting anything. It now seeds only when the key
  is absent.

---

## Final unit/component count

**1180 passing, 67 files** (Phase 4 baseline 1093 / 64 — this fix contributed 23, Phase 5 the
remaining 64).

## Final E2E count

**245 passing, 15 skipped** (baseline 211; +34 across desktop and mobile projects).

---

## Live smoke

```
AUDIUS_SMOKE=1 JAMENDO_SMOKE=1 YOUTUBE_SMOKE=1 pnpm test:smoke
```

**Best observed: 26/26** — Audius 6/6, Jamendo 8/8, YouTube 12/12.

Across eight runs the result alternated between 26/26 and two *diagnosed, external* failure modes.
Neither was modified, hidden, or worked around.

**1. Audius — `ERR_SSL_PACKET_LENGTH_TOO_LONG`** on *"serves real audio bytes over a range request
from that URL"*. An OpenSSL record-layer error raised by a remote Audius content node; client code
cannot cause it. The same condition this codebase already documents and retries around
(`player-actions.ts` → `MAX_MEDIA_RETRIES`, `types.ts` → `Artwork.mirrors`), and the same condition
that produced this artwork bug in the first place. Nothing in the stream path imports anything from
`src/personalization/` — a repo-wide grep returns zero.

**2. YouTube — HTTP 429, daily quota exhausted** on five YouTube smoke assertions.
`[youtube] YouTube search answered HTTP 429.` The Data API allows 100 searches per day for the
whole deployment; this session spent them across repeated smoke runs and the live manual QA, whose
multilingual queries legitimately trigger one automatic fallback search each. This is the
documented quota model behaving correctly — the server surfaced 429 and the app's own quota-message
path is separately covered by an existing E2E test. It recovers when the quota resets.

---

## Manual QA

Real dev server, live Audius, real Chromium, real `localStorage`. **35/35 checks passed**
(shared with the Phase 5 walkthrough). The ones belonging to this fix:

| Check | Result |
| --- | --- |
| Recently Played cards carry real `http(s)` artwork, not the placeholder | PASS — `val004.open-audio-validator.com…` and `figment.io…` |
| Those images actually loaded (`naturalWidth > 1`) | PASS |
| Mirror origins persisted alongside the primary URL | PASS — 3 origins |
| Replaying an existing item moves it to first, no reload | PASS — `Van Snyder > Peak` ⇒ `Peak > Van Snyder` |
| No duplicate row | PASS |
| The replay start credited no qualified play | PASS — `playCount=1`, `lastStartedAt` moved |
| The new order survives a reload | PASS |
| Artwork survives the reload | PASS |
| Storage still contains no secret | PASS |
| Bottom player and Recently Played show the same song correctly | PASS |
| No page errors | PASS |

---

## Known limitations

1. **Artwork still depends on Audius content nodes being reachable.** The fix restores the failover
   chain; it cannot invent a working host. When every published mirror is down — which was the live
   state during part of this work — a card falls to the placeholder, exactly as a track card does.
   The correct claim is that a history card now renders *whenever any other card for the same track
   would*, and that is what the tests assert.
2. **Jamendo rows have no mirrors**, because Jamendo serves a single origin. Nothing to fail over
   to, and nothing lost.
3. **A row recorded before this change gains mirrors only when replayed.** No background repair is
   performed, deliberately: repairing every old card on Home would mean provider requests nobody
   asked for.
4. **`lastStartedAt` is not exposed in the UI** and is not used for anything but ordering.
