# Real-device YouTube auto-start — iframe permission, player state, autoplay block

## Status

| Gate                               | Result                                        |
| ---------------------------------- | --------------------------------------------- |
| `pnpm typecheck`                   | pass                                          |
| `pnpm lint`                        | pass (`--max-warnings 0`)                     |
| `pnpm test:run`                    | **2044 passed**, 107 files (baseline 2025)    |
| `pnpm build`                       | pass                                          |
| `pnpm test:e2e`                    | **521 passed**, 29 skipped (baseline 519)     |
| `pnpm verify:bundle`               | pass — 0 secret matches                       |
| module cycles (`madge --circular`) | none                                          |
| **Physical-device auto-start**     | **UNVERIFIED** — see _Physical-device status_ |

Two concrete defects were found and fixed in this pass, both of which can produce
exactly the reported symptom. Neither was found by guessing: one came out of auditing the
deployed headers, the other out of asking what documented command a _cued_ player is
actually sent.

## Physical-phone symptom

Audio A ends. The collection advances to saved YouTube B. The unified Now Playing view
opens with the correct video loaded. Then:

> YouTube remains on its thumbnail with the large native red Play button.
> Pulse also shows its own Play button. The user must tap Play.

That detail — **YouTube's own red overlay on a thumbnail** — is the important one. It is
what a `CUED` player looks like. It is not what a player that was asked to play and
refused normally looks like, and it is not a player mid-buffer.

## What already worked

Collection routing, player presentation, video selection, reveal, iframe creation, the
`> 0.5` visibility measurement, player readiness, the cue/play engine split, the stale-cue
race, the duplicate-player UI. None of those were touched.

## Actual iframe permission

**Audited, and the audit changed something.**

`autoplay`'s default Permissions Policy allowlist is `self`. The top document may
autoplay; that permission does **not** reach a cross-origin child frame unless the parent
delegates it with the iframe's `allow` attribute. Without the token, `playVideo()` from
the parent is refused however visible the player is and however recently anyone tapped.

The app never set it. It relied entirely on the IFrame API doing so — current builds of
`YT.Player` do include `autoplay` in the `allow` list they write, but the app had no way
to know, no way to see, and no fallback if a build did not.

Now:

- `mergeAllowTokens` / `ensureAutoplayPermission` in `youtube/iframe-adapter.ts` add the
  token **only if it is missing**, preserving every other permission. A destructive
  `setAttribute('allow', 'autoplay')` would have stripped `encrypted-media` and broken DRM
  playback to fix something that may not have been broken; that failure mode is now
  covered by its own tests.
- Applied at the earliest possible moment — synchronously, in the same task the API
  created the element — because a frame's permissions policy is fixed when its document is
  created. An `allow` added after the embed has loaded applies to the _next_ navigation and
  does nothing for the document already in it.
- Applied again in the engine, right after creation, so the guarantee holds for any
  factory and is therefore assertable. Idempotent, so it is a no-op whenever the first
  attempt worked.
- Reported in the trace and on the debug panel as `iframe autoplay`.

## Top-level Permissions-Policy

**Audited, and it was one word away from breaking this outright.**

`vercel.json` sent:

```
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

`autoplay` is absent, so it kept its default allowlist of `self` — which does permit
delegation, so this was **not** the bug. But it was silent, implicit, and one careless
edit away from `autoplay=()`, which would disable the feature for the document and every
frame under it with no attribute on any iframe able to win it back. The video would simply
stop starting, with no error and no failing test.

It is now explicit:

```
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(),
                    autoplay=(self "https://www.youtube.com" "https://www.youtube-nocookie.com")
