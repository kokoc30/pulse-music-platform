# Liked Songs — continuous collection playback

## Status

**PASS.** Liked Songs plays as a collection: a song ends and the next saved song
follows, across providers and across playback engines, and the saved list
outranks generated autoplay until it is genuinely exhausted.

All deterministic gates are green against a green baseline:

| Gate                 | Baseline                | After                                            |
| -------------------- | ----------------------- | ------------------------------------------------ |
| `pnpm typecheck`     | exit 0                  | exit 0                                           |
| `pnpm lint`          | exit 0                  | exit 0                                           |
| `pnpm test:run`      | 1941 passed / 102 files | 1993 passed / 104 files                          |
| `pnpm build`         | exit 0                  | exit 0                                           |
| `pnpm test:e2e`      | 466 passed, 32 skipped  | 488 passed, 32 skipped (22 new, 11 × 2 projects) |
| `pnpm verify:bundle` | exit 0                  | exit 0                                           |

No test was deleted, skipped or weakened. One existing assertion moved layer and
one immediate read became a polled one (both noted under **Playlist
regression**), and one stale comment was corrected.

Only the touched files were run through Prettier. `pnpm format:check` is not one
of the required gates and was already failing on the baseline — 161 files before,
146 after, because the files this change touched are now formatted. Nothing
unrelated was reformatted.

---

## Reported bug

> Your Library → Liked Songs, click a song, it plays. When it finishes, Pulse
> does not reliably move to the next song from Liked Songs.

Expected: a collection of `A B C D E`, clicked at `B`, plays `B → C → D → E`
automatically, and the next Liked Song outranks generated autoplay.

The behaviour was reproduced before anything was edited, in
`src/player/collection-playback.test.ts`. Four separate defects were behind the
one report, and each had a failing test written against the old implementation
first:

1. a YouTube item in the middle of the list was filtered out of the queue and
   silently skipped;
2. starting the list _on_ a YouTube item threw the rest of the list away;
3. starting from the middle rotated the list, so Repeat **off** wrapped round to
   the beginning;
4. a YouTube search session left open beforehand answered Next instead of the
   saved list.

---

## Existing LikedSongsPage behaviour

The page was already expressing the right intent and was **not** the bug. It
passed its _visible_ rows — the current sort and the current filter already
applied — with the clicked index and a stable context:

```ts
const play = (index) => playPlaylist(rows, index, { id: 'library:liked', label: 'Liked Songs' })
```

That is preserved exactly. The page's hero Play, hero Shuffle and every row click
still go through the same one call, and the context id and label are unchanged.

---

## Existing `playPlaylist` limitation

The old implementation had provider-specific behaviour, and it is the root of
three of the four defects:

```ts
const ordered = [...playable.slice(from), ...playable.slice(0, from)] // ① rotation

if (ordered[0].provider === 'youtube') {
  // ② whole list lost
  await playLibraryRef(ordered[0], context)
  return
}

const audioRefs = ordered.filter((r) => r.provider !== 'youtube') // ③ YouTube items dropped
// …resolve all of audioRefs, then setQueue(...)                        // ④ up to 100 lookups
```

- **①** rotating the array made Repeat off behave like Repeat playlist: clicking
  `C` in `A B C D E` produced the queue `C D E A B`, so after `E` the list
  quietly restarted at `A`.
- **②** starting on a saved video played that video alone. There was no
  continuation at all, and Next was answered by whatever YouTube search session
  happened to be open.
- **③** a video _inside_ the list was removed from the queue, so it was skipped
  without a word.
- **④** the whole list (up to 100 items) was resolved on one click.

The underlying reason for all of it: **the saved list had to become the audio
`Track[]` queue**, so it had to be something the audio engine could hold. A
collection is not that.

---

## Root cause

A saved list belongs to neither playback engine. Audius and Jamendo items play
through the single `HTMLAudioElement`; a YouTube item plays through YouTube's own
embedded player and can never be a `Track`. Because the only representation of
"what plays next" lived _inside_ the audio queue, any item the audio engine could
not hold was invisible to continuation — and the queue's own repeat/rotation
arithmetic was operating on a rotated copy of the list rather than on the list.

