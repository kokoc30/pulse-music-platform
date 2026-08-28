# 14 — Jamendo Provider Contract

## Official API Scope for Phase 2

Use Jamendo API v3 read methods only.

Primary endpoint:

```text
GET https://api.jamendo.com/v3.0/tracks/
```

Jamendo documents that:

- `client_id` is required.
- `search` performs free-text search across track, album, artist, tags, and similar artists.
- relevance is the default search order.
- `type` can include both singles and album tracks.
- the response includes `audio`, which is a stream URL.
- the response includes artwork and Jamendo share/source URLs.
- `audioformat` supports MP3, OGG, and FLAC options.

Do not use write APIs or OAuth in Phase 2.

## Recommended Search Request

The server-side adapter should build a request conceptually equivalent to:

```text
/v3.0/tracks/
  ?client_id=<SERVER_ONLY>
  &format=json
  &limit=20
  &search=<UTF-8 QUERY>
  &order=relevance
  &type=single albumtrack
  &audioformat=mp32
  &imagesize=300
```

Use `URL` / `URLSearchParams`.

Do not concatenate raw user query strings into URLs manually.

Confirm the exact accepted formatting for multi-value parameters against current Jamendo documentation and live behavior before finalizing.

## Search Rules

### Query

- Preserve original Unicode.
- Trim whitespace.
- Limit request length sensibly.
- Never render provider metadata as HTML.
- Reuse the existing smart-search normalization/ranking layer for comparison.
- Do not destroy Arabic, Cyrillic, Armenian, or other Unicode text.

### Variant budget

Do not fan out every smart-search alias to Jamendo.

Jamendo should normally receive:

1. the original query, and
2. at most one high-value alternate variant when it materially changes script/spelling and the initial combined result quality is weak.

This keeps latency and provider load bounded.

The existing Audius smart-search behavior should not be weakened.

## Jamendo Raw Track Shape

The adapter should safely parse relevant fields such as:

```ts
interface JamendoRawTrack {
  id: string
  name: string
  duration: number | string
  artist_id: string
  artist_name: string
  album_name?: string
  album_id?: string
  image?: string
  album_image?: string
  audio?: string
  shorturl?: string
  shareurl?: string
  license_ccurl?: string
  releasedate?: string
  audiodownload_allowed?: boolean
  audiodownload?: string
}
```

Do not trust provider types blindly.

Validate/coerce:
- string IDs,
- numeric duration,
- missing image,
- missing stream URL,
- malformed URLs,
- missing source/share URL.

## Production Normalized Track

Extend the existing application Track model minimally.

Conceptual shape:

```ts
type MusicProviderId = 'audius' | 'jamendo'

interface Track {
  id: string
  provider: MusicProviderId
  providerId: string
  title: string
  artistId?: string
  artistName: string
  artwork: {
    small?: string
    medium?: string
    large?: string
  }
  durationSeconds: number
  genre?: string
  playCount?: number
  isStreamable: boolean
  sourceUrl?: string
  licenseUrl?: string
  attributionRequired?: boolean
}
```

Do not rewrite the whole domain model if equivalent fields already exist.

Use stable application IDs:

```text
audius:<provider-id>
jamendo:<provider-id>
```

Never assume IDs are globally unique across providers.

## Jamendo Normalization

Map:

- `provider = 'jamendo'`
- `providerId = raw.id`
- `id = 'jamendo:' + raw.id`
- `title = raw.name`
- `artistName = raw.artist_name`
- artwork from `image` then `album_image`
- `durationSeconds = finite parsed duration`
- `isStreamable = valid HTTPS raw.audio`
- `sourceUrl = raw.shareurl || raw.shorturl`
- `licenseUrl = raw.license_ccurl`
- `attributionRequired = true`

Do not expose `audiodownload` in the frontend domain model.

Phase 2 has no download feature.

## Streaming

For a valid Jamendo track, playback should use the provider-returned `audio` stream URL.

The audio source should be assigned to the existing single global audio engine.

Do not create a second Jamendo-specific HTMLAudioElement.

Do not:
- fetch the full track into JS memory,
- turn it into a Blob,
- proxy it through Vercel,
- cache it,
- save it,
- expose download actions.

## Provider Errors

Map Jamendo errors into the application's existing domain error model.

Jamendo failure must not make Audius fail.

## API Response Validation

Jamendo responses include a `headers` object and `results`.

Server adapter must verify:

- HTTP status,
- JSON parse,
- Jamendo API success status/code,
- array results.

Do not trust `200 OK` alone if Jamendo's response-level status reports failure.

## No Direct Browser Credential Calls

No client source file may contain:

```ts
import.meta.env.VITE_JAMENDO_CLIENT_ID
```

No frontend request may call:

```text
https://api.jamendo.com/...client_id=...
```

Browser Jamendo metadata calls must go through the application's same-origin serverless route.

Direct browser access to the returned **audio stream URL** is allowed and required for this architecture.
