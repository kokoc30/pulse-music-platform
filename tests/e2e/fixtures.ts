import type { Locator, Page, Route } from '@playwright/test'

/**
 * Deterministic Audius doubles for E2E.
 *
 * The suite must not depend on the live Audius service or on real audio bytes
 * (agents/09_TESTING_QA.md). Discovery/search JSON is stubbed at the network
 * layer, and the stream URL points at a tiny locally-generated WAV so the real
 * `<audio>` element genuinely loads, plays, seeks and ends.
 */

const ENVELOPE = {
  latest_chain_block: 1,
  latest_indexed_block: 1,
  latest_chain_slot_plays: 1,
  latest_indexed_slot_plays: 1,
  signature: 'sig',
  timestamp: '2026-01-01T00:00:00Z',
  version: { service: 'discovery-node', version: '1.0.0' },
}

interface TrackSpec {
  id: string
  title: string
  artist: string
  duration: number
  streamable?: boolean
}

const rawTrack = (spec: TrackSpec) => ({
  id: spec.id,
  title: spec.title,
  duration: spec.duration,
  genre: 'Electronic',
  mood: 'Energizing',
  play_count: 1000,
  permalink: `/${spec.artist.toLowerCase().replace(/\s+/g, '')}/${spec.id}`,
  is_streamable: spec.streamable !== false,
  access: { stream: spec.streamable !== false, download: false },
  artwork: null,
  followee_reposts: [],
  followee_favorites: [],
  track_segments: [],
  remix_of: null,
  field_visibility: {
    mood: true,
    tags: true,
    genre: true,
    share: true,
    remixes: true,
    play_count: true,
  },
  is_original_available: false,
  is_downloadable: false,
  repost_count: 1,
  favorite_count: 1,
  comment_count: 0,
  blocknumber: 1,
  created_at: '2026-01-01T00:00:00Z',
  cover_art_sizes: 'art',
  user: {
    id: `u-${spec.id}`,
    name: spec.artist,
    handle: spec.artist.toLowerCase().replace(/\s+/g, ''),
    is_verified: false,
    is_deactivated: false,
    is_available: true,
    profile_picture: null,
  },
})

export const TRENDING: TrackSpec[] = [
  { id: 't1', title: 'Neon Corridor', artist: 'Aster Vale', duration: 8 },
  { id: 't2', title: 'Glass Harbour', artist: 'Ilo Rhen', duration: 8 },
  { id: 't3', title: 'Slow Transit', artist: 'Mora Kest', duration: 8 },
  { id: 't4', title: 'Copper Field', artist: 'Nell Aro', duration: 8 },
  { id: 't5', title: 'Late Return', artist: 'Sable Junot', duration: 8 },
]

export const SEARCH_RESULTS: TrackSpec[] = [
  { id: 's1', title: 'Night Signal', artist: 'Aster Vale', duration: 8 },
  { id: 's2', title: 'Night Drive', artist: 'Ilo Rhen', duration: 8 },
  { id: 's3', title: 'Night Vault', artist: 'The Vault', duration: 8, streamable: false },
]

const USERS = [
  {
    id: 'a1',
    name: 'Aster Vale',
    handle: 'astervale',
    is_verified: true,
    is_deactivated: false,
    is_available: true,
    follower_count: 1200,
    track_count: 20,
    profile_picture: null,
  },
  {
    id: 'a2',
    name: 'Ilo Rhen',
    handle: 'ilorhen',
    is_verified: false,
    is_deactivated: false,
    is_available: true,
    follower_count: 800,
    track_count: 12,
    profile_picture: null,
  },
  {
    id: 'a3',
    name: 'Mora Kest',
    handle: 'morakest',
    is_verified: false,
    is_deactivated: false,
    is_available: true,
    follower_count: 400,
    track_count: 8,
    profile_picture: null,
  },
  {
    id: 'a4',
    name: 'Nell Aro',
    handle: 'nellaro',
    is_verified: false,
    is_deactivated: false,
    is_available: true,
    follower_count: 200,
    track_count: 4,
    profile_picture: null,
  },
]

/** A 2-second silent 8 kHz mono WAV — small, real, and decodable by Chromium. */
export function silentWav(seconds = 2): Buffer {
  const sampleRate = 8000
  const samples = sampleRate * seconds
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  return buffer
}

/** A 1x1 transparent PNG, so an image renders with no request leaving the machine. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export const AUDIO_ORIGIN = 'https://audio.e2e.test'
/** Stands in for an Audius content node serving cover art. */
export const ARTWORK_ORIGIN = 'https://art.e2e.test'
export const STREAM_PATH = `${AUDIO_ORIGIN}/stream.wav`

