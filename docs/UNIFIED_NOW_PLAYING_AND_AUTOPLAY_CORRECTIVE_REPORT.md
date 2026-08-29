# Unified Now Playing, and why autoplay stopped moving

A corrective pass over three reported bugs. Two were real and are fixed; the
third turned out to be correct behaviour, and this report says so rather than
inventing a change.

## Status

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS — 0 errors |
| `pnpm lint` (`--max-warnings 0`) | PASS — 0 errors, 0 warnings |
| `pnpm test:run` | PASS — 98 files, **1814** tests (was 94 / 1767) |
| `pnpm build` | PASS |
| `pnpm verify:bundle` | PASS — 0 secret matches across 12 files in `dist/` |
| `pnpm test:e2e` | PASS — **428** passed, 30 skipped, 0 failed (was 409 / 29) |

`pnpm format:check` still fails at the repository baseline: **126** files, none
of them touched by this change. Every file this change did touch satisfies
Prettier. The baseline was 138 before this pass and is lower only because files
this work happened to open were formatted on the way past.

## Reported real-device bugs

| # | Report | Verdict |
| --- | --- | --- |
| A | Search a song, play it; Next is disabled, the track ends without a similar one following, and turning Repeat on makes Next replay the same song | **Two real bugs.** Fixed. |
| B | Start a YouTube video while an Audius track is loaded; the bottom bar keeps announcing the Audius track | **Real bug.** Fixed. |
| C | `Aram Asatryan` did not automatically fall back to YouTube | **Not a bug.** Explained below with evidence; no code changed. |

## Bug A, part one — Next disabled

`useHasNext` answered a narrower question than the button was asking:

```ts
s.repeatMode === 'one' || nextQueueIndex({ … }) !== null
```

It considered the explicit queue and repeat, and **never considered
`autoplaySimilar`**. Playing one result from a search seeds a queue of exactly
one track, so `nextQueueIndex` returns `null`, repeat is off, and the control
went grey — while `playNext`, sitting directly behind that same button, was
perfectly able to generate a similar track. The control and the action disagreed
about what Next could do.

`useCanSkipNext` replaces it and asks the real question: is there a *distinct
destination*? A further queue position, a repeat-playlist wrap that lands
somewhere else, or autoplay with a track to seed from.

Repeat one is deliberately **not** counted. It can always replay the current
track, so counting it would light the button up on a one-track queue with
autoplay off — and pressing it would then do the one thing a press of Next must
never do. `useHasNext` was deleted rather than left beside its replacement; a
dead selector with a misleading name is what caused this in the first place.

## Bug A, part two — Repeat turned Next into a replay button

Natural completion and a button press ran the same function. So with Repeat one
on, a press of Next hit precedence rule 1 and replayed the current track; and a
Repeat-playlist queue of one track wrapped from index 0 to index 0, which is the
same thing by another route.

The two intentions are now distinct:

- `handleTrackEnded()` — unchanged precedence: repeat one → explicit queue →
  repeat playlist → autoplay → stop.
- `skipToNext()` — the single action behind **every** Next a visitor can press:
  the bottom bar, the expanded Now Playing sheet, the Media Session's
  `nexttrack`, and a headset button. It differs in exactly two ways, both the
  same idea — *leave this song*: repeat one does not answer it, and a
  single-track repeat-playlist queue does not wrap onto itself.

Everything else is untouched. A genuinely queued track still outranks anything
generated, and `A B C` at `C` under Repeat playlist still wraps to `A`, because
`A` is a different track.

## Bug A, part three — why nothing similar ever played

This is the part that needed evidence rather than reasoning, so the live Audius
API was queried directly. A search for `Kosandra` returns fifteen rows:

```
[S] "Miyagi & Andy Panda - Kosandra (Official Audio)" | user="tttyyu7"
[S] "Miyagi & Andy Panda - Kosandra (Official Audio)" | user="ldhcuhu"
[S] "Kosandra Miyagi & Andy Panda Nitrixx Bass House Remix" | user="Nick11"
[S] "Miyagi & Andy Panda - Kosandra (Official Audio)" | user="ssss"
…ten more, mostly the same recording
```

