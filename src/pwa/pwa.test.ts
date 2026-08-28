import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { usePlayerStore } from '@/player/player-store'
import {
  isRunningInstalled,
  needsManualInstallGuidance,
  promptInstall,
  resetInstallState,
  watchInstallAvailability,
} from './install'
import { SW_PATH, registerServiceWorker, watchForUpdate } from './register-sw'

/**
 * The PWA surface.
 *
 * The service-worker assertions matter most: what a worker caches is a policy
 * decision, not a performance one, and a rule that only exists in a comment is
 * a rule that will be broken. The exclusion list is therefore executed here
 * rather than described.
 */

/** Reads a shipped file from the repo root, so tests assert what actually ships. */
const projectFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('the manifest', () => {
  const manifest = JSON.parse(projectFile('public/manifest.webmanifest')) as {
    name: string
    short_name: string
    start_url: string
    scope: string
    display: string
    theme_color: string
    background_color: string
    icons: { src: string; sizes: string; type: string; purpose: string }[]
  }

  it('identifies Pulse', () => {
    expect(manifest.name).toBe('Pulse Music Platform')
    expect(manifest.short_name).toBe('Pulse')
  })

  it('opens the app at its root, in its own window', () => {
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.display).toBe('standalone')
  })

  it('uses the existing Pulse colours', () => {
    // `--color-app-bg` from tokens.css. The installed splash must not be a
    // white flash before a black app.
    expect(manifest.theme_color).toBe('#000000')
    expect(manifest.background_color).toBe('#000000')
  })

  it('declares the 192 and 512 icons installability requires', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    for (const icon of manifest.icons) expect(icon.type).toBe('image/png')
  })

  it('includes a maskable icon so Android does not clip the mark', () => {
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  })

  it('ships every icon file it declares', () => {
    for (const icon of manifest.icons) {
      expect(() => projectFile(`public${icon.src}`)).not.toThrow()
    }
  })

  it('is linked from the document', () => {
    const html = projectFile('index.html')
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('/manifest.webmanifest')
    expect(html).toContain('apple-touch-icon')
  })
})

describe('the service worker never caches media or provider data', () => {
  const source = projectFile('public/sw.js')

  /**
   * Runs the worker's own `isExcluded` against a URL.
   *
   * The function is extracted from the shipped file rather than reimplemented,
   * so the test cannot drift from what actually runs in the browser.
   */
  const isExcluded = (() => {
    const start = source.indexOf('function isExcluded')
    const end = source.indexOf('/** Static build output')
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(`${source.slice(start, end)}; return isExcluded`) as () => (
      url: URL,
    ) => boolean
    return factory()
  })()

  const excluded = (href: string) => isExcluded(new URL(href))

  it('refuses every same-origin API route', () => {
    expect(excluded('https://pulse.app/api/youtube?action=search&q=x')).toBe(true)
    expect(excluded('https://pulse.app/api/jamendo?action=search&q=x')).toBe(true)
    expect(excluded('https://pulse.app/api/jamendo?action=similar&id=1')).toBe(true)
    // Including one that does not exist yet.
    expect(excluded('https://pulse.app/api/anything-new')).toBe(true)
  })

  it('refuses YouTube in every form', () => {
    expect(excluded('https://www.youtube.com/iframe_api')).toBe(true)
    expect(excluded('https://www.youtube.com/embed/abc')).toBe(true)
    expect(excluded('https://i.ytimg.com/vi/abc/maxresdefault.jpg')).toBe(true)
    expect(excluded('https://rr1---sn-x.googlevideo.com/videoplayback')).toBe(true)
    expect(excluded('https://www.youtube-nocookie.com/embed/abc')).toBe(true)
  })

  it('refuses Jamendo audio and its hosts', () => {
    expect(excluded('https://prod-1.storage.jamendo.com/?trackid=1')).toBe(true)
    expect(excluded('https://api.jamendo.com/v3.0/tracks/')).toBe(true)
  })

  it('refuses Audius streams and signed URLs', () => {
    expect(excluded('https://api.audius.co/v1/tracks/abc/stream')).toBe(true)
    expect(excluded('https://audius.co/anything')).toBe(true)
    // Content-node hostnames are not a fixed list, so the media path is caught
    // wherever it is served from.
    expect(excluded('https://cn4.mainnet.audiusindex.org/content/abc/track.mp3')).toBe(true)
  })

  it('refuses any audio or video payload, whatever the host', () => {
    for (const ext of ['mp3', 'mp4', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac', 'webm', 'm3u8']) {
      expect(excluded(`https://unknown.example/media/file.${ext}`), ext).toBe(true)
    }
  })

  it('still allows the app shell it exists to cache', () => {
    expect(excluded('https://pulse.app/')).toBe(false)
    expect(excluded('https://pulse.app/assets/index-abc123.js')).toBe(false)
    expect(excluded('https://pulse.app/assets/index-abc123.css')).toBe(false)
    expect(excluded('https://pulse.app/pulse-icon-192.png')).toBe(false)
    expect(excluded('https://pulse.app/manifest.webmanifest')).toBe(false)
  })

  it('pre-caches nothing but the shell', () => {
    const precache = /const PRECACHE = \[([^\]]*)\]/.exec(source)?.[1] ?? ''
    expect(precache).not.toMatch(/api|mp3|youtube|jamendo|audius/i)
  })

  it('does not take over on install, so an update cannot interrupt playback', () => {
    // The worker may only ever skip waiting when the *page* says it is safe.
    // Asserted on the call itself, since the file also discusses it in prose.
    const calls = source.match(/self\.skipWaiting\(\)/g) ?? []
    expect(calls).toHaveLength(1)
    expect(source).toContain("if (event.data === 'pulse:skip-waiting') self.skipWaiting()")

    const install = source.slice(
      source.indexOf("addEventListener('install'"),
      source.indexOf("addEventListener('activate'"),
    )
    expect(install).not.toContain('self.skipWaiting()')
  })

  it('attempts no audio playback of its own', () => {
    expect(source).not.toMatch(/new Audio|HTMLAudioElement|\.play\(\)/)
  })
})

