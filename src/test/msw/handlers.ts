import { HttpResponse, http } from 'msw'
import {
  RAW_TRACKS,
  RAW_USERS,
  catalogSearchResponse,
  searchResponse,
  streamResponse,
  trackListResponse,
  userListResponse,
} from '../fixtures/audius'
import type { RawAudiusTrack } from '../fixtures/audius'
import { JAMENDO_TRACKS, jamendoSearchResponse } from '../fixtures/jamendo'
import type { JamendoFixtureTrack } from '../fixtures/jamendo'
import { YOUTUBE_PAYLOADS, youtubeSearchResponse } from '../fixtures/youtube'
import type { YouTubeVideoPayload } from '@/music/youtube'

/**
 * `@audius/sdk`'s production base path is fixed at `https://api.audius.co/v1`
 * (verified in the installed SDK's `createSdk`), so MSW can intercept it
 * deterministically.
 */
export const AUDIUS_BASE = 'https://api.audius.co'

/**
 * Deliberately naive substring matching — it mirrors how Audius actually
 * behaves, including returning loosely-related rows, which is exactly what the
 * relevance layer has to cope with.
 */
export function matchTracks(query: string): RawAudiusTrack[] {
  const needle = query.toLowerCase().trim()
  if (!needle || needle.includes('nothing')) return []
  const matches = RAW_TRACKS.filter((track) =>
    `${track.title} ${String((track.user as { name?: string } | undefined)?.name ?? '')}`
      .toLowerCase()
      .includes(needle),
  )
  return matches.length ? matches : RAW_TRACKS
}

function matchUsers(query: string): unknown[] {
  const needle = query.toLowerCase().trim()
  if (!needle) return []
  return RAW_USERS.filter((user) =>
    `${String(user.name)} ${String(user.handle)}`.toLowerCase().includes(needle),
  )
}

/**
 * The same-origin Jamendo route. It answers *empty* by default so every Phase 1
 * test keeps seeing exactly the Audius-only result set it was written against;
 * a test that wants the second catalogue opts in with
 * `server.use(jamendoHandlers.withResults())`.
 */
export const JAMENDO_ROUTE = '/api/jamendo'

export const jamendoHandlers = {
  /** Jamendo returns real rows. */
  withResults: (tracks: JamendoFixtureTrack[] = JAMENDO_TRACKS) =>
    http.get(JAMENDO_ROUTE, ({ request }) =>
      HttpResponse.json(jamendoSearchResponse(tracks, new URL(request.url).searchParams.get('q') ?? '')),
    ),
  /** No JAMENDO_CLIENT_ID configured: the documented graceful-degradation path. */
  unavailable: () =>
    http.get(JAMENDO_ROUTE, () =>
      HttpResponse.json({ error: { code: 'UNAVAILABLE', message: 'unavailable' } }, { status: 503 }),
    ),
  /** Jamendo is configured but broken. */
  serverError: () =>
    http.get(JAMENDO_ROUTE, () =>
      HttpResponse.json({ error: { code: 'UPSTREAM', message: 'boom' } }, { status: 502 }),
    ),
}

/**
 * The same-origin YouTube route.
 *
 * There is deliberately **no default handler** for it in `handlers` below. MSW
 * is configured with `onUnhandledRequest: 'error'`, so any test that causes a
 * YouTube request without explicitly opting in fails loudly. That is the
 * quota-discipline guarantee expressed as test infrastructure: typing, ordinary
 * search, discovery and playback must all cost zero YouTube calls, and if one
 * ever appears the suite says so rather than quietly stubbing it
 * (agents/22 → "Quota Constraint").
 */
export const YOUTUBE_ROUTE = '/api/youtube'

export const youtubeHandlers = {
  /** YouTube answers with rows. Opt in with `server.use(...)`. */
  withResults: (payloads: YouTubeVideoPayload[] = YOUTUBE_PAYLOADS) =>
    http.get(YOUTUBE_ROUTE, ({ request }) =>
      HttpResponse.json(youtubeSearchResponse(payloads, new URL(request.url).searchParams.get('q') ?? '')),
    ),
  /** No YOUTUBE_API_KEY configured — the documented graceful-degradation path. */
  unavailable: () =>
    http.get(YOUTUBE_ROUTE, () =>
      HttpResponse.json({ error: { code: 'UNAVAILABLE', message: 'unavailable' } }, { status: 503 }),
    ),
  /** The day's 100 searches are gone. */
  quotaExceeded: () =>
    http.get(YOUTUBE_ROUTE, () =>
      HttpResponse.json(
        { error: { code: 'QUOTA', message: 'YouTube search is temporarily unavailable. Try again later.' } },
        { status: 429 },
      ),
    ),
  serverError: () =>
    http.get(YOUTUBE_ROUTE, () =>
      HttpResponse.json({ error: { code: 'UPSTREAM', message: 'boom' } }, { status: 502 }),
    ),
  /** Answers, but records every call so request counts can be asserted. */
  counting: (calls: string[], payloads: YouTubeVideoPayload[] = YOUTUBE_PAYLOADS) =>
    http.get(YOUTUBE_ROUTE, ({ request }) => {
      const url = new URL(request.url)
      calls.push(url.searchParams.get('q') ?? '')
      return HttpResponse.json(youtubeSearchResponse(payloads, url.searchParams.get('q') ?? ''))
    }),
}

