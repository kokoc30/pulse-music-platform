# ONE-SHOT — Phase 7: Your Library, Liked Songs, Playlists and Recommendation Upgrade

Project:

`C:\music-platform`

The Pulse music platform is already deployed and the Vercel serverless module-resolution issue has been fixed.

The existing architecture is mature:

- React + TypeScript + Vite
- Audius
- Jamendo
- YouTube fallback
- multilingual search
- global Audio + YouTube playback coordinator
- queue
- Phase 4 local personalization
- Phase 5 recent-search dropdown
- Recently Played artwork/failover/live ordering
- Phase 6 PWA, Media Session and similar-track autoplay
- Vercel serverless functions
- production build-specific TypeScript configuration
- Node ESM-safe server import graph

Implement Phase 7 as an additive professional library/recommendation phase.

Read current project docs/reports first.

Then read:

1. `agents/40_PHASE7_ENTRYPOINT.md`
2. `agents/41_LIBRARY_DATA_MODEL.md`
3. `agents/42_LIKES_PLAYLISTS_UX.md`
4. `agents/43_RECOMMENDATION_MIXES.md`
5. `agents/44_PROVIDER_POLICY_BOUNDARIES.md`
6. `agents/45_PLAYLIST_PLAYBACK_QUEUE.md`
7. `agents/46_TESTING_QA.md`
8. `agents/47_DEFINITION_OF_DONE.md`
9. `agents/48_FUTURE_CLOUD_SYNC.md`
10. `agents/RESEARCH_SOURCES.md`

Do not begin implementation until the existing queue, player, personalization, service worker, Vercel function packaging, provider normalization and storage architecture are understood.

============================================================
A. BASELINE
============================================================

Run:

```powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
pnpm verify:bundle
```

Record exact counts.

Do not repeatedly spend YouTube live-search quota.

============================================================
B. HARD INVARIANTS
============================================================

Do NOT:

- rewrite the player
- add a second audio engine
- break Media Session
- break PWA/service worker
- break Vercel serverless ESM imports
- expose server secrets
- add authentication
- add a database/backend
- add provider OAuth
- add collaborative playlists
- download/cache music
- use YouTube API metadata to derive recommendation scores
- enable YouTube background playback

This phase is local-library first.

============================================================
C. CREATE A LIBRARY DOMAIN
============================================================

Create a dedicated library module, separate from personalization.

Prefer:

```text
src/library/
  types.ts
  storage.ts
  store.ts
  selectors.ts
  migrations.ts
  actions.ts
  track-ref.ts
  index.ts
```

Use a versioned persistent schema.

Preferred namespace:

```text
pulse.library.v1
```

Audit whether IndexedDB is appropriate.

Preferred:
- IndexedDB for growing library metadata
- current small localStorage settings remain where they are

Do not directly call IndexedDB/localStorage from React components.

Implement graceful storage-unavailable behavior.

============================================================
D. CORE LIBRARY MODEL
============================================================

Use stable:

```text
provider + providerItemId
```

identity.

Persist safe track references only.

Never persist:
- audio stream URL
- signed URL
- media bytes
- API key
- OAuth token
- raw provider payload
- YouTube statistics

Implement:

- Liked Songs
- user playlists
- track reference table
- hidden/not-interested recommendations
- schema version
- timestamps

Liked Songs is a system/virtual collection, not a renamable playlist.

============================================================
E. YOUR LIBRARY
============================================================

Add:

```text
/library
/library/liked
/playlist/:playlistId
```

Integrate in desktop and mobile navigation.

`/library` should show:

- Liked Songs
- Your playlists
- optional useful shortcuts already supported by product

Use existing visual language.

No generic off-brand redesign.

============================================================
F. LIKE / HEART
============================================================

Add one canonical Pulse-local heart state across:

- Search
- Home
- Recently Played
- Player
- Queue
- Playlist rows

Action labels must be accessible.

Like:
- adds to Liked Songs
- persists immediately
- creates/updates safe library track ref
- updates every mounted surface in real time
- becomes a strong explicit recommendation signal for Audius/Jamendo when personalization consent is granted

Unlike:
- removes Liked Songs membership
- does not delete listening history
- removes explicit-like recommendation contribution
- does not automatically create a strong negative signal

Do not mutate provider-native likes.

UI copy should make it clear this is saved in Pulse.

