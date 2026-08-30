# YouTube collection hand-off and expanded player UI — corrective pass

## Status

**Complete for everything that can be verified here.** Two defects reported from a real
phone are fixed, reproduced by tests written before the source was touched, and covered
by 17 new unit tests and 22 new end-to-end tests. Every deterministic gate passes:

| Gate                                     | Result                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`                         | pass                                                                                                                     |
| `pnpm lint`                              | pass (0 warnings, `--max-warnings 0`)                                                                                    |
| `pnpm test:run`                          | **2011 passed**, 105 files (baseline 1993)                                                                               |
| `pnpm build`                             | pass                                                                                                                     |
| `pnpm test:e2e`                          | **515 passed**, 29 skipped (baseline 452 passed / 36 failed after the change, all of which encoded the old architecture) |
| `pnpm verify:bundle`                     | pass — 0 secret matches                                                                                                  |
| `pnpm format:check` (touched files only) | pass                                                                                                                     |
| module cycles (`madge --circular`)       | none                                                                                                                     |

Two things in this report are **not** claimed: physical-device QA and the Vercel
deployment. See _Physical-device QA_ and _Vercel status_ at the end.

No test was deleted and no assertion was weakened to manufacture green. Nineteen unit
tests and thirty-six E2E tests were **rewritten**, because each of them asserted the
architecture this pass replaces; every rewrite is called out where it happens, in the
test's own comment, with what it used to claim and why that claim was the defect.

---

## Real-device screenshot findings

The screenshot showed Liked Songs playing `Kosandra` (Audius) → `Tangarjhek Manyak`
(YouTube) → a third saved song, on a phone, with Now Playing expanded over the video.
Two things were wrong at once.

**The top half** was the expanded Now Playing panel: title, channel, heart, menu,
progress rail, Previous, a large Play, Next.

**The bottom half**, simultaneously visible, was the player bar: a large YouTube video,
the same title, another heart, another Play button, and a close cross.

So the screen carried **two complete transports over one video**. And reaching that
screen at all required the visitor to notice that the song had changed and then swipe
up, because the video had been _cued_ rather than started.

---

## Bug A — collection hand-off

### The behaviour

Liked Songs holding `Audio A, YouTube B, Audio C`. A ends naturally. The
`CollectionSession` correctly advances to B, the metadata changes to B — and B does not
play. The visitor is left on the page they were browsing, with a title that has changed
under them and a video docked at the bottom waiting for a press they have no reason to
expect.

### Why automatic YouTube hand-off was cued

Not "an autoplay issue". The exact cause, found by reproduction:

`src/library/collection-playback.ts` → `playYouTubeCollectionItem` called

```ts
playYouTubeVideo(item, {
  userInitiated: request.userInitiated,
  visibleRatio: youTubeVisibleRatio(), // ← read here
  documentHidden: documentHidden(),
})
```

`youTubeVisibleRatio()` was read **at the instant the collection decided B was next** —
which is before anything has been revealed. Coming from a catalogue track, at that
instant:

- the YouTube engine holds no claim,
- `useYouTubeStore.item` is still null, so `PlayerBar` renders no stage,
- no `YouTubeStageHost` is mounted, so no `IntersectionObserver` exists,
- and `youtube-visibility` is at its module default, which is **zero** — deliberately,
  because "nothing has been observed" must never authorise autoplay.

That zero was then passed to `mayAutoplay` as though it were a measurement.
`mayAutoplay` did exactly what it is supposed to do with a ratio of zero: it refused.
`playYouTubeVideo` cued the video and set `awaitingUserPlay`.

So the policy check was correct and the _input_ to it was a fiction. The value did not
describe a player that was not visible; it described the absence of a player. The two
were indistinguishable because a single number carried both meanings.

### Visibility timing / root cause

Stated as one sentence: **the measurement was taken before the thing it measures
existed, and "unmeasured" and "measured as invisible" were the same value.**

Two changes follow from that, and only the second is a behaviour change:

1. `youtube-visibility.ts` now tracks `measured` alongside `ratio`. "There is no player
   yet" and "the player is off screen" are no longer the same state. Nothing in the
   policy check changed: an unmeasured surface still resolves to _do not autoplay_.
2. The decision is deferred until after the reveal.

### Reveal → measure → play architecture

`playYouTubeVideo` and `playSessionItem` are now explicitly three-phase:

```
PHASE 1 — REVEAL
  store.openWith(item, …)              mounts the stage, and with it the observer
  prepareYouTubePlaybackSurface(reason) takes the engine claim; opens the expanded view
  notePlayed(item.id)