export interface StubOptions {
  /** Force every discovery + search request to fail with this status. */
  failStatus?: number
  /** Force search to return no results. */
  emptySearch?: boolean
  /** Make the stream-URL lookup fail. */
  failStream?: boolean
  /**
   * Rows every search answers with. Defaults to `SEARCH_RESULTS`.
   *
   * Autoplay searches the catalogue for something in the same vein when the
   * queue runs low, so a spec that means "there is exactly one track in the
   * world" has to say so here — otherwise the continuation finds the other
   * search rows and is quite right to play them.
   */
  searchResults?: TrackSpec[]
  /** Rows the trending shelves answer with. Defaults to `TRENDING`. */
  trending?: TrackSpec[]
}

export async function stubAudius(page: Page, options: StubOptions = {}): Promise<void> {
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

  await page.route('https://api.audius.co/health_check', (route) =>
    json(route, {
      data: { healthy: true, network: { content_nodes: [] } },
      comms: { healthy: true },
    }),
  )

  await page.route('https://api.audius.co/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (options.failStatus && !path.includes('/stream')) {
      return route.fulfill({
        status: options.failStatus,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'stubbed failure' }),
      })
    }

    if (path.endsWith('/stream')) {
      if (options.failStream) {
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'gated' }),
        })
      }
      return json(route, { data: STREAM_PATH })
    }

    const searchRows = options.searchResults ?? SEARCH_RESULTS
    const trendingRows = options.trending ?? TRENDING

    if (path === '/v1/tracks/search') {
      const results = options.emptySearch ? [] : searchRows
      return json(route, { data: results.map(rawTrack) })
    }

    // The smart-search layer reads tracks and artists from one combined index.
    if (path === '/v1/search/full') {
      const results = options.emptySearch ? [] : searchRows
      return json(route, {
        ...ENVELOPE,
        data: { tracks: results.map(rawTrack), users: [], playlists: [], albums: [] },
      })
    }

    if (/^\/v1\/users\/[^/]+\/tracks$/.test(path)) {
      return json(route, { ...ENVELOPE, data: [] })
    }

    if (path === '/v1/users/top') {
      return json(route, { ...ENVELOPE, data: USERS })
    }

    if (path === '/v1/tracks/trending/underground') {
      return json(route, { ...ENVELOPE, data: trendingRows.slice(0, 3).map(rawTrack) })
    }

    if (path === '/v1/tracks/trending') {
      return json(route, { ...ENVELOPE, data: trendingRows.map(rawTrack) })
    }

    // A single track by id. Recently Played re-resolves an Audius row through
    // this, because a stored history entry deliberately keeps no playable URL.
    //
    // Checked *after* the named collection routes: `/v1/tracks/trending` also
    // matches "one path segment after /tracks/", and answering it with a single
    // track would empty the trending shelf.
    const byId = /^\/v1\/tracks\/([^/]+)$/.exec(path)
    if (byId) {
      const id = byId[1]
      const spec = [...TRENDING, ...SEARCH_RESULTS].find((track) => track.id === id) ?? {
        id,
        title: 'Recovered Track',
        artist: 'Aster Vale',
        duration: 8,
      }
      return json(route, { ...ENVELOPE, data: rawTrack(spec) })
    }

    return json(route, { ...ENVELOPE, data: [] })
  })

  // Phase 2: pin the second provider to a deterministic empty answer so an
  // Audius-only spec behaves identically whether or not the machine running it
  // happens to have a JAMENDO_CLIENT_ID configured. `stubJamendo` registers a
  // later matching route, which Playwright gives precedence, so `stubProviders`
  // still gets real Jamendo rows.
  await page.route('**/api/jamendo*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'jamendo',
        action: 'search',
        query: '',
        count: 0,
        results: [],
      }),
    }),
  )

  // Artwork, served locally. Audius publishes images on community content
  // nodes; the suite must not depend on one being reachable, and a history card
  // that renders its real image has to have a real image to render.
  await page.route(`${ARTWORK_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG }),
  )

  // Real audio bytes, served locally: no copyrighted stream, no live network.
  await page.route(`${AUDIO_ORIGIN}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: { 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' },
      body: silentWav(),
    }),
  )
}

/* ==========================================================================
   Jamendo doubles (Phase 2)

   The suite must not depend on the live Jamendo service, on a real
   JAMENDO_CLIENT_ID, or on copyrighted audio (agents/18_PHASE2_TESTING_QA.md
   → "E2E"). `/api/jamendo` is stubbed at the network layer with exactly the
   sanitized payload the serverless function emits, and the stream URL points at
   the same locally-generated WAV the Audius double uses, so real playback,
   seeking and `ended` all happen against a real <audio> element.
   ========================================================================== */

export const JAMENDO_AUDIO_ORIGIN = 'https://prod-1.storage.jamendo.test'

export interface JamendoTrackSpec {
  id: string
  title: string
  artist: string
  duration: number
  /** Omit the stream URL, producing a visible but unplayable row. */
  streamable?: boolean
  /** Omit the Jamendo page URL, exercising the attribution fallback. */
  sourceUrl?: boolean
}

