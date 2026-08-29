# Expanded Audio Now Playing

A full-screen Now Playing surface for the audio catalogues (Audius and Jamendo),
reachable by a control or by swiping up from the mini-player, carrying a large
scrubber and ±10 second seek controls.

## Status

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS — 0 errors |
| `pnpm lint` (`--max-warnings 0`) | PASS — 0 errors, 0 warnings |
| `pnpm test:run` | PASS — 94 files, 1767 tests |
| `pnpm build` | PASS |
| `pnpm verify:bundle` | PASS — 0 secret matches across 12 files in `dist/` |
| `pnpm test:e2e` | PASS — 409 passed, 29 skipped, 0 failed |

`pnpm format:check` fails, and failed before this work: 138 files are flagged,
133 of which this change never touched. `src/components/feedback/EmptyState.tsx`
is unmodified against `HEAD` and still fails, so the repository does not match
its own Prettier configuration at baseline. The five files in this change that
were flagged have been formatted; nothing else was reformatted, because
rewriting 133 unrelated files would bury the diff. Fixing the baseline is worth
doing as its own commit.

## What this is

The bottom bar stays exactly as it was. Above it, an expandable sheet shows the
same track larger: artwork, title, artist, provider attribution, the like
control and the track menu, a seek rail with a real hit area, transport, shuffle
and repeat, and a route into the existing queue panel.

It is a *view*. It owns no playback state of its own.

## The invariants, and how they are held

The brief's hard rule was that this must not become a second player. Verified
by inspection of the tree and by test:

| Invariant | Evidence |
| --- | --- |
| One `HTMLAudioElement` | `src/player/audio-engine.ts:56` is the only construction site in `src/`. E2E asserts `document.querySelectorAll('audio').length === 1` across an open/close cycle. |
| No second store | Stores are unchanged in number: `ui-store`, `library/store`, `personalization/store`, `player-store`, `youtube-store`. The sheet is a consumer of all of them. |
| No second queue | The sheet's Next/Previous call `playNext`/`playPrevious`; "Up next" opens the existing queue panel. |
| No duplicate progress state | Position comes from `usePlayerStore`. The only local state is `preview`, the value under a finger mid-drag, discarded on release. |
| No duplicate actions | Every control routes to `player-actions`. |
| No Web Audio, no crossfade | `AudioContext`, `createGain`, `crossfade` appear nowhere in `src/`. |
| No proxying or downloading | No new network path exists; see the zero-request test below. |

## Seeking

`seekBy` is new and central:

```ts
export const SEEK_STEP_SECONDS = 10

export function seekBy(deltaSeconds: number, store: Store = usePlayerStore): void {
  if (!Number.isFinite(deltaSeconds)) return
  const state = store.getState()
  if (state.duration <= 0) return
  seek(state.currentTime + deltaSeconds, store)
}
```

It delegates to the existing `seek`, so relative and absolute seeking clamp
through one code path rather than two. `MediaSessionHost` now routes the OS lock
screen's own `seekbackward`/`seekforward` through it as well, which means the
lock screen and the sheet cannot disagree about what ten seconds means.

Keyboard granularity on the rail is one second per arrow key
(`SEEK_ARROW_SECONDS = 1`), ten per Page key, with Home and End for the ends.
The step is computed as a fraction of duration, so it stays one second whether
the track is two minutes or twenty.

`src/player/seek-by.test.ts` (11 tests) covers both directions, clamping at zero
and at duration, refusal when duration is unknown, refusal of `NaN` and
`Infinity`, and that extreme deltas produce a finite in-range position.

## Gestures

`src/components/player/swipe.ts` keeps the decision as a pure function —
`swipeDirection({dx, dy, elapsed})` — so the thresholds are testable arithmetic
rather than something that needs a device to reproduce. 56 px of travel, a 1.4:1
vertical bias, and an 800 ms ceiling.

Two defects were found and fixed here by the browser tests, both of which would
have shipped as "the swipe just doesn't work sometimes":

