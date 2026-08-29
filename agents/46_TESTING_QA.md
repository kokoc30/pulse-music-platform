# Phase 7 testing and QA

## Baseline

Record current counts before edits.

Run:

```powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
pnpm verify:bundle
```

## Storage tests

- IndexedDB/default adapter initializes
- version validation
- migration
- unavailable IndexedDB fallback
- write/read
- transaction failure cannot leave dangling playlist references
- max playlist cap
- max track cap
- no stream URLs
- no secrets
- no raw provider responses
- library clear
- garbage collection of unreferenced metadata

## Likes

- like Audius
- unlike Audius
- like Jamendo
- unlike Jamendo
- like survives reload
- heart state consistent across Home/Search/Player/Queue/Library
- same track has one canonical like state
- provider identity prevents false cross-provider dedupe
- Pulse Like does not call provider write APIs

## Playlists

- create
- trim/validate name
- Unicode names
- rename
- description
- delete with confirmation
- add track
- duplicate prevention
- remove
- reorder
- reorder survives reload
- same track can exist in two playlists
- deleting playlist does not unlike track
- Liked Songs cannot be renamed/deleted

## Library UX

- `/library`
- `/library/liked`
- `/playlist/:id`
- local search
- sorting
- empty states
- cover collage fallbacks
- keyboard controls
- accessible action labels
- mobile layout

## Playlist playback

- Play starts first playable
- click middle starts there
- remaining playlist becomes explicit continuation
- shuffle session order stable
- persisted order unchanged by shuffle
- repeat one
- repeat playlist
- repeat off
- explicit playlist continuation outranks autoplay
- autoplay starts only after playlist ends when allowed
- unavailable track skipped boundedly
- Media Session next uses same queue path

## Explicit recommendation signals

- Like increases permitted Audius/Jamendo recommendation affinity
- add-to-playlist adds bounded signal
- five playlists do not multiply signal unboundedly
- unlike removes explicit-like contribution
- Not interested excludes item
- undo restores
- hidden recommendations survive reload if consent allows
- consent denied prevents personalization mutation

## Made-for-you mixes

- insufficient data -> no fake mix
- warm profile -> mix appears
- deterministic same state -> same ranking
- max artist cap
- exploration present
- hidden items excluded
- recent overplay suppressed
- Save as playlist snapshots current order
- saved snapshot stops auto-changing

## YouTube policy tests

- no YouTube API metadata used in recommendation score
- YouTube library item has `storedAt` / expiry
- max retention <= 30 days
- startup purge/expiry path
- expired item cannot silently play stale metadata
- no YouTube statistics persisted
- no YouTube stream/media bytes
- no background YouTube playback regression
- if refresh action exists: exactly one bounded `videos.list`, zero `search.list`
- no refresh request storm
- MadeForKids/embeddability checked before embed
- API key server-only

## E2E flows

### A — Like and return

1. search Audius/Jamendo track
2. click heart
3. go to Library -> Liked Songs
4. verify item
5. reload
6. verify persists
7. play item

### B — Playlist creation

1. open Add to playlist from a result
2. create "Road Trip"
3. item appears
4. add two more
5. open `/playlist/:id`
6. reorder
7. reload
8. order persists

### C — Playlist playback

1. open playlist
2. Play
3. Next follows playlist order
4. turn shuffle on
5. start again
6. shuffled order is stable for session
7. autoplay does not jump ahead

### D — Recommendations

1. seed strong Audius/Jamendo likes
2. open Home
3. Made-for-you section appears
4. like-driven candidates increase appropriately
5. mark one Not interested
6. it disappears and remains hidden

### E — YouTube saved item

If Phase 7 supports temporary YouTube saves:
1. seed non-expired compliant metadata
2. item renders with YouTube attribution
3. playback uses visible iframe
4. seed expired metadata
5. stale item is removed/disabled/refreshed according to chosen strict policy
6. no recommendation scoring changes from YouTube metadata

### F — Mobile/PWA

- heart easy to tap
- playlist menus fit viewport
- library navigation usable
- PWA Media Session unchanged

## Production regression

After local gates:
- push to GitHub
- Vercel deploy
- verify direct `/api/jamendo`
- verify `/api/youtube` does not crash
- test Library on production HTTPS
- test at least one installed-PWA flow on a real phone when available
