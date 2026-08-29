# Phase 7 — Library, Liked Songs, Playlists and Professional Recommendations

Project: `C:\music-platform`

## Objective

Add the next professional music-app layer on top of the completed Pulse V1:

1. **Your Library**
2. **Liked Songs**
3. **User-created playlists**
4. **Add to playlist / remove / reorder / play / shuffle**
5. **Persistent local library**
6. **Stronger recommendation signals from explicit user intent**
7. **Made-for-you mixes**
8. **Hide / Not interested**
9. **Library search, sorting and deep links**
10. **Provider-safe handling of Audius, Jamendo and YouTube**

This phase is additive. Do not rewrite the existing search, player, queue, personalization, Media Session, PWA, or Vercel server architecture.

## Product boundary

Pulse still has no Pulse account and no database in this phase.

The library is **local to this browser/device**.

That is intentional. The data model must be designed so it can later be synchronized to a real account/backend without a rewrite.

## Why local first

The current app already has local personalization/history. A local library gives the app a professional "save and return" experience immediately while avoiding a new identity/backend project.

A later phase may add:
- Pulse accounts
- cloud sync
- collaborative playlists
- provider account connections
- import/export

Do not add those now.

## Read in order

1. `41_LIBRARY_DATA_MODEL.md`
2. `42_LIKES_PLAYLISTS_UX.md`
3. `43_RECOMMENDATION_MIXES.md`
4. `44_PROVIDER_POLICY_BOUNDARIES.md`
5. `45_PLAYLIST_PLAYBACK_QUEUE.md`
6. `46_TESTING_QA.md`
7. `47_DEFINITION_OF_DONE.md`
8. `48_FUTURE_CLOUD_SYNC.md`
9. `RESEARCH_SOURCES.md`
10. `ONE_SHOT_PHASE7_PROMPT.md`
