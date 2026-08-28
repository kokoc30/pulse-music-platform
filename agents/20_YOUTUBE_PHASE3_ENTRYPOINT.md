# 20 — YouTube Phase 3 Entry Point

## Purpose

Phase 3 extends the already-working Audius + Jamendo music platform with YouTube as an **explicit fallback provider** for broader international/mainstream coverage.

YouTube is not an audio-stream provider in this project. Correct architecture:

```text
Audius  -> audio -> existing HTMLAudioElement
Jamendo -> audio -> existing HTMLAudioElement
YouTube -> official visible YouTube IFrame Player
```

Forbidden:

```text
YouTube -> extract MP3/audio
YouTube -> hidden iframe -> audio-only playback
YouTube -> download/rehost/proxy media
YouTube -> background/invisible playback
```

## Mandatory Read Order

Read the original Phase 1 and Phase 2 files first (`AGENTS.md`, `01_...` through `19_...`), then:

1. `20_YOUTUBE_PHASE3_ENTRYPOINT.md`
2. `21_YOUTUBE_POLICY_BOUNDARIES.md`
3. `22_YOUTUBE_SEARCH_QUOTA_ARCHITECTURE.md`
4. `23_YOUTUBE_SERVERLESS_SECURITY.md`
5. `24_YOUTUBE_PLAYBACK_ENGINE.md`
6. `25_YOUTUBE_UI_ATTRIBUTION_AND_FIDELITY.md`
7. `26_YOUTUBE_PRIVACY_MFK_DATA.md`
8. `27_PHASE3_TESTING_QA.md`
9. `28_PHASE3_DEFINITION_OF_DONE.md`

Do not code before inspecting the live repository and current official YouTube documentation.

## Product Decision

YouTube must be quota-conscious. Current default YouTube Data API allocation gives projects only **100 `search.list` calls/day**. Therefore YouTube must not run during ordinary debounced Audius/Jamendo search.

Required flow:

```text
User searches
   |
   v
Audius + Jamendo smart search
   |
   +--> strong result -> normal UI
   |
   `--> weak/no result
          |
          v
     [ Search YouTube ]
          |
          v
     YouTube fallback
```

A subtle `Search YouTube for more` action may also be offered after normal results, but it must require explicit user action.

## Official Sources To Re-Verify

- https://developers.google.com/youtube/v3/docs/search/list
- https://developers.google.com/youtube/v3/determine_quota_cost
- https://developers.google.com/youtube/iframe_api_reference
- https://developers.google.com/youtube/player_parameters
- https://developers.google.com/youtube/terms/developer-policies
- https://developers.google.com/youtube/terms/required-minimum-functionality
- https://developers.google.com/youtube/v3/guides/made_for_kids_status

Current official docs outrank this pack if policies change.