PHASE 2 — MEASURE                       (resolveAutoplay)
  userInitiated            → true, no wait; a gesture needs no measurement
  documentHidden           → false, no wait; nothing an observer says could permit it
  caller supplied a ratio  → use it; a running player has already been measured
  otherwise                → await waitForYouTubeVisibility({ minimumRatio: 0.5 })

PHASE 3 — START OR CUE
  mayAutoplay(…)  → engine.play(item, { userInitiated: autoplay })
  otherwise       → the item is cued, awaitingUserPlay, with one Play button
```

`waitForYouTubeVisibility({ minimumRatio, timeoutMs })` lives in
`src/player/youtube-visibility.ts`. It resolves:

- **immediately**, when the current measurement already clears the bar (a video
  following a video costs nothing);
- on the **first real observation** that clears it;
- or on **timeout**, carrying whatever was last actually measured.

`VISIBILITY_SETTLE_TIMEOUT_MS = 700` — long enough for a mount plus the expanded view's
260ms rise on a slow device, short enough that nobody sits in front of a stalled player.
It is bounded: there is no polling, no retry loop and no unbounded wait. The waiter is
also resolved (as _not visible_) if the stage unmounts underneath it.

**No ratio is invented anywhere.** The number that reaches `mayAutoplay` is either one
the caller measured or one an `IntersectionObserver` reported on the real stage element.
`documentHidden` is never hard-coded; it is re-read after the wait, because the visitor
may have switched away while the surface was being revealed.

### One further defect the fix exposed: a request race in the engine

Deferring `engine.play` behind a wait revealed a latent race. The stage cues the loaded
item when it mounts, so a remount does not lose the video; the hand-off then plays it a
moment later. Both operations are several awaits long (build the player, wait for the
script, call the API), so they interleaved — and the _cue_ landed after the _play_.
`cueVideoById` arrived on top of `loadVideoById` and silently stopped a video that had
just started: the player sitting on a thumbnail while the store said `playing`.

`createYouTubeIframeEngine` now serialises its requests. One runs at a time, and a
request a newer one overtook while it waited its turn is dropped rather than applied
late. A separate `loaded` field tracks what the _player_ holds, as distinct from
`current` — what the last caller _asked for_ — so "resume this video" and "load this
video" are still told apart correctly while a request is queued.

### Central presentation control

`prepareYouTubePlaybackSurface(reason)` in `src/player/youtube-actions.ts` is the single
place the player's surface is prepared:

```ts
export type YouTubePresentationReason =
  | 'user-selection' // a press on a video   → open the expanded player
  | 'collection-transition' // a saved list arrives → open the expanded player
  | 'session-step' // Next inside a session → leave the surface alone
  | 'restore' // a remount            → move nothing
