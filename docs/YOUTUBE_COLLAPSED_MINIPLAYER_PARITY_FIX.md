# YouTube collapsed mini-player parity

## Status

**PASS.** Collapsed, a video is one bottom bar and nothing else — the same bar an
audio track gets, with the video's own thumbnail in the artwork slot. There is no
floating YouTube box, and no embedded player on the page at all.

All six gates green. Not verified on a physical device; see _Physical-device
status_.

## Reported UI issue

The collapsed YouTube state showed two things at once:

1. the normal Pulse bottom player bar, and
2. a separate floating official YouTube video box in the bottom-right corner.

Audio showed one compact row. The product looked like it had two players.

## Previous floating-stage architecture

Not a styling accident — it followed from three constraints that are each true:

- an embedded player must be mounted and at least 200 x 200 while it plays;
- the developer policies prohibit content continuing in a player "not displayed
  in the page, tab, or screen that the user is viewing";
- reparenting or remounting an iframe reloads it, restarting the video.

Taken together they say: if a video is to keep playing while the visitor
collapses Now Playing, the player must stay mounted, in one fixed place in the
DOM, visibly, at 200 x 200 or more. So the stage became a permanent sibling of
both presentations, and only its _box_ changed:

```css
.player-shell[data-mode='collapsed'] .yt-stage-frame {
  width: min(var(--yt-stage-docked-width), 100%); /* 356px */
  height: var(--yt-stage-floor); /* 201px */
}
```

## Why it caused two visible player surfaces

A 356 x 200 video card, with its own radius and shadow, sitting above the
bottom-right corner for as long as the bar was on screen — beside a 66px bar
carrying the title, the heart and the transport. Two boxes, two visual weights,
two things that look like players. Every constraint above was satisfied and the
product was incoherent.

The mistake was in which constraint got relaxed. The set is only unsatisfiable if
you insist the video **keeps playing** through a collapse. Give that up and the
rest resolves cleanly.

## New collapsed model

**Collapsed, there is no embedded player on the page, for either engine.**

```
COLLAPSED                            EXPANDED
┌──────────────────────────────┐     ┌──────────────────────────────┐
│ thumb  title/channel  ♥ ◀▶▶  │     │        ══ grab ══        ⌄   │
│         ──── progress ────   │     │   ┌────────────────────┐     │
└──────────────────────────────┘     │   │   official iframe  │     │
  one bar, one thumbnail, no iframe  │   └────────────────────┘     │
                                     │  title / channel      ♥  ⋯   │
                                     │  ──── seek ────  0:42 / 4:00 │
                                     │   ↺10  ◀  ▶/❚❚  ▶  ↻10       │
                                     └──────────────────────────────┘
```

**Absent, never hidden.** `opacity: 0`, `visibility: hidden` and offscreen
parking would each leave a live player where the visitor cannot see it — the
exact background playback the policies prohibit, and the same violation as
docking one. The stage is unmounted, which is the only answer that is true. The
tests count elements rather than inspect styles, so a hidden player fails them
exactly as a visible one would.

## Audio mini-player

Unchanged. A track still starts in the bar, keeps playing across a collapse, and
expands only when asked.

## YouTube mini-player

The same component, the same DOM, the same code path — `PlayerBar` already had no
`engine === 'youtube'` in it, and still does not. A video draws its own
unmodified 320 x 180 thumbnail through the same `<Artwork>` in the same 56px
slot, from YouTube's own CDN, with no new fetch and no second thumbnail state.

The rows are not byte-identical and should not be: an Audius track carries a
dismissible permalink icon that a video drops, because a video's _required_
backlink already rides on the always-visible credit line rather than linking to
the same page twice. That is an attribution rule, not a layout difference.

The bar keeps its dismiss control for a video (where audio shows volume). It is
not the floating box's close button — it is `unifiedDismiss` in the bar's own
aside slot, and it is the only way to hand the bar back to the audio track
preserved underneath. Removing it would strand the visitor, so it stayed; this
is the one judgement call in the pass that reads against a literal "same as
audio".

## YouTube expanded iframe lifecycle

```
GlobalPlayer:  const stageItem = expanded && snapshot.isEmbeddedStage ? snapshot.stageItem : null
```

Two conditions, neither an engine branch. Mount on expand, unmount on collapse.

