# Phase 6 — Background audio, PWA and intelligent autoplay

## Status

**PARTIAL — implementation PASS, physical-device background verification pending.**

Every deterministic gate passes and every behaviour that can be proven in a browser
is proven. What is *not* claimed: that background audio, lock-screen controls and
headset buttons behave correctly on a real Android phone or iPhone. No physical
device was available, so `docs/PHASE6_DEVICE_QA.md` marks those rows **UNVERIFIED**
rather than PASS.

This report does not claim Spotify-equivalent lifecycle behaviour. It could not:
that claim requires hardware.

| Gate | Baseline | After Phase 6 |
| --- | --- | --- |
| `pnpm typecheck` | clean | clean |
| `pnpm lint` | clean (`--max-warnings 0`) | clean |
| `pnpm test:run` | 1199 tests, 68 files | **1330 tests, 73 files** |
| `pnpm build` | succeeds | succeeds |
| `pnpm test:e2e` | 245 passed, 15 skipped | **273 passed, 15 skipped** |
| `pnpm verify:bundle` | 0 matches, 7 files | 0 matches, 12 files |
| Live smoke | 26/26 best observed | Audius 6/6, Jamendo 8/8, YouTube **quota-blocked** |

All 1199 pre-existing tests still pass. **131 tests were added.** One existing test
was edited — the Jamendo wire-contract key list, which genuinely widened on both
sides; the change is described under [Files changed](#files-changed).

---

## Research and policy findings

Read before implementing, from `agents/RESEARCH_SOURCES.md`.

**Media Session (MDN, web.dev, Chrome developers).** `navigator.mediaSession` is the
stable, supported way to reach OS media controls. `setActionHandler` throws
`NotSupportedError` for actions a browser does not implement, so each registration
must be attempted independently. `setPositionState` is optional and rejects a
duration of zero or a position past the end. The API decorates playback; it does
not create it — an `<audio>` element still does the work.

**Background execution (MDN Offline and background operation).** A service worker
has no DOM and cannot own an `HTMLAudioElement`. It is not an audio daemon. Web
background audio comes from the browser choosing to keep the page alive, and stops
when the OS reclaims the process. Installing as a PWA improves launch and framing;
it grants no additional background entitlement.

**Audio Session API.** MDN marks it experimental with limited availability. It was
deliberately not used: the phase depends on the stable Media Session integration.

**YouTube (Developer Policies, Required Minimum Functionality).** Background play
while the API client's window is closed or minimised is prohibited, as is caching
audiovisual content (§III.E.1) and separating audio from video (§III.I.7). This is
why YouTube is excluded from the OS session entirely rather than merely omitted
from autoplay — an OS Next button that could restart a hidden video *is* the
prohibited mechanism.

**Jamendo.** `GET /v3.0/tracks/similar` is a real, documented endpoint. It is the
only provider-side similarity available here.

**Audius.** No similar-tracks endpoint is documented, and none was invented. The
SDK's `Track` model does expose `genre`, `mood`, `tags`, `bpm` and `musicalKey` —
verified in the installed type definitions — which is what makes local scoring
possible without fanning out requests.

---

## Architecture

Phase 6 adds three independent modules and changes no engine.

```
src/player/media-session/     metadata.ts · controller.ts
src/player/autoplay/          types · similarity · planner · candidates
                              session-pool · buffer · index
src/pwa/                      install.ts · register-sw.ts
public/                       manifest.webmanifest · sw.js · icons
src/features/playback/MediaSessionHost.tsx
src/components/settings/PlaybackSettings.tsx
```

The invariant is intact: **Audius and Jamendo play through the one existing
`HTMLAudioElement`; YouTube plays in the one official visible IFrame player.** No
second audio element, no crossfade, no Web Audio graph, no new provider, no
database, no auth, no model.

The one structural addition to existing code is `onEngineChange` on the playback
coordinator. It has exactly one subscriber — the Media Session host — and the
dependency runs one way. The alternative, having the session infer the active
engine from two stores, would have created a second source of truth for the single
fact that module exists to own.

---

## Media Session

`createMediaSessionController` is a small stateful object over
`navigator.mediaSession`; `MediaSessionHost` wires it to the store once, above the
router, so a lock screen survives SPA navigation.

**Feature detection.** Absent `navigator`, absent `mediaSession`, or a
`setActionHandler` that is not a function all resolve to `supported: false`, after
which every method is a no-op. Registration is per-action inside `try/catch`, so a
browser refusing `stop` and `seekto` still gets the other six.

**Metadata** comes from `sessionMetadataFor(track)`: title, artist, and artwork
built with `buildArtworkCandidates` — the *same* resolver every card uses, so the
mirror origins travel to the OS and a dead Audius content node degrades on the lock
screen exactly as it does in the page. `album` is left empty unless real; putting
"Audius" there would present the source as the record, and the attribution
obligation is met by the visible in-app credit instead.

Metadata is written **once per track**, not once per store update — rebuilding
identical metadata makes some platforms flicker the notification.

**Handlers, all of which call existing actions:**

| Action | Calls |
| --- | --- |
| `play` | `togglePlay()` |
| `pause` | `pause()` |
| `stop` | `stopPlayback()` |
| `previoustrack` | `playPrevious()` |
| `nexttrack` | `playNext()` |
| `seekto` | `seek(seekTime)` |
| `seekbackward` / `seekforward` | `seek(currentTime ± offset)`, defaulting to 10s |

`stopPlayback` is the one new action: it releases the source and clears the
position, which `pause` deliberately does not. The queue survives.

**Playback state** mirrors the store. **Position state** is throttled to one write
per second — `timeupdate` fires ~4 Hz and the OS needs a progress bar, not a
stream — and refuses a duration of zero or `NaN`, both of which occur normally
before metadata loads.

`activate()` clears before registering, so activating twice cannot leave two
generations of closures bound to one action. Proven by a test that fires `nexttrack`
after re-activation and asserts only the current generation runs.

---

## Background playback behaviour

**Audio is never paused because the document is hidden.** Nothing in this phase
added such a rule, and an E2E test dispatches a real `visibilitychange` with
`visibilityState: 'hidden'` and asserts the element stays unpaused.

Whether audio *continues* is then the browser's and the OS's decision, which is
exactly the honest framing: the app stops getting in the way, and the platform
decides. On a desktop Chromium tab it continues; on a phone it depends on the OS,
which is what the device QA exists to establish.

If a scripted `play()` is refused by autoplay policy, the existing handling applies
unchanged: `isBenignPlayRejection` catches `NotAllowedError`, sets `paused`, and
does not retry. State stays resumable and there is no loop.

---

## PWA, install and the service-worker cache policy

**Manifest** (`public/manifest.webmanifest`): name *Pulse Music Platform*, short
name *Pulse*, `start_url` and `scope` `/`, `display: standalone`, `#000000` for
both theme and background — the existing `--color-app-bg` — and three icons:
192×192, 512×512, and a 512×512 maskable padded into Android's 4/5 safe zone.

Icons are rasterised from the existing `public/pulse-mark.svg` by
`scripts/generate-pwa-icons.mjs`, using the Chromium that is already a dev
dependency. No new package, and the SVG remains the single source of the branding.

**Install affordance** lives in Settings, never over the content. Chromium's
`beforeinstallprompt` is captured and its default prompt suppressed so the offer
can be replayed from a real press. iOS gets written Add-to-Home-Screen steps **only
after the visitor presses "How to install"** — asserted by a test that counts the
single `.prompt()` call site, so nothing can fire an install dialog on its own. An
already-installed window shows neither.

**Service worker** (`public/sw.js`) caches the app shell and nothing else. What it
refuses is the substance of the file, and it is executed as a test rather than
described: the shipped `isExcluded` function is extracted from the built file and
run against real URLs, so the test cannot drift from what ships.

| Never cached | Why |
| --- | --- |
| `/api/*` — every route, present and future | `no-store` by design; provider data the app re-validates |
| `youtube.com`, `ytimg.com`, `googlevideo.com`, `youtube-nocookie.com` | §III.E.1 prohibits caching audiovisual content; `/api/youtube` is Non-Authorized Data with a 30-day ceiling a worker cannot honour |
| `jamendo.com` | Licensed for streaming, not for offline copies |
| `audius.co`, `/v1/tracks/*/stream` | Stream URLs are signed and node-specific; caching one stores a credential-bearing URL and pins a dead node |
| `.mp3 .mp4 .m4a .aac .ogg .opus .wav .flac .webm .m3u8 .ts` on any host | Audius content-node hostnames are not a fixed list, so the payload is caught wherever it is served |

There is no offline download feature and the worker attempts no playback — asserted
by a test that greps the shipped file for `new Audio`, `HTMLAudioElement` and
`.play()`.

**Updates never interrupt playback.** The worker does not call `skipWaiting()` on
install; the page sends `pulse:skip-waiting` only once the player is idle. Tested
both ways, and the assertion targets the call rather than the prose that discusses
it.

---

## Autoplay preference

`Autoplay similar music`, default **on**, persisted at `pulse:autoplay` beside
`pulse:volume` and `pulse:muted` — the established home for local-only playback UX
state.

It is **separate from personalization consent** by construction, not by convention.
The preference lives in the player store; the profile lives in the personalization
store; neither reads the other's key. A test asserts that toggling autoplay writes
`pulse:autoplay` and leaves `pulse.personalization.v1` untouched. It also survives
`player.reset()`, because resetting a session must not silently re-enable something
the visitor turned off.

Only an explicit `'false'` disables it: an unreadable or absent value falls back to
the recommended default rather than quietly killing the feature.

---

## Queue precedence

One rule, one implementation, used by the on-page Next, the Media Session Next and a
track ending naturally — because all three call `playNext()`:

1. **The explicit user queue.** Consulted first and unconditionally.
2. **An existing station/playlist continuation** — already materialised into the
   queue by `playFromShelf`, so it is covered by (1) rather than by a second branch.
3. **Autoplay's generated candidate**, when the preference is on and the current
   track is Audius or Jamendo.
4. **Stop** — cleanly, at position zero, never looping.

Autoplay cannot jump ahead of a queued item because the queue is checked before the
buffer is ever consulted. A generated track is *appended to the queue* rather than
replacing it, so the player bar, the queue panel and Previous all treat it as an
ordinary entry.

**Previous** is unchanged: it steps back through the queue, or restarts the track
past the 3-second threshold. It never reaches into generated candidates.

---

## Audius strategy

No similar endpoint was invented and no request fan-out was added.

Audius similarity is computed from metadata Audius already publishes — `genre`,
`mood`, `tags`, `bpm`, `musicalKey` — over tracks the session already holds. Those
five fields are now normalized into the `Track` model (`tags` split from Audius's
comma-separated string, `bpm` range-checked to 20–300).

The candidate pool is `src/player/autoplay/session-pool.ts`: an in-memory,
bounded (300), most-recent-first record of tracks that have already arrived from
discovery shelves and search results. It costs **zero requests** — it is a
by-product of browsing — and is never persisted, so no new storage key and no
schema change.

**An Audius seed therefore spends no provider request at all.** Asserted.

---

## Jamendo similar endpoint

`GET /api/jamendo?action=similar&id=<trackId>` → `https://api.jamendo.com/v3.0/tracks/similar/`.

Narrow by construction:

- **One parameter**, validated against `/^[0-9]{1,12}$/` *before* config is read or
  any network call is made. Path traversal, injection attempts, a smuggled
  `client_id` and a 20-digit id are all rejected with 400 and zero upstream traffic.
- **Result limit fixed server-side** at 12. A caller passing `limit=200` is ignored —
  asserted.
- **No parameter is forwarded.** `fullcount`, `order` and a caller-supplied
  `client_id` never reach Jamendo.
- **Client id stays server-only**, redacted twice over in logs and errors, exactly
  as `search` already does — both actions now share one request path so the
  redaction cannot drift between them.
- **Sanitized response**, same allow-list as search plus `tags` and `bpm`. No
  download URL: a payload carrying `audiodownload` is asserted not to survive.
- **No CORS header, `no-store`.**
- **The search action is untouched** — including a test that the search request still
  does *not* ask for `musicinfo`, since its shape is on the visitor's critical path
  and pinned by Phase 2 tests.

`include=musicinfo` is requested only by the similar action, and is what supplies
the tags and tempo the scorer reads.

---

## Similarity scoring and diversity

Pure, centralized, explainable. No LLM, no embeddings, no paid recommender, no
opaque randomness.

| Signal | Weight | Applies when |
| --- | --- | --- |
| Provider similarity rank | 0.34 | The candidate came from Jamendo's `/tracks/similar` |
| Genre | 0.22 | Both sides have one |
| Tag overlap (Jaccard) | 0.16 | Both sides have tags |
| Mood | 0.10 | Both sides have one |
| BPM proximity | 0.10 | Both have a tempo; linear to zero at ±12 BPM |
| Artist relation | 0.06 | Always — every track has an artist |
| Musical key | 0.02 | Both have one; exact match only |
| Local profile affinity | +0.08 on top | **Only when consent is granted** |

**Missing metadata is neutral, not negative.** The denominator is the weight of the
signals actually *available on both sides*, so a track that shares its only field
scores well rather than being dragged towards zero by four fields neither provider
published. Asserted directly: a bare track never ranks below one that mismatches on
every field.

Profile affinity is added *on top* rather than mixed into the denominator, so it can
never make an unrelated track out-rank a genuinely similar one — also asserted.

**Diversity**, applied in `planner.ts`:

- never the current track;
- never an id already in the explicit queue;
- never anything in the last 20 played (a track becomes eligible again once it falls
  out of that window — tested);
- never an unplayable track;
- **max 1 same artist in any run of 3**, and **max 2 in any run of 10**;
- **position 0 always maximises similarity** — the next track is what the feature is
  judged by;
- later positions reserve ~20% for exploration, chosen **deterministically** by
  walking a fixed depth of the ranking rather than by a dice roll;
- ties break on track id, so the same inputs always produce the same run.

---

## Request budget

| Situation | Provider requests |
| --- | --- |
| Audius seed | **0** |
| Jamendo seed | **1** (`/tracks/similar`) |
| Buffer refill while one is already in flight | **0** — concurrent calls share it |
| Rendering, arrowing, or any UI interaction | **0** |
| YouTube, in every situation | **0** |

The buffer holds 5 and refills only when the explicit queue cannot answer.
`MAX_SESSION_CANDIDATES = 120` bounds the scoring work; `MAX_AUTOPLAY_ATTEMPTS = 3`
bounds recovery when a generated candidate will not play, after which autoplay stops
rather than looping.

---

## YouTube exclusion

Enforced at four separate levels, deliberately overlapping:

1. **The type system.** `Track` is `provider: 'audius' | 'jamendo'`. A
   `YouTubeVideoItem` cannot be an autoplay candidate at all — there is no filter to
   forget, in the same way `music/types.ts` makes "YouTube never reaches the audio
   engine" a compile-time property.
2. **The candidate sources.** `candidates.ts` contains no YouTube import, fallback or
   enrichment. Autoplay never searches or queues it.
3. **The Media Session.** Handing the engine to YouTube calls `deactivate()`, which
   nulls every handler. An OS Next after the handover reaches nothing — asserted in
   both the unit suite and E2E.
4. **The service worker.** Every YouTube host and `/api/youtube` are refused.

The existing hidden-document YouTube pause is untouched, and an E2E test asserts the
video still pauses on `visibilitychange`. No YouTube metadata contributes to any
cross-provider score (the Phase 4 guarantee, unchanged).

---

## Consent interaction

| Consent | Autoplay | Profile use |
| --- | --- | --- |
| `granted` | Works | May add ≤0.08 artist affinity |
| `denied` | Works | **None** |
| `unset` | Works | **None** |

Enforced at the boundary, in `affinityForAutoplay()`: with consent anything other
than `granted`, it returns `undefined` and the planner simply receives no
affinities. The planner has no way to reach the profile itself, so there is no flag
it could misread and no second profile anywhere.

Generated tracks follow the **normal** Phase 4 pipeline exactly: the same qualified-
listen threshold (`min(30s, 25%)`, floor 10s), the same history recording through
`PersonalizationHost`, the same artwork and ordering rules, the same attribution. No
history bypass, and no duplicate history event — the generated track enters the
queue and is played by `playTrack` like any other.

---

## Security

- `JAMENDO_CLIENT_ID` server-only; the new action shares the existing double
  redaction and is asserted never to appear in a body or a log.
- `YOUTUBE_API_KEY` server-only; untouched by this phase.
- No stream URL persisted. The autoplay buffer and session pool are in-memory only,
  and no new `localStorage` key was added beyond the `pulse:autoplay` preference.
- No new schema, no personalization storage change.
- The service worker stores no credential-bearing URL, by exclusion.
- `pnpm verify:bundle` — 0 matches across 12 files (up from 7: the icons, manifest
  and worker now ship).

---

## Files changed

**New — Media Session (3):** `media-session/metadata.ts`, `media-session/controller.ts`,
`features/playback/MediaSessionHost.tsx`

**New — autoplay (7):** `autoplay/types.ts`, `similarity.ts`, `planner.ts`,
`candidates.ts`, `session-pool.ts`, `buffer.ts`, `index.ts`

**New — PWA (6):** `pwa/install.ts`, `pwa/register-sw.ts`, `public/manifest.webmanifest`,
`public/sw.js`, three icon PNGs, `scripts/generate-pwa-icons.mjs`

**New — UI (1):** `components/settings/PlaybackSettings.tsx`

**New — tests (5):** `media-session.test.ts` (28), `autoplay.test.ts` (39),
`autoplay-queue.test.ts` (16), `pwa.test.ts` (28), `server/jamendo/similar.test.ts` (20),
plus `tests/e2e/background-autoplay.spec.ts` (14 × 2 projects)

**Modified (13), all additive:**

| File | Change |
| --- | --- |
| `music/types.ts` | Optional `tags`, `bpm`, `musicalKey` on `Track` |
| `music/normalize.ts` | Normalizes the three from Audius; `normalizeTags`, `normalizeBpm` |
| `music/jamendo/normalize.ts` · `wire.ts` · `client.ts` · `index.ts` | Similar payload parsing and `fetchSimilarJamendoTracks` |
| `server/jamendo/upstream.ts` | `buildSimilarUrl`, `similarJamendo`, shared `requestJamendo` |
| `server/jamendo/handler.ts` | The `similar` action |
| `server/jamendo/sanitize.ts` | `tags` and `bpm` allow-listed |
| `player/player-store.ts` | `autoplaySimilar` preference |
| `player/player-actions.ts` | Queue precedence in `playNext`; `stopPlayback` |
| `player/playback-coordinator.ts` | `onEngineChange` |
| `components/layout/AppShell.tsx` | Mounts `MediaSessionHost` |
| `pages/SettingsPage.tsx` | Renders `PlaybackSettings` |
| `features/discovery/useDiscovery.ts` · `features/search/useTrackSearch.ts` | Feed the session pool |
| `index.html` · `src/main.tsx` | Manifest link, iOS hints, worker registration |

**One existing test edited:** `src/music/jamendo/wire.test.ts` — the wire-contract
key list. It deliberately mirrors the server's `PAYLOAD_KEYS`, both sides gained
`tags` and `bpm`, and the test exists precisely to fail when they drift. Updating it
is the intended response, not a workaround.

**Not touched:** the audio engine, the YouTube engine, search architecture, provider
APIs, YouTube quota behaviour, personalization scoring, the storage schema, `refe/`.

---

## Unit / component and E2E counts

**Unit: 1330 passing, 73 files** (baseline 1199 / 68; +131).

| Suite | Tests |
| --- | --- |
| `media-session.test.ts` | 28 — capability, metadata, artwork failover, every action, seek variants, position validity and throttling, no duplicate handlers, YouTube handover and restore |
| `autoplay.test.ts` | 39 — each similarity signal, missing metadata neutral, consent on/off, exclusions, artist caps, determinism, request budget, session pool |
| `autoplay-queue.test.ts` | 16 — explicit queue wins, autoplay after exhaustion, autoplay off stops, manual Next, Previous, bounded failure, preference persistence |
| `pwa.test.ts` | 28 — manifest validity and shipped icons, **worker exclusions executed against the shipped file**, no media cache, update-during-playback, install affordance |
| `similar.test.ts` | 20 — id validation, fixed limit, not a proxy, sanitization, no download URL, no secret leak, search unchanged |

**E2E: 273 passing, 15 skipped** (baseline 245; +28 = 14 × 2 projects), including
mocked OS Media Session actions driving the real app, the hidden-document assertions
in both directions, autoplay with zero YouTube traffic, and manifest/icon delivery.

---

## Live smoke

```
AUDIUS_SMOKE=1 JAMENDO_SMOKE=1 YOUTUBE_SMOKE=1 pnpm test:smoke
```

| Provider | Result |
| --- | --- |
| Audius | **6/6** |
| Jamendo | **8/8** |
| YouTube | **BLOCKED — HTTP 429 daily quota exhausted** |

The YouTube block is reported once, explicitly, by the diagnostic added in the
previous pass; the 11 dependent checks are *skipped*, and the command exits
non-zero. No product code or test was changed to hide it.

**One transient failure was investigated rather than assumed.** The first combined
run showed 5 Jamendo failures. They did not reproduce: Jamendo returned 8/8 on three
subsequent runs, both alone and combined. Nothing in this phase adds Jamendo traffic
to the smoke suite — the `similar` action is reached only from the browser when a
track ends — so the most likely cause is upstream rate-limiting after repeated runs.
Recorded here rather than quietly re-run until green.

Audius' intermittent `ERR_SSL_PACKET_LENGTH_TOO_LONG` content-node fault, documented
in earlier phases, did not recur in the final runs.

---

## Device QA

**Not performed — no physical device was available.**

`docs/PHASE6_DEVICE_QA.md` is a filled-in checklist with every hardware row marked
**UNVERIFIED**: Android Chrome (18 rows), installed Android PWA (10), iPhone Safari
(11), installed iOS web app (7), and 4 cross-cutting. It also records precisely what
*was* verified in real Chromium and states plainly that it is not a substitute.

The rows that matter most for compliance rather than polish are A16, A17 and C10 —
that a YouTube video does **not** continue in the background and that no lock-screen
control appears while YouTube is the active player.

---

## Known limitations

1. **Physical background behaviour is unverified.** The headline claim of the phase
   is the one thing that needs hardware.
2. **Force-close stops playback.** No web app survives OS process eviction; a service
   worker cannot close that gap.
3. **Controls differ by platform.** All eight actions are registered; which appear is
   the platform's decision. `setPositionState` may be absent, costing only the
   progress bar.
4. **Audius autoplay is limited by what the session has seen.** A visitor who plays
   one track immediately after a cold load has a small pool. This is the deliberate
   cost of not fanning out requests.
5. **Jamendo search results carry no tags or BPM.** Only the similar action requests
   `musicinfo`, because widening the search request would change a path pinned by
   Phase 2 tests. Missing metadata is neutral, so those tracks still rank.
6. **No crossfade or gapless playback.** Out of scope; it would materially change the
   engine.
7. **Exploration is deterministic, not novel.** The same history yields the same run —
   chosen for testability over surprise.
8. **The install prompt depends on the browser's own heuristics.** Chromium decides
   when to offer; Firefox and desktop Safari do not install web apps, and Settings
   says so plainly rather than showing a dead button.

---

## Native future path

Per `agents/37_NATIVE_FUTURE_PATH.md`, and not implemented here.

What the web can deliver on supporting browsers: installed launch, background audio
for Audius and Jamendo while backgrounded or screen-locked, lock-screen metadata and
controls, headset and Bluetooth keys, and this autoplay engine.

What it cannot guarantee: playback after force-close, survival of OS eviction,
identical controls everywhere, Android foreground-service semantics, or iOS
background-audio entitlement behaviour.

If true native lifecycle behaviour becomes a requirement, the practical route is
Capacitor around this existing React/Vite UI with native playback integrations —
Android Media3/MediaSession foreground playback, iOS `AVAudioSession` playback
category with the Audio background mode and Now Playing controls. The autoplay
planner, the similarity scoring and the Jamendo endpoint are all pure and would move
across unchanged.

**A native wrapper would still not grant permission to background-play YouTube API
content.** That boundary is a policy one, and it does not move.