```

There is **no** `setNowPlayingOpen(true)` anywhere else in the playback path. The
library layer asks for a _reason_; what a reason does to the screen is decided once,
here (agents/32). Nothing in a background store change can open the view.

---

## Bug B — duplicate controls

### Existing stage-in-PlayerBar architecture

The YouTube embed must be mounted and at least 200 × 200 while it plays
(Required Minimum Functionality; `docs/youtube-policy-audit.md` §4), and reparenting an
iframe reloads it. So the stage needed one permanent home, and it had had two:

1. **In `NowPlayingSheet`.** Correct for the policy, wrong for the product: the sheet is
   closed most of the time, so it had to be _forced open_ before a video could play at
   all — pressing a YouTube result took over the screen where an Audius result simply
   started the bar.
2. **In `PlayerBar`'s artwork slot.** This fixed (1) and caused the screenshot.

### Why it produced two visible player presentations

Trace, exactly as it stood:

- `PlayerBar` rendered `<div class="player-stage"><YouTubeStageHost/></div>` in the slot
  a 56px cover occupies, at the documented 200px floor. On a 390px phone that made the
  bar roughly **216px tall** — a black video card wedged into a mini-player — and the
  bar also carried its own heart, seek rail, Previous, Play, Next and close cross.
- `PlayerBar` measured itself with a `ResizeObserver` and published
  `--player-bar-height`.
- `now-playing.css` consumed that variable:
  `.now-playing-scrim[data-engine='youtube'] { padding-bottom: calc(var(--player-bar-height) + var(--frame-gutter)) }`.
  The expanded panel was **inset by the bar's height** — deliberately laid out to stop
  short of the bar rather than cover it, because covering it would have hidden the very
  player the policies require to stay displayed.
- `NowPlayingSheet` therefore rendered its own complete transport — title, heart, menu,
  progress rail, Previous, large Play, Next — directly above a bar that still had all of
  those, plus the video.

So: **PlayerBar transport + NowPlayingSheet transport + PlayerBar YouTube stage, all on
screen at once.** Two Play buttons, two Next buttons, two Previous buttons, two hearts,
two progress rails, two title blocks. Not a styling slip — a direct, inevitable
consequence of "the player lives in the bar, so the sheet must not cover the bar".

The same layout also made the expanded view non-modal for a video (no scrim, no scroll
lock, `aria-modal` withheld), because the page behind had to stay reachable while the
bar held the player. And hiding the bar with CSS would not have helped: every one of its
controls would have stayed in the Tab order and in the accessibility tree.

---

## New stable iframe ownership

The stage belongs to **neither** presentation. It is a stable child of a player shell
that owns both, mounted once by `GlobalPlayer` and never moved:

```
GlobalPlayer
  └── .player-shell   data-mode="collapsed" | "expanded"
        ├── CollapseHandle      (expanded only — grab strip + chevron)
        ├── .yt-stage-frame     ← the stage. Same DOM node, always.
        │     └── YouTubeStageHost → yt-stage-mount → the API-created iframe
        └── PlayerBar  (collapsed)  |  NowPlayingSheet  (expanded)