============================================================
G. ADD TO PLAYLIST
============================================================

Add a shared action:

```text
Add to playlist
```

Available from appropriate track surfaces.

Menu:
- existing playlists
- Create new playlist

Prevent duplicates in same playlist by default.

Success via toast.

No provider network request.

============================================================
H. PLAYLIST CRUD
============================================================

Implement:

- create
- rename
- description
- delete
- add track
- remove track
- reorder
- keyboard move controls
- local search
- custom order persistence

Bounds:
- sensible playlist count cap
- sensible tracks-per-playlist cap

Unicode-safe.

Delete requires confirmation.

Deleting a playlist must not unlike its songs.

============================================================
I. PLAYLIST COVER
============================================================

Create automatic cover presentation from up to four safe artwork references.

Do NOT create or persist new binary images.

Fallback safely on missing/broken artwork.

Preserve YouTube-specific attribution/thumbnail rules.

============================================================
J. PLAYLIST PLAYBACK
============================================================

Reuse the exact existing player/queue.

Play:
- start first playable
- remaining playlist items become explicit continuation

Click row:
- start selected item
- continuation is subsequent playlist order

Shuffle:
- session-only shuffled order
- persisted playlist order unchanged
- deterministic within session

Implement Repeat if the app does not already have it:

- repeat off
- repeat playlist
- repeat one

Track-end precedence:

```text
repeat one
explicit playlist/user queue
repeat playlist wrap
Phase 6 autoplay
stop
```

User intent always wins over generated autoplay.

Media Session Next/Previous must use the same queue actions.

============================================================
K. RECOMMENDATION SIGNAL UPGRADE
============================================================

Do NOT create a new recommendation engine.

Extend the existing Phase 4 profile / Phase 6 scorer.

Explicit signals:

```text
Pulse Like -> very strong bounded positive
In >=1 playlist -> strong bounded positive
Not interested -> strong negative/exclusion
```

Prevent duplicate weighting explosion.

A track in 5 playlists must not count 5x.

Consent denied:
- library still works
- explicit library actions must not train the personalization profile

============================================================
L. NOT INTERESTED
============================================================

Add:

```text
Not interested
```

to recommendation surfaces where appropriate.

Behavior:
- remove item from recommendation surfaces
- persist hidden state when permitted
- add negative/exclusion signal only when personalization consent permits
- offer Undo
- never change provider account
- never delete history

Add Settings action:

```text
Reset hidden recommendations
```

if there is a natural existing settings section.

============================================================
M. MADE-FOR-YOU MIXES
============================================================

Create 1–3 dynamic virtual mixes when evidence is sufficient.

Do not claim personalization on cold start.

Possible product labels:

- Your Mix
- Discovery Mix
- More from your likes

or simple numbered Pulse mixes.

Use Audius/Jamendo only for derived recommendation scoring.

Inputs:
- local preference profile
- liked Audius/Jamendo tracks
- playlisted Audius/Jamendo tracks
- recent qualified listening
- real provider metadata
- Jamendo similar
- bounded Audius discovery candidates
- reusable Phase 6 similarity logic

Per mix target:
- 15–30 tracks
- max 2 per artist
- recent-repeat suppression
- hidden-item exclusion
- controlled exploration

Do not regenerate every playback tick.

============================================================
N. SAVE MIX AS PLAYLIST
============================================================

Allow:

```text
Save as playlist
```

This snapshots the current virtual mix order into a normal local playlist.

After saving:
- it is independent
- future recommendation changes do not mutate it automatically

============================================================
O. YOUTUBE POLICY — STRICT
============================================================

Re-read current official YouTube API Services Developer Policies before implementation.

Current reviewed rule:

Non-Authorized API Data may be stored only as necessary and no longer than 30 calendar days before deletion or refresh.

Current Pulse has no YouTube OAuth.

Therefore saved YouTube metadata is temporary.

If YouTube items are allowed in Liked Songs/playlists:

Store only minimal currently-permitted normalized metadata and:

```text
storedAt
youtubeExpiresAt <= storedAt + 30 days
```

Do not store YouTube statistics.

Do not use YouTube API metadata in:
- taste profile
- similarity
- mixes
- recommendation weights
- derived metrics

On expiry:
- take the strict policy-safe route
- purge API-derived metadata or mark stale
- optionally provide explicit refresh