export const JAMENDO_RESULTS: JamendoTrackSpec[] = [
  { id: '1880336', title: 'Night Reverie', artist: 'Lumen Field', duration: 8 },
  { id: '1880337', title: 'Night Cedar', artist: 'Cedar Room', duration: 8 },
]

/** Exactly the shape `server/jamendo/sanitize.ts` emits — no extra fields. */
const jamendoPayload = (spec: JamendoTrackSpec) => ({
  id: spec.id,
  title: spec.title,
  artistName: spec.artist,
  artistId: `ja-${spec.id}`,
  albumName: 'Slow Country',
  durationSeconds: spec.duration,
  artwork: undefined,
  ...(spec.streamable === false ? {} : { audioUrl: `${JAMENDO_AUDIO_ORIGIN}/?trackid=${spec.id}` }),
  ...(spec.sourceUrl === false
    ? {}
    : {
        sourceUrl: `https://www.jamendo.com/track/${spec.id}/${spec.title.toLowerCase().replace(/\s+/g, '-')}`,
      }),
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/3.0/',
  releaseDate: '2023-04-11',
})

export interface JamendoStubOptions {
  /** Answer 503, as a deployment with no JAMENDO_CLIENT_ID does. */
  unavailable?: boolean
  /** Answer 502, as a configured-but-broken Jamendo does. */
  failing?: boolean
  /** Return no rows. */
  empty?: boolean
  tracks?: JamendoTrackSpec[]
}

