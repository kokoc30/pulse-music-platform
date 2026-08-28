import { handleYouTubeRequestSafely } from '../server/youtube/handler'

/**
 * `GET /api/youtube?action=search&q=<query>` — the only route the browser uses
 * to reach YouTube metadata.
 *
 * `YOUTUBE_API_KEY` is injected here, server-side, and never crosses into the
 * client bundle (agents/23_YOUTUBE_SERVERLESS_SECURITY.md). No audiovisual
 * bytes pass through this function and none ever will: the sanitized response
 * carries metadata only, and playback happens in YouTube's own embedded IFrame
 * player, loaded from YouTube, with its native controls and its ads intact.
 *
 * Written as a Vercel Web Handler so the exact same `Request`/`Response`
 * function backs the Vite dev and preview servers — see `vite.config.ts`.
 * Imports are relative on purpose: Vercel's Node runtime does not apply the
 * project's TypeScript path mappings inside `/api`.
 */
export function GET(request: Request): Promise<Response> {
  return handleYouTubeRequestSafely(request, { env: process.env })
}

/** Anything other than GET is rejected by the shared handler, not by routing. */
export function POST(request: Request): Promise<Response> {
  return handleYouTubeRequestSafely(request, { env: process.env })
}
