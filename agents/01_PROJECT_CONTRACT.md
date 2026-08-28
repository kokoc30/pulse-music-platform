# 01 — Project Contract

## Objective

Implement the production version of the music platform represented by the design reference at:

`C:\music-platform\refe`

The production system should preserve the reference's visual identity while converting it from a mock/design prototype into a real, testable music search and playback application.

---

## Primary User Journey

The critical flow is:

`OPEN APP -> SEARCH -> RESULTS -> CLICK TRACK -> AUDIO PLAYS`

This path has priority over every secondary feature.

A new visitor should be able to understand the product without onboarding or registration.

---

## V1 Product Requirements

### Home / discovery

The homepage should use the reference layout exactly as the visual source of truth.

Where the reference contains mock music content, production should prefer real Audius discovery/trending data.

The homepage should remain usable if discovery data fails:
- shell remains visible,
- error/empty state is styled according to reference,
- search remains available.

### Search

Users can search by keywords such as:
- track title,
- artist,
- genre-related text.

Requirements:
- trim input,
- avoid requests for empty queries,
- debounce typing,
- cancel or ignore stale requests,
- loading state,
- no-results state,
- API error state,
- deterministic result rendering,
- no duplicate React keys,
- no raw provider data exposed throughout the UI.

### Playback

Clicking a playable search/discovery result must:
1. set it as current track,
2. load its real Audius stream,
3. start playback because the action originated from a user gesture,
4. update the persistent player UI,
5. preserve the player while navigating/searching.

### Queue

The queue is client-side only.

Required behavior:
- current track,
- next track,
- previous track,
- add-to-queue if the reference exposes the interaction,
- avoid duplicated accidental queue entries where reasonable,
- continue to next track on `ended`,
- show a queue panel/view only if present in the reference.

### Responsive UI

Match the reference behavior for:
- desktop,
- laptop,
- tablet,
- mobile.

Do not implement "desktop squeezed into mobile."

### No account requirement

No signup/login walls. No persistence server.

Optional local-only persistence is allowed only for harmless playback UX such as:
- volume,
- mute state,
- recent local query,
and only if it does not create reference drift.

---

## Product Non-Goals

Do not add:
- authentication,
- subscriptions,
- ads,
- payments,
- database schema,
- server-side user history,
- user-generated uploads,
- downloading,
- DRM bypass,
- social graphs,
- comments,
- creator analytics,
- AI recommendations,
- multi-provider aggregation.

These can be later phases. They are not V1.

---

## Quality Priorities

In descending order:

1. Functional search -> playback.
2. Reference UI fidelity.
3. Stable player behavior.
4. Responsive usability.
5. Correct provider abstraction.
6. Error/loading handling.
7. Tests.
8. Performance.
9. Nice-to-have enhancements.

Do not sacrifice the top priorities to add low-value features.

---

## Legal/Product Truth

This application is not "all songs on Earth for free."

It streams music made available through the chosen provider's catalog and rules.

The UI must not claim:
- Spotify catalog equivalence,
- guaranteed global availability,
- ownership of streamed tracks,
- download rights.

Avoid misleading product copy.
