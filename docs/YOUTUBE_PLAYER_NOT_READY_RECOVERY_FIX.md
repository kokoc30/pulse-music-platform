# YouTube — player-not-ready recovery fix

The reported failure was an automatic Audio → YouTube hand-off that opened a
black player, started nothing, and — the part that made it unacceptable rather
than merely disappointing — could not be started by pressing Play either.

This document records the physical evidence, what it actually proved, and what
changed. Nothing here weakens the autoplay policy.

## Physical phone evidence

The on-device diagnostic readout, at the moment of failure:

```
status            cued
ratio             1
measured          true
waited ms         4
wait ended        observed
player ready      false
iframe autoplay   —
decision          cue
withheld          player-not-ready
commands          [empty]
states            [empty]
outcome           —
blocked           false
```

## Why this is not autoplay refusal

Every measurement in that trace is the success case. The document was visible,
the stage was **fully** on screen (`ratio 1`), the measurement was real
(`measured true`) and it landed in four milliseconds. The visibility rule passed.

A browser refusal requires a command to refuse. `commands [empty]` says no
documented media command was ever issued — not `loadVideoById`, not `playVideo`,
not even `cueVideoById` — and `states [empty]` says the player never reported
anything. `blocked false` says `onAutoplayBlocked` never fired.

So nothing refused anything. The application never asked, because it never had a
player to ask. `iframe autoplay —` follows from the same fact: there was no
generated frame to read the permission from.

## Direct-click control case

Refresh the page and click a YouTube song directly: it plays, every time.

That is the same engine, the same factory, the same policy code and the same
device. The one thing it does differently is construct the `YT.Player` **around
the video** — the constructor is given `videoId` — because a direct click goes
straight to a start and never passes through the preparation step.

The automatic transition did pass through it, and that is the only structural
difference between the path that works and the path that does not.

## Empty-player preparation diagnosis

The automatic transition ran:

```
runStartSequence() → engine.prepare(item) → ensurePlayer(null)
```

`ensurePlayer(null)` constructed a `YT.Player` with **no** `videoId`. The
documented constructor treats `videoId` as optional, and the reasoning for using
it was sound: a player holding no media lets an authorised start be a single
`loadVideoById` rather than a load on top of a video the constructor had already
queued.

The reasoning was sound and the deployed environment did not support it. On the
physical device the empty construction never emitted `onReady`. The mocks did
support it, which is exactly why the previous pass believed it was safe; the
phone is the authority and the architecture has been withdrawn rather than
defended.

## `creating` promise lifecycle

The empty construction failing was the first fault. Everything downstream came
from how that failure was _shared_.

The engine held one slot:

```ts
creating ??= factory.create(...)
```

A construction that never settles therefore poisons everything that asks
afterwards. Concretely, in the reported run:

1. `prepare` began the empty construction. It never resolved.
2. `decideStart` waited on `engine.whenReady()`, timed out, and — because
   readiness was part of the decision — withheld playback with
   `withheld: player-not-ready` and downgraded the mode to `cue`.
3. The cue reached `ensurePlayer`, found the hung `creating`, and awaited it
   for ever. No `cueVideoById` was issued: hence `commands [empty]`.
4. The request queue behind it stopped moving, permanently.
5. `toggleYouTubePlayback` called `engine.resume()`, which is
   `player?.playVideo()`. With no player it is a no-op. **The Play button did
   nothing.**

Step 2 is also circular in its own right: readiness was required before deciding
to play, while the player was only built after deciding to play.

The lifecycle now guarantees the opposite invariant — _a failed, timed-out,
detached, superseded or never-ready construction must never prevent a later real
start from building a functional player_:

- every attempt is **bounded** by `PLAYER_CREATE_TIMEOUT_MS` (6s) and, on the
  bound, releases the shared slot and **rejects** rather than staying pending;
- every attempt carries a monotonic **generation**, and only the current
  generation may install itself as the player;
- a **late** attempt — one that reports ready after being timed out or
  superseded — destroys the player it built instead of replacing the working
  one;
- `detach` bumps the generation, so a construction for a container that has gone
  cannot install itself into the next one;
- a start may pass `recover: true`, which discards the in-flight attempt and
  **does not queue behind it**.

## New preparation model

Readiness is two independent facts and is now modelled as two:

|                  | meaning                                                            | engine         |
| ---------------- | ------------------------------------------------------------------ | -------------- |
| **API ready**    | the official script has loaded and `YT.Player` exists              | `isApiReady()` |
| **Player ready** | a concrete player for an actual video exists and emitted `onReady` | `isReady()`    |

`engine.prepare(item)` now prepares infrastructure and only infrastructure: it
records the requested item and calls the factory's `prepareApi()`, which is the
existing `loadYouTubeIframeApi()` in `iframe-adapter.ts`. **One script loader in
the codebase, no second one, and no Data API request.** It constructs no player,
holds no media, and cannot hang anything.