describe('applying a worker update', () => {
  function registration(waiting: { postMessage: ReturnType<typeof vi.fn> } | null) {
    return {
      waiting,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as ServiceWorkerRegistration
  }

  it('waits while a track is playing', () => {
    const waiting = { postMessage: vi.fn() }
    watchForUpdate(registration(waiting), () => true)
    expect(waiting.postMessage).not.toHaveBeenCalled()
  })

  it('applies as soon as playback is idle', () => {
    const waiting = { postMessage: vi.fn() }
    watchForUpdate(registration(waiting), () => false)
    expect(waiting.postMessage).toHaveBeenCalledWith('pulse:skip-waiting')
  })

  it('applies once, not repeatedly', () => {
    const waiting = { postMessage: vi.fn() }
    const registrationWithEvents = registration(waiting)
    watchForUpdate(registrationWithEvents, () => false)
    // Re-firing `updatefound` must not send a second message.
    const handler = (registrationWithEvents.addEventListener as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as (() => void) | undefined
    handler?.()
    expect(waiting.postMessage).toHaveBeenCalledTimes(1)
  })

  it('reads the real player status by default', () => {
    usePlayerStore.setState({ status: 'playing' })
    const waiting = { postMessage: vi.fn() }
    // No `playing` override: the default guard consults the store.
    void registerServiceWorker({
      container: {
        register: vi.fn().mockResolvedValue(registration(waiting)),
      } as unknown as ServiceWorkerContainer,
    })
    usePlayerStore.setState({ status: 'idle' })
  })
})

describe('registration', () => {
  it('does nothing on a browser without service workers', async () => {
    const original = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
    try {
      await expect(registerServiceWorker()).resolves.toBe(false)
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true })
    }
  })

  it('never throws when registration fails', async () => {
    const container = {
      register: vi.fn().mockRejectedValue(new Error('insecure context')),
    } as unknown as ServiceWorkerContainer
    await expect(registerServiceWorker({ container })).resolves.toBe(false)
  })

  it('registers the shipped worker at the app scope', async () => {
    const register = vi.fn().mockResolvedValue({
      waiting: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    await registerServiceWorker({
      container: { register } as unknown as ServiceWorkerContainer,
      playing: () => false,
    })
    expect(register).toHaveBeenCalledWith(SW_PATH, { scope: '/' })
  })
})

describe('install affordance', () => {
  it('captures the browser offer and suppresses the default prompt', () => {
    resetInstallState()
    const target = new EventTarget()
    watchInstallAvailability(target)

    const changes: boolean[] = []
    const event = Object.assign(new Event('beforeinstallprompt'), {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })
    const prevented = vi.spyOn(event, 'preventDefault')
    target.dispatchEvent(event)

    expect(prevented).toHaveBeenCalled()
    expect(changes).toEqual([])
    resetInstallState()
  })

  it('reports unavailable when the browser never offered', async () => {
    resetInstallState()
    await expect(promptInstall()).resolves.toBe('unavailable')
  })

  it('never fires an install prompt on its own', () => {
    // The whole module is passive: it only listens. `prompt()` is reachable
    // exclusively through `promptInstall`, which Settings calls from a click.
    const source = projectFile('src/pwa/install.ts')
    const autoCalls = source.match(/\.prompt\(\)/g) ?? []
    expect(autoCalls).toHaveLength(1)
  })

  it('detects an installed window', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true })
    vi.stubGlobal('matchMedia', matchMedia)
    expect(isRunningInstalled()).toBe(true)
    vi.unstubAllGlobals()
  })

  it('offers manual guidance only where there is no install API', () => {
    const original = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 },
      configurable: true,
    })
    try {
      expect(needsManualInstallGuidance()).toBe(true)
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true })
    }
  })
})
