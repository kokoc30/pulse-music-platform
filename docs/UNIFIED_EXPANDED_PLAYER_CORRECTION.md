# Unified expanded Now Playing — YouTube correction pass

A corrective UI/UX pass, not a redesign. The YouTube expanded player worked; it
did not look or behave like the same player as the audio one. This document
records what actually differed, what changed, and what was deliberately left
alone.

## Root cause

Two independent defects, both small, both in places that had drifted from what
they claimed to be.

**1. The sheet changed size with the engine.** `player-shell.css` carried

```css
.player-shell[data-mode='expanded'][data-stage='youtube'] {
  width: min(820px, 100%);
}
.player-shell[data-mode='expanded'] .yt-stage-frame {
  width: 100%;
  max-width: 760px;
}
```

so Now Playing was 560px wide for a track and 820px for a video, with 760px of
that filled by the embed. The reasoning in the comment was sound — a widescreen
player wants width a square cover does not — and the result was still wrong: the
screen changed proportion depending on what was loaded, and the app's own
controls read as an afterthought stacked below a dominant video. That is the
"too large / feels like a different product" report.

**2. The transport row changed shape with the engine.** The ten-second controls
were gated on `can.queue`:

```tsx
{can.queue ? <button …>Seek back 10 seconds</button> : null}
```

`can.queue` is `true` for audio and `false` for YouTube, so the gate happened to
spell "audio only" — but a queue is a _running order_, and moving ten seconds
inside one item has nothing to do with having one. Five controls for a track,
three for a video, in the same slot on the same screen.

Nothing was broken about the underlying plumbing: `unifiedSeekBy` already routed
to both engines, and `seekYouTube` already drove YouTube's documented `seekTo`.
The control was simply never rendered.

## What changed

### One sheet, one width

`[data-stage='youtube']` no longer widens the surface. Both engines get
`min(560px, 100%)`. The one place the widening genuinely earned its keep — the
short-landscape two-column layout, where a 200px-floor video sits beside the
controls — keeps it, scoped to that media query alone.

### A compact media card

The stage is now a card _inside_ the media slot rather than the slot itself:

```css
.player-shell[data-mode='expanded'] .yt-stage-frame {
  align-self: center;
  width: min(var(--yt-stage-expanded-width), 100%); /* 420px */
  aspect-ratio: 16 / 9;
  min-height: var(--yt-stage-floor);
  border-radius: var(--radius-surface);
  box-shadow: var(--shadow-play);
}
```

420 × 236 against the cover's 320 × 320 — the same centred box, in the same
place, with the same radius and shadow. Down from 760 × 428.

**An honest limit.** On a phone this is already at its minimum and cannot be made
smaller: YouTube's documented floor is 200 × 200, so the narrowest compliant 16:9
card is 356 × 200, and a 390px viewport has ~354px of content width. The mobile
video region was therefore _already_ compact — the visible compaction lands on
tablet and desktop. What mobile gains from this pass is the consistent control
set and the two layout fixes below.

### The floor, and a pixel of clearance

Fixing the card size surfaced a genuine compliance bug. A box laid out at
_exactly_ `200px` renders on a fractional device-pixel grid — a Pixel 5 runs at
2.75× — and measures back as `199.99998px`. Nothing looks wrong, but it is no
longer truthful to say the player is at least 200 × 200, and the new e2e
assertion caught it intermittently.

`--yt-stage-floor: 201px` is now used by every box that would otherwise sit _on_
the floor — the expanded card, the docked frame, and the stage's own restated
minimum. `--yt-stage-min: 200px` stays as the documented constant it is.

### Safe centring on a phone

The mobile shell is a centred flex column that scrolls. A centred flex column
that overflows pushes its **first** child past the scroll origin, where no amount
of scrolling reaches it — on a short phone that is the grab handle and the video.
`justify-content: safe center` fixes it, declared after plain `center` so a
browser without `safe` keeps the previous behaviour.

### Ten-second controls for both engines

The gate is now `can.seek`, which is what the control is actually about. Both
engines publish `seekTo`; both get the buttons, in the same position, at the same
size, with the same labels.

### One effective duration

`seekYouTube` consulted the store's `duration` alone, which is `0` until the embed
reports one. The read model has always covered that gap with the item's own
published length so the rail is never dead on arrival — so the app drew a live
scrubber, and now two enabled buttons, over a seek that silently refused.

`youTubeSeekLimit(state)` returns `state.duration || state.item?.durationSeconds || 0`,
and both the rail and the ten-second controls use it. The engine still clamps
against the player's own duration, which is authoritative; this is the app's gate.

The _position_ is written back to the store and the duration is left as it was: a
length that came from metadata is not something the player reported, and writing
it in would turn a display fallback into a claim about the embed.

## What was deliberately not changed

**Shuffle, repeat, Up next, volume stay absent for a video.** A result session has
no running order to reorder or repeat, there is no queue panel behind it, and the
embed's volume is the visitor's own business through YouTube's native controls.
The rule is "expose what is truly supported; do not fake the rest", and these fall
on the other side of it. `NowPlaying.test.tsx` pins that.