Thirteen of the fifteen are **the same recording**, re-uploaded by throwaway
accounts. The uploader lands in `Track.artistName`.

`isSameSongVariant` requires the artists to agree before calling two rows one
song — a deliberately conservative rule, so a cover by a different act stays a
separate song. Against this data it compared `tttyyu7` with `dfghjb`, concluded
"different artists, therefore different songs", and let every re-upload through.
Planning from the real pool produced:

```
BUFFER: Kosandra (Official Audio) | dfghjb          ← the same song
        Kosandra (Official Audio) | ihiuhb          ← the same song
        Kosandra (Official Audio) | eeeeeeeerrrrrrr ← the same song
        Kosandra Nitrixx Bass House Remix | Nick11
        Kosandra (Official Audio) | ldhcuhu         ← the same song
```

So the reported "the same song remains/replays" was literally true: autoplay was
selecting Kosandra to follow Kosandra. **This is root cause D from the brief's
list — duplicate suppression failing on re-uploaded metadata — and not C, E or
F.** Nothing was wrong with `handleTrackEnded`, the refill, or stream
resolution.

### The fix: read the artist the title states

`artistHintFromTitle` parses `Artist - Title` when — and only when — the title
says so confidently: exactly one separator, spaces on both sides (so `Jay-Z` and
`Anne-Marie` are never split), a left half that is not a bare track number, and
a right half that still names something once decoration is stripped. That last
rule matters: `Kosandra — Official Audio 4K` parses as a pair, but its right
half is pure decoration, which means the dash separated a title from its own
labels rather than an artist from a title — so the provider's artist stands.

The parsed artist is used **only** to answer "is autoplay about to play this
song again?" It never rewrites `Track.artistName`, never reaches provider
attribution, and never changes what is displayed or credited. A re-upload is
still shown and linked exactly as the provider described it.

After the fix, the same real pool plans:

```
BUFFER: Kosandra Nitrixx Bass House Remix | Nick11   ← a different take
        Indra Indra Madhuchandra ! Kosandra ! Bgm    ← a different song
        …
```

## Candidate-supply audit, and the Audius decision

The brief asked whether `/tracks/recommended` is usable. It was queried live
rather than assumed:

- `/tracks/recommended` with no arguments returns a generic 100-row list — no
  seed track parameter exists.
- `/tracks/recommended?genre=Hip-Hop/Rap` returns **the same rows** as
  `/tracks/trending?genre=Hip-Hop/Rap`.

So it is not a similarity endpoint, and treating it as one would be inventing a
meaning the provider never gave it. It was **not** adopted under that name.

What was adopted is the bounded thing it actually offers: one genre-scoped
request, through `getTrendingTracks({ genre })` — a provider method the app
already had, so no new endpoint, no new normalization, and no new API surface.
It is called `genre-fallback` in the candidate source type, because that is what
it is: other tracks in the same genre, not the same sound.

Bounds:

- **Audius seeds only.** See below.
- Spent only when the plan from the free pass is **empty** — a pool full of
  candidates that all fail the rules is as useless as no pool.
- Only when the seed carries a genre to scope by; an unscoped call would be a
  popularity list, which is not a continuation of anything.
- Exactly one request, never retried, even when it too returns nothing.
- A failure yields fewer candidates and is never surfaced as an error.

### Why the fallback is Audius-only

Audius publishes no similar-tracks endpoint, so an exhausted Audius refill has
spent nothing and has nowhere else to look — one genre-scoped request is the
difference between a continuation and silence.

Jamendo is not in that position. It has a real `/tracks/similar`, and when the
provider's own answer to "what is like this track" comes back empty, that is a
judgement, not a gap. Following it with a generic same-genre list would override
a provider opinion that had already arrived, and would quietly turn Jamendo's
documented one-request budget into two.