The script fetch still overlaps the visibility measurement, which was the whole
benefit of the old arrangement. `CreatePlayerOptions.videoId` is now **required**
so the empty player cannot be reintroduced by accident.

## Automatic transition

```
Audio A ends
  ↓ YouTube B selected
  ↓ expanded visible surface revealed          (phase 1)
  ↓ IFrame API script preloaded — no player    (prepare)
  ↓ document visible AND stage ratio > .5      (phase 2 — policy)
  ↓ construct YT.Player for B, bounded         (phase 3 — execution)
  ↓ onReady
  ↓ loadVideoById(B)
  ↓ PLAYING
```

Player readiness is an **execution** prerequisite, not an **autoplay-policy**
prerequisite. `decideStart` waits for the visibility measurement and nothing
else; `engine.start` owns building the player and is where a construction
failure surfaces, as a bounded and recoverable failure to start.

The policy itself is untouched: a hidden document never plays, and a stage that
is not measurably **more than half** visible is cued and waits for a press.
`AUTOPLAY_VISIBILITY_RATIO` is still `0.5` and the comparison is still strict.

The construction is video-seeded, so the automatic path now converges on the
same player setup the direct click uses. It issues one authoritative media
command, `loadVideoById` — the documented "load and play" for a player that has
never started — not a cue followed by a load.

## User Play recovery

`toggleYouTubePlayback` now has two paths:

- **A player exists** — resume, exactly as before. A working player is never
  rebuilt and the position is kept.
- **No player exists** — the press _is_ the recovery. It resets the start guard
  so an older sequence cannot land its conclusion on top, then calls
  `engine.start(item, { mode: 'play', recover: true })`, which discards whatever
  stalled, builds a fresh player around the video the store is showing, and
  plays it. A direct gesture needs no measurement, so it is authorised outright.

A recovery that also fails leaves the visitor cued, visible and able to press
again — never in an error state a second press could not leave.

## Store status and the user-facing message

A construction abandoned on its bound is a failure to _start_, not a failure of
the video, and is no longer reported through `setError` (which would move the
store to `'error'`, where there is no Play button). It ends as:

```
status               cued
awaitingUserPlay     true
awaitingUserPlayReason  player-not-ready
```

and the sheet shows one quiet line — _"Tap play to continue this YouTube
track."_ — which it did not show for this reason before, because before, the
button it points at did not work.

The collection stays on the item: the transition returns `true`, so
`advanceCollection` does not skip a song over a slow player. When the recovered
video ends, the next one continues automatically as usual.

## Stale progress fix

The screenshot showed `0:33 / 4:51` against a black, never-ready player. Nothing
had loaded, so the position could not have been this video's.

The engine now republishes the position as `(0, 0)` the moment a _different_
video is requested — in both `enqueue` and `prepare` — and the progress timer
refuses to report at all unless a player holds a loaded video. A duration of zero
resolves, in the read model, to the item's own metadata length; the position
resolves to nothing, which is the honest answer. A resume of the same video is
unaffected and keeps its position.

## Debug panel

> **Since removed.** The on-screen readout below is what produced both traces in
> this document, and it has since been deleted from the product — see _Debug
> cleanup_. The trace it drew is still recorded, and still printed to the console
> under `?debugPlayback=1` in a development build.

During the investigation the readout gained the facts whose absence made this
unplaceable on a device with no developer tools:

```
api ready            true
player ready         false
player creation      creating | ready | failed | timed-out
creation gen         2
creation timed out   true
```

`iframe autoplay` was moved to read the real frame **after** the player is built
(`engine:iframe`), rather than before it exists, where it was unfailingly `—`.
That trace step remains and is asserted by the tests.

## Tests

Engine lifecycle — `src/player/youtube-engine.test.ts`:

- a construction that never becomes ready is abandoned on its bound, not held
- an abandoned construction does not poison the next attempt
- a `recover` start supersedes a stalled construction **at once**, without
  waiting out the bound
- a late `onReady` from a timed-out attempt is destroyed; the working player
  stays canonical
- a healthy player is never rebuilt by a recovery
- `prepare` loads the API script and constructs nothing (`created === 0`,
  `isApiReady() === true`, `isReady() === false`)
- progress is republished as nothing when a different video is requested, and
  kept when the same video is resumed

Transition and recovery — `src/player/youtube-player-recovery.test.ts`:

- the device trace, reproduced: `ratio 1`, `measured true`, `player ready
false`, `commands []`, `states []`
- the decision is no longer withheld for a player nothing was building
- the transition ends, bounded, as `cued` + `player-not-ready`, and is not
  reported as an error
- the collection stays on the item, and no stale position is shown
- **a press of Play builds a fresh player and starts the video** — the required
  regression
