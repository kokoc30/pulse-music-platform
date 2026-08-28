# 07 — Player Behavior Specification

## Goal

The music player is not a decorative component. It is core application infrastructure.

There must be one global playback session.

---

## Core State

Minimum state:

```ts
type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'error'

interface PlayerState {
  status: PlayerStatus
  currentTrack: Track | null
  queue: Track[]
  currentIndex: number
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  error: string | null
}
```

Add repeat/shuffle only if the reference uses them.

---

## Single Audio Engine

Use one `HTMLAudioElement`.

It may be:
- created once in an audio engine module, or
- rendered once in a top-level provider.

Do not create audio elements in track cards/rows.

---

## Required Audio Events

Handle at minimum:

- `loadstart`
- `loadedmetadata`
- `canplay` as useful
- `play`
- `pause`
- `timeupdate`
- `durationchange`
- `volumechange`
- `ended`
- `error`

Keep event listener ownership centralized.

---

## `playTrack(track, context?)`

Required behavior:

1. Validate streamability.
2. Determine queue context.
3. Set current track.
4. Set loading state.
5. Resolve stream source.
6. Assign audio source only if this is still the current request.
7. call `audio.play()` from/after user gesture path.
8. handle rejected play promise.
9. synchronize UI status.

Avoid race conditions when users click multiple tracks quickly.

Use a monotonically increasing load token or equivalent cancellation mechanism.

---

## Queue Semantics

When a user clicks a track in a result list:
- queue should normally become that list or a sensible context derived from it,
- clicked track becomes current index.

When clicking a standalone card:
- use the surrounding section as context if available.

`next()`:
- advances current queue,
- does not crash at end.

`previous()`:
- if current time is meaningfully into the track (commonly > 3 seconds), restarting current track is acceptable if that matches reference/product convention;
- otherwise go to previous queue item.

Pick one behavior and test it.

---

## Ended Behavior

On `ended`:
- advance to next queue track,
- if no next track:
  - stop/paused according to chosen semantics,
  - reset status consistently,
  - do not enter a loop unless repeat is enabled.

---

## Seek

Seeking must:
- clamp between 0 and duration,
- be disabled/ignored before valid duration exists,
- update the real audio element,
- work via click/drag according to reference control.

Do not fake progress independent of the audio element.

---

## Volume

Range:
- `0` to `1` internally.

UI can display percent.

Mute must preserve previous volume behavior sensibly.

Optional:
- persist volume in `localStorage`.

If persisted:
- validate stored value,
- do not autoplay.

---

## Time Updates / Rendering

Native `timeupdate` can update store.

Avoid causing the entire app to rerender with every tick.

Components should subscribe to narrow selectors.

Do not implement a 60fps global React state loop unless reference animation actually needs it.

---

## Track Change

When source changes:
- reset currentTime display,
- remove previous media errors,
- update metadata immediately,
- update artwork/title/artist without waiting for audio bytes,
- loading indicator should match reference.

---

## Media Errors

Never leave player stuck in "loading."

On media error:
- capture a safe error,
- set status `error`,
- show reference-style feedback,
- leave search/navigation usable,
- allow user to play another track.

If a track is unavailable/gated:
- do not repeatedly retry it forever.

---

## Autoplay Policy

Initial playback must follow a user gesture.

Do not attempt to auto-play music on first site load.

After a user starts a playback session, advancing to next track may be attempted automatically; handle browser rejection if it occurs.

---

## Navigation Persistence

Changing routes/search query must not reconstruct the audio engine.

The player should remain alive while SPA navigation occurs.

---

## Accessibility

Controls must have:
- semantic `<button>`,
- accessible names,
- keyboard focus,
- disabled states,
- `aria-valuetext`/appropriate semantics for sliders where relevant.

Do not make clickable `<div>` the only control surface.

---

## Mobile

Follow the reference.

Common pattern:
- mini-player above mobile navigation,
- tap opens expanded now-playing,
- full player uses same global engine/state,
- no second audio element.

---

## Test Cases

At minimum automate:

- click result -> current track set,
- play -> playing state,
- pause -> paused,
- seek clamps,
- volume changes,
- mute toggles,
- next,
- previous,
- ended advances,
- media error clears loading,
- rapid track changes do not allow stale stream to win,
- route navigation does not reset current track.