If implementing refresh:
- use narrow server route
- bounded IDs
- `videos.list` only
- zero `search.list`
- recheck embeddability/MadeForKids
- no generic proxy
- no request storm

If policy interpretation is uncertain:
fully remove the expired YouTube saved item.

Do not weaken existing YouTube background-play prohibition.

============================================================
P. PROVIDER-NATIVE ACTIONS
============================================================

Do not add Audius OAuth or Jamendo OAuth now.

Research confirms both providers have native user library/write capabilities, but that is a future integration.

Pulse actions must be labeled/implemented as:

```text
Liked in Pulse
Saved to Pulse playlist
```

not provider-native mutations.

============================================================
Q. PRIVACY
============================================================

Update `/privacy` as necessary.

Explain:

- library stored locally on this browser/device
- no Pulse account
- no cloud sync
- deleting Pulse library does not modify provider accounts
- YouTube metadata retention/expiry behavior
- user can clear local library

Add:

```text
Clear Library
```

in Settings with confirmation.

It must not silently clear unrelated volume/UI settings.

Decide and document whether it clears local recommendation signals derived from library actions; if it does, explain and test it.

============================================================
R. PERFORMANCE
============================================================

Opening Library:
- no provider search calls merely to render saved metadata
- no YouTube search
- no background API storm

Resolve provider media only when playback needs it or when a specifically documented metadata refresh is required.

Use selectors/memoization.

Do not parse a large persisted object on every render.

============================================================
S. TESTING
============================================================

Follow `46_TESTING_QA.md`.

Add deterministic tests for:

- storage
- likes
- playlist CRUD
- reorder
- library routes
- playlist playback
- shuffle
- repeat
- queue precedence
- Media Session integration
- explicit recommendation signals
- Not interested
- mixes
- Save mix as playlist
- YouTube expiration/policy
- privacy
- no secrets
- no stream URL persistence

Extend Playwright with real product flows.

============================================================
T. PRODUCTION SAFETY
============================================================

Preserve the recent Vercel fixes.

Specifically:
- production build tsconfig remains test-pruned
- full `pnpm typecheck` still typechecks tests
- Node ESM-safe server relative imports remain explicit/runtime-valid
- `api/jamendo` and `api/youtube` must not regress to `ERR_MODULE_NOT_FOUND`

After local gates and push, verify direct production endpoints.

============================================================
U. FULL GATES
============================================================

Run:

```powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
pnpm verify:bundle
```

Do not edit tests simply to manufacture green.

Run live provider smoke only when useful and quota allows.

============================================================
V. MANUAL QA
============================================================

On local and deployed HTTPS:

1. Like Audius song
2. Like Jamendo song
3. verify Library
4. reload
5. create playlist
6. add 3+ tracks
7. reorder
8. Play
9. Next
10. Shuffle
11. Repeat
12. add current song to another playlist
13. unlike one
14. mark one recommendation Not interested
15. verify mixes update appropriately
16. Save mix as playlist
17. reload
18. verify everything persists

On mobile/PWA:
- heart
- playlist menu
- library navigation
- playlist playback
- Media Session
- no layout overflow

============================================================
W. FINAL REPORT
============================================================

Create:

```text
docs/PHASE7_LIBRARY_RECOMMENDATIONS_FINAL_REPORT.md
```

Include:

# Status
# Baseline
# Library architecture
# Persistence
# Liked Songs
# Playlist CRUD
# Playlist playback
# Shuffle / repeat
# Queue precedence
# Explicit recommendation signals
# Not interested
# Made-for-you mixes
# Save mix behavior
# Audius boundary
# Jamendo boundary
# YouTube policy audit
# YouTube expiration/refresh
# Privacy
# Performance/network budget
# Vercel regression verification
# Files changed
# Unit/component count
# E2E count
# Manual QA
# Production QA
# Known limitations
# Future cloud-sync path

Do not claim PASS unless:
- likes persist
- playlists persist
- reorder works
- playlist playback/queue precedence works
- recommendation signals are bounded
- mixes are real, not fake cold-start labels
- YouTube policy rules are enforced
- all deterministic gates pass
- Vercel serverless endpoints still function after deployment

============================================================
X. STOP
============================================================

After this phase is complete, STOP.

Do not add:
- Pulse accounts
- cloud DB
- collaborative playlists
- provider OAuth
- offline downloads
- crossfade
- lyrics
- social feed

Those are future phases.