- the press does not queue behind the stalled attempt, and the stalled attempt's
  later conclusion does not undo it
- a press on a healthy player resumes rather than rebuilding
- direct-click control case: create → ready → start, one media command
- authorised automatic transition with a video-seeded player starts with no tap
- the policy still refuses a stage at ratio 0.4, and still refuses a hidden
  document

Autostart — `src/player/youtube-autostart.test.ts`: the assertion that the
player is constructed _empty_ has been reversed to require the video-seeded
construction, with the physical evidence recorded beside it.

Debug removal — `src/components/player/PlaybackDebugRemoved.test.tsx` and one
end-to-end test in `tests/e2e/youtube-fallback.spec.ts`. See _Debug cleanup_.

## Network budget

No `search.list` and no `videos.list` were added. `prepare` fetches the official
IFrame API script through the existing loader — normal YouTube player
infrastructure, cached, once per sitting.

## Final physical device verification

**Result: PASS.**

The Audio → YouTube saved-collection transition automatically starts the YouTube
item on the tested device. The previous audio song finished, the collection
selected the YouTube item, and it began playing with **no manual Play press**.

Real-device trace:

```
status            playing
ratio             1
measured          true
wait ended        observed
iframe autoplay   true
decision          play
withheld          —
commands          loadVideoById
states            unstarted → buffering → playing
outcome           started
blocked           false
awaiting          —
```

Read against the failing trace at the top of this document, every field that was
wrong is now right, and each one confirms a specific part of the change:

| field             | then               | now                               | what it confirms                                             |
| ----------------- | ------------------ | --------------------------------- | ------------------------------------------------------------ |
| `iframe autoplay` | `—`                | `true`                            | a player exists, and its frame was delegated the permission  |
| `decision`        | `cue`              | `play`                            | readiness left the policy; visibility alone decides          |
| `withheld`        | `player-not-ready` | `—`                               | nothing was withheld                                         |
| `commands`        | `[]`               | `loadVideoById`                   | one authoritative media command, from a video-seeded player  |
| `states`          | `[]`               | `unstarted → buffering → playing` | the player accepted it and genuinely started                 |
| `outcome`         | `—`                | `started`                         | confirmed by reaching `playing`, not by reaching `buffering` |

## Debug cleanup

The temporary production-visible diagnostic panel used during the physical-device
investigation has been removed from the visitor-facing UI. Internal regression
instrumentation and tests remain where they are useful.

What went:

- `PlaybackDebugReadout` in `NowPlayingSheet.tsx`, deleted outright rather than
  hidden — no element, no empty container, no gap in the sheet's stack.
- The `.playback-debug` rules in `src/styles/now-playing.css`.
- The `localStorage` switch. `pulse.debugPlayback` no longer enables anything,
  and `forgetLegacyPlaybackDebugFlag()` removes that one key at start-up so it
  does not sit in a tester's browser being misread later as live configuration.
  No other `pulse.*` key is touched.
- The public debug mode. `isPlaybackDebugEnabled()` now requires
  `import.meta.env.DEV`, so `?debugPlayback=1` does nothing at all in production.
  In development it still prints the trace to the console.

What stayed, deliberately:

- `beginPlaybackTrace`, `tracePlayback`, `playbackTrace`, `lastTraceDetail`,
  `tracedSteps`, `tracedValues` — the instrument the regression tests read.
- Every regression test that proved these bugs, unchanged.

The console line is written as `if (import.meta.env.DEV && …)` rather than
relying on the runtime check alone, so a bundler can fold it away: the production
bundle contains no `[pulse:playback]` string, no `playback-debug` class and no
`Playback diagnostics` label. The only surviving occurrence of `debugPlayback` is
the storage key the cleanup deletes.

Verified by `PlaybackDebugRemoved.test.tsx` (the panel does not render even with
the debug switch forced on; production cannot enable tracing; the stored flag is
ignored and cleared) and by an end-to-end test that loads
`?debugPlayback=1` against the **real production build** on both the desktop and
mobile viewports and asserts a clean player and a silent console.

## Gates

```
pnpm typecheck     pass
pnpm lint          pass (0 warnings)
pnpm test:run      pass — 2089 tests, 109 files
pnpm build         pass
pnpm test:e2e      pass — 531 passed, 29 skipped
pnpm verify:bundle pass — 0 matches across 12 files
```

## Physical-device status

**Verified.** See _Final physical device verification_ above. The fix is
confirmed on hardware, not merely on the deterministic gates.

The on-device readout that produced both traces has been removed from the
product; the traces themselves are kept here, because they are the evidence and
outlive the instrument. Should this ever need diagnosing again, the trace is
still recorded in memory and still printed to the console under
`?debugPlayback=1` in a **development** build.
