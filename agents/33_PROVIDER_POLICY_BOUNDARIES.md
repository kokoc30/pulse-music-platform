# Provider and policy boundaries

## YouTube
Current official Google policy explicitly prohibits background play of the YouTube player when the API-client window is closed/minimized.

Phase 6 must preserve:
- official visible IFrame player
- background/hidden pause behavior
- no extraction or isolated audio
- no YouTube autoplay generation
- no YouTube automatic search from next-track logic
- no app-owned background Media Session that can restart hidden YouTube

## Audius
Continue using the current browser-side Audius architecture and one HTML audio engine. Preserve content-node retry/failover.

Useful real metadata may include genre, mood, BPM, musical key and tags. Normalize only fields actually present.

## Jamendo
Use the existing server-only handler. The official `/tracks/similar` endpoint may be added as one narrow action.

Do not expose:
- client id
- raw upstream payload
- download URLs
- generic proxy capability

## PWA
PWA installation improves app-like UX but does not grant native unrestricted background execution.

## Audio Session API
MDN currently marks the newer Audio Session API experimental/limited. Do not make it a core dependency. Prefer the stable Media Session integration plus HTML audio.
