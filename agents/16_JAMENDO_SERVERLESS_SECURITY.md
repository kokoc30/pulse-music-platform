# 16 — Jamendo Serverless, Security, and Environment

## Why a Serverless Function Is Required

A Vite `VITE_*` environment variable is compiled into client JavaScript.

The Jamendo API terms treat API credentials as credentials that should not be disclosed.

Therefore:

```env
VITE_JAMENDO_CLIENT_ID=
```

is forbidden.

Use:

```env
JAMENDO_CLIENT_ID=
```

server-side.

## Environment Contract

`.env.example` should become conceptually:

```env
VITE_AUDIUS_API_KEY=
VITE_AUDIUS_APP_NAME=Pulse Music Platform

# SERVER ONLY
JAMENDO_CLIENT_ID=
```

The real `.env` / `.env.local` remains gitignored.

## Production Vercel Function

Prefer one top-level function:

```text
api/jamendo.ts
```

Shared server-only implementation should live outside top-level `/api`, for example:

```text
server/jamendo/
  handler.ts
  client.ts
  schema.ts
  sanitize.ts
```

## Public API Contract

Keep the browser API narrow.

Example:

```text
GET /api/jamendo?action=search&q=<query>&limit=20
```

Do not expose an arbitrary Jamendo proxy.

Whitelist supported actions and parameters.

## Search Endpoint Validation

Validate:

- GET only,
- known action,
- query required for search,
- query length,
- clamped limit,
- whitelisted optional genre if implemented.

Reject malformed requests with safe JSON.

## Server-Side Upstream Request

Use:

- HTTPS,
- `URL`,
- `URLSearchParams`,
- timeout/AbortController,
- safe error handling.

## Sanitized Response

Return only data needed by the frontend.

Strip:

- `audiodownload`,
- unnecessary private data,
- internal request details,
- `client_id`,
- upstream credential-bearing URLs.

## Audio Must Bypass the Function

The function may return Jamendo's provider-issued audio stream URL.

Playback then goes directly:

```text
Browser -> Jamendo storage
```

Do not implement an audio proxy.

## Local Development

Existing `pnpm dev` should remain useful.

Preferred design:

- shared Jamendo handler,
- mounted in Vite dev server middleware,
- same validation/sanitization logic as Vercel.

The Vite config may read `JAMENDO_CLIENT_ID` server-side, but never inject it into client code.

## Missing Configuration

When `JAMENDO_CLIENT_ID` is absent:

- Jamendo is unavailable,
- Audius keeps working,
- no raw config error reaches the user.

## CORS

Frontend calls same-origin `/api/jamendo`.

Do not broadly enable `Access-Control-Allow-Origin: *` without need.

## Abuse / Rate Discipline

- debounce,
- bounded variants,
- clamped limits,
- no polling,
- no infinite pagination,
- no offline caching.

## Credential Redaction

Extend existing redaction for:

- `client_id`,
- `api_key`,
- `access_token`,
- bearer values.

Unit test redaction.

## Bundle Verification

After build, scan client output for the actual Jamendo client ID.

Expected:

```text
0 matches
```

## Vercel Environment

Add:

```text
VITE_AUDIUS_API_KEY
JAMENDO_CLIENT_ID
```

Optional:

```text
VITE_AUDIUS_APP_NAME
```

Mark `JAMENDO_CLIENT_ID` sensitive where supported.

Redeploy after environment changes.

## Vercel Routing

Verify the SPA rewrite does not swallow `/api/jamendo`.

This must be tested.