**No skinning of the iframe.** The embed is YouTube's player and stays that way:
native controls on, nothing drawn over it, no synthetic gestures, no undocumented
options, no autoplay workarounds. What is unified is the app shell _around_ it —
handle, media slot, title, credit, actions, seek row, transport, secondary row.

**No new player state.** One snapshot, one expanded/collapsed flag, one engine
claim, one library key. Every control calls the same `unified*` action the
mini-player calls. Nothing in this pass added a store, an action or a branch.

**The autoplay and recovery work is untouched.** `youtube-engine.ts` was not
modified. Visibility still requires a measured ratio strictly greater than 0.5, a
hidden document still refuses, and the Play-button recovery still holds.

## Duplicate controls

Already structurally impossible — `GlobalPlayer` renders `expanded ? <Sheet/> :
<Bar/>`, so the mini-player is _not rendered_ rather than hidden — and now
asserted rather than assumed, at both levels:

- component: exactly one Play, one scrubber, one Next, one Previous and one
  ±10 control in the whole document while expanded; no `.music-player`; one
  `.player-shell`; one stage;
- e2e: one `.now-playing-transport` on the page, no mini-player, and collapsing
  hands back exactly one bar with the iframe never rebuilt.

## Files changed

| File                                                   | Change                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `src/components/player/NowPlayingSheet.tsx`            | ±10 controls gated on `can.seek`, not `can.queue`                                                   |
| `src/player/youtube-actions.ts`                        | `youTubeSeekLimit()`; `seekYouTube` uses it and no longer writes a metadata duration into the store |
| `src/player/unified-actions.ts`                        | `unifiedSeekBy` YouTube branch uses the same limit                                                  |
| `src/styles/player-shell.css`                          | one sheet width; compact centred media card; `safe center`; landscape widening scoped               |
| `src/styles/tokens.css`                                | `--yt-stage-expanded-width`, `--yt-stage-floor`                                                     |
| `src/styles/youtube.css`                               | stage's restated floor uses the clearance                                                           |
| `src/components/player/UnifiedExpandedPlayer.test.tsx` | **new** — 13 tests                                                                                  |
| `src/components/player/NowPlaying.test.tsx`            | the ±10 assertion for YouTube reversed, with the reasoning recorded                                 |
| `tests/e2e/now-playing.spec.ts`                        | 4 new video tests; `Play`/`Pause` locators made exact                                               |
| `tests/e2e/collection-youtube-handoff.spec.ts`         | desktop layout assertion updated to the card; `endCurrentVideo` race guard                          |
| `tests/e2e/fixtures.ts`                                | fake IFrame API gained the documented `seekTo`, recording `lastSeek`/`seekCalls`                    |

## Tests

**Component** (`UnifiedExpandedPlayer.test.tsx`) — the shell is asserted as a
_comparison_ rather than a list of class names: the audio expanded view is
rendered, its structure captured, then the YouTube one is compared against it.

- the transport row is the same five controls in the same order for both engines
- the same structural regions (`meta`, `titles`, `actions`, `transport`)
- collapse affordance, grab strip and scrubber present for a video
- the player occupies the media slot; no placeholder cover beside it
- heart and menu in the same action row
- exactly one Play / scrubber / Next / Previous / ±10 in the document
- no `.music-player` beneath; one shell, one stage
- collapse hands back one bar with the iframe never rebuilt
- ±10 forward and back drive the real `seekTo`, clamp at 0 and at the length,
  work before the embed reports a duration, and update the visible time readout

**E2E** (`now-playing.spec.ts`, video block) — same sheet width as a track, a
centred 16:9 card that is narrower than the sheet and clears the 200px floor in
both dimensions; ±10 both ways with clamping; the full transport row with one of
each on the page; play/pause from the sheet. The mobile viewport runs the same
block, plus the existing checks that every control stays inside the viewport.

One existing e2e assertion was updated rather than deleted: the desktop hand-off
test required `stage.width >= 480`, which encoded the oversized design this pass
removes. It now asserts the documented 200 × 200 floor, 16:9, and that the card
sits centred _inside_ the sheet.

## Gates

```
pnpm typecheck     pass
pnpm lint          pass (0 warnings)
pnpm test:run      pass — 2102 tests, 110 files
pnpm build         pass
pnpm test:e2e      pass — 539 passed, 29 skipped
pnpm verify:bundle pass — 0 matches across 12 files
```

Prettier was run on the touched files only.

## Not verified

- **No manual QA on a physical device.** The mobile assertions run at a 390 × 844
  Pixel 5 viewport in Chromium, which is not the same as a phone; safe-area
  insets in particular are `0px` in that environment, so the `env(safe-area-inset-*)`
  padding is exercised but never non-zero.
- **`justify-content: safe center` has no automated coverage** for the case it
  fixes — a viewport short enough to overflow the expanded column. It is a
  progressive enhancement: browsers without it behave exactly as before.
- **Desktop and tablet compaction is asserted structurally** (the card is
  narrower than the sheet, centred, 16:9, above the floor) rather than judged
  visually. Whether 420px is the right weight beside a 320px cover is a design
  call worth a real look.