export async function stubJamendo(page: Page, options: JamendoStubOptions = {}): Promise<void> {
  await page.route('**/api/jamendo*', (route) => {
    if (options.unavailable) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'unavailable' } }),
      })
    }
    if (options.failing) {
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UPSTREAM', message: 'boom' } }),
      })
    }
    const specs = options.empty ? [] : (options.tracks ?? JAMENDO_RESULTS)
    const query = new URL(route.request().url()).searchParams.get('q') ?? ''
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'jamendo',
        action: 'search',
        query,
        count: specs.length,
        results: specs.map(jamendoPayload),
      }),
    })
  })

  // Real audio bytes for the Jamendo stream URL, served locally.
  await page.route(`${JAMENDO_AUDIO_ORIGIN}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: { 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' },
      body: silentWav(),
    }),
  )
}

/** Both catalogues, the normal Phase 2 state. */
export async function stubProviders(
  page: Page,
  options: { audius?: StubOptions; jamendo?: JamendoStubOptions } = {},
): Promise<void> {
  await stubAudius(page, options.audius ?? {})
  await stubJamendo(page, options.jamendo ?? {})
}

/* ==========================================================================
   YouTube doubles (Phase 3)

   Nothing here touches the live YouTube network. `agents/27_PHASE3_TESTING_QA.md`
   → "Normal E2E must not use live YouTube", and the daily allowance is 100
   searches for the whole deployment, so an E2E run that spent real quota would
   be both non-deterministic and expensive.

   Three things are intercepted:

   · `/api/youtube` — answered with exactly the sanitized payload the serverless
     function emits, no extra fields;
   · `https://www.youtube.com/iframe_api` — replaced with a local script that
     defines a `YT.Player` with the documented method and event surface, so the
     app's real adapter, engine and coordinator all run unchanged;
   · `https://i.ytimg.com/**` — a locally generated PNG, so a thumbnail renders
     without a request leaving the machine.

   The fake player still creates a real `<iframe>` and still *replaces* the node
   it is given, exactly as the official API does, which is what makes the
   "nothing overlays the iframe" assertions meaningful.
   ========================================================================== */

export interface YouTubeSpec {
  videoId: string
  title: string
  channelTitle: string
  durationSeconds?: number
  embeddable?: boolean
  madeForKids?: boolean | null
}

export const YOUTUBE_RESULTS: YouTubeSpec[] = [
  {
    videoId: 'aaaaaaaaaaa',
    title: 'Night Signal (Official Video)',
    channelTitle: 'Aster Vale',
    durationSeconds: 213,
  },
  {
    videoId: 'bbbbbbbbbbb',
    title: 'Night Drive Live',
    channelTitle: 'Ilo Rhen',
    durationSeconds: 245,
  },
  {
    videoId: 'ccccccccccc',
    title: 'Night Songs For Kids',
    channelTitle: 'Little Tunes',
    durationSeconds: 180,
    madeForKids: true,
  },
  {
    videoId: 'ddddddddddd',
    title: 'Night Vault Session',
    channelTitle: 'The Vault',
    durationSeconds: 300,
    embeddable: false,
  },
]

/** Exactly the shape `server/youtube/sanitize.ts` emits — no extra fields. */
const youtubePayload = (spec: YouTubeSpec) => ({
  videoId: spec.videoId,
  title: spec.title,
  channelTitle: spec.channelTitle,
  channelId: `UC-${spec.videoId}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${spec.videoId}/maxresdefault.jpg`,
  thumbnailWidth: 1280,
  thumbnailHeight: 720,
  publishedAt: '2019-10-24T06:36:00Z',
  ...(spec.durationSeconds ? { durationSeconds: spec.durationSeconds } : {}),
  embeddable: spec.embeddable !== false,
  madeForKids: spec.madeForKids === undefined ? false : spec.madeForKids,
})

/**
 * A local stand-in for `https://www.youtube.com/iframe_api`.
 *
 * It implements only the documented surface the app uses: the `YT.Player`
 * constructor with `width`/`height`/`videoId`/`playerVars`/`events`, the
 * playback methods, `seekTo`, `getIframe`, `destroy`, and the
 * `onReady`/`onStateChange` events carrying the documented state numbers.
 */
const FAKE_IFRAME_API = `
(function () {
  var STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }
  window.__pulseYouTube = {
    created: 0, playCalls: 0, lastVideoId: null, playing: false, destroyed: 0,
    // The unified seek rail and the expanded ten-second controls both drive the
    // player through the documented seekTo. Recording the argument is what lets
    // a test assert the app moved the real playhead rather than only its own
    // progress state.
    seekCalls: 0, lastSeek: null,
    // Every documented command the app issued, in order. This is what makes
    // 'the app asked and the browser refused' distinguishable from 'the app
    // never asked' — the single question the reported failure turned on.
    commands: [],
    // Seeded from a page-level flag a test sets with an init script, so it
    // survives the navigation that re-creates this recorder. Setting it on the
    // recorder directly would race the assignment above.
    blockAutoplay: window.__pulseBlockAutoplay === true,
    blocked: 0,
    // One-shot: the first start is accepted, buffers, and falls straight back to
    // a cued thumbnail with no error and no autoplay-blocked event — the exact
    // sequence a physical phone reported. Consumed on use, so a manual press
    // afterwards behaves normally, which is what really happens.
    refuseNextStart: window.__pulseRefuseNextStart === true,
  }

  function Player(element, config) {
    var self = this
    var doc = element.ownerDocument
    var iframe = doc.createElement('iframe')
    iframe.title = 'YouTube video player'
    iframe.setAttribute('src', 'about:blank')
    iframe.setAttribute('width', String(config.width || 480))
    iframe.setAttribute('height', String(config.height || 270))
    iframe.setAttribute('data-e2e-youtube', '1')
    iframe.setAttribute('allow', 'accelerometer; autoplay; encrypted-media; picture-in-picture')
    iframe.setAttribute('allowfullscreen', 'true')
    element.parentNode.replaceChild(iframe, element)

    var state = STATE.UNSTARTED
    window.__pulseYouTube.created += 1
    window.__pulseYouTube.lastVideoId = config.videoId || null
    window.__pulseYouTube.playerVars = config.playerVars || {}

    function fire(next) {
      state = next
      window.__pulseYouTube.playing = next === STATE.PLAYING
      if (config.events && config.events.onStateChange) {
        config.events.onStateChange({ data: next, target: self })
      }
    }

    function silentlyRefuse() {
      window.__pulseYouTube.refuseNextStart = false
      fire(STATE.BUFFERING)
      fire(STATE.UNSTARTED)
      fire(STATE.CUED)
    }

    function refuse() {
      window.__pulseYouTube.blocked += 1
      if (config.events && config.events.onAutoplayBlocked) config.events.onAutoplayBlocked()
    }

    this.cueVideoById = function (id) {
      window.__pulseYouTube.commands.push('cue')
      window.__pulseYouTube.lastVideoId = id
      fire(STATE.CUED)
    }
    this.loadVideoById = function (id) {
      window.__pulseYouTube.commands.push('loadVideoById')
      window.__pulseYouTube.lastVideoId = id
      window.__pulseYouTube.playCalls += 1
      if (window.__pulseYouTube.blockAutoplay) return refuse()
      if (window.__pulseYouTube.refuseNextStart) return silentlyRefuse()
      fire(STATE.PLAYING)
    }
    this.playVideo = function () {
      window.__pulseYouTube.commands.push('playVideo')
      window.__pulseYouTube.playCalls += 1
      if (window.__pulseYouTube.blockAutoplay) return refuse()
      if (window.__pulseYouTube.refuseNextStart) return silentlyRefuse()
      fire(STATE.PLAYING)
    }
    // Test seam: drive a natural end, which is the one state a test cannot
    // reach by pressing anything.
    window.__pulseYouTube.endCurrent = function () { fire(STATE.ENDED) }
    this.pauseVideo = function () { fire(STATE.PAUSED) }
    this.stopVideo = function () { fire(STATE.UNSTARTED) }
    // Advances while playing, so a test can assert progress actually moves —
    // the difference between a player that started and one that merely says so.
    var startedAt = 0
    this.getCurrentTime = function () {
      if (!window.__pulseYouTube.playing) return startedAt
      startedAt = Math.min(startedAt + 1, 213)
      return startedAt
    }
    // Documented seekTo(seconds, allowSeekAhead). The clock follows it, as a
    // real player does, so a seek is observable through getCurrentTime.
    this.seekTo = function (seconds) {
      window.__pulseYouTube.seekCalls += 1
      window.__pulseYouTube.lastSeek = seconds
      startedAt = Math.max(0, Math.min(seconds, 213))
    }
    this.getDuration = function () { return 213 }
    this.getPlayerState = function () { return state }
    this.getIframe = function () { return iframe }
    this.destroy = function () {
      window.__pulseYouTube.destroyed += 1
      window.__pulseYouTube.playing = false
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }

    setTimeout(function () {
      if (config.events && config.events.onReady) config.events.onReady({ target: self })
    }, 0)
  }

  window.YT = { Player: Player, PlayerState: STATE }
  if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady()
})()
`

export interface YouTubeStubOptions {
  /** Answer 503, as a deployment with no YOUTUBE_API_KEY does. */
  unavailable?: boolean
  /** Answer 429, as an exhausted daily quota does. */
  quotaExceeded?: boolean
  /** Answer 502. */
  failing?: boolean
  /** Return no rows. */
  empty?: boolean
  videos?: YouTubeSpec[]
}

export async function stubYouTube(page: Page, options: YouTubeStubOptions = {}): Promise<void> {
  await page.route('**/api/youtube*', (route) => {
    if (options.unavailable) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'unavailable' } }),
      })
    }
    if (options.quotaExceeded) {
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'QUOTA',
            message: 'YouTube search is temporarily unavailable. Try again later.',
          },
        }),
      })
    }
    if (options.failing) {
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UPSTREAM', message: 'boom' } }),
      })
    }
    const specs = options.empty ? [] : (options.videos ?? YOUTUBE_RESULTS)
    const query = new URL(route.request().url()).searchParams.get('q') ?? ''
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'youtube',
        action: 'search',
        query,
        count: specs.length,
        results: specs.map(youtubePayload),
      }),
    })
  })

  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_IFRAME_API }),
  )

  await page.route('https://i.ytimg.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG }),
  )
}

