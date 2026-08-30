# Collection auto-start into a saved YouTube video — diagnosis and fix

## Reported behaviour

Liked Songs holding `Audio A, YouTube B, Audio C`. On a phone, in the foreground:

1. A plays and ends naturally.
2. The collection advances to B correctly.
3. The expanded YouTube Now Playing view opens correctly.
4. **B does not start.** The visitor has to press Play.

Everything except step 4 was already right. This pass is only about step 4.

## Status

| Gate                               | Result                                        |
| ---------------------------------- | --------------------------------------------- |
| `pnpm typecheck`                   | pass                                          |
| `pnpm lint`                        | pass (`--max-warnings 0`)                     |
| `pnpm test:run`                    | **2025 passed**, 106 files (baseline 2011)    |
| `pnpm build`                       | pass                                          |
| `pnpm test:e2e`                    | **519 passed**, 29 skipped (baseline 515)     |
| `pnpm verify:bundle`               | pass — 0 secret matches                       |
| module cycles (`madge --circular`) | none                                          |
| Physical-device auto-start         | **UNVERIFIED** — see _Physical-device status_ |

---

## Existing reveal → measure → play path

As it stood before this pass:

```
PHASE 1  store.openWith(item)            mounts the stage
         prepareYouTubePlaybackSurface() takes the claim, opens the expanded view
PHASE 2  await waitForYouTubeVisibility({ minimumRatio: 0.5 })   ← flat 700ms deadline
PHASE 3  engine.play(item, { userInitiated: autoplay })
```

and inside the engine:

```ts
if (mode === 'cue' || !userInitiated) instance.cueVideoById(id)
else if (sameVideo) instance.playVideo()
else instance.loadVideoById(id)
```

## Physical failure reproduction

**It does not reproduce here, and that is the finding that shaped this pass.** In
Chromium — headless and at a 390 × 844 device-scaled viewport, with the IFrame API
doubled — the hand-off starts the video every time, and did so before this pass too. The
two things a phone has that this environment does not are a _real_ YouTube player (a
network script load, a real cross-origin iframe) and a _real_ autoplay policy.

So rather than guess between the two candidate causes, the transition was instrumented
and each cause was pinned with a test that fails for one and passes for the other.

### The instrument

`src/player/playback-trace.ts` records one transition as a capped in-memory list:
reveal, the reason, `documentHidden`, every observation and its ratio, how the wait
ended and after how long, the decision and what was withheld, **the documented IFrame
API command actually issued**, whether `onAutoplayBlocked` fired, and the final state.

Recording is a push onto an array. The console and the on-screen readout are silent
unless `?debugPlayback=1` (or `pulse.debugPlayback` in `localStorage`) is set. Nothing
in playback reads the trace back — a diagnostic that could change a decision would be a
second, invisible source of truth.

`youtube-engine` gained an `onCommand` event for the same reason: _"did the authorised
automatic start issue a play command or a cue"_ is the single question that separates an
application bug from a browser refusal, and inferring it from the resulting state is
exactly the guesswork that could send a fix to the wrong layer.

## Visibility measurements

Two defects were found in the measurement path. Both are real; only the first could
plausibly explain the phone.

### Defect 1 — the 700ms deadline was the wrong shape, not the wrong number

The previous wait had a single flat deadline. It is fine on a desktop and fragile on a
phone, where the expanded view mounts, rises for 260ms, and then has its geometry
changed _again_ by the browser's address bar collapsing and by safe-area insets
resolving. A flat deadline must be either too short for the slow case or needlessly slow
for the common one, and it answers the wrong question: not _"has 700ms passed"_ but
_"has the layout stopped moving"_.

The wait is now driven by observations:

- resolves **immediately** when any observation clears the threshold;
- otherwise waits for the layout to go quiet — `VISIBILITY_SETTLE_MS` (400ms) after the
  _last_ observation, armed only once the stage is genuinely laid out and something has
  genuinely been observed;
- `VISIBILITY_TIMEOUT_MS` (2000ms) is a hard cap so nothing waits for ever.