export const handlers = [
  // Default: configured, reachable, and empty.
  http.get(JAMENDO_ROUTE, ({ request }) =>
    HttpResponse.json(jamendoSearchResponse([], new URL(request.url).searchParams.get('q') ?? '')),
  ),

  // The SDK's storage-node selector pings this during initialisation and reads
  // `data.network.content_nodes`; supplying it keeps the test console clean.
  http.get(`${AUDIUS_BASE}/health_check`, () =>
    HttpResponse.json({
      data: {
        healthy: true,
        network: {
          content_nodes: [
            {
              endpoint: 'https://cn1.example.audius',
              delegateOwnerWallet: '0xcn1',
              type: 'content-node',
            },
            {
              endpoint: 'https://cn2.example.audius',
              delegateOwnerWallet: '0xcn2',
              type: 'content-node',
            },
          ],
        },
      },
      comms: { healthy: true },
    }),
  ),

  http.get(`${AUDIUS_BASE}/v1/tracks/search`, ({ request }) =>
    HttpResponse.json(searchResponse(matchTracks(new URL(request.url).searchParams.get('query') ?? ''))),
  ),

  // The combined index the smart-search layer uses: tracks + artists per call.
  http.get(`${AUDIUS_BASE}/v1/search/full`, ({ request }) => {
    const query = new URL(request.url).searchParams.get('query') ?? ''
    return HttpResponse.json(catalogSearchResponse(matchTracks(query), matchUsers(query)))
  }),

  http.get(`${AUDIUS_BASE}/v1/users/:userId/tracks`, ({ params }) => {
    const owned = RAW_TRACKS.filter(
      (track) => (track.user as { id?: string } | undefined)?.id === params.userId,
    )
    return HttpResponse.json(trackListResponse(owned))
  }),

  http.get(`${AUDIUS_BASE}/v1/tracks/trending/underground`, () =>
    HttpResponse.json(trackListResponse(RAW_TRACKS.slice(0, 2))),
  ),

  http.get(`${AUDIUS_BASE}/v1/tracks/trending`, () => HttpResponse.json(trackListResponse())),

  http.get(`${AUDIUS_BASE}/v1/users/top`, () => HttpResponse.json(userListResponse())),

  http.get(`${AUDIUS_BASE}/v1/tracks/:trackId/stream`, ({ params }) => {
    const track = RAW_TRACKS.find((item) => item.id === params.trackId)
    if (!track) return HttpResponse.json({ error: 'not found' }, { status: 404 })
    if (track.is_streamable === false) {
      return HttpResponse.json({ error: 'gated' }, { status: 403 })
    }
    return HttpResponse.json(streamResponse())
  }),

  http.get(`${AUDIUS_BASE}/v1/tracks/:trackId`, ({ params }) => {
    const track = RAW_TRACKS.find((item) => item.id === params.trackId)
    if (!track) return HttpResponse.json({ error: 'not found' }, { status: 404 })
    return HttpResponse.json({ data: track })
  }),
]

/** Handlers a test can swap in with `server.use(...)` to exercise failure paths. */
export const errorHandlers = {
  rateLimited: http.get(`${AUDIUS_BASE}/v1/tracks/search`, () =>
    HttpResponse.json({ error: 'rate limited' }, { status: 429 }),
  ),
  serverError: http.get(`${AUDIUS_BASE}/v1/tracks/search`, () =>
    HttpResponse.json({ error: 'boom' }, { status: 500 }),
  ),
  networkError: http.get(`${AUDIUS_BASE}/v1/tracks/search`, () => HttpResponse.error()),
  trendingServerError: http.get(`${AUDIUS_BASE}/v1/tracks/trending`, () =>
    HttpResponse.json({ error: 'boom' }, { status: 500 }),
  ),

  // The smart-search path goes through /search/full, so UI-level failure tests
  // need to fail that endpoint rather than /tracks/search.
  catalogRateLimited: http.get(`${AUDIUS_BASE}/v1/search/full`, () =>
    HttpResponse.json({ error: 'rate limited' }, { status: 429 }),
  ),
  catalogServerError: http.get(`${AUDIUS_BASE}/v1/search/full`, () =>
    HttpResponse.json({ error: 'boom' }, { status: 500 }),
  ),
  catalogNetworkError: http.get(`${AUDIUS_BASE}/v1/search/full`, () => HttpResponse.error()),
}