/**
 * Records every request that would have gone to YouTube or Google.
 *
 * This is how "an ordinary search costs zero YouTube calls" is proved rather
 * than asserted: the list must stay empty until the visitor presses the button.
 */
export function recordYouTubeTraffic(page: Page): string[] {
  const calls: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    // Google Fonts is the page's own webfont stylesheet from index.html and has
    // nothing to do with YouTube; everything else on these hosts does.
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url)) return
    if (/\/api\/youtube|youtube\.com|ytimg\.com|googleapis\.com|googlevideo\.com/.test(url)) {
      calls.push(url)
    }
  })
  return calls
}

/** All three catalogues, the normal Phase 3 state. */
export async function stubAllProviders(
  page: Page,
  options: {
    audius?: StubOptions
    jamendo?: JamendoStubOptions
    youtube?: YouTubeStubOptions
  } = {},
): Promise<void> {
  await stubAudius(page, options.audius ?? {})
  await stubJamendo(page, options.jamendo ?? {})
  await stubYouTube(page, options.youtube ?? {})
}

/* ==========================================================================
   Personalization doubles (Phase 4)

   Personalization lives entirely in `localStorage`, so seeding it is the whole
   of the setup: there is no server to stub, no account to create and no API to
   intercept. `seedPersonalization` writes the same allow-listed shape the
   application itself writes (`src/personalization/storage.ts` → `toPersisted`),
   through an init script so the value is already in place before the app's first
   render — which is what makes it a *returning visitor*, rather than a visitor
   whose history appeared halfway through the page load.
   ========================================================================== */

export const PERSONALIZATION_KEY = 'pulse.personalization.v1'

const DAY_MS = 86_400_000

export interface SeedEntry {
  id: string
  provider?: 'audius' | 'jamendo' | 'youtube'
  title: string
  artist: string
  /** Days before now that this was last played. */
  daysAgo?: number
  /** Days before now that this row was written. Defaults to `daysAgo`. */
  storedDaysAgo?: number
  playCount?: number
  durationSeconds?: number
  genre?: string
  completionRatio?: number
  embeddable?: boolean
  madeForKids?: boolean | null
}

export interface SeedSearch {
  query: string
  script?: 'latin' | 'cyrillic' | 'arabic' | 'armenian' | 'other'
  submitCount?: number
  daysAgo?: number
}

export interface SeedOptions {
  consent?: 'unset' | 'granted' | 'denied'
  entries?: SeedEntry[]
  searches?: SeedSearch[]
}

