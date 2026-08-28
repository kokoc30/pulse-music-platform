# 10 — Security, Environment, and Deployment

## V1 Environment

Create:

`.env.example`

with:

```env
# Audius developer API key.
# Audius documents the API key as safe for frontend/browser use.
VITE_AUDIUS_API_KEY=
```

Local developer creates:

`.env.local`

or the Vite-supported local env file used by the project.

Never commit the real value.

---

## Forbidden Client Secret

Never create or expose:

```env
VITE_AUDIUS_BEARER_TOKEN=
```

Never hardcode:
- bearer tokens,
- private keys,
- passwords,
- server-only service keys.

Anything prefixed `VITE_` is exposed to client-side bundled code.

---

## Input Safety

Search query:
- trim,
- length-limit sensibly,
- treat as plain data,
- no `dangerouslySetInnerHTML`,
- do not interpret provider metadata as HTML.

Remote artwork URLs:
- use as image source,
- provide fallback,
- do not render arbitrary HTML.

Provider titles/descriptions:
- React text rendering only unless explicitly sanitized.

---

## Links

For external track/artist links:
- use provider permalink when available,
- if opening new tab use safe rel attributes such as `noopener noreferrer`.

---

## Audio

Do not:
- store provider MP3s,
- re-upload,
- expose "download" UI unless explicitly supported by rights/provider and requested in a later phase,
- scrape alternate sources when a stream fails.

---

## Vercel

Preferred deployment: Vercel.

Expected configuration for Vite:

- install: `pnpm install`
- build: `pnpm build`
- output directory: `dist`

Set:

`VITE_AUDIUS_API_KEY`

in Vercel project environment variables.

Because it is a client API key, it will be included in the frontend bundle. This is intentional only because Audius explicitly supports browser use of the API key.

---

## SPA Rewrites

If production uses `BrowserRouter` with paths such as `/search`, refreshing a deep link on static hosting may require rewrite configuration.

Use a Vercel rewrite only if needed.

Example:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Verify this against Vercel behavior and do not overwrite special asset/API routes if architecture changes.

---

## Render

No Render backend is required for V1.

If a later blocker forces a backend, create it deliberately and separately.

Before doing so, document:
- why browser-only is insufficient,
- exact secret/server capability needed,
- endpoint contract,
- CORS policy,
- deployment plan,
- health check,
- timeout behavior.

Never introduce Render solely because the original idea mentioned it.

---

## Headers

For static app hardening, consider sensible headers where compatible:
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- frame policy / `frame-ancestors` as appropriate

A strict CSP can be valuable but must account for:
- Audius API,
- Audius audio/storage hosts,
- artwork hosts,
- font hosts.

Do not ship a CSP that breaks playback.

---

## Error Logging

Never log secrets.

Client logs may contain:
- safe error code,
- operation,
- provider status.

Avoid dumping full SDK configuration.

---

## Deployment Verification

After Vercel deploy:

1. Open production URL in incognito.
2. Search real track.
3. Play publicly streamable result.
4. Pause/resume.
5. Seek.
6. Next/previous.
7. Refresh homepage.
8. Test a direct route if any.
9. Test mobile viewport.
10. Inspect console/network.
11. Confirm no secret/bearer token appears in bundle/network.
12. Confirm stream bytes come from Audius infrastructure, not the application's hosting origin.

---

## README Deployment Section

Production README must state:
- prerequisites,
- `pnpm install`,
- how to obtain Audius API key,
- `.env` setup,
- `pnpm dev`,
- `pnpm test:run`,
- `pnpm build`,
- Vercel deployment.