```

and `src/player/autoplay-permission.test.ts` reads `vercel.json` and asserts the header
never disables autoplay, names both embed origins, and still closes camera, microphone,
geolocation and payment. Nothing else was relaxed. CSP is not set by this project and was
not changed.

## Command history

**This is the second defect, and the one that matches the screenshot exactly.**

The engine chose its play command like this:

```ts
const sameVideo = loaded?.videoId === video.videoId && player !== null
if (sameVideo) instance.playVideo()
else instance.loadVideoById(video.videoId)
```

The previous pass added a phase-1 _preparation cue_ — the player is cued while the
visibility measurement settles, so the script fetch and iframe construction overlap the
wait instead of following it. Correct in itself, and it made `sameVideo` true by the time
the authorised play was issued. So the command sent to a player sitting on its thumbnail
was `playVideo()`.

`playVideo()` is a **resume**: its documented purpose is to continue a video that has
already started. `loadVideoById()` is documented as "loads and plays" — one command that
does both, from the beginning, which is the right instruction for a cued player that has
never run.

The check now asks what the player is actually doing, not merely whether the ids match:

```ts
const state = instance.getPlayerState()
const resumable = state === PLAYING || state === PAUSED || state === BUFFERING
if (sameVideo && resumable) instance.playVideo()
else instance.loadVideoById(video.videoId)
```

Resume only what genuinely played; load-and-play everything else. A paused video still
resumes at its position; a cued one gets the documented load-and-play.

The full command history is recorded and shown in the debug panel — `cue → loadVideoById`.

## State history

`engine.isPlaying()` is this application's own mirror of the last state event and is not
the authority. YouTube's state sequence is, and a start that works produces one:
`cued`/`unstarted` → `buffering` → `playing`.

Every state is now traced, so the debug panel shows the sequence rather than a single
value. A successful hand-off reads `cued → buffering → playing`; the reported failure
reads the same _commands_ against a sequence that stops at `cued`, and only the pair
together says which happened.

## onAutoplayBlocked

Unchanged in behaviour and now distinguishable in diagnosis: it sets
`awaitingUserPlayReason: 'autoplay-blocked'`, the one outcome that is not an application
decision. One attempt, no retry, one Play button.

**A third case was added**, because a browser can decline without saying so — which is
what a thumbnail-with-red-overlay and no error looks like:

`START_CONFIRMATION_MS` (2500ms) after an authorised play command, the outcome is
confirmed against YouTube's own events. `buffering` counts as success, because it is the
player saying it accepted the command and went to fetch content. If nothing arrives and
nothing refused out loud, the state is recorded as `'player-command-no-start'` — a silent
refusal, distinguished from a loud one. Still one attempt, still no retry: the command is
never re-issued, because a refusal repeated is still a refusal.

Without this the store could sit on `loading` indefinitely, drawing a spinner over a video
that was never going to start.

## Root cause

Two, both real, both capable of producing the reported symptom on their own:

1. **The wrong documented command for a cued player.** An authorised automatic start sent
   `playVideo()` — a resume — to a player that had only ever been cued, instead of
   `loadVideoById()`, which loads and plays. This is the more likely of the two, because it
   matches the screenshot precisely: the right video, loaded, on its thumbnail, with
   YouTube's own overlay still showing.
2. **Autoplay permission delegation was assumed rather than ensured.** The app never set
   the `allow` token and had no way to see whether the API had. The top-level header was
   implicit about the same feature.

**What is still not proven:** that either of these is what the _reported device_ hit. Both
are now fixed, both are asserted by tests, and the remaining possibility — a genuine
browser refusal — is measurable from the phone itself.

## Fix

| File                        | Change                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `youtube/iframe-adapter.ts` | `mergeAllowTokens`, `allowsAutoplay`, `ensureAutoplayPermission`; delegation applied at element creation and again at `onReady` |
| `youtube-engine.ts`         | play command chosen by real player state; `describeIframe()`; delegation guaranteed after creation                              |
| `youtube-actions.ts`        | bounded start confirmation; `player-command-no-start`; iframe permission and state history traced                               |
| `youtube-store.ts`          | `'permission-policy'` and `'player-command-no-start'` reasons                                                                   |
| `playback-trace.ts`         | `tracedValues` for command and state histories                                                                                  |
| `NowPlayingSheet.tsx`       | debug panel shows player-ready, iframe autoplay, both histories, outcome                                                        |
| `vercel.json`               | explicit `autoplay` delegation to the embed origins                                                                             |
| `youtube/fake-adapter.ts`   | a realistic `allow` attribute, settable so both API builds are testable                                                         |

## Why this is not an autoplay bypass

Everything here is either a _question asked correctly_ or a _diagnosis_. Specifically:

- The `allow` attribute is the standard mechanism by which a page delegates its own
  permission to an embed. It grants the browser's rules no exemption — the browser still
  applies every one of them inside the frame, and if it declines, the app takes no for an
  answer.
- `loadVideoById` versus `playVideo` is a choice between two documented commands, made on
  what the player is actually doing.
- The confirmation window observes; it does not act.

Explicitly **not** done, and not to be done: muted-start-then-unmute, `volume=0`, synthetic
clicks or `dispatchEvent`, hidden buttons, `AudioContext` gesture laundering, hidden
iframes, extracted or proxied audio, repeated `playVideo()` loops. The `>0.5` visibility
requirement, the hidden-document pause, and the "one attempt" rule are all unchanged.

## Stage mount/restore audit

`YouTubeStageHost`'s mount effect still cues only when `engine.getCurrentItem()` is null —
and since the phase-1 preparation cue sets the engine's current item before React ever
mounts the stage, that branch is now genuinely a _restore_ path rather than a second
request racing the first. The engine's latest-request-wins queue is the backstop.

Covered by `a visible player that accepts the start › cannot be overwritten by a late cue
from the stage`: a restore-style cue issued mid-transition, asserting the final command is
not a cue, the player is playing, and the store agrees. Presentation mounting cannot
override playback intent.

## Collection preservation

Unchanged, and re-asserted. `A → B → C` runs on its own; the video ending hands back to
the audio element; Next while B is playing means C and never an older search result; the
collection stays on B when B cannot start, and a manual press then starts B. Liked Songs
semantics, repeat, shuffle, queue precedence and autoplay-similar were not touched.

## Unit tests

`youtube-autostart.test.ts` — now 20 tests. New in this pass:

- **A play command that starts nothing:** gives up after one attempt and asks for a press;
  proves a play command was issued first; does not re-issue it over the following ten
  seconds; keeps the collection on the item.
- **The generated iframe permission:** recorded from the real frame rather than assumed;
  delegated when the API build omits it, with every other permission preserved.

`autoplay-permission.test.ts` — 13 tests. The deployed header is sent, never disables
autoplay, names both embed origins, and still closes camera/microphone/geolocation/payment.
Token merging preserves existing permissions, handles an absent attribute, recognises a
token that carries its own allowlist, and is not fooled by a similarly-named feature.

Existing coverage retained: visibility timing, hidden document, blocked, stale cue, trace.

## E2E

`collection-youtube-handoff.spec.ts` — now 28 tests. New:

- **`the player is running: no overlay, Pause showing, progress advancing`** — §27's
  mandatory assertion in the terms a person would use. YouTube's own player reports it has
  started (which is what removes the red overlay), Pulse's control reads Pause and there is
  exactly one of it, and the clock moves — which a cued player's never does. Nobody tapped.
- Retained from the previous pass: a play command is issued and Pause is reached with a
  press count asserted at zero; a genuine refusal is handled with one attempt, one Play
  button, the quiet line, no retry, and the collection still on B.

## Physical-device status

**UNVERIFIED. Not claimed.** No hardware test was performed.

Open the deployed app with `?debugPlayback=1`, save `Audio A, YouTube B, Audio C`, play A
in the foreground and let it finish. The panel in the expanded view now reads:

```
status          playing
ratio           0.96
measured        true
waited (ms)     8
wait ended      observed
player ready    true
iframe autoplay true
decision        play
withheld        —
commands        cue → loadVideoById
states          cued → buffering → playing
outcome         started
blocked         false
awaiting        —
```

| Reading                                                       | Meaning                                       | Next step                                            |
| ------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `states` ends `playing`, `blocked false`                      | Fixed.                                        | Nothing.                                             |
| `iframe autoplay false`                                       | The frame was never delegated the permission. | A configuration problem — capture the `allow` value. |
| `decision cue`, `withheld visibility`                         | The player really was not visible enough.     | A layout problem; capture `ratio` and `wait ended`.  |
| `decision cue`, `withheld player-not-ready`                   | The API script did not load in 4s.            | Network or CSP.                                      |
| `decision play`, `blocked true`                               | The browser refused, out loud.                | Platform boundary.                                   |
| `decision play`, `outcome no-start`, `states` stops at `cued` | The browser refused **silently**.             | Platform boundary.                                   |

The last two are the same conclusion: **BLOCKED BY MOBILE BROWSER/PROVIDER AUTOPLAY
POLICY.** Do not invent another workaround.

Android Chrome and iOS Safari must be recorded separately — they do not share an autoplay
policy and one device proves nothing about the other. Run desktop Chrome through the same
flow: if desktop auto-starts and the phone does not while both report `decision play` and
`iframe autoplay true`, that is strong evidence for the mobile boundary rather than for
anything in this codebase.

## Known platform limitations

- **Mobile browsers may refuse an unmuted scripted start** minutes after the last gesture,
  regardless of visibility, readiness and permission. That is the boundary; the honest
  response is the one Play button and the one quiet line the app now shows.
- **Permissions policy is fixed at frame creation.** If a future IFrame API build omits
  `autoplay` _and_ the synchronous delegation misses the element, the token cannot be added
  retroactively for the loaded document. The debug panel would report `iframe autoplay
false`, which is the signal to switch the adapter to the API's documented
  "control an existing iframe" construction mode.
- **2500ms is a judgement** for the confirmation window, chosen so a slow buffer is not
  mistaken for a refusal. A device slower than that reports `no-start` and shows one Play
  button — the correct failure, but one a faster device would not have had.
- **The debug panel shifts the transport down** while enabled. It renders nothing in a
  normal session.
