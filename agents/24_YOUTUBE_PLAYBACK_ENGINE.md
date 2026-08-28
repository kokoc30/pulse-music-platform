# 24 — YouTube Playback Engine

## Architecture

Keep current HTMLAudioElement engine for Audius/Jamendo.

Add:
- `YouTubeIframeEngine`,
- a small `PlaybackCoordinator`.

Exactly one provider engine is active at a time.

## Engine Switching

### Audio -> YouTube
1. pause audio engine,
2. render visible YouTube surface,
3. wait for IFrame player readiness,
4. cue/load selected video,
5. play only when current visibility/policy rules are satisfied.

### YouTube -> Audio
1. pause/stop YouTube,
2. activate audio engine,
3. load provider stream,
4. play under existing app semantics.

### YouTube -> YouTube
Reuse the same single embedded player instance where practical.

## Official IFrame API

Use only the official YouTube IFrame Player API. Do not install an unofficial extraction/player package.

Wrap global `YT.Player` behind a typed adapter. Map ready/state/error events into app state.

## Native Controls

Keep native YouTube controls visible and usable. Place external app controls outside the iframe and only use documented IFrame methods.

## Progress

If currentTime must be reflected in app UI, use one modest polling timer only while YouTube is playing. Stop it when paused/inactive/unmounted.

## Visibility

Use page visibility handling and IntersectionObserver where needed for scripted playback. If user closes the visible surface, pause/stop YouTube.

## Queue

Mixed queues may contain:

```text
Audius -> Jamendo -> YouTube -> Audius -> YouTube
```

YouTube visibility/autoplay restrictions override seamless transitions. If automatic playback is not allowed, cue the item and require explicit play.

## Errors

Map IFrame errors to safe states. Do not search for mirror copies automatically. Allow next result or direct `Open on YouTube` where appropriate.

## Testability

Normal Vitest/E2E should use a fake YouTube adapter, not real iframes. Live smoke tests Data API metadata; do not automate ad suppression/media extraction.