A player that settles at 0.4 is answered in about 400ms rather than two seconds. A
player still being laid out at 900ms is still waited for. `> 0.5` is untouched.

The discriminating test is `a phone-paced reveal › starts the video when the layout
settles above the bar after 700ms`: stage at 300ms, first observation 0.45 at 650ms,
0.92 at 900ms. Its sibling asserts the same sequence is _not_ playing at 700ms — which
is precisely the answer the old deadline would have returned and shipped.

### Defect 2 — "no player yet" and "player off screen" were one value

Partly addressed in the previous pass with a `measured` flag; completed here. The
visibility module now also holds the observed **element** (`registerYouTubeStageElement`)
and can answer `youTubeStageIsLaidOut()` — connected, and boxed at or above the
documented minimum. `nowPlayingOpen === true` says the app _intends_ to show a player;
this says the browser has actually laid one out, and those diverge for exactly the few
frames this problem lives in. Silence before the stage is laid out is treated as _not
ready_, not as an answer.

## Player readiness

Visibility and readiness are independent, and only visibility was being waited for. The
box can be measured a second or more before the IFrame API script has loaded and built a
player inside it. The decision is now taken on both:

```ts
const [measurement, ready] = await Promise.all([
  waitForYouTubeVisibility({ minimumRatio: AUTOPLAY_VISIBILITY_RATIO }),
  engine.whenReady(), // bounded, PLAYER_READY_TIMEOUT_MS = 4000
])
```

A player that never becomes usable is **cued**, with `awaitingUserPlayReason:
'player-not-ready'`, rather than sent a command that would do nothing.

A scripted transition that is going to wait also **prepares the player while it waits**
(§16): phase 1 issues a `'cue'`, which is the documented way to build and line up a
player without initiating playback. No audiovisual content starts, nothing is hidden, no
Data API quota is spent — and the script fetch and iframe construction happen _during_
the milliseconds the observer is settling instead of afterwards. A direct gesture and a
step inside an already-open player both skip it, because neither would be paying for
anything.

## Actual final iframe command

Asserted directly, at the engine boundary and end to end.

For an authorised automatic start the last command is `playVideo` — **not**
`loadVideoById`, and that is correct: phase 1 cued this very video while the measurement
settled, so the play resumes the player it prepared rather than reloading it. Both are
documented play paths. What matters, and what a test now pins, is that the final command
is never `cueVideoById`.

The E2E stub records every command, so the browser-level assertion is the same claim
rather than a proxy for it.

## onAutoplayBlocked result

In Chromium with the doubled API, no block occurs — the video plays. The refusal path is
therefore reproduced deliberately: the stub can be told to decline a scripted start the
way a mobile browser does, and an E2E test drives that whole path.

`onAutoplayBlocked` is no longer folded into a generic "waiting for a press". It sets
`awaitingUserPlayReason: 'autoplay-blocked'`, which is the one outcome that is **not**
an application decision.

## Root cause

Stated honestly, because the brief asked for the layer and not for the word "fixed":

**What was demonstrably wrong in this codebase, and is fixed:**

1. **The visibility wait had the wrong shape** for a phone-paced reveal. A flat 700ms
   deadline can return "not visible" for a player that is about to be perfectly visible.
   This is the most plausible explanation for the reported behaviour, and it is
   reproduced by a test that fails against the old model.
2. **The decision ignored player readiness**, so a slow script load could produce a
   decision taken against a player that did not yet exist.
3. **The engine conflated two facts.** It cued whenever `userInitiated` was false, so the
   only way to express "scripted, but authorised" was to tell it a human had clicked.
   The _behaviour_ was right — the caller passed `true` and a play command went out — but
   the semantics were a lie the next reader would have believed. This was **not** the
   cause of the reported failure.

**What could not be established here, and is now measurable on the device:**

Whether the phone was failing at (1) or at a genuine browser autoplay refusal. Those need
opposite responses, and until this pass the application could not tell them apart even in
principle. It now can, from the phone itself.