**Pointer release outside the element.** The handlers were bound to the grab
area, but a swipe by definition ends somewhere else. Releasing 90 px above the
mini-player delivers `pointerup` to whatever is under the finger *there*, so the
gesture never completed. A Playwright probe showed `pointerdown` arriving and
`pointerup` never following. Fixed with `setPointerCapture` on the tracked
gesture, released on up. Capture is taken only when a gesture is genuinely being
tracked — never when the press landed on a control — so buttons, links and the
rails keep their own events.

**A handle that was mostly button.** The sheet's swipe zone was the whole
header, whose centre is the collapse button; `isInteractiveTarget` correctly
refused, which left the visible grip undraggable. The grab strip is now its own
full-width element wrapping the grip, so it has a touch target worth aiming at
and the button underneath keeps its ordinary click.

`isInteractiveTarget` still excludes `button, a, input, select, textarea,
[role="slider"]`, menus, and anything marked `[data-no-swipe="true"]` — which is
what stops a scrub from closing the sheet.

Covered by `swipe.test.ts` (13 tests) plus four browser tests: an upward swipe
opens, a downward swipe on the grip closes, a 6 px wobble does nothing, and a
scrubber drag that wanders 120 px downward leaves the sheet open.

## It never covers the video

The sheet reads `useVideoSurfaceOpen()` and stands down entirely while a YouTube
video surface is on screen. There is no expanded surface for YouTube tracks, and
no path by which the audio sheet can paint over the iframe. Pinned by
`tests/e2e/now-playing.spec.ts` → "stands down while a YouTube video is on
screen".

The sheet's provider backlink uses `rel="noopener"` only. `noreferrer` is
forbidden on YouTube links by the Developer Policies, and
`youtube-security.test.ts` enforces this across client source — it caught an
early draft of this component.

## Zero provider cost

Everything the sheet displays is already in the store. A browser test attaches a
request listener, pauses playback to remove the stream resolutions that belong
to playback rather than to this surface, then opens the sheet, seeks forward and
back ten seconds, arrows the rail both ways, and collapses — asserting the
recorded call list is exactly empty.

## Accessibility

`role="dialog"`, `aria-modal="true"`, `aria-label="Now playing"`. Focus moves to
the collapse control on open and returns to the control that opened it on close
— asserted, not assumed: the Escape test ends with
`expect(getByRole('button', { name: 'Open Now Playing' })).toBeFocused()`.

Escape closes. Body scroll is locked while open and the exact `window.scrollY`
is restored on collapse, which is also asserted rather than described.

The expand control is a real button, not only a gesture. The reference stylesheet
hides `.player-track > button` below 560 px, which would have left the phone
layout with no keyboard- or screen-reader-reachable route into the sheet; the
control is restored at that width, smaller. A swipe is not a substitute for a
control.

Motion is behind `prefers-reduced-motion: no-preference` and animates `transform`
and `opacity` only. Safe-area insets are honoured top and bottom.

## Files changed

Modified:

- `src/player/player-actions.ts` — `seekBy`, `SEEK_STEP_SECONDS`
- `src/features/playback/MediaSessionHost.tsx` — lock-screen skips routed through `seekBy`
- `src/app/ui-store.ts` — `nowPlayingOpen`, `setNowPlayingOpen`, included in `closeOverlays`
- `src/player/player-selectors.ts` — `useVideoSurfaceOpen()`
- `src/components/player/PlayerProgress.tsx` — `variant: 'bar' | 'sheet'`, keyboard steps, drag preview
- `src/components/player/RangeRail.tsx` — `pageStep`, `className`
- `src/components/player/PlayerTrackInfo.tsx` — expand control, swipe-up zone
- `src/components/player/GlobalPlayer.tsx` — renders the sheet
- `src/styles/index.css`, `src/test/render.tsx`

Added:

- `src/components/player/NowPlayingSheet.tsx`
- `src/components/player/swipe.ts`
- `src/styles/now-playing.css`
- `src/components/player/NowPlaying.test.tsx`, `swipe.test.ts`, `src/player/seek-by.test.ts`
- `tests/e2e/now-playing.spec.ts`

## Tests

New: 53 unit and component tests (`swipe.test.ts` 13, `seek-by.test.ts` 11,
`NowPlaying.test.tsx` 29) and 39 browser tests across the desktop and mobile
projects.

No existing test was deleted, skipped, or weakened. Three assertions in the new
E2E file were changed during the run, each for a reason that was a flaw in the
test rather than in the product:

1. `getByRole('button', { name: 'Play' })` matched two elements, because
   Playwright's name matching is substring-based and "Collapse Now Playing"
   contains "Play". Now `{ exact: true }`.
2. The ten-second test asserted an exact playhead position on a *playing* two-
   second clip. It passed in isolation and failed under full-suite load, which is
   a race, not a check. It now pauses first, which makes the arithmetic
   deterministic and still exercises both directions and the clamp.
3. The zero-request test counted the stream resolution belonging to playback
   itself. It now pauses and zeroes the tally after metadata lands, so it
   measures the sheet's cost and nothing else.

The swipe-down test's selector moved from `.now-playing-head` to
`.now-playing-grab` because the production markup changed, not to dodge a
failure — the original assertion was correct and was failing for a real reason.

Both fixed gesture defects were found by these tests and fixed in production
code, which is the outcome the tests existed for.

## QA

Automated, in Chromium at 1440×900 and 390×844 (VERIFIED):

- Opens from the control and from a swipe up; closes from the control, Escape,
  and a swipe down.
- Audio never stops across open, close, navigation, or a track change; exactly
  one `<audio>` throughout.
- The sheet follows an autoplay transition in place without closing.
- Scrub, ±10, play/pause, previous/next, shuffle, repeat, like, and the queue
  panel all act on the same state as the bottom bar.
- Liking from the sheet produces the same stored key as liking from a row.
- The heart on the sheet is at least 36×36 px.
- Scroll position is restored on collapse.
- Zero provider requests for open, seek and close.

**UNVERIFIED — no physical device was used.** Nothing below was tested on real
hardware, and no result for it is claimed:

- Touch swipe feel on a real touchscreen, including against iOS Safari's
  edge-swipe back gesture and Android's gesture bar.
- Lock-screen and notification-shade behaviour of the ±10 controls on iOS and
  Android, including whether the OS renders them as skip or as seek.
- Background playback continuity with the screen off on a real phone.
- Safe-area rendering on a notched device or a device with a home indicator.
- Behaviour on a real slow network or with a real provider's live stream.

The Chromium mobile project emulates a viewport and touch, which is not a phone.

Production endpoints remain unverifiable from here: Vercel Deployment Protection
returns `302 → vercel.com/sso-api` for `/`, `/api/jamendo` and `/api/youtube`,
`vercel whoami` reports logged out, and no `VERCEL_AUTOMATION_BYPASS_SECRET` is
available. This is unchanged from the two previous phases and is not a
regression introduced here.

## Known limitations

- The sheet is audio-only by design. YouTube tracks keep the bottom bar and the
  video surface, with no expanded view.
- The swipe-up zone is the mini-player's text block, not the whole bar. Pressing
  the artwork or a control does not start a gesture — deliberate, so the
  controls stay controls.
- Pointer capture means a gesture begun on the grab strip owns the pointer until
  release. Nothing else on the sheet needs that pointer, but it is a constraint
  worth knowing before adding a nested draggable there.
- The seek rail's one-second keyboard step is derived from duration, so on a
  track whose duration is not yet known the rail is inert rather than
  approximate.

## Deliberately not done

No accounts, no cloud sync, no lyrics, no social feed, no crossfade, no offline
downloads, no new providers, no provider OAuth. No change to YouTube background
playback policy, which remains disabled.
