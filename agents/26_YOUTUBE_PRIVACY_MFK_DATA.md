# 26 — YouTube Privacy, MadeForKids, and Data Handling

## Privacy

Embedded YouTube players share request/playback context with YouTube/Google. Add a lightweight Privacy page/link stating truthfully:
- this app has no account/database in the current version,
- external providers are used,
- YouTube Data API and embedded player are used only for fallback results/playback,
- YouTube/Google may receive request/playback data,
- link to Google's Privacy Policy.

Do not write legal guarantees.

## Autoplay

YouTube autoplay must be false on page load. No YouTube playback before explicit user interaction.

## MadeForKids

Before embedding, retrieve `status.madeForKids` via current `videos.list` guidance.

If `madeForKids === true`, inspect current official requirements for disabling tracking. Do not guess.

If a compliant implementation is not clear/achievable within this simple architecture:
- do not embed it,
- keep the result visible as external-only,
- provide `Open on YouTube`,
- explain internal playback is unavailable for that item.

## Data Storage

Do not store YouTube API data indefinitely. Allowed Phase 3 storage is short-lived session/in-memory/CDN metadata cache only, under current retention rules.

Never store:
- audiovisual media,
- user viewing history,
- inferred user preferences,
- user identifiers.

## Metrics

Do not create cross-platform derived engagement/popularity metrics from YouTube + Audius + Jamendo statistics.

## Referrer

Do not globally suppress required Referer context. Audit meta tags and Vercel headers.
