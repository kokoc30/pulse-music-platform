# Phase 6 testing and QA

## Baseline
Before editing:
```powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
pnpm verify:bundle
```

Do not repeatedly spend YouTube live quota while developing.

## Media Session tests
Mock `navigator.mediaSession` and verify:
- unsupported browser safe
- Audius/Jamendo metadata
- artwork
- play/pause/stop
- previous/next
- seek handlers
- valid position state
- throttling
- no duplicate/stale handlers
- Audio -> YouTube clears Pulse audio session
- YouTube -> Audio restores it

## Autoplay tests
- same genre outranks unrelated
- tags/mood help
- close BPM helps
- missing metadata neutral
- current item excluded
- recent items excluded
- explicit queue duplicates excluded
- artist cap
- deterministic order
- consent OFF ignores profile
- consent ON may use existing profile
- YouTube never eligible

## Jamendo similar
Test:
- narrow action
- id validation
- fixed max results
- secret server-only
- upstream `/tracks/similar`
- sanitized response
- no download URLs
- no secret leaks

## Queue
- explicit queue wins
- autoplay after explicit exhaustion
- autoplay OFF stops
- manual Next consumes autoplay if explicit empty
- Previous uses history
- bounded candidate failures
- generated track follows normal history qualification

## PWA
- manifest linked/valid
- icons exist
- service worker excludes provider audio and `/api/*`
- no YouTube media caching
- update flow does not force reload during playback

## E2E
Mock OS Media Session actions against real app actions.

Verify autoplay:
1. play metadata-rich audio
2. explicit queue empty
3. trigger `ended`
4. similar audio becomes current
5. no YouTube request
6. turn autoplay off
7. next end stops

## Physical-device QA
Create `docs/PHASE6_DEVICE_QA.md`.

Test on real devices if available:
- Android Chrome
- installed Android PWA
- iPhone Safari
- installed iOS web app

Check:
- screen lock/background audio for Audius/Jamendo
- lock-screen/notification title, artist, artwork
- play/pause
- next/previous
- seek if shown
- headset/Bluetooth
- stop
- return-to-app synchronization
- YouTube does NOT become hidden/background audio

If no physical device is available, mark those rows UNVERIFIED rather than claiming PASS.

## Final live smoke
When quota permits, run once:
```powershell
$env:AUDIUS_SMOKE="1"
$env:JAMENDO_SMOKE="1"
$env:YOUTUBE_SMOKE="1"
pnpm test:smoke
```

A YouTube 429 is quota-blocked, not permission to weaken tests.
