# Mobile YouTube: loaded, buffered, returned to cued

## Real phone trace

The evidence this pass was built on, captured from a physical device with
`?debugPlayback=1`:

```
status            cued
ratio             1
measured          true
waited ms         3
wait ended        observed
player ready      true
iframe autoplay   true
decision          play
withheld          -
commands          cue → loadVideoById
states            unstarted → buffering → unstarted → cued
outcome           started        ← contradicts `status: cued`
blocked           false
awaiting          -
```

User-visible: Audio A finishes, the correct YouTube B opens, YouTube's native red
Play overlay stays on the thumbnail, B does not play, the visitor must press Play.

## Status

| Gate                           | Result                                       |
| ------------------------------ | -------------------------------------------- |
| `pnpm typecheck`               | pass                                         |
| `pnpm lint`                    | pass (`--max-warnings 0`)                    |
| `pnpm test:run`                | **2054 passed**, 107 files (baseline 2044)   |
| `pnpm build`                   | pass                                         |
| `pnpm test:e2e`                | **529 passed**, 29 skipped (baseline 521)    |
| `pnpm verify:bundle`           | pass — 0 secret matches                      |
| module cycles                  | none                                         |
| **Physical-device auto-start** | **UNVERIFIED** — needs another deployed test |

## Confirmed false-positive diagnosis

The trace contains two statements that cannot both be true: `outcome: started`
beside `status: cued`. The store was right and the diagnostic was wrong.

`confirmPlaybackStarted` treated **`buffering` as final success** and stopped
watching at the first one. The player then went `unstarted → cued` — it took the
command, began, and was stopped — and nothing recorded that, because the watch
had already ended and reported a start.

So the previous pass's instrument, which existed precisely to tell an application
bug from a browser refusal, was itself reporting the wrong answer. That is worse
than no instrument, and it is fixed first.

## Why BUFFERING was not sufficient

`buffering` means _the player accepted the command and went to fetch content_. It
is progress, not an outcome. Whether content then plays is a separate question,
and on this device the answer was no.

Success now requires **`playing`**, and nothing else:

| sequence                               | verdict                                     |
| -------------------------------------- | ------------------------------------------- |
| `… → playing`                          | `started` — the only success                |
| `… → buffering → cued` / `→ unstarted` | `returned-to-cued` — a silent refusal       |
| `onAutoplayBlocked`                    | `blocked` — a refusal the browser announced |
| `onError`                              | `error`                                     |
| nothing inside the bound               | `timeout`                                   |

A `cued` or `unstarted` event _before_ any buffering is ignored — the real trace
opens with `unstarted`, and treating that as a refusal would fail every start
instantly. The fall-back only counts once a buffer has been seen, and it resolves
the wait immediately when it happens: there is nothing left to wait for.

The bound went from 2500 ms to **6000 ms**, because requiring `playing` rather
than `buffering` means a genuine slow-network buffer must fit inside it. It is a
backstop, not the usual exit: a refusal ends the wait by dropping back to cued,
and a success ends it by playing.

## Pre-cue audit

The command history — `cue → loadVideoById` — was the second thing worth
examining, and it was a consequence of the previous pass. That pass prepared the
player by _cueing_ the video so the script fetch and iframe construction would
overlap the visibility measurement. Correct in intent, wrong in instrument: it
meant an authorised automatic start issued **two** media commands at a player the
constructor had _already_ been given the same id for. Three separate loads of the
same video, in effect.

Whether that caused the fall-back or merely accompanied it cannot be proven from
here. But one authoritative media command is the correct shape, and the extra cue
was doing no work that a player-only preparation could not do.

## New player preparation architecture

`engine.prepare(item)` replaces the preparation cue. It does initialisation and
nothing else:

1. attach the visible container (or wait for `attach()` if the stage has not
   mounted),
2. fetch the IFrame API script,
3. construct `YT.Player` **with no `videoId`** — the documented constructor treats
   it as optional, and a player built without one holds no media at all,
4. delegate the autoplay permission on the iframe it creates,
5. record the requested item so the stage's remount-restore branch stays quiet,
6. issue **no** `cueVideoById`, **no** `loadVideoById`, and start no media.

`playerVars` are untouched: `autoplay: 0`, `controls: 1`, `playsinline: 1`,
`enablejsapi: 1`, `origin`. `autoplay` was **not** changed to `1` — this
application decides when playback begins through explicit commands, and
constructing with `autoplay: 1` would start content before the visibility
decision had been taken. That would be a policy regression, not a fix.

Two callers skip preparation, because neither would gain: a direct gesture (which
goes straight to a play command) and a step inside an already-open player (which
has its own measurement and its own built player).

## Final command sequence

For an authorised Audio → YouTube collection transition:

```
commands   loadVideoById
```

One documented media command, asserted in unit tests (`toEqual(['loadVideoById'])`)
and end to end against the doubled IFrame API. The cue path still exists and is
still used wherever playback must _not_ start — a hidden document, a ratio at or
below 0.5, a player that never became ready.

The engine also now picks its play command from the player's real state rather
than from id equality alone: `playVideo()` only resumes something that genuinely
played (`PLAYING`/`PAUSED`/`BUFFERING`); anything else gets `loadVideoById`, the
documented load-and-play.

## Playing confirmation

Watched in the background and **not awaited**. The caller's question is "was this
item started", answered the moment the command goes out; whether the player
honours it is a correction that arrives seconds later. Awaiting it held up
`advanceCollection` for up to six seconds behind a network buffer — found and
fixed during this pass.

A **generation guard** was added with it. A start sequence now spans two bounded
waits, so it can be in flight for seconds, and in those seconds the visitor can
press Next or the collection can move on. The newest sequence wins; older ones
stop writing. Two details matter and both were bugs before they were fixed:

- a superseded sequence returns **`true`**, not `false` — `advanceCollection`
  reads `false` as _this saved item is unplayable_ and steps past it, so
  returning false would make an overtaken transition silently skip a song;
- the guard's reset **bumps** the counter rather than zeroing it, because zeroing
  would make a stale sequence's token valid again and let an abandoned transition
  write its conclusion into a player it no longer has anything to do with.

## Silent refusal behaviour

`awaitingUserPlayReason` gained `'player-returned-to-cued'`, distinct from
`'player-command-no-start'` (nothing happened at all) and `'autoplay-blocked'`
(the browser said so). All three show the visitor the same thing — one Play
button and one quiet line, _"Tap play to continue this YouTube track."_ — and all
three are distinguishable in a diagnosis.

One attempt. No retry, no timer, no second `playVideo()`, and none of the tricks
that would amount to working around an autoplay policy: no muted start, no
synthetic gesture, no hidden media, no `AudioContext` laundering, no extraction.
The `> 0.5` threshold, the `IntersectionObserver` logic, the iframe permission
work, the `Permissions-Policy` header, the collection session, audio autoplay,
queue precedence, repeat, search and the background pause are all untouched.

§22's optional single documented continuation was **not** added: the IFrame API
documentation does not describe a `playVideo()` after a load as a required
state-machine step, so inventing one would be a retry wearing a costume.

## The contradictory debug output

Impossible by construction now: `outcome: started` is only ever recorded when the
player reached `playing`, and a unit test asserts the invariant in both
directions. The panel also gained the two histories and the readiness and
permission facts:

```
status          cued
ratio           1
measured        true
waited (ms)     3
wait ended      observed
player ready    true
iframe autoplay true
decision        play
withheld        —
commands        loadVideoById
states          unstarted → buffering → unstarted → cued
outcome         returned-to-cued
blocked         false
awaiting        player-returned-to-cued
```

## Tests

**Unit** — `youtube-autostart.test.ts`, now 30 tests. New in this pass:

- the exact phone sequence `unstarted → buffering → unstarted → cued`: not
  reported as started; store cued; `player-returned-to-cued`; no retry; the
  collection stays on the item;
- the invariant that `outcome: started` and `status: cued` can never coexist;
- `unstarted → buffering → playing` is a confirmed start;
- a long buffer is waited out rather than called a refusal — no verdict is
  recorded while the player is working;
- the command history is exactly `['loadVideoById']`, with the player constructed
  with no `videoId`;
- a withheld decision still cues.

**E2E** — `collection-youtube-handoff.spec.ts`, now 36 tests. New:

- the command sequence a hand-off produces is exactly one `loadVideoById`;
- it reaches playing through the documented state sequence;
- a player that loads, buffers and falls back to cued is reported as a refusal:
  one Play control, no Pause, the quiet line, the collection still on the item,
  and nothing re-issued in the following two seconds;
- a manual press then starts it, and when it ends the list carries on to the next
  saved song.

The doubled IFrame API gained a one-shot `refuseNextStart`, seeded from a page
flag so it survives the navigation that creates the recorder — it reproduces the
phone's sequence for the first scripted start and behaves normally for the manual
press afterwards, which is what really happens.

**Also fixed while here:** `whenReady` was polling every 25 ms, which added up
across the hand-off and pushed it past the default 1000 ms `waitFor` budget,
making several component tests flaky. Readiness is now resolved the instant the
player is assigned. The flakiness was a symptom of real latency in front of the
visitor's next song, so it was fixed at the source rather than by lengthening the
test's patience.

## Physical-device status

**UNVERIFIED.** No hardware test was performed, and none is claimed. Another
deployed test is required.

Run the same flow with `?debugPlayback=1` and read the panel:

| Reading                                                                           | Meaning                                                                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `commands loadVideoById`, `states … → playing`, `outcome started`                 | **Fixed.**                                                                                               |
| `commands loadVideoById`, `states … buffering → cued`, `outcome returned-to-cued` | The app issued one clean command at a visible, ready, permitted player and the browser silently refused. |
| `outcome blocked`                                                                 | The browser refused and said so.                                                                         |
| `decision cue`, `withheld …`                                                      | The app withheld playback; the `withheld` value says why.                                                |

If the second or third line is what comes back — with a single `loadVideoById`, no
stale cue, `iframe autoplay true` and `player ready true` — then classify it as
**BLOCKED BY MOBILE BROWSER/PROVIDER AUTOPLAY POLICY** and stop. There is nothing
further this codebase should do about it.

Android Chrome and iOS Safari must be recorded separately; they do not share an
autoplay policy. Desktop Chrome through the same flow is the control: if desktop
starts and the phone does not while both report `decision play` and one
`loadVideoById`, that is the platform boundary rather than anything here.

## Known platform limitations

- **A mobile browser may refuse an unmuted scripted start** minutes after the last
  gesture, regardless of visibility, readiness and permission — silently, without
  `onAutoplayBlocked`. That is the boundary. The response is one Play button and
  one quiet line.
- **6000 ms is a judgement** for the confirmation window, chosen so a slow buffer
  is not mistaken for a refusal. A device slower than that reports `timeout` and
  shows one Play button — the correct failure, but one a faster device would not
  have had.
- **`prepare` constructs the player with no `videoId`**, so the thumbnail appears a
  fraction later than when the constructor was given one. That is the cost of a
  single authoritative media command, and it is paid only on the scripted path; a
  direct press still constructs with the id.
- **The debug panel shifts the transport down** while enabled. It renders nothing
  in a normal session.