|                          | collapsed | expanded |
| ------------------------ | --------- | -------- |
| `youtube-stage` elements | 0         | 1        |
| embedded iframes         | 0         | 1        |
| player objects alive     | 0         | 1        |

## Collapse behaviour

The stage's own unmount runs, in this order:

1. `suspendYouTubePlayback()` — reads the position **from the player**, pauses,
   writes the position to the store, and moves `playing`/`loading` to `paused`.
2. `engine.detach()` — destroys the player and its iframe.

The position is read rather than waited for. This runs while the stage's effects
are cleaning up, and React cleans up in declaration order: the engine→store
subscription is set up first (so it cannot miss a command `attach()` flushes) and
is therefore torn down first, which means a position the engine _emits_ at that
moment reaches nobody. `engine.getCurrentTime()` was added for exactly that
caller.

`engine.pause()` also publishes the player's clock before its progress timer
stops, so an ordinary in-view pause is accurate to the second too.

## Expand / resume behaviour

Expanding mounts the stage, which attaches the engine and finds it holding
nothing, so it restores: `start(item, { mode: 'cue', startAt: resumeAt })` —
cued, at the position, one Play button.

Pressing **Play on the collapsed bar** is one gesture from the visitor's side:

1. `unifiedPlayPause` opens the expanded view (only when something is going to
   _start_ — a pause acts on a player already on screen);
2. `toggleYouTubePlayback` finds no player and starts a recovery:
   `engine.start(item, { mode: 'play', recover: true, startAt: resumeAt })`;
3. the request is held, because the stage has not mounted yet;
4. the stage mounts, `attach()` flushes it, the player is built around the video,
   `loadVideoById` goes out and `seekTo(resumeAt)` follows it.

`startAt` rides _with_ the request rather than being applied after it, and that
is load-bearing: a request made before the surface mounts resolves its promise
the moment it is _queued_, so a seek on the far side would run against a player
that does not exist yet and silently do nothing. This is precisely the shape of
"press Play on the collapsed bar".

Nothing plays in the background at any point, and nothing is faked — the sheet
comes up because the video is about to be visible in it.

## Audio → YouTube

Unchanged and still verified. `runStartSequence` phase 1 opens the expanded view
for `'user-selection'` and `'collection-transition'` before anything is measured,
so the hand-off still reveals → measures → `loadVideoById` → buffering → playing,
with nobody touching the app. It was never routed through the docked stage.

`'session-step'` **joined** the reasons that open the view, and had to: a step
within a result session needs a player, and the only place one exists is the
expanded view. Putting that rule in `prepareYouTubePlaybackSurface` rather than in
`unifiedNext`/`unifiedPrev` matters — a step from a saved list can hand off to a
catalogue track on the other engine, and expanding for _that_ would pull the
sheet up over somebody who asked for the next song. The start sequence only runs
for an item genuinely going to a YouTube player.

## YouTube → Audio

Unchanged: the video ends, the collection hands to the audio track, the stage
unmounts with the engine claim and the expanded view shows the cover in the slot
the video occupied. No duplicate surfaces, at any point.

## Single iframe proof

Asserted at every point of the round trip, at both levels:

- component — `queryAllByTestId('youtube-stage')`, `.yt-stage-frame` and
  `document.querySelectorAll('iframe')` counted collapsed (0) and expanded (1);
- e2e — `iframe[data-e2e-youtube]` counted through play → collapse → expand →
  navigate, plus the fake API's own `created`/`destroyed` counters showing one
  built and one destroyed per round trip, never two alive.

## Accessibility

Unchanged and still asserted: collapsed, only the mini-player's controls are in
the tab order; expanded, the mini-player is **not rendered**, so no second Play,
Next or heart is reachable by Tab or by a screen reader underneath the sheet. The
YouTube player's own controls are reachable only while it exists, which is only
while expanded.

## Mobile

At 390 x 844 the collapsed video is the same full-bleed bar an audio track gets —
same height, same position, same width — measured rather than assumed. There is
no 356 x 200 region outside it.

## Desktop

The collapsed shell is now exactly as tall as the bar inside it (asserted to
within 1px), where it used to be the bar plus 8px plus a 201px video card.

## Network