There was nothing above both engines that could answer _what did the visitor
actually ask to hear after this_.

---

## Collection-session architecture

New: `src/player/collection-session.ts` — one source of truth for explicit
collection playback, sitting **above** both engines.

```ts
CollectionSessionState {
  context:         { id, label } | null   // 'library:liked', 'playlist:pl_1', …
  items:           LibraryTrackRef[]      // snapshot of the visible collection
  order:           number[]               // running order: a permutation of item indices
  position:        number                 // position within `order` of what is playing
  queuePositions:  Record<trackId, position>
  queuedThrough:   number                 // how far the audio queue has been resolved
}
```

It answers exactly the questions §34 of the brief asks for: is a collection
active, which one, which item, what is next, what is previous, what running order
is in force.

**It holds references, never playable material.** `items` are
`LibraryTrackRef`s — provider, provider id, and the metadata a row needs. No
stream URL, no signed URL, no provider payload, no bytes. Resolution stays in the
library layer and reaches the session only through a registered `CollectionEngine`
(`{ play, topUp }`), which is what keeps provider code out of the player layer
and keeps the import graph acyclic:

```
player/collection-session.ts   ← knows order, position, repeat, precedence
        ▲                 registers
        │
library/collection-playback.ts ← knows providers, resolution, engine routing
        │
library/resolve.ts             ← turns one saved ref into a Track
```

`library/resolve.ts` was split out of `library-actions.ts` so the one-off play
path and the collection engine can both use it without importing each other.

### The advance precedence

`playNext` now reads:

1. **Repeat one** — replay the current track (natural end only).
2. **The explicit audio queue**, in the running order in force.
3. **The collection session** — the next _saved item_, routed to whichever engine
   owns it, including the Repeat-playlist wrap of that collection.
4. **Repeat playlist over the queue** — only when no collection is playing.
5. **Generated autoplay**, when the preference is on.
6. **Stop**, with the standard notice.

Step 3 is the fix. The wrap is split between 3 and 4 because while a collection
is playing, Repeat playlist means _that collection_, not the resolved window of
it the queue happens to hold — so step 2 is asked with the wrap suppressed and
the collection performs it.

---

## Why this is not the audio queue

The audio `Track[]` queue holds resolved, playable catalogue tracks. It is now a
**materialization** of the part of the session the audio engine can reach right
now: the current item plus a bounded look-ahead, stopping at the first YouTube
item in the running order.

`setOrderedQueue` was added to the player store for this. It is `setQueue` plus
one thing: it clears `shuffleOrder`. The collection owns the permutation and
materializes the queue already in it, so a queue-level running order on top would
shuffle an already-shuffled list — and would redraw it on every top-up, since
each append changes the queue length.

A `shuffleOrder` whose length does not match the queue is treated as absent by
`effectiveOrder`, so the queue plays straight through while the visitor's own
Shuffle toggle stays exactly as they left it.

## Why this is not the YouTube search session

A page of search results and a saved list are different things with different
continuations, and the same video reached from each is two different situations.
`collectionOwnsItemKey` decides, by comparing the loaded item's id against the
saved ref at the session's current position — the two are the same string,
`youtube:<videoId>`, so origin needs no flag that could go stale.

When a collection routes a video, `clearSession()` is called first. That is what
stops an old search hijacking library Next, and it also means a collection
transition can never spend a `search.list`.

---

## Click-row semantics

Click `C` in `A B C D E` → session snapshot `A B C D E`, position at `C`.
Playback runs `C → D → E` and stops (Repeat off). It does **not** rotate to
`A B`. The items behind the start stay in the session so Previous can reach them
and so Repeat playlist can wrap to the true beginning of the list.

## Play-button semantics

`Play` sets shuffle off and calls the same `playPlaylist(rows, 0, CONTEXT)` a row
click calls. There is one implementation, not two.

## Shuffle semantics

