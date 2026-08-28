# ONE-SHOT — Phase 6 background playback + PWA + intelligent autoplay

Project: `C:\music-platform`

Read all existing Phase 1–5 agent docs/reports, then read the Phase 6 files `30` through `37` plus `RESEARCH_SOURCES.md`.

Do not start editing until you understand the current player, queue, provider, search, personalization and search-dropdown architecture.

## 1. Baseline
Run and record:
```powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
pnpm verify:bundle
```

Do not repeatedly run YouTube live smoke during implementation.

## 2. Preserve architecture
Keep:
- Audius + Jamendo -> ONE existing HTMLAudioElement
- YouTube -> ONE official visible IFrame player

Do not add another audio engine, crossfade, database, auth, ML/LLM, new provider, offline song downloads or native wrapper.

## 3. Media Session for audio only
Create a small stable Media Session controller for Audius/Jamendo.

Feature-detect `navigator.mediaSession`.

Set `MediaMetadata`:
- title
- artist
- real album when known
- artwork using the existing safe artwork/failover resolver

Synchronize `playbackState`.

Register supported handlers via `try/catch`:
- play
- pause
- stop
- previoustrack
- nexttrack
- seekto
- seekbackward
- seekforward

Every handler must call existing player/queue actions.

Use `setPositionState()` when supported; update safely and throttled.

For Audius/Jamendo, do not pause simply because the document becomes hidden. Allow browser/OS background audio where supported.

If auto-continuation `play()` is rejected by browser policy, do not loop; pause cleanly and preserve resumable state.

## 4. YouTube hard boundary
Current YouTube policy prohibits background play of the YouTube player while the API-client window is closed/minimized.

Therefore:
- preserve existing hidden-document YouTube pause
- never make YouTube part of Pulse's audio Media Session
- never use OS play/next to restart hidden YouTube
- never hide iframe while audio continues
- never extract/proxy YouTube audio
- never auto-search/auto-queue YouTube for similar-next

When Audio -> YouTube, clear/suspend Pulse audio Media Session.
When YouTube -> Audio, restore it.

## 5. PWA
Add/verify:
- manifest
- Pulse branding
- 192/512 icons
- standalone display
- install affordance in Settings
- Chromium `beforeinstallprompt` progressive enhancement
- optional iOS Add to Home Screen guidance only after explicit interest

Add a service worker only for app shell/static assets.

Exclude intentional caching of:
- Audius/Jamendo streams
- signed Audius URLs
- YouTube audiovisual content
- `/api/youtube`
- `/api/jamendo`

Do not force-reload an update while audio is playing.

## 6. Autoplay preference
Add:
`Autoplay similar music`

Recommended default ON.

Persist as a playback preference separate from personalization consent.

Consent OFF:
- autoplay still uses current-track metadata
- no stored profile signal

Consent ON:
- may reuse the existing profile as one small ranking signal
- do not create a second profile

## 7. Queue precedence
Exact order:
1. user queue
2. existing explicit station/playlist continuation
3. autoplay generated audio
4. stop

Manual Next uses the same rule.
Previous uses existing history only.

## 8. Jamendo similar
Extend the existing narrow server route with a validated action such as:
`GET /api/jamendo?action=similar&id=<id>`

Upstream:
`/v3.0/tracks/similar`

Requirements:
- fixed small result limit
- client id server-only
- sanitized fields
- no download URLs
- no open proxy
- no secret logs/errors
- existing search action unchanged

## 9. Audius similarity
Do not invent a similar endpoint.

Use bounded existing/session candidates and real Audius metadata where present:
- genre
- mood
- tags
- BPM
- musical key
- artist

Do not fan out API calls.

## 10. Deterministic similarity
Create pure centralized scoring.

Use:
- Jamendo provider similarity
- genre
- tag overlap
- mood
- BPM proximity
- artist relation
- optional existing local profile when consent granted

Missing metadata = neutral.

No LLM, embeddings or opaque random score.

## 11. Diversity
- exclude current
- exclude explicit queue duplicates
- strongly avoid recent 10–20 played
- max 1 same artist in next 3
- max 2 same artist in next 10
- immediate next maximizes similarity
- later items may reserve ~10–20% exploration
- deterministic tie-break

Maintain a small in-memory autoplay buffer, around 5 items.

Refill only when explicit queue is low/empty and buffer is below target.

Bound metadata requests; no request storm.

## 12. End flow
Natural end:
```text
explicit next -> play it
else autoplay ON + Audius/Jamendo -> play best generated candidate
else -> stop
```

If candidate fails, try bounded alternatives then stop.

No infinite retry.

Generated playback follows existing Phase 4 qualification/history/artwork/order rules exactly.

## 13. Media Session + queue integration
Lock-screen/notification Next must call the same Next action as the player UI.

When autoplay advances:
- player state updates
- queue updates
- Media Session metadata updates
- position resets
- history records through the existing pipeline once

No duplicate history event.

## 14. Tests
Follow `35_PHASE6_TESTING_QA.md`.

Add deterministic coverage for:
- Media Session capability, metadata, actions, seek, position, transitions
- YouTube exclusion
- similarity scoring
- diversity
- consent on/off
- Jamendo similar server action
- explicit queue precedence
- autoplay on/off
- candidate failure bounds
- PWA manifest/service-worker exclusions
- no provider/media cache violations

Extend E2E with mocked OS Media Session actions.

## 15. Real-device QA
Create:
`docs/PHASE6_DEVICE_QA.md`

Include Android Chrome, installed Android PWA, iPhone Safari and installed iOS web app if available.

Test real:
- screen lock
- background audio
- lock-screen/notification metadata
- play/pause
- next/previous
- seek if available
- Bluetooth/headset
- stop
- return-to-app synchronization
- YouTube remains non-background

If the agent has no physical phone, mark those rows UNVERIFIED. Do not fabricate device results.

## 16. Final gates
Run:
```powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
pnpm verify:bundle
```

When YouTube quota is available, run live smoke ONCE:
```powershell
$env:AUDIUS_SMOKE="1"
$env:JAMENDO_SMOKE="1"
$env:YOUTUBE_SMOKE="1"
pnpm test:smoke
```

If YouTube returns 429, report quota BLOCKED. Do not change product code/tests to hide it.
If Audius content-node TLS is flaky, diagnose and document.

## 17. Final report
Create:
`docs/PHASE6_BACKGROUND_AUTOPLAY_FINAL_REPORT.md`

Report:
- status
- research/policy findings
- architecture
- Media Session
- background playback behavior
- PWA/install/service-worker cache policy
- autoplay preference
- queue precedence
- Audius strategy
- Jamendo similar endpoint
- similarity scoring/diversity
- request budget
- YouTube exclusion
- consent interaction
- security
- files changed
- unit/E2E counts
- live smoke
- device QA
- known limitations
- native future path

Do not claim true Spotify-equivalent lifecycle/background behavior unless it was actually verified on physical devices.

If implementation is green but physical devices were unavailable, use:
`PARTIAL — implementation PASS, physical-device background verification pending`.

## 18. Stop
When this is implemented/tested/documented, STOP.

Do not add crossfade, native wrapper, account sync, new provider or AI recommender in this phase.
