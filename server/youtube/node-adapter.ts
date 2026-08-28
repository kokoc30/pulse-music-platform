import type { IncomingMessage, ServerResponse } from 'node:http'
import type { EnvSource } from './env'
import { handleYouTubeRequestSafely } from './handler'

/**
 * Bridges the shared Web-standard handler onto Node's `(req, res)` middleware
 * signature, so the Vite dev and preview servers run **the same code** the
 * Vercel Function runs — same validation, same fixed result count, same
 * sanitization, same redaction (agents/23 → "API Shape").
 *
 * The credential is read from the Node process here and never handed to Vite's
 * `define`, so it cannot reach the client bundle.
 */

export const YOUTUBE_ROUTE = '/api/youtube'

/** Absolute URL for the incoming request, needed to construct a `Request`. */
function absoluteUrl(request: IncomingMessage): string {
  const host = request.headers.host ?? 'localhost'
  return new URL(request.url ?? '/', `http://${host}`).toString()
}

export interface MiddlewareOptions {
  env: EnvSource
}

export function createYouTubeMiddleware(options: MiddlewareOptions) {
  return function youtubeMiddleware(
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ): void {
    const path = (request.url ?? '').split('?')[0]
    if (path !== YOUTUBE_ROUTE) {
      next()
      return
    }

    void (async () => {
      const webRequest = new Request(absoluteUrl(request), {
        method: request.method ?? 'GET',
        headers: new Headers(
          Object.entries(request.headers)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([key, value]): [string, string] => [key, value]),
        ),
      })

      const webResponse = await handleYouTubeRequestSafely(webRequest, { env: options.env })
      response.statusCode = webResponse.status
      webResponse.headers.forEach((value, key) => response.setHeader(key, value))
      response.end(await webResponse.text())
    })().catch(() => {
      // The shared handler already turns every failure into a safe response;
      // reaching here means the socket itself broke.
      if (!response.headersSent) response.statusCode = 502
      response.end()
    })
  }
}