`Shuffle` sets shuffle on and calls the same `playPlaylist` the other two paths
call. There is no separate shuffle implementation.

One permutation of the **whole visible snapshot** is drawn when the session
starts, from the player's existing seeded `shuffledOrder`, and is never redrawn.
Every item appears exactly once. Next and Previous follow that exact order,
across an engine change. The persisted Liked Songs order and the rows on screen
are untouched.

The chosen row is pinned first, shuffled or not — `shuffledOrder` already places
`currentIndex` at the head and Fisher–Yates the rest. A row click named the song
that must play now; a press of Shuffle over a list still starts at the top of the
list the visitor is looking at, and what shuffle changes is everything after
that. This also keeps the existing, tested behaviour that pressing Shuffle twice
within a session reproduces the same running order.

**Known behaviour:** toggling the bar's Shuffle control _mid-session_ re-orders
the remaining materialized audio run at the queue level. The collection's own
cross-engine order stays as drawn. Starting the collection with Shuffle already
on — the path both hero buttons take — is unaffected.

## Sort/filter snapshot semantics

Playback follows the **rows as they are on screen**. `rows` already carries the
chosen sort and the current filter, and that list, in that order, is what is
snapshotted.

- Sorted by Title showing `C A B`, click `C` → `C → A → B`.
- Filtered to `B D E`, click `B` → `B → D → E`. Nothing hidden is inserted.

The snapshot is taken once, when playback starts. Liking, unliking, changing the
sort, typing in the filter or navigating away afterwards does **not** rewrite the
running session; the new state applies the next time playback is started.

Liked Songs and playlists deliberately differ here, and the difference is what the
list _is_. A playlist has one curated order the visitor built by hand and can
reorder — filtering it is a way of finding a row in that order, which is why the
page says "Reordering is available in the full list" and why playback maps a
clicked row back to the stored order. Liked Songs has no authored order at all: it
is presented through a sort control and a filter, so the arrangement on screen
_is_ the collection. Existing playlist behaviour is unchanged.

## Natural-end behaviour

`C` ends → `D` → `E` → collection exhausted. Then, in order: Repeat one (ahead of
everything, natural end only), the collection continuation, the Repeat-playlist
wrap of the collection, generated autoplay if the preference is on, otherwise a
clean stop with the existing notice.

## Manual Next behaviour

`skipToNext` is unchanged in intent and uses the same collection advancement, with
the one existing distinction preserved:

|                              | Repeat one  |
| ---------------------------- | ----------- |
| natural end on `B`           | replays `B` |
| **user presses Next** on `B` | goes to `C` |

The recent Next fix is not regressed; `next-semantics.test.ts` passes untouched.

## Manual Previous behaviour

Unchanged algorithm. The existing "restart the current track when several seconds
in" convention (`PREVIOUS_RESTART_THRESHOLD_SECONDS = 3`) is preserved. What was
added is one fall-through: when the _queue_ has nothing behind it but the
collection does — because the window behind the listener was a later run, or a
YouTube item they stepped past — Previous asks the collection rather than giving
up.

## Repeat behaviour

| Mode             | Behaviour                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Off              | `A B C` → collection ends → autoplay if on, else stop. No silent wrap.                          |
| Playlist         | `A B C` → `A`. Wraps the **whole** collection, including items behind the row that was clicked. |
| One, natural end | `B` → `B`                                                                                       |
| One, user Next   | `B` → `C`                                                                                       |

Repeat is not consulted for a _video_ beyond the wrap the collection already
performs: the YouTube surface offers no repeat control (`capabilities.repeat` is
`false`), so acting on Repeat one there would apply a setting the visitor cannot
see from that player. Documented rather than silently inconsistent.

## Unavailable-item handling

One bounded attempt per item, and the cursor steps **before** the attempt so the
same item can never be retried inside one advance. `MAX_UNAVAILABLE_SKIPS = 5`
consecutive failures, plus a one-lap `seen` guard so a Repeat-playlist collection
of entirely dead items cannot circle for ever.