## Fix

- `youtube-visibility.ts` — settle-based bounded wait; stage-element registration and a
  geometric readiness check; richer result (`measured`, `elapsedMs`, `outcome`).
- `youtube-engine.ts` — `start(item, { mode })` replacing `play`/`cue`; `isReady()` and
  bounded `whenReady()`; an `onCommand` diagnostic event. No policy in the engine.
- `youtube-actions.ts` — `StartDecision` carrying `directUserGesture` and `mode`
  separately; `decideStart` waiting on visibility _and_ readiness; one shared
  `runStartSequence` for both entry points; phase-1 preparation cue.
- `youtube-store.ts` — `awaitingUserPlayReason`.
- `playback-trace.ts` — the instrument.
- `NowPlayingSheet.tsx` — one quiet line for a genuine refusal, and the debug readout.
- `YouTubeStageHost.tsx` — registers the observed element.

## Engine API semantics

```ts
export type PlaybackStartMode = 'play' | 'cue'
start(item: MediaItem, request: { mode: PlaybackStartMode }): Promise<void>
```

The engine is told the decision, never the reasoning. There is no visibility check, no
document check and no notion of a gesture in `youtube-engine.ts`; those live in
`mayAutoplay` and its callers, in one place, where they are tested. At the actions layer
the two facts stay separate — `directUserGesture` answers "did a human press something",
`mode` answers "play or cue" — so nothing downstream can come to believe an automatic
transition was a human click.

## Collection preservation

Unchanged and re-asserted:

- `A → B → C` still runs on its own; the video ending still hands back to the audio
  element.
- **Next while B is playing still means C**, never the next result of an older search
  session. Covered in both suites.
- `collection-session.ts` still imports no React and no component; no cycles.
- A step inside an open YouTube session supplies its own measurement, so it takes no wait
  and no preparation cue — the reveal path is not on that route at all.
- A direct press on a video still starts it immediately.

## Browser autoplay boundary

If a device reports `decision: play`, `command: playVideo`/`loadVideoById` and
`blocked: true`, then this application did everything within its power and the browser
refused. That is a platform boundary, not a defect, and it is not worked around here.
Explicitly **not** done, and not to be done: muted-start-then-unmute, synthetic pointer
or click events, hidden or offscreen media, `AudioContext` tricks, autoplay-policy
bypasses, extracted or proxied audio. The response is one Play button and one quiet line
— _"Your browser asked for a tap before playing this video."_ — which is information, not
an error, and not a claim that anything failed.

There is **no retry**: one automatic attempt per transition, asserted by a test that
waits five seconds and checks the play count has not moved.

## Tests

`src/player/youtube-autostart.test.ts` — 14 tests, driving the real actions, the real
engine and the real bounded waits under fake timers. What they control is the
environment: when observations arrive, and what the player does with the command it is
given.

- **A — visible, accepted:** reaches `playing` with no press; ends on a documented play
  command, never a cue; cannot be overwritten by a late cue from the stage.
- **B — visible, refused:** records `autoplay-blocked` as its own reason; proves a play
  command was issued first; does not retry; keeps the item rather than skipping it.
- **C — settles at 0.42:** cues, names `visibility`, keeps the `> 0.5` bar, and is
  answered in about the settle period rather than the hard cap.
- **D — phone-paced:** 0.45 at 650ms then 0.92 at 900ms starts the video; the same
  sequence is asserted _not_ playing at 700ms; nothing observed at all still gives up and
  cues, bounded, with `measured: false` and ratio 0.
- **Hidden document:** refused immediately, with no wait and no play command.
- **The trace:** records every step a diagnosis needs, and says which cause a run was.

One test-setup bug of my own is worth recording, because it is the same class of mistake
as the production one: the harness registered the stage element _before_ calling
`resetYouTubeVisibility()`, which clears it — so the wait could not tell the stage was
laid out and ran to the hard cap. The test hung rather than lying, which is the right
failure mode.

## E2E