function buildPersonalization(options: SeedOptions, now: number): Record<string, unknown> {
  const entries = (options.entries ?? []).map((entry) => {
    const provider = entry.provider ?? 'audius'
    const lastPlayedAt = now - (entry.daysAgo ?? 0) * DAY_MS
    const playCount = entry.playCount ?? 1
    const base: Record<string, unknown> = {
      provider,
      providerItemId: entry.id,
      title: entry.title,
      artist: entry.artist,
      context: provider === 'youtube' ? 'search' : 'trending',
      startedAt: lastPlayedAt - 60_000,
      qualifiedAt: playCount > 0 ? lastPlayedAt : null,
      lastPlayedAt,
      playedSeconds: 60 * Math.max(playCount, 1),
      completionRatio: entry.completionRatio ?? 0.6,
      playCount,
      skipCount: 0,
      playedDays: [],
      storedAt: now - (entry.storedDaysAgo ?? entry.daysAgo ?? 0) * DAY_MS,
      durationSeconds: entry.durationSeconds ?? 213,
    }
    if (provider === 'youtube') {
      base.thumbnailUrl = `https://i.ytimg.com/vi/${entry.id}/maxresdefault.jpg`
      base.sourceUrl = `https://www.youtube.com/watch?v=${entry.id}`
      base.embeddable = entry.embeddable !== false
      base.madeForKids = entry.madeForKids === undefined ? false : entry.madeForKids
    } else {
      base.artworkUrl = `${ARTWORK_ORIGIN}/content/${entry.id}/480x480.jpg`
      base.artworkMirrors = [ARTWORK_ORIGIN]
      base.genre = entry.genre ?? 'Electronic'
      base.sourceUrl = `https://audius.co/x/${entry.id}`
    }
    return base
  })

  const searches = (options.searches ?? []).map((search) => ({
    query: search.query,
    normalizedQuery: search.query.toLowerCase(),
    submittedAt: now - (search.daysAgo ?? 0) * DAY_MS,
    providers: ['audius'],
    resultWasPlayed: false,
    submitCount: search.submitCount ?? 1,
    script: search.script ?? 'latin',
  }))

  return {
    version: 1,
    consent: options.consent ?? 'granted',
    consentUpdatedAt: now - DAY_MS,
    updatedAt: now,
    preferences: { promptSeen: true },
    dismissedItems: [],
    listeningHistory: entries,
    searchHistory: searches,
  }
}

/**
 * Puts personalization state in the browser *before* the app loads.
 *
 * `addInitScript` runs on every navigation, so the write is guarded: it seeds
 * only when the key is absent. That distinction is the whole point of the
 * persistence scenarios — re-seeding on reload would silently restore a row the
 * visitor had just removed, and a test asserting "the removal survived" would
 * pass without the application persisting anything at all.
 */
export async function seedPersonalization(page: Page, options: SeedOptions = {}): Promise<void> {
  const payload = JSON.stringify(buildPersonalization(options, Date.now()))
  await page.addInitScript(
    ([key, value]) => {
      try {
        if (window.localStorage.getItem(key as string) === null) {
          window.localStorage.setItem(key as string, value as string)
        }
      } catch {
        // A context with storage disabled is a different scenario entirely.
      }
    },
    [PERSONALIZATION_KEY, payload],
  )
}

/** Reads whatever the application has actually persisted. */
export async function readPersonalization(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
  }, PERSONALIZATION_KEY)
}

/** Every localStorage key the page currently holds. */
export async function storageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.localStorage))
}

/** The shelf headings on the home page, in visual order. */
export async function shelfTitles(page: Page): Promise<string[]> {
  return page.locator('.music-section h2').allInnerTexts()
}

/**
 * Records only requests that would **spend YouTube Data API quota** or load
 * YouTube's player.
 *
 * Deliberately narrower than `recordYouTubeTraffic`. A page that displays a
 * retained Recently Played entry loads YouTube's own thumbnail from
 * `i.ytimg.com`, and it must: the policies require the image to be shown
 * unmodified from YouTube rather than copied or re-hosted. That image request
 * costs no quota and is not an API call. What must stay at zero is the Data API
 * (`/api/youtube`, `googleapis.com`), the IFrame player script and the media
 * CDN — which is what this records.
 */
export function recordYouTubeApiTraffic(page: Page): string[] {
  const calls: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url)) return
    if (/i\.ytimg\.com/.test(url)) return
    if (/\/api\/youtube|youtube\.com|googleapis\.com|googlevideo\.com|ytimg\.com/.test(url)) {
      calls.push(url)
    }
  })
  return calls
}

/* ==========================================================================
   Library doubles (Phase 7)

   The library lives in IndexedDB, and Playwright runs a real browser, so these
   helpers talk to the real thing — there is no adapter to stub. Reading it back
   is how a test proves that a like actually reached durable storage rather than
   merely a React store.
   ========================================================================== */