- `A` playable, `B` withdrawn, `C` playable → `A` ends → `B` asked once → `C`.
- A row that is itself unavailable does not stop the click: the same bounded walk
  finds the first playable item at or after it.
- Nothing playable at all → the existing honest notice, and the session ends.
- An unavailable item inside the resolved window is simply absent from the queue:
  one attempt, no retry, list unaffected.

## Mixed-provider handling

`Audius A`, `YouTube B`, `Jamendo C`, started at `A`:

- `A` ends → the session says `B` → routed to the YouTube engine.
- If the visibility rules permit a scripted start (`mayAutoplay`: document
  visible **and** more than half the player on screen, measured by the existing
  `IntersectionObserver`), `B` plays.
- If they do not — not observed yet, insufficiently visible, or a hidden document
  — `B` is **cued** in the visible player and waits for a press. It is never
  skipped silently and never started behind the visitor's back.
- `B` ends → the session says `C` → the audio engine takes the claim back and
  `C` plays. No second Library click.

`YouTube → Audio` and `Audio → YouTube` are both covered by tests, including the
hidden-document case. The existing background restriction is untouched: a hidden
document still cues rather than plays, and the item is not skipped to keep audio
going.

An expired or non-embeddable saved video is treated as unavailable and stepped
over by the ordinary bounded rule. The `≤ 30-day` retention rule
(`canPlaySavedYouTubeRef`) is re-checked at play time, not only at render time,
and nothing re-searches YouTube to replace it.

## YouTube-origin priority

| Video started from | Next means             |
| ------------------ | ---------------------- |
| Search results     | the next search result |
| Liked Songs        | the next Liked Song    |
| A Pulse playlist   | the next playlist item |

Enforced in three places, all reading the same `collectionOwnsCurrentVideo`:
`playYouTubeSessionStep` (a press), `advanceYouTubeSession` (a natural end), and
`hasYouTubeSessionStep` / the playback snapshot (whether the control is lit).
`ensureYouTubeSessionDepth` returns early for a collection-owned video, so a saved
list never prefetches.

## Search-seed regression protection

Untouched and protected. `playSeedTrack` still builds a one-track queue under a
`search:<query>` context, so a search click is still a single seed followed by
Phase 6 autoplay — never the next search row. `search-seed-autoplay.test.ts` and
`search-seed-continuation.spec.ts` pass unchanged, and a new test asserts that
starting a search seed **ends** any running collection so it cannot resurface
three tracks later.

The general rule: `playTrack` clears the collection whenever the resolved queue
context id differs from the collection's, and `unifiedPlay` clears it when called
with no context at all (Recently Played, a single saved item).

## Playlist regression

Playlists now use the same collection layer, and every existing test in
`PlaylistPlayback.test.tsx` passes. Three edits, none a weakening:

- A comment saying the continuation wraps round was **corrected** — it no longer
  does, which is the point — and the assertion was tightened from two indexed
  checks to a full `toEqual(['Paper Lanterns', 'No Artwork Here'])`.
- _"holds one running order for the session"_ now asserts the collection's
  `order` is stable across an advance, and additionally that the queue order is
  stable. The property under test is unchanged; it is asserted at the layer that
  now owns the running order, and the test is strictly stronger than before.
- In `library.spec.ts`, _"the shuffled running order is stable within the
  session"_ read the bar's text immediately after pressing Next. That is now a
  polled assertion. This is a **real timing change** the look-ahead introduces
  and worth stating plainly: an advance that reaches past the resolved window
  costs one provider lookup before the bar can name what it landed on, where the
  previous implementation had already resolved the whole list. The assertion
  itself — that Next lands somewhere different — is unchanged.

Playlists gain the mixed-provider fix for free: a playlist holding a saved video
now continues _through_ it rather than around it.

The E2E viewport helpers (`openQueue`, `closeQueue`, `nextTrack`, `canGoNext`,
`playbackModes`) moved from `library.spec.ts` into `fixtures.ts` so the new spec
could use them rather than keep a second copy of "where is the queue button at
this width". `library.spec.ts` imports them and is otherwise untouched.

## Home shelves — audit only

