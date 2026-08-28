# Phase 6 — Background audio, PWA and intelligent autoplay

Project: `C:\music-platform`

## Goals
1. Give Audius/Jamendo app-like background playback using the existing single `HTMLAudioElement` plus the Media Session API.
2. Make Pulse installable as a PWA.
3. Add deterministic "similar next track" autoplay when the explicit queue is empty.
4. Preserve every Phase 1–5 invariant.

## Critical reality
- Background web audio is browser/OS controlled. Do not promise playback after the user force-closes the browser/PWA or the OS kills the process.
- A service worker cannot own the existing `HTMLAudioElement`; it has no DOM access and is not a permanent audio daemon.
- **YouTube must not be background-played.** Current YouTube API policy prohibits API clients from offering background play of the YouTube player while the client window is closed/minimized.
- YouTube must not be auto-queued or auto-searched by the autoplay engine.

## Read in order
- `31_MEDIA_SESSION_PWA.md`
- `32_AUTOPLAY_SIMILAR_QUEUE.md`
- `33_PROVIDER_POLICY_BOUNDARIES.md`
- `34_QUEUE_INTEGRATION.md`
- `35_PHASE6_TESTING_QA.md`
- `36_PHASE6_DEFINITION_OF_DONE.md`
- `37_NATIVE_FUTURE_PATH.md`
- `RESEARCH_SOURCES.md`

Then execute `ONE_SHOT_PHASE6_PROMPT.md`.