export const LIBRARY_DB = 'pulse.library.v1'
export const LIBRARY_STORE = 'state'
export const LIBRARY_RECORD = 'state'

/** The persisted library record, exactly as it sits in IndexedDB. */
export async function readLibrary(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    ([dbName, storeName, key]) =>
      new Promise<Record<string, unknown> | null>((resolve) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => resolve(null)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains(storeName)) {
            resolve(null)
            return
          }
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key)
          request.onerror = () => resolve(null)
          request.onsuccess = () =>
            resolve((request.result as Record<string, unknown> | undefined) ?? null)
        }
      }),
    [LIBRARY_DB, LIBRARY_STORE, LIBRARY_RECORD] as const,
  )
}

/** Liked keys currently on disk, in stored order. */
export async function likedKeys(page: Page): Promise<string[]> {
  const record = await readLibrary(page)
  return (record?.likedTrackKeys as string[] | undefined) ?? []
}

/** One playlist's stored item order, by playlist name. */
export async function playlistOrder(page: Page, name: string): Promise<string[]> {
  const record = await readLibrary(page)
  const playlists = (record?.playlists ?? {}) as Record<
    string,
    { name: string; itemKeys: string[] }
  >
  return Object.values(playlists).find((list) => list.name === name)?.itemKeys ?? []
}

/** The heart on a given row or card, by the track's title. */
export function heartFor(page: Page, title: string) {
  return page.getByRole('button', { name: `Save ${title} to Liked Songs in Pulse` })
}

export function unheartFor(page: Page, title: string) {
  return page.getByRole('button', { name: `Remove ${title} from Liked Songs in Pulse` })
}

export function menuFor(page: Page, title: string) {
  return page.getByRole('button', { name: `More actions for ${title}` })
}

/* ==========================================================================
   Reaching the player, in whichever presentation it is in

   The player is one shell with two presentations, and exactly one of them is
   rendered at a time: a compact mini-player docked at the bottom, or the
   expanded Now Playing view — centred and flush to the bottom edge on a desktop,
   the whole viewport on a phone. Pressing a video opens the expanded one, since
   the official player is the content; pressing a track starts the mini-player.

   So "which controls can a visitor reach right now" is a real question, and
   these helpers are the answer, so no spec has to reinvent it.
   ========================================================================== */

/** The expanded view — the same dialog for every provider. */
export const nowPlayingSheet = (page: Page) => page.getByRole('dialog', { name: 'Now playing' })

/**
 * Brings the expanded view down, the way a visitor returns to browsing.
 *
 * A **collapse**, not a dismiss: the same item stays loaded, at the same
 * position, still playing, and the mini-player is rendered in the expanded
 * view's place. A video's player survives it untouched — it is a stable child of
 * the shell, docked rather than destroyed — so a test that needs playback to
 * continue can use this freely. Stopping a video is the separate cross on the
 * mini-player.
 */
export async function collapseSheet(page: Page): Promise<void> {
  const sheet = nowPlayingSheet(page)
  if (!(await sheet.isVisible())) return
  await sheet.getByRole('button', { name: 'Collapse Now Playing' }).click()
  await sheet.waitFor({ state: 'hidden' })
}

/**
 * The transport a visitor can actually reach right now.
 *
 * Both presentations carry the same controls, wired to the same unified actions
 * over the same store, so which one drives a test is only a question of which is
 * up. Two things decide that, and neither is the provider:
 *
 * · **Is the expanded view open?** Then the mini-player is not rendered at all,
 *   and its controls are not merely behind it — they do not exist. For a video
 *   opened by a press, that is the state playback starts in.
 * · **Is the bar showing more than Play?** The reference collapses it to the
 *   round play button below 560px, so a phone reaches Next and Previous by
 *   expanding.
 */
export async function transport(page: Page): Promise<Locator> {
  const sheet = nowPlayingSheet(page)
  if (await sheet.isVisible()) return sheet

  const bar = page.locator('.music-player')
  if (await bar.getByRole('button', { name: 'Next track' }).isVisible()) return bar

  await page.getByRole('button', { name: 'Open Now Playing' }).click()
  await sheet.waitFor({ state: 'visible' })
  return sheet
}

/**
 * The stage's rendered size, and what the compositor actually puts at its
 * centre and its corners — both measured in one pass, inside the page.
 *
 * Measuring from Node and then hit-testing in a second round trip is a race.
 * The bar rises, and the sheet over it rises for 260ms more, so a box captured
 * while either animation is still running describes a position the stage has
 * already left by the time the probes run. Letting every animation on the page
 * settle and then doing both in the same evaluate closes the gap, rather than
 * papering over it with a sleep.
 *
 * Settled across the whole document rather than on one container, because the
 * stage moved: it lives in the bar now, and the sheet it used to live in is not
 * necessarily on the page at all.
 */