No change. `playFromShelf` still gives the whole shelf to the queue (collection
semantics) and `playSeedTrack` still gives search rows a single seed
(seed semantics). Both pass a context, so both cleanly end a running collection.
`playShelf.ts` is untouched.

## Media Session

No special lock-screen library logic. `MediaSessionHost` already binds
`nextTrack: () => void skipToNext()` and `previousTrack: () => void playPrevious()`,
which are the same central actions the bar and the sheet call — so the collection
continuation reaches the lock screen and hardware transport keys by construction.
Metadata updates through the existing `playTrack` path when the next saved song
starts. The session stays cleared while YouTube holds the engine, as before.

## Provider request budget

| Action                      | Requests                                                 |
| --------------------------- | -------------------------------------------------------- |
| Rendering Liked Songs       | 0                                                        |
| Clicking one row            | 1 for that item, then a bounded look-ahead behind it     |
| Advancing within the window | 0                                                        |
| Topping the window up       | at most `COLLECTION_LOOKAHEAD − ahead`, at concurrency 4 |
| Any collection transition   | 0 YouTube `search.list` — asserted in E2E                |

- `MAX_COLLECTION_ITEMS = 100` — the snapshot cap (was `MAX_PLAYLIST_QUEUE`).
- `COLLECTION_LOOKAHEAD = 24` — resolved ahead of the listener, topped back up as
  playback advances. Replaces resolving the entire list on one click.
- `RESOLVE_CONCURRENCY = 4` — unchanged.
- `MAX_UNAVAILABLE_SKIPS = 5` — unchanged in value, now enforced centrally in the
  session for every transition rather than only on the first item.

Playback still begins before the look-ahead resolves, and the continuation is
applied only while the track it was built for is still loaded — a visitor who
presses Next during the lookup keeps their choice.

## Up next

The queue panel shows the resolved catalogue window, then — in the same panel,
under a _"Later from Liked Songs"_ heading — the saved items the collection will
reach next: the ones beyond the resolved window, and the YouTube items no audio
queue can hold. Both halves are the same running order, in order. Reading them
costs nothing: the references are already in memory.

Generated autoplay appears in neither, because it is consulted only once both have
run out. The context line still reads _"From Liked Songs"_.

---

## Files changed

**New**

| File                                               |                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/player/collection-session.ts`                 | The collection session: order, position, precedence, bounded advance.                 |
| `src/library/collection-playback.ts`               | Resolution, engine routing, the look-ahead window.                                    |
| `src/library/resolve.ts`                           | Saved ref → `Track`, split out so the two library modules need not import each other. |
| `src/player/collection-playback.test.ts`           | Session and routing tests, including the four reproductions.                          |
| `src/features/library/LikedSongsPlayback.test.tsx` | Page-level tests: the page is wired to the session.                                   |
| `tests/e2e/liked-songs-playback.spec.ts`           | 11 Playwright tests × 2 projects = 22.                                                |

**Changed**

| File                                             |                                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `src/player/player-actions.ts`                   | Collection step in `playNext`; collection fall-through in `playPrevious`; cursor sync and context clearing in `playTrack`. |
| `src/player/player-store.ts`                     | `setOrderedQueue`.                                                                                                         |
| `src/player/player-selectors.ts`                 | `selectCanSkipNext` / `selectHasPrevious` accept a collection destination.                                                 |
| `src/player/youtube-actions.ts`                  | Collection owns Next, natural end, control state and prefetch for a saved video.                                           |
| `src/player/unified-actions.ts`                  | A context-free `unifiedPlay` ends the collection.                                                                          |
| `src/player/use-playback-snapshot.ts`            | `canNext` / `canPrevious` honour the collection on both engines.                                                           |
| `src/library/library-actions.ts`                 | `playPlaylist` delegates; resolution moved to `resolve.ts`.                                                                |
| `src/features/library/LikedSongsPage.tsx`        | Documents that the visible rows are the collection. No behaviour change.                                                   |
| `src/features/library/PlaylistPage.tsx`          | Documents the filtered-view difference. No behaviour change.                                                               |
| `src/components/queue/QueuePanel.tsx`            | Shows the rest of the collection.                                                                                          |
| `src/styles/additions.css`                       | `.queue-later`.                                                                                                            |
| `src/test/render.tsx`                            | Resets the collection session between tests.                                                                               |
| `src/features/library/PlaylistPlayback.test.tsx` | Corrected comment, strengthened assertions.                                                                                |
| `tests/e2e/fixtures.ts`                          | Viewport-aware transport helpers, lifted from `library.spec.ts`.                                                           |
| `tests/e2e/library.spec.ts`                      | Imports those helpers; one immediate read made polled.                                                                     |

---

## Unit / component results

```
Test Files  104 passed (104)
     Tests  1993 passed (1993)
