import { handleJamendoRequestSafely } from '../server/jamendo/handler.js'

/**
 * `GET /api/jamendo?action=search&q=<query>&limit=<n>` — the only route the
 * browser uses to reach Jamendo metadata.
 *
 * `JAMENDO_CLIENT_ID` is injected here, server-side, and never crosses into the
 * client bundle (agents/16_JAMENDO_SERVERLESS_SECURITY.md). Audio bytes do not
 * pass through this function: the sanitized response carries Jamendo's own
 * stream URL and the browser's single `<audio>` element loads it directly from
 * Jamendo storage.
 *
 * Written as a Vercel Web Handler so the exact same `Request`/`Response`
 * function backs the Vite dev and preview servers — see `vite.config.ts`.
 * Imports are relative on purpose: Vercel's Node runtime does not apply the
 * project's TypeScript path mappings inside `/api`.
 */
export function GET(request: Request): Promise<Response> {
  return handleJamendoRequestSafely(request, { env: process.env })
}

/** Anything other than GET is rejected by the shared handler, not by routing. */
export function POST(request: Request): Promise<Response> {
  return handleJamendoRequestSafely(request, { env: process.env })
}