`tests/e2e/collection-youtube-handoff.spec.ts` — 26 tests. Two are new and specific to
this pass, both at 390 × 844:

- **`issues a play command and reaches Pause without anyone tapping`** — §23's mandatory
  assertion, in the terms a visitor would use. The transport shows **Pause**, which it
  only ever does while something is genuinely playing; a capture hook counts presses of
  Play and asserts zero; and the last command sent to the IFrame API is a play, not a cue.
- **`handles a genuine refusal without retrying or skipping the item`** — the player
  declines the scripted start. Asserts the app _did_ ask, that exactly one Play control
  and the quiet line are shown, that no retry occurs over the following two seconds, that
  the collection stays on B, and that a real press still works.

The E2E IFrame API stub gained a command log and a `blockAutoplay` switch to make that
second test possible; it implements only documented surface.

## Local QA

Every gate in the table at the top, on this machine. The debug build was exercised at
390 × 844 for both outcomes and the readouts are the discriminator they are meant to be:

```
success                     refusal
status   playing            status   paused
ratio    1                  ratio    1
measured true               measured true
waited   8 ms               waited   8 ms
decision play               decision play
command  playVideo          command  playVideo
blocked  false              blocked  true
awaiting —                  awaiting autoplay-blocked
```

## Physical-device status

**UNVERIFIED.** No hardware test was performed, and none is claimed.

What to do on the device, and what each outcome means:

1. Open the deployed app with `?debugPlayback=1`.
2. Save `Audio A, YouTube B, Audio C` to Liked Songs.
3. Play A, leave the app in the foreground, and let A finish.
4. Read the diagnostic block in the expanded view.

| Reading                                                                       | Meaning                                   | Next step                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| `decision play`, `blocked false`, status `playing`                            | Fixed.                                    | Nothing.                                                         |
| `decision cue`, `withheld visibility`, low `ratio`                            | The player really is not visible enough.  | A layout problem — capture the ratio and the `wait ended` value. |
| `decision cue`, `withheld visibility`, `measured false`, `wait ended timeout` | Nothing was ever observed inside 2s.      | The observer or the stage geometry, not autoplay.                |
| `decision cue`, `withheld player-not-ready`                                   | The IFrame API script did not load in 4s. | A network or CSP problem.                                        |
| `decision play`, `blocked true`, `awaiting autoplay-blocked`                  | **The browser refused.**                  | A platform boundary. Do not "fix" the visibility code.           |

Android Chrome and iOS Safari must be recorded separately; they do not share an autoplay
policy and one device proves nothing about the other. Desktop Chrome should be run
through the same flow: if desktop auto-starts and the phone does not while both report
`decision play`, that is strong evidence for the mobile autoplay boundary rather than for
anything in this codebase.

## Vercel status

Not deployed as part of this pass, and not claimed. `pnpm build` succeeds and
`pnpm verify:bundle` finds no secrets in `dist/`.

## Known limitations

- **The phone cause is still formally unknown.** This pass fixes a demonstrated defect in
  the wait, closes a readiness gap, and makes the remaining possibility measurable. It
  does not prove which one the reported device hit.
- **The `allow="autoplay"` attribute on the generated iframe was not verified.** The
  official IFrame API creates the iframe itself and recent versions set an `allow` list
  including `autoplay`; this application never sets it and cannot, without manipulating a
  node the API owns. If a device reports `blocked: true`, that attribute is the first
  thing to inspect in the real DOM — it is a legitimate permission-delegation question,
  not a policy bypass.
- **2000ms is a judgement**, chosen against a 260ms rise plus browser-chrome relayout. A
  device slower than that cues and shows one Play button — the correct failure, but one a
  faster device would not have had.
- **The debug readout sits inside the expanded view**, so it shifts the transport down
  while enabled. Acceptable for a diagnostic build; it renders nothing in a normal
  session.
- **`playVideo` versus `loadVideoById`** now depends on whether the preparation cue got
  there first. Both are documented play paths and the tests accept either, but a future
  reader comparing traces across devices should expect to see both.
