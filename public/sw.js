/**
 * Pulse service worker — app shell only.
 *
 * Its entire job is to make the installed app open quickly and survive a flaky
 * connection. It is emphatically **not** an offline music feature, and the
 * exclusions below are the substance of the file rather than an afterthought:
 *
 * · **No provider audio.** Audius stream URLs are signed and node-specific;
 *   caching one would store a credential-bearing URL and would keep serving a
 *   dead node after failover. Jamendo audio is licensed for streaming, not for
 *   offline copies. Neither is ever cached (agents/31 → "Service worker").
 *
 * · **No YouTube anything.** Caching YouTube audiovisual content is prohibited
 *   outright by the YouTube API Services Developer Policies §III.E.1, and
 *   `/api/youtube` responses are Non-Authorized Data under §III.E.4.d with a
 *   30-day ceiling this worker has no way to honour. Both are refused.
 *
 * · **No `/api/*` at all.** Those responses are `no-store` by design and carry
 *   provider data the app re-validates on arrival.
 *
 * A service worker also cannot own the `<audio>` element: it has no DOM, and it
 * is not a background audio daemon. Playback in the background comes from the
 * browser keeping the page alive, not from this file.
 */

const VERSION = 'pulse-shell-v1'
const SHELL_CACHE = `${VERSION}`

/** Only the entry document is pre-cached; hashed assets are cached on first use. */
const PRECACHE = ['/', '/manifest.webmanifest', '/pulse-mark.svg']

/**
 * Requests this worker will never read from or write to a cache.
 *
 * Checked before anything else, so a future change to the caching strategy
 * cannot accidentally widen what is stored.
 */
function isExcluded(url) {
  // Every same-origin API route, present and future.
  if (url.pathname.startsWith('/api/')) return true

  // YouTube, in any form: the Data API proxy, the player, the CDN, the media.
  if (/(^|\.)youtube\.com$/.test(url.hostname)) return true
  if (/(^|\.)ytimg\.com$/.test(url.hostname)) return true
  if (/(^|\.)googlevideo\.com$/.test(url.hostname)) return true
  if (/(^|\.)youtube-nocookie\.com$/.test(url.hostname)) return true

  // Jamendo audio and its storage hosts.
  if (/(^|\.)jamendo\.com$/.test(url.hostname)) return true

  // Audius: the API, and every community content node that serves audio or
  // signed URLs. Content-node hostnames are not a fixed list, so the media file
  // extension is the reliable signal.
  if (/(^|\.)audius\.co$/.test(url.hostname)) return true
  if (/\/v1\/tracks\/.+\/stream/.test(url.pathname)) return true

  // Any audio or video payload, whatever the host.
  if (/\.(mp3|mp4|m4a|aac|ogg|opus|wav|flac|webm|m3u8|ts)$/i.test(url.pathname)) return true

  return false
}

/** Static build output plus the icons: safe, immutable, same-origin. */
function isShellAsset(url) {
  if (url.pathname.startsWith('/assets/')) return true
  return /\.(css|js|woff2?|png|svg|ico|webmanifest)$/i.test(url.pathname)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // A precache miss must not prevent activation; the runtime cache recovers.
      .catch(() => undefined),
  )
  // Deliberately no `skipWaiting()` here. A new worker must not take over while
  // audio is playing — the page decides when to apply an update (see
  // `src/pwa/register-sw.ts`).
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

/** The page asks for the update when it is safe — never while a track plays. */
self.addEventListener('message', (event) => {
  if (event.data === 'pulse:skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // Excluded traffic is left entirely to the network: not intercepted, not
  // read from cache, not written to one.
  if (isExcluded(url)) return

  // Navigations: network first so a deploy is picked up, cache as the offline
  // fallback so an installed app still opens on a train.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy)).catch(() => undefined)
          return response
        })
        .catch(() => caches.match('/').then((cached) => cached ?? Response.error())),
    )
    return
  }

  if (url.origin !== self.location.origin || !isShellAsset(url)) return

  // Hashed build assets are immutable, so cache-first is both correct and fast.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined)
        }
        return response
      })
    }),
  )
})
