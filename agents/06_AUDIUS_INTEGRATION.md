# 06 — Audius Integration Contract

## Provider

V1 music provider: Audius.

Use official Audius APIs/SDK only.

Do not scrape:
- Spotify,
- YouTube,
- SoundCloud pages,
- search engines,
- unofficial MP3 sites.

---

## Current Official Capability Assumptions

At the time this project pack was authored, Audius official developer material states that its JavaScript/TypeScript SDK supports searching and streaming tracks and that the free API plan provides a rate-limited monthly allowance.

The implementation agent must verify the installed SDK types and official current documentation while implementing. API surfaces can change.

Never freeze this document's example method names over what the installed SDK actually supports.

---

## Credentials

V1 client environment:

```env
VITE_AUDIUS_API_KEY=
```

The Audius API key is designed to be usable in browser contexts.

Do **not** put an Audius bearer token in the browser.

Do not create:

```env
VITE_AUDIUS_BEARER_TOKEN=...
```

That is prohibited by this project.

If later work genuinely requires a bearer token, it must be moved to a server-side environment and the architecture must be revised explicitly.

---

## SDK Initialization

Centralize initialization in a single module such as:

`src/music/audius/client.ts`

Conceptual example only:

```ts
import { sdk } from '@audius/sdk'

const apiKey = import.meta.env.VITE_AUDIUS_API_KEY

if (!apiKey) {
  throw new Error('Missing VITE_AUDIUS_API_KEY')
}

export const audius = sdk({ apiKey })
```

Confirm exact current SDK signature from installed types.

Do not duplicate SDK instances per component.

---

## Search

Expected provider behavior:

```ts
searchTracks(query, { limit, offset })
```

Normalize results immediately.

Recommended defaults:
- debounce: ~250-350 ms,
- first page: ~20 tracks,
- relevant sorting when supported,
- do not query blank/whitespace-only strings.

Protect against stale responses.

Example scenario:
- request A: `dr`
- request B: `drake`
- B returns first,
- A returns later.

A must not overwrite B's results.

---

## Trending / Discovery

Use Audius supported discovery/trending operations for homepage sections represented by the reference.

Normalize all returned tracks.

If a section requires a genre:
- use provider-supported genre values,
- do not send arbitrary UI labels if the API requires canonical genre strings.

---

## Track Normalization

Raw provider data must become a stable app model.

Mapping should safely handle:
- missing artwork,
- missing artist/user,
- unknown duration,
- zero play count,
- non-streamable/gated track,
- malformed optional metadata.

No UI should crash because artwork is absent.

---

## Artwork Selection

Prefer:
- large artwork for hero/expanded player,
- medium for cards,
- small for rows/player.

Use a reference-matching fallback when artwork is missing.

Do not ship reference mock artwork as if it belongs to real Audius tracks.

---

## Streaming

Audius exposes a documented stream endpoint for track audio.

Implementation rules:

1. Use public stream behavior supported by current official Audius API/SDK.
2. Do not download and re-host the song.
3. Do not turn every playback into a Vercel/Render audio proxy.
4. Do not create Blob URLs for full songs unless required for a narrow browser compatibility reason.
5. Do not persist audio.
6. Respect tracks that are not publicly streamable.
7. If a track is gated or cannot be streamed, show the reference-styled unavailable/error state and continue operating.

Because streaming APIs can evolve, the agent must confirm the correct current approach from:
- installed `@audius/sdk` types/source,
- official Audius API schema/documentation.

If the official SDK provides a first-class stream helper, prefer it.
If the SDK does not, use the documented REST stream endpoint in the supported way.

Do not invent undocumented URL formats or query parameters.

---

## Errors

Map provider errors to a small domain set:

```ts
type MusicErrorCode =
  | 'CONFIG'
  | 'NETWORK'
  | 'RATE_LIMIT'
  | 'NOT_FOUND'
  | 'NOT_STREAMABLE'
  | 'PROVIDER'
```

UI should receive a human-safe error, not an SDK dump.

---

## Rate Limits / Request Discipline

Even with a generous development/free allowance:
- debounce search,
- no duplicate request loops,
- no refetch on every render,
- no trending refetch on every component mount,
- abort/ignore obsolete requests,
- avoid prefetching stream data for entire result lists.

---

## Development Mocking

Use MSW for tests.

Production:
- real provider.

Tests:
- deterministic mocked provider responses.

Do not require external Audius availability for unit/component tests.

A small optional integration smoke test may call real Audius only when an environment flag is enabled.

---

## Provider Swappability

UI imports app-level music functions/types, not Audius SDK types.

Future providers should be addable without rewriting:
- player UI,
- track card,
- track row,
- search page.

Do not implement other providers now.