```

Exactly one of the two subtrees exists at a time. **Not hidden — not rendered**, which
is what makes "one Play button" true of the accessibility tree and the Tab order as well
as of the pixels.

The stage sits at a fixed slot in the React children array, so:

- toggling `CollapseHandle` at the slot before it is an `insertBefore` against the stage,
  which does not move the stage node;
- swapping `PlayerBar` for `NowPlayingSheet` at the slot after it is an append, which
  does not move the stage node either.

Only the stage's **box** changes, in `src/styles/player-shell.css`. No reparenting, no
remount, no reload.

## Collapsed layout

`.player-shell[data-mode='collapsed']` is a fixed column at the bottom of the viewport:
the docked stage, then the mini-player.

- **The bar is a mini-player again.** The same compact row for every provider: expand
  chevron, 56px artwork, title and channel, heart, transport, seek rail, dismiss cross.
  A video's slot holds _its own unmodified 16:9 still_ from `i.ytimg.com` — the live
  player is elsewhere. On a phone the bar is back to `--player-height-sm` (76px) from
  roughly 216px, and an E2E test asserts it measures under 140px.
- **The live player is docked directly above it**, as a 356 × 200 card: 16:9 at the
  documented height floor, right-aligned on a desktop, full-bleed above the bar below
  560px. `--yt-stage-docked-width` is the token.
- `pointer-events: none` on the shell with `auto` on its two children, so the empty
  column beside the docked card does not swallow clicks meant for the page.

**Why the collapsed player is not shrunk to thumbnail size.** Required Minimum
Functionality states _"Embedded players must have a viewport that is at least 200px by
200px"_ (`docs/youtube-policy-audit.md` §4, confirmed verbatim). This project treats
that as a hard floor, not a recommendation, and this pass does not weaken it. A live
player therefore cannot be 56px. The compliant compact answer is the one taken: the
_bar_ is compact, and the player is a small docked card beside it rather than inside it.

One incidental fix fell out of this. Below 560px `.music-player` was a two-column grid
with three children, so `.player-aside` — which holds the dismiss cross — wrapped onto a
row of its own and the cross floated under the bar attached to nothing. Invisible while
the bar was 216px of video; obvious once it was a compact row. The template is now
`1fr auto auto`.

## Expanded layout

`.player-shell[data-mode='expanded']` is the panel itself, with a real scrim behind it:

```
┌─────────────────────────────┐
│            ━━━              │  grab strip (the only swipe-down zone)
│             ⌄               │  collapse chevron  (focus lands here)
│  ┌───────────────────────┐  │
│  │   OFFICIAL YOUTUBE    │  │  .yt-stage-frame — 16:9, min 200px, max 760px
│  │        VIDEO          │  │
│  └───────────────────────┘  │
│ Tangarjhek Manyak      ♥ ⋯  │  title / channel / YouTube backlink
│ Aram Asatryan - Topic       │
│ 0:00 ━━━━━━━━━━━━━━━ 6:13   │  one Pulse progress rail
│       ◀     ❚❚     ▶        │  one Pulse transport
│        secondary actions    │
└─────────────────────────────┘
```

- **Mobile (≤768px):** the whole viewport, `height: 100dvh` — `dvh`, not `vh`, because a
  phone's address bar changes the viewport as it scrolls and `100vh` is exactly how a
  Play control ends up under browser chrome. Safe-area insets on the handle (top) and
  the padding (bottom).
- **Desktop:** a centred bottom-anchored panel. `min(560px, 100%)` for a track;
  `min(820px, 100%)` when the stage is a video, so a 16:9 player gets the width the
  IFrame API recommends (480 × 270 and up) and the view reads as one coherent Now
  Playing screen rather than a narrow sheet with a video squeezed into it. An E2E test
  asserts the rendered stage is ≥480px wide and 16:9.
- **Short landscape (`max-height: 520px` and `orientation: landscape`):** stacked, the
  video's 200px floor pushes the transport below the fold. The YouTube layout becomes a
  two-column grid — handle across the top, video left, title/scrubber/transport right —
  so everything is on screen at once. The stage's DOM position is unchanged; it is the
  same element in a different grid area, which is precisely what being a sibling buys.
- The panel scrolls internally (`overflow-y: auto`) rather than compressing controls
  below a usable size.

Also fixed here: `can.continuous` was true for every video, so the secondary row
rendered while `ContinuousPlayToggle` self-gated to `null` — a stray divider across the
expanded view with nothing under it. The rule ("a standalone video has no result list to
continue into") now lives once, in `capabilities`, where it belongs.

## One-iframe guarantee

Enforced structurally rather than by convention: `YouTubeStageHost` is rendered from
exactly one place in the codebase — `GlobalPlayer` — and only when
`snapshot.isEmbeddedStage`. `PlayerBar` and `NowPlayingSheet` no longer import it.

Asserted at every point:

- unit — `document.querySelectorAll('iframe[title="YouTube video player"]').length === 1`
  before, during and after a full expand → collapse → expand round trip;
- unit — `screen.getAllByTestId('youtube-stage')` has length 1 in both presentations, and
  is the **same node** (`toBe`) each time;
- E2E — `page.getByTestId('youtube-stage')` has count 1 throughout, and the doubled
  IFrame API's `created` / `destroyed` counters are unchanged across the round trip.

## IFrame lifecycle

`attach` on mount, `detach` on unmount, and nothing in between. Expanding and collapsing
do neither: they change `data-mode` on an ancestor, which changes CSS. The stage's own
effects — the engine-event binding, the `visibilitychange`/`focus` handlers, the
`IntersectionObserver`, the engine attachment — each run once for the life of the stage,
and a unit test asserts the observer count is unchanged across a round trip, so no
listener is registered twice.

## Player identity across expand/collapse

Pinned in three ways: the DOM node (`toBe`), the engine's player object
(`youtube.current()` is the same instance), and `factory.created === 1`. Position
survives (`currentTime` 73 before and after), and so do the collection session and the
active engine.

## CollectionSession preservation

Untouched. `collection-session.ts` still imports only `zustand`, a library _type_, and
`queue-order`; it imports no React and no component. `madge --circular` reports no
cycles. `collectionOwnsCurrentVideo()` and the collection-aware stepping in
`playYouTubeSessionStep` / `advanceYouTubeSession` are unchanged.

The regression from §50 is covered twice — unit and E2E: with a stale search session
`Y1, Y2, Y3` open and Liked Songs holding `A, Y2, C`, playing A and letting it end
reaches Y2; pressing **Next** then plays **C**, not Y3.

## Audio → YouTube

`advanceCollection` → `playCollectionItem` → `playYouTubeCollectionItem`, which now
passes **no** `visibleRatio` and `reason: 'collection-transition'`. The three phases run,
the expanded player opens, the observer reports on the stage that has just appeared, and
the video starts if the measurement permits. If it does not, the item is cued in a
_visible_ player with one obvious Play button. It is never skipped.

## YouTube → Audio

`advanceYouTubeSession` sees `collectionOwnsCurrentVideo()` and calls
`advanceCollection`, which routes the next saved item to the audio engine. If the
expanded view is open it **stays open and changes in place**: the large cover appears
where the video was, the stage unmounts, and no surface closes or reopens. Asserted in
both suites.

## Like / Library

One `LikeButton` in the expanded view, one in the mini-player, and never both on screen —
because only one presentation is rendered. Both use the same `snapshot.toLibraryRef` and
the same `useLibraryStore`, so there is no second copy of "is this liked" to diverge.
One `TrackMenu`, on the same reference.

## Up Next

Unchanged, and still correct for a collection: `remainingCollectionItems()` is what the
queue panel reads, so a collection that continues past the resolved audio window still
shows the saved items ahead. No second queue was built. The _Up next_ button is withheld
for a video (`can.queue` is false) because a video has no audio queue to show — the
collection's own continuation is what `canNext` reflects, and it is collection-owned.

## Accessibility

- The expanded surface is `role="dialog" aria-modal="true" aria-label="Now playing"`,
  for **both** engines. It used to withhold `aria-modal` for a video because the page
  behind really was reachable; it no longer is, so the attribute is now honest.
- Focus moves to the collapse control on open. On close it returns to the element it came
  from when that element still exists, and otherwise to the mini-player's expand chevron —
  which is the ordinary case, because that chevron is unmounted while the view is open.
  A keyboard visitor ends up back on the control they pressed rather than on `<body>`.
- Escape collapses.
- **No hidden duplicate controls.** The mini-player is not rendered while the expanded
  view is up, so nothing of it is focusable, announced, or reachable by Tab. A unit test
  walks every `Next track`, `Previous track` and `Open Now Playing` button on the page and
  asserts each is inside the dialog, and that the dismiss cross is absent entirely.
- The stage holds the API-created iframe and nothing else; every control is a sibling, so
  nothing of ours is drawn over the player or its native controls. Asserted by a real
  compositor hit-test in E2E, in both presentations.

## Mobile layout

`100dvh`, `env(safe-area-inset-top)` on the handle, `env(safe-area-inset-bottom)` in the
padding, internal scrolling, and an E2E assertion that the document does not scroll
sideways at 390px. A measured E2E test pins the vertical order (handle → video → title →
rail → transport) and asserts the primary Play control is fully within the viewport.

## Desktop layout

One centred panel with a real scrim. No giant bottom player bar underneath it: the
mini-player is not rendered. Asserted at 1440 × 900.

## Network budget

**Zero** `search.list` and `videos.list` calls added. Expanding, collapsing, the
collection hand-off, seeking, Play and Next-within-a-saved-collection are all reads of
data already held. E2E records every request that would spend quota or load the player
script and asserts an empty list across the whole hand-off plus a full expand/collapse
cycle. `ensureYouTubeSessionDepth` still returns early for a collection-owned video, so
a saved list never prefetches.

## Policy boundaries

Unchanged, all of them:

- 30-day saved-metadata retention, expiry and the `canPlaySavedYouTubeRef` re-check at
  play time;
- MadeForKids and embeddability filtering, through the same `canEmbedYouTubeItem`;
- raw payload and statistics policy;
- the 200 × 200 minimum, in both geometries and restated in the component's inline style;
- `controls=1`, no overlays, no `noreferrer`, the watch-page backlink;
- hidden document → pause, and the resume that undoes only that pause;
- no autoplay into a hidden document, and no autoplay without a real measurement.

Audius/Jamendo background playback, Media Session and screen-off collection progression
were not touched.

---

## Files changed

**Player logic**

| File                                  | Change                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/player/youtube-visibility.ts`    | `measured` flag; `waitForYouTubeVisibility`; `VISIBILITY_SETTLE_TIMEOUT_MS`; waiters resolved on reset                                                          |
| `src/player/youtube-actions.ts`       | `YouTubePresentationReason`; `prepareYouTubePlaybackSurface`; `resolveAutoplay`; three-phase `playYouTubeVideo` / `playSessionItem`; `reason` on `StartOptions` |
| `src/player/youtube-engine.ts`        | serialised request queue; `loaded` distinguished from `current`                                                                                                 |
| `src/player/use-playback-snapshot.ts` | `capabilities.continuous` gated on a session of ≥2                                                                                                              |
| `src/player/unified-actions.ts`       | comments — collapse vs dismiss, and why collapsing pauses nothing                                                                                               |
| `src/library/collection-playback.ts`  | stops reading the ratio early; passes a presentation reason                                                                                                     |