```

Baseline was 102 files / 1941 tests. The 52 added tests are the collection suite
(`src/player/collection-playback.test.ts`) and the Liked Songs page suite
(`src/features/library/LikedSongsPlayback.test.tsx`), which together run 52 cases
across the two new files.

Coverage of the brief's numbered cases: §36 audio liked songs, §37 click middle,
§38 Play button, §39 sort order, §40 filtered order, §41 shuffle, §42 repeat (all
four modes), §43 unavailable item, §44 mixed providers, §45 YouTube liked origin,
§46 playlist regression, §47 search regression, §49 manual queue.

## E2E results

```
488 passed, 32 skipped
```

`tests/e2e/liked-songs-playback.spec.ts` runs the full product flow of §50 in a
real browser against a real WAV, so the `ended` event is the browser's own:
like three playable songs across two catalogues → open `/library/liked` →
confirm three rows → click the first → confirm it becomes current → let it end →
confirm the second → let it end → confirm the third → confirm the context is
Liked Songs → confirm Next stays enabled → confirm autoplay has not replaced the
collection. Then clicking the second row directly, confirming the third follows,
and confirming Repeat off does not wrap back to the first. Plus sort order,
filtered order, unliking the playing song, and a zero-YouTube-quota assertion.

## Mobile emulation

The suite runs under both configured projects, `chromium-desktop` and
`chromium-mobile`. `tests/e2e/liked-songs-playback.spec.ts` additionally pins a
390 × 844 viewport for §51: click the first liked song → bottom player →
expand Now Playing → let the track end → the sheet **stays open**, its metadata
updates to the second liked song, and again to the third. No layout regression;
`mobile.spec.ts` and `unified-now-playing.spec.ts` pass unchanged.

## Physical-device status

**Not verified on a physical device.** No hardware was available in this
environment. Lock-screen and hardware-transport behaviour is covered indirectly:
`MediaSessionHost` binds the OS actions to `skipToNext` and `playPrevious`, the
same functions the on-screen controls call and the same ones these tests drive,
so there is no separate code path that could behave differently — but the OS
integration itself is untested here and should be checked on a real device.

---

## Known limitations

1. **Shuffle toggled mid-collection.** Turning the bar's Shuffle control on while
   a collection is already playing re-orders the remaining _materialized audio
   run_ at the queue level; the collection's own cross-engine order stays as
   drawn at the start. Starting with Shuffle already on — what both hero buttons
   do — is unaffected.
2. **A collection ending on a YouTube item stops rather than generating.** Phase 6
   autoplay is seeded from catalogue metadata, and deriving an audio
   recommendation from YouTube API data is what §III.E.4.h prohibits. The bar
   shows the standard "no more tracks" notice instead.
3. **Repeat is not applied to a saved video** beyond the collection wrap, because
   the YouTube surface exposes no repeat control.
4. **The snapshot is capped at 100 items.** A longer collection plays its first
   hundred from the chosen row; the rest stay visible and are reachable by
   starting from a later row.
5. **Nothing is persisted.** The session is session-only by design: a reload has
   no active queue and no active collection. Liked Songs themselves persist
   exactly as before.
6. **Filtered playlists still play the stored order**, deliberately, unlike Liked
   Songs. The reasoning is documented above and in `PlaylistPage.tsx`.