So a Jamendo seed spends its one similarity request and stops cleanly — no genre
fallback, and no second Jamendo request either. The ceiling is **one provider
request per refill, for either seed**; the free Audius pass and the bounded
Audius fallback are the same single allowance claimed at different moments.

## Request budget

| Situation | Requests |
| --- | --- |
| Audius seed, session pool can answer | **0** |
| Audius seed, pool exhausted → one genre-scoped request | **1**, once, no retry |
| Audius seed with no genre, pool exhausted | **0** — stops cleanly |
| Jamendo seed, `/tracks/similar` | **1**, whatever it returns |
| Jamendo seed, similarity empty or failed | still **1** — never a genre fallback |
| Ceiling for any one refill | **1** |
| Global bar rendering a YouTube item | **0** |
| Bar's YouTube Next / Previous | **0** — reads `sessionItems` only |
| Opening, seeking or collapsing the audio sheet | **0** |

The YouTube quota model is untouched: one `search.list`, one batched
`videos.list`, per-query session cache, no search-as-you-type, no search on
natural end, and `relatedToVideoId` appears nowhere.

## When there is genuinely nowhere to go

Playback pauses cleanly at position 0 — it never silently replays the current
song. A press of Next also raises one notice, *No similar track available right
now.* A track that simply ends stays quiet, because a toast on every natural
ending is noise nobody asked for.

## Bug B — the stale bottom bar

`GlobalPlayer` read `useCurrentTrack()` from the audio store and nothing else.
When YouTube took over, `activateYouTube()` paused the audio element but
**deliberately preserved** its track, position and queue so the visitor could
come back to them. That engine behaviour is correct and was left alone; the bar
simply had no way to ask whose turn it was, so it went on announcing a track
that had stopped.

The fix is presentational, and the engines stay separate:

- `useActiveEngine()` mirrors the coordinator through `useSyncExternalStore`,
  subscribing to the `onEngineChange` notification that already existed for the
  Media Session. There is no second `activeEngine` in Zustand and nothing writes
  it — the coordinator remains the single source of truth.
- `GlobalPlayer` renders `YouTubeMiniPlayer` while YouTube holds the claim, the
  audio bar otherwise, and the join strip when neither has anything.

`Track` and `YouTubeVideoItem` were **not** merged, no YouTube item enters the
audio queue, and nothing routes through `HTMLAudioElement`. Only the
presentation is shared.

### What the YouTube bar does and does not do

Every control calls a YouTube action — `toggleYouTubePlayback`,
`playYouTubeSessionStep(±1)`, enabled by `hasYouTubeSessionStep`. No
`togglePlay`, no `playNext`, no `seek`, no queue movement. Progress is
informational with no thumb, because scrubbing belongs to the official player's
own controls. Tapping the bar points at the visible player through a UI token
rather than opening a second view of it; no second iframe is ever created and
nothing is drawn over the stage.

A standalone video — opened from Recently Played or the library — has no session,
so both step controls are disabled. That is truthful rather than decorative.

Below 560px the reference leaves only the round play button on the bar, so the
phone bar carries title, channel and play/pause; stepping there is done in the
player's own footer, which is on screen anyway.

### Closing the video

`closeYouTubeSurface` stops playback and releases the claim, so the bar returns
to the preserved, paused audio track showing **Play**. Nothing resumes on its
own — resuming stays the visitor's decision. With no audio track loaded, the join
strip returns.

## Media Session boundary — unchanged

`MediaSessionHost` still deactivates the moment YouTube takes the engine and
restores when audio takes it back. The bar now displays YouTube; the lock screen
and notification shade still do not, and YouTube background playback remains
disabled. The only change here is that `nexttrack` routes through `skipToNext`,
so a headset skip obeys the same rule as the on-screen button.

## Bug C — the Aram Asatryan fallback was working

Audited against live data rather than guessed at.

**The catalogues genuinely have nothing.** Audius returns one row —
`02 - Galis es ancnum` by `GUGFox LIVE`, handle `muzzon` — which is *tagged*
`aram,asatryan`, and tags are deliberately not scored. Jamendo returns three rows
sharing only the generic token `aram`. Scored with the app's own scorer:

```
  weak score=0.000 coverage=0.000 :: 02 - Galis es ancnum | GUGFox LIVE
  weak score=0.375 coverage=0.500 :: Eternos Rivales - Fil d'aram
  weak score=0.375 coverage=0.500 :: Orom Aram | Joël Vanoli
  weak score=0.375 coverage=0.500 :: 01. Météo sombre (prod. Aram) | L!AM
```

All four are weak — coverage 0.5 against the 0.6 requirement, exactly as the
coverage rule was designed to do. `hasStrongOpenCatalogMatch` is `false`, and no
artist expansion fires either (the Audius user search returns `Adam R. Sweet`,
`ARAZ` and similar, none close enough).

**So the fallback should fire, and it does.** Driven through the real hook, the
real submission signal and the real confidence flag, with the catalogues stubbed
to that exact noisy data:

- explicit submit (Enter) → **1** YouTube request, results rendered
  automatically, manual button gone;
- typing the whole phrase and waiting → **0** requests, manual button shown.

The reported experience — "I had to press Search YouTube" — is what happens when
the results are reached by **typing** rather than by submitting. Typing navigates
with `replace`, which is not an explicit submission, and that is the quota
guarantee: the deployment shares 100 searches a day, and auto-running on settled
keystrokes would spend them on one person typing one phrase.

**No confidence threshold was changed, and none should be.** Lowering it to make
this case auto-run would break the rule that protects the quota. What was missing
was coverage: every existing test of the auto-fallback used *empty* catalogues,
and none covered catalogues that answer with noise. Three tests now do.

## Files changed

Modified:

- `src/player/player-actions.ts` — `skipToNext`, `AdvanceReason`,
  `nextQueueDestination`, the exhaustion notice
- `src/player/player-selectors.ts` — `selectCanSkipNext` / `useCanSkipNext`;
  `useHasNext` deleted
- `src/music/song-identity.ts` — `artistHintFromTitle`, `foldTitle`
- `src/player/autoplay/candidates.ts` — `collectFallbackCandidates`, gated to
  Audius seeds
- `src/player/autoplay/buffer.ts` — second pass when the plan is empty
- `src/player/autoplay/types.ts`, `index.ts` — the `genre-fallback` source
- `src/components/player/GlobalPlayer.tsx` — renders the active engine
- `src/components/player/PlayerControls.tsx`,
  `src/components/player/NowPlayingSheet.tsx`,
  `src/features/playback/MediaSessionHost.tsx` — all Next surfaces call
  `skipToNext`
- `src/components/youtube/YouTubePlayerSurface.tsx` — focus target
- `src/app/ui-store.ts` — `focusVideoToken`
- `src/styles/youtube.css`

Added:

- `src/player/use-active-engine.ts`
- `src/components/player/YouTubeMiniPlayer.tsx`
- `src/player/next-semantics.test.ts`,
  `src/player/autoplay/reupload-supply.test.ts`,
  `src/player/autoplay/request-budget.test.ts`,
  `src/components/player/UnifiedNowPlaying.test.tsx`
- `tests/e2e/unified-now-playing.spec.ts`

## Tests

**Unit and component: +47** (1767 → 1814), in four new files —
`next-semantics.test.ts` (17), `reupload-supply.test.ts` (12),
`UnifiedNowPlaying.test.tsx` (9) and `request-budget.test.ts` (9). The re-upload
tests are built from the verbatim live Audius rows; the budget tests pin one
request per refill for each provider, including the case that restriction exists
to prevent — a Jamendo seed whose similarity came back empty must not fall
through to a genre request.

**E2E: +19 passing, +1 skipped** (409 → 428) — `unified-now-playing.spec.ts` (13
across both projects, 1 skipped on mobile) and three Aram submission tests in
`youtube-fallback.spec.ts` (6 across both projects).

No test was deleted or weakened. Four existing tests changed, each for a stated
reason:

