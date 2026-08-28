# 28 — Phase 3 Definition of Done

## Preservation
- [ ] Audius search/playback still PASS.
- [ ] Jamendo search/playback still PASS.
- [ ] International smart search still PASS.
- [ ] Existing reference UI unchanged except documented YouTube deviations.
- [ ] `refe/` untouched.

## Search / Quota
- [ ] YouTube is explicit fallback, not always-on.
- [ ] No YouTube request on typing.
- [ ] One explicit fallback normally uses one search call.
- [ ] No alias fanout or automatic pagination.
- [ ] One batched videos.list enriches results.
- [ ] Quota errors handled safely.

## Security
- [ ] `YOUTUBE_API_KEY` server-only.
- [ ] No `VITE_YOUTUBE_API_KEY`.
- [ ] Browser metadata calls only `/api/youtube`.
- [ ] Real key absent from client bundle.
- [ ] Key-bearing errors/logs redacted.
- [ ] Endpoint is narrow, not open proxy.

## Domain
- [ ] YouTube uses `provider: youtube` and `mediaKind: youtube-video`.
- [ ] YouTube never enters HTMLAudioElement.
- [ ] Audio providers never enter YouTube engine.
- [ ] Title/channel/thumbnail retained accurately.
- [ ] MadeForKids status known before embed.

## Playback
- [ ] Official IFrame API used.
- [ ] One YouTube player instance.
- [ ] Visible while playing.
- [ ] Minimum 200x200 respected.
- [ ] Native controls visible.
- [ ] No iframe overlays.
- [ ] Ads not blocked.
- [ ] No audio extraction/download/proxy.
- [ ] Hidden document pauses.
- [ ] Closing surface pauses/stops.
- [ ] Scripted playback respects visibility requirements.
- [ ] All provider transitions tested.

## UI / Attribution
- [ ] YouTube results separately labeled.
- [ ] Every YouTube result attributed.
- [ ] Direct watch link exists.
- [ ] Thumbnail presented unmodified at 16:9.
- [ ] Channel title visible.
- [ ] Player responsive and mobile-compliant.
- [ ] Reference deviations documented.

## Privacy / MFK
- [ ] Privacy disclosure exists.
- [ ] No YouTube autoplay on page load.
- [ ] Referrer policy does not suppress required Referer.
- [ ] MFK status retrieved.
- [ ] MFK handling compliant or external-only.
- [ ] No YouTube media caching/history database.
- [ ] No prohibited derived cross-platform metric.

## Tests
- [ ] YouTube server/search tests.
- [ ] Unicode tests.
- [ ] Quota/request-budget tests.
- [ ] Security tests.
- [ ] Normalization tests.
- [ ] Playback coordinator tests.
- [ ] IFrame adapter tests.
- [ ] Visibility tests.
- [ ] UI attribution tests.
- [ ] MFK tests.
- [ ] E2E fallback tests.
- [ ] Live YouTube smoke.
- [ ] Existing Audius/Jamendo smokes remain.

## Full Gate
- [ ] typecheck PASS.
- [ ] lint PASS.
- [ ] unit/component tests PASS.
- [ ] build PASS.
- [ ] E2E PASS.
- [ ] bundle scan PASS.
- [ ] Audius smoke PASS.
- [ ] Jamendo smoke PASS.
- [ ] YouTube smoke PASS.
- [ ] Armenian manual query tested.
- [ ] Arabic manual query tested.
- [ ] Cyrillic manual query tested.
- [ ] Visible YouTube playback manually confirmed.
- [ ] Google Cloud quota usage checked.

## Final Report
Report PASS/PARTIAL/FAIL, baseline, policy audit, architecture, quota strategy, request counts, security, playback visibility behavior, privacy/MFK handling, tests, all live smokes, manual international QA, deployment changes, and known limitations.