**Components**

| File                                          | Change                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/player/GlobalPlayer.tsx`      | now the player shell: `data-mode`, the stable stage slot, the dialog role, the scrim, scroll lock, focus, Escape, `CollapseHandle` |
| `src/components/player/PlayerBar.tsx`         | back to a mini-player: no stage, no `ResizeObserver`, artwork for every provider                                                   |
| `src/components/player/NowPlayingSheet.tsx`   | the expanded composition below the media region; header, dialog role and modal behaviour moved to the shell                        |
| `src/components/youtube/YouTubeStageHost.tsx` | documentation corrected to the new ownership                                                                                       |

**Styles**

| File                          | Change                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `src/styles/player-shell.css` | **new** — both geometries, the docked stage, the expanded panel, mobile/landscape/desktop |
| `src/styles/now-playing.css`  | scrim/panel/inset rules removed; `.now-playing-body`                                      |
| `src/styles/youtube.css`      | `.player-stage` → `.yt-stage-frame`; stage docs rewritten                                 |
| `src/styles/app.css`          | `.music-player` no longer `position: fixed`; three-column mobile grid                     |
| `src/styles/tokens.css`       | `--player-bar-height` removed; `--yt-stage-docked-width` added                            |
| `src/styles/index.css`        | imports `player-shell.css`                                                                |

**Tests** — `src/test/intersection.ts` (new),
`src/components/player/ExpandedYouTubePlayer.test.tsx` (new),
`tests/e2e/collection-youtube-handoff.spec.ts` (new), plus rewrites in
`PlayerBar.test.tsx`, `NowPlaying.test.tsx`, `UnifiedNowPlaying.test.tsx`,
`use-playback-snapshot.test.ts`, `continuous-playback.test.ts`, and the E2E specs
`now-playing`, `unified-now-playing`, `continuous-playback`, `search-seed-continuation`,
`youtube-fallback` and `fixtures.ts`.

---

## Unit tests

`src/components/player/ExpandedYouTubePlayer.test.tsx` — 16 tests, written before the
source was touched, driving the real components and the real actions through
`renderApp`. The only thing doubled is the environment: jsdom implements no
`IntersectionObserver`, so `src/test/intersection.ts` installs a real one whose reported
ratio the test chooses. **Nothing writes a ratio into the module the production code
reads** — every number arrives through an observation of the actual stage element, which
is what makes "the code did not fake the visibility" a claim these tests support.

- opens the expanded player, with the video in it, without anyone swiping
- starts the video once the real observer reports it visible (0.95) — and asserts the
  stage is under observation
- cues and waits when the observer settles at 0.40, with one Play button
- does not begin a video while the document is hidden, and holds position at B
- carries on into the next saved catalogue item when the video ends, in the same view
- answers Next with the collection's next item, not a stale search result
- replaces the mini-player rather than sitting on top of it
- exactly one Play/Pause, Next, Previous, heart and progress rail
- video above the title, handle above the video
- never more than one embedded player, across a full round trip
- same player, position and session across expand and collapse
- one visibility observer, not one per presentation
- one compact presentation left behind on the way down
- no focusable control from the other presentation
- a direct press opens the expanded player, starts it, and keeps the collection
- an audio track still starts in the mini-player

Plus one new capability test in `use-playback-snapshot.test.ts`, and a new
`continuous-playback.test.ts` case that a step inside a session leaves a collapsed player
collapsed.

## E2E tests

`tests/e2e/collection-youtube-handoff.spec.ts` — 22 tests across desktop (1440 × 900) and
the reported mobile viewport (390 × 844). Nothing is pressed to reach the hand-off: the
audio stub serves a real WAV and the track is run to its end.

- opens the expanded player and starts the video, unprompted
- **the screenshot as assertions** — one Play/Pause, one Next, one Previous, one heart,
  one progress rail, one collapse control, one title block, and `.music-player` count 0
- measured stacking order, with the Play control fully inside the viewport
- no horizontal overflow at 390px
- collapses to one compact player (bar under 140px, still image in the slot) and expands
  back to the same one, with `created` unchanged
- carries on into the next saved song when the video ends, in the same view
- Next goes to the next saved song, not a search result
- the whole hand-off spends no YouTube quota
- desktop: one coherent view, stage ≥480px wide and 16:9, no bar beneath
- a direct press behaves the same way and keeps the collection
- an audio track still starts in the mini-player

## Screenshot tests

Captured deliberately and compared, at 390 × 844, 1440 × 900 and 844 × 390 landscape:
audio collapsed, YouTube expanded, YouTube collapsed, audio expanded (reached by letting
the video end), and landscape YouTube expanded.

- **Mobile YouTube expanded** matches the target layout exactly: grab strip, chevron,
  16:9 video, title with heart and menu, progress, transport. One screen, one player, no
  second bar underneath.
- **Mobile YouTube collapsed** is one compact row — chevron, thumbnail, title, heart,
  Play, close — with the docked player above it.
- **Desktop collapsed** is a compact bar with the docked 356 × 200 card resting above its
  right-hand end.
- **Audio expanded and collapsed** are visually unchanged from before this pass.
- Landscape was **reworked as a result of this comparison**: stacked, the transport fell
  below the fold, so the YouTube expanded view became a two-column grid there.

Two further defects were found by looking at these rather than by any assertion — the
empty secondary divider and the wrapped dismiss cross — and both are fixed above.

The captures were taken with a throwaway Playwright spec and are not committed: pixel
baselines for a live embedded player would be brittle, and every claim they informed is
covered by a behavioural assertion in the suites above.

## Local QA

All gates in the table at the top of this document, run on this machine against this
working tree. The E2E suite was run three times end to end; the one flake seen
(`the player clears 200 x 200 in both presentations`, under parallel load) was a
measurement taken mid-animation and is now read through `stageHitTest`, which settles
every animation on the page first. Two subsequent full runs were clean.

## Physical-device QA

**Not performed. Not claimed.** Everything above was verified in Chromium — headless for
the suites, at a 390 × 844 device-scaled viewport for the screenshots — and on this
machine only. The checklist from the brief (save `Audio A / YouTube B / Audio C`, play A,
let it finish, inspect, swipe down, swipe up, let B finish) is exactly what
`tests/e2e/collection-youtube-handoff.spec.ts` performs, but a real handset differs in
ways a headless browser cannot report: touch gesture handling, the real YouTube player
rather than a stub, actual safe-area insets, and the browser chrome that makes `100dvh`
matter. That pass still needs doing on hardware.

## Vercel status

**Not deployed as part of this pass, and not claimed.** `pnpm build` succeeds and
`pnpm verify:bundle` finds no secrets in `dist/`, which is what can be established here.

## Known limitations

- **A collapsed YouTube player still occupies 200px above the bar.** That is the
  documented minimum for an embedded player and this pass does not weaken it. The bar
  itself is compact again, which is the part that was in the app's gift.
- **The docked card overlays page content**, as the bar always has. `--app-bottom-space`
  is a constant and does not account for it. Unchanged from before, and out of scope.
- **The 700ms visibility bound is a judgement**, chosen to cover a mount plus a 260ms
  rise. A device slow enough to exceed it cues the video and shows one Play button —
  the correct failure, but a failure a faster machine would not have had.
- **Landscape below roughly 320px tall** will still scroll the right-hand column. The
  controls stay reachable; they are not all simultaneously visible.
- **Screenshot baselines are not committed**, for the reason given above.