Collapse and expand spend **zero** YouTube Data API calls — no `search.list`, no
`videos.list` — asserted by the existing traffic recorder across a full
collapse/expand cycle. Rebuilding the embed is ordinary iframe network activity;
the IFrame API script itself is fetched once and cached.

## Files changed

| File                                                            | Change                                                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/components/player/GlobalPlayer.tsx`                        | stage mounted only when `nowPlayingOpen`                                                            |
| `src/components/youtube/YouTubeStageHost.tsx`                   | suspends before detaching; restore carries `startAt`                                                |
| `src/player/youtube-engine.ts`                                  | `StartRequest.startAt`; `getCurrentTime()`; `pause()` publishes its position                        |
| `src/player/youtube-actions.ts`                                 | `suspendYouTubePlayback()`; `'session-step'` opens the surface; recovery start carries the position |
| `src/player/unified-actions.ts`                                 | Play reveals the view when a player must be built                                                   |
| `src/styles/player-shell.css`                                   | docked-stage rules removed (collapsed, 560px, landscape)                                            |
| `src/styles/tokens.css`                                         | `--yt-stage-docked-width` deleted                                                                   |
| `src/styles/youtube.css`, `src/styles/app.css`, `PlayerBar.tsx` | prose corrected to the new model                                                                    |
| `CollapsedMiniPlayerParity.test.tsx`                            | **new** — 13 tests                                                                                  |
| 6 existing test files                                           | assertions that encoded the docked stage, updated                                                   |

## Tests

**New** (`CollapsedMiniPlayerParity.test.tsx`): one bar and no player for audio;
one bar and no player for a video; the thumbnail in the same slot at the same
index; the same transport in the same order; the same expand affordance;
collapsing pauses and keeps the item; the position is captured from the player
rather than from the last progress tick; audio keeps playing through a collapse;
**Play from the collapsed bar opens the view, rebuilds the player and resumes at
the captured position**; never two players while doing it; expand-by-hand
restores the video cued; expanded holds one player and no mini-player; a direct
press starts expanded.

**New e2e** (`now-playing.spec.ts`): collapses to one compact bar with no
floating player and no iframe; the collapsed bar has the same geometry as an
audio track's; re-expanding gives one player on the same video told to resume;
Play from the collapsed bar opens the view and starts it.

**Updated, not deleted** — eight assertions across six files encoded the docked
stage and now state the new contract:

- collapsed `youtube-stage` count 1 → 0 (four places);
- "keeps the same player across expand and collapse" → keeps the same **video,
  position and session**, with the player rebuilt;
- "does not pause on the way down" → **pauses** on the way down, because the
  player leaves the page;
- "clears 200 x 200 in both presentations" → wherever a player exists, plus its
  absence when collapsed;
- "expanding and collapsing never rebuilds" → rebuilds exactly one, never two at
  once;
- "keeps the video playing across a collapse and a route change" → keeps it
  **loaded**, paused, and resumable on a press;
- "YouTube to YouTube reuses the single player" — kept intact by stepping with
  Next from inside the open view rather than by collapsing first, which is what
  the claim was always about;
- one session-step test that asserted a collapsed player stays collapsed now
  asserts the view opens, since that is where the player it needs lives.

Two engine tests gained assertions for the new behaviour (`pause()` publishes
exactly one final tick; `startAt` restores through `seekTo`).

## Gates

```
pnpm typecheck     pass
pnpm lint          pass (0 warnings)
pnpm test:run      pass — 2115 tests, 111 files
pnpm build         pass
pnpm test:e2e      pass — 545 passed, 29 skipped
pnpm verify:bundle pass — 0 matches across 12 files
```

Prettier run on touched files only.

## Physical-device status

**Not verified on hardware.** The Audio → YouTube autostart fix was confirmed on
a real phone and is untouched by this pass, but the collapse/expand round trip is
new behaviour and has only been exercised in Chromium at a 390 x 844 viewport.

What is worth checking on a device:

1. Collapse a playing video: the floating box should be gone, leaving one bar
   with a thumbnail, and the video should stop.
2. Press Play on that bar: the sheet should come up and the video should resume
   near where it stopped, on the first press.
3. The rebuild is a real reload of the embed — on a slow connection it will show
   as a moment of buffering that the docked player did not have. That is the
   deliberate cost of this trade, and worth confirming it feels acceptable rather
   than broken.