1. **`library.spec.ts` — "Repeat one replays the current track rather than
   advancing".** This test asserted the exact behaviour reported as broken: that
   pressing Next under Repeat one replays the song. It now asserts that Next
   moves to the next playlist track, and is renamed to say so. Repeat one's real
   rule — what happens when a track *ends* — is unchanged and remains pinned in
   `repeat-shuffle.test.ts` and `next-semantics.test.ts`.
2. **`library.spec.ts` — "Play starts the first item and Next follows the
   playlist order".** Now pauses before stepping. The stub clip is two seconds
   and the playlist holds three, so with autoplay continuing past the end (which
   it now does, rather than stopping) a slow run was racing real playback down
   the queue. Where Next *goes* does not depend on whether anything is playing.
3. **`search-seed-continuation.spec.ts` — session stepping.** Scoped to the
   player's own footer, because the global bar now carries the same two controls.
4. **`autoplay-queue.test.ts` — the two exhaustion tests.** Their premise —
   "nothing similar is available" — now has one more place to look, so they close
   that door explicitly. The assertions are untouched; the scenario is stronger.

Two tests I wrote were themselves wrong and were corrected rather than the code:
a fallback test whose "all re-uploads" pool actually contained the remix, and a
first draft of the selector test that duplicated the predicate instead of
importing it. The predicate is now exported and tested directly.

## Local QA

Against the **live** Audius and Jamendo APIs (VERIFIED):

- `Kosandra` — 15 rows, 13 the same recording from throwaway accounts; the
  reported failure reproduced exactly from this data.
- `Miyagi Andy Panda Kosandra` — same shape.
- `Aram Asatryan` — 1 Audius row, 3 Jamendo rows, all four weak.
- `/tracks/recommended` vs `/tracks/trending`, with and without `genre`.
- Audius user search for `Aram Asatryan` — no matching artist.

One live YouTube search was **not** spent: the fallback behaviour was proven
against the real hook with the network doubled, which answers the question
without touching the daily allowance.

## Physical-device QA

**UNVERIFIED — no physical device was used, and no result for one is claimed.**
Nothing in the brief's device checklist was executed on real hardware:
lock-screen metadata changing on an autoplay transition, a hardware or
notification Next under Repeat one, screen-off continuity, YouTube pausing on
lock, or how the bar reads on a real phone. Chromium's mobile project emulates a
viewport and touch; it is not a phone.

## Vercel

`api/**`, `server/**`, `vercel.json` and the `tsconfig*.json` files were not
touched, so the Node ESM module-resolution fix is untouched and its guard test
still passes. Production endpoints remain unverifiable from here: Deployment
Protection returns `302 → vercel.com/sso-api`, `vercel whoami` reports logged
out, and no `VERCEL_AUTOMATION_BYPASS_SECRET` is available. Unchanged across the
last three passes, and not a regression from this one.

## Known limitations

- **Identical re-uploads of a song that is *not* the seed are still not
  collapsed.** Four copies of `Indra Indra Madhuchandra ! Kosandra ! Bgm` from
  four uploaders can occupy several buffer positions, because their titles carry
  no `Artist - Title` to parse and suppressing on title alone would break covers.
  Position 0 — the track that actually plays next — is correct, which is what the
  visitor experiences.
- **The genre fallback is a weak signal and is named as one.** Same genre is not
  same sound, and on junk metadata (these re-uploads are variously tagged
  Experimental, Punk and Metal) the genre it scopes by may be meaningless.
- **A seed with no genre gets no fallback**, so an untagged track in an exhausted
  session still ends in silence.
- **Autoplay now continues where it used to stop**, for an Audius seed carrying a
  genre. That is the intent, but it means a long unattended session keeps playing
  and spends roughly one request per exhausted refill.
- **An exhausted Jamendo seed ends in silence, by design.** Jamendo answered the
  similarity question itself, and an empty answer is a judgement rather than a
  gap; this pass does not second-guess it with a weaker signal.
- **The phone bar carries play/pause only** while YouTube is active, following
  the reference's own mini-player rules.