export async function stageHitTest(
  page: Page,
): Promise<{ width: number; height: number; covering: string[] }> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))),
  )

  return page.evaluate(() => {
    const selector = '[data-testid="youtube-stage"]'
    const stage = document.querySelector(selector)
    if (!stage) throw new Error('no stage on the page')

    const { x, y, width, height } = stage.getBoundingClientRect()
    const points: [number, number][] = [
      [x + width / 2, y + height / 2],
      [x + 4, y + 4],
      [x + width - 4, y + height - 4],
    ]

    return {
      width,
      height,
      covering: points.map(([px, py]) => {
        const node = document.elementFromPoint(px, py)
        if (node?.closest(selector)) return 'stage'
        return node ? (node.getAttribute('class') ?? node.tagName.toLowerCase()) : 'nothing'
      }),
    }
  })
}

/**
 * Gone with the layout that needed it: `clickBesideSheet`.
 *
 * It clicked a row's leading edge, in the strip a 520px centred sheet left
 * clear, so a test could reach the page while a video went on playing behind the
 * expanded view. That was only possible because the expanded view for a video
 * was a non-modal panel — no scrim, no scroll lock — and it was a panel because
 * the player lived in the bar underneath it, where it had to stay reachable.
 *
 * The player is inside the expanded view now and the mini-player is not rendered
 * beneath it, so the view is modal for both engines and `collapseSheet` is the
 * honest route back to the page. It leaves the video playing, so every caller
 * that needed the old helper's guarantee still has it.
 */

/* ==========================================================================
   Reaching the transport, at whatever width the test is running

   The reference moves two controls as the viewport narrows: below 830px the
   sidebar (and its queue button) disappears behind the hamburger, and below
   560px the player bar collapses to a mini-player showing only play/pause, so
   Next lives in the queue panel. Both routes reach the same unified action, so
   which one a test takes is never the property under test — it is only a
   question of what this viewport actually offers.

   These lived in `library.spec.ts` and now live here, because a second spec
   needed them and two copies of "where is the queue button" is exactly how the
   two copies drift.
   ========================================================================== */

/** Opens the play queue through whichever control this viewport offers. */
export async function openQueue(page: Page): Promise<void> {
  if ((await page.locator('.queue-panel').count()) > 0) return
  const sidebar = page.getByRole('button', { name: 'Open the play queue' })
  if (await sidebar.isVisible()) {
    await sidebar.click()
    return
  }
  // Below 830px the reference hides the sidebar entirely, and the drawer behind
  // the hamburger is the only route to anything.
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('button', { name: 'Play queue' }).click()
}

/** The panel and its backdrop share the label; the panel's own control is the one to press. */
export async function closeQueue(page: Page): Promise<void> {
  await page.locator('.queue-panel').getByRole('button', { name: 'Close queue' }).click()
  await page.locator('.queue-panel').waitFor({ state: 'detached' })
}

/** Advances the queue through whichever control this viewport offers. */
export async function nextTrack(page: Page): Promise<void> {
  const bar = page.getByRole('button', { name: 'Next track' })
  if (await bar.isVisible()) {
    await bar.click()
    return
  }
  // Leave the panel exactly as it was found: some tests keep it open for the
  // playback-mode controls it also carries.
  const wasOpen = (await page.locator('.queue-panel').count()) > 0
  await openQueue(page)
  const list = page.getByTestId('queue-list')
  const rows = list.locator('.song-row')
  const currentIndex = await rows.evaluateAll((nodes) =>
    nodes.findIndex((node) => node.getAttribute('data-current') === 'true'),
  )
  await rows.nth(currentIndex + 1).click()
  if (!wasOpen) await closeQueue(page)
}

/**
 * Whether Next can be pressed at all right now.
 *
 * On a narrow viewport the bar has no Next button, so "is Next available" is a
 * question about the queue rather than about a control: the panel's own rows are
 * the affordance there.
 */
export async function canGoNext(page: Page): Promise<boolean> {
  const bar = page.getByRole('button', { name: 'Next track' })
  if (await bar.isVisible()) return bar.isEnabled()

  const wasOpen = (await page.locator('.queue-panel').count()) > 0
  await openQueue(page)
  const rows = page.getByTestId('queue-list').locator('.song-row')
  const total = await rows.count()
  const currentIndex = await rows.evaluateAll((nodes) =>
    nodes.findIndex((node) => node.getAttribute('data-current') === 'true'),
  )
  if (!wasOpen) await closeQueue(page)
  return currentIndex >= 0 && currentIndex < total - 1
}

/** Shuffle and repeat, wherever this viewport puts them. */
export async function playbackModes(page: Page): Promise<Locator> {
  const inBar = page.locator('.player-controls .player-toggle').first()
  if (await inBar.isVisible()) return page.locator('.player-controls')
  if ((await page.locator('.queue-modes').count()) === 0) await openQueue(page)
  return page.locator('.queue-modes')
}
