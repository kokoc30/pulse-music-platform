# 23 — YouTube Serverless and Security

## Environment

Use server-only:

```env
YOUTUBE_API_KEY=
```

Forbidden:

```env
VITE_YOUTUBE_API_KEY=
```

Frontend metadata requests go only through `/api/youtube`.

## Google Cloud Key

Document:
1. create/use Google Cloud project,
2. enable YouTube Data API v3,
3. create API key,
4. restrict key to YouTube Data API v3,
5. store as `YOUTUBE_API_KEY`,
6. never commit it.

If dynamic Vercel egress prevents a safe IP application restriction, do not invent one. At minimum apply an API restriction and keep the key server-side.

## API Shape

Prefer one Vercel Function:

```text
api/youtube.ts
```

Shared logic should live outside `/api` and be reused by Vite dev middleware so `pnpm dev` works without a separate backend.

Endpoint accepts only approved fields such as:
- `action=search`,
- `q`.

Reject arbitrary upstream URLs, API parts, keys, pagination, or user-supplied maxResults beyond the fixed product cap.

## Sanitization

Return only fields needed by UI/playback. Never return:
- API key,
- key-bearing upstream URL,
- raw Google error payloads with credentials,
- unnecessary statistics/user data.

Extend existing redaction for `key`, `api_key`, `client_id`, `access_token`, and authorization headers.

## Referrer Policy

YouTube embedded player requires playback context identification via HTTP Referer. Audit current Vercel security headers.

Do not use `Referrer-Policy: no-referrer`.

Prefer current YouTube-compatible guidance, currently `strict-origin-when-cross-origin`, after re-verifying official docs.

Use the current origin player parameter when documented/recommended.

## Missing Key

Without `YOUTUBE_API_KEY`, Audius/Jamendo must remain fully functional. Hide/disable the YouTube fallback or return a clean unavailable state.

## Bundle Scan

Extend `pnpm verify:bundle` to scan for the actual YouTube API key. Expected client-bundle matches: **0**.
