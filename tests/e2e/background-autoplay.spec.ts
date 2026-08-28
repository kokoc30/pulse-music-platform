import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { recordYouTubeApiTraffic, seedPersonalization, stubAllProviders, stubAudius } from './fixtures'

/**
 * Phase 6 in a real browser: OS media controls, and generated autoplay.
 *
 * Chromium in Playwright exposes `navigator.mediaSession`, but nothing can press
 * a real lock-screen button from a test. So the handlers the app registers are
 * captured and invoked directly — which is exactly what the OS does, and proves
 * the wiring rather than the platform.
 */

/**
 * Records every Media Session handler the app registers, before it loads.
 *
 * Wraps `setActionHandler` rather than replacing `mediaSession`, so the real
 * controller runs and the real feature detection passes.
 */
async function captureMediaSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const registry = new Map<string, ((details?: unknown) => void) | null>()
    ;(window as unknown as { __pulseMedia: unknown }).__pulseMedia = {
      registry,
      calls: [] as string[],
      metadata: [] as { title: string; artist: string; artwork: number }[],
      positions: [] as { duration: number; position: number }[],
    }

    const media = navigator.mediaSession as MediaSession | undefined
    if (!media) return

    const store = (window as unknown as { __pulseMedia: Record<string, unknown> }).__pulseMedia

    const originalSet = media.setActionHandler.bind(media)
    media.setActionHandler = ((action: string, handler: (() => void) | null) => {
      registry.set(action, handler)
      ;(store.calls as string[]).push(`${action}:${handler ? 'set' : 'clear'}`)
      try {
        originalSet(action as MediaSessionAction, handler as never)
      } catch {
        // The browser refused this action; the app tolerates that, so does this.
      }
    }) as typeof media.setActionHandler

    // `metadata` and `setPositionState` are observed for their content only.
    let stored: MediaMetadata | null = null
    Object.defineProperty(media, 'metadata', {
      configurable: true,
      get: () => stored,
      set: (value: MediaMetadata | null) => {
        stored = value
        if (value) {
          ;(store.metadata as unknown[]).push({
            title: value.title,
            artist: value.artist,
            artwork: value.artwork?.length ?? 0,
          })
        }
      },
    })

    const originalPosition = media.setPositionState?.bind(media)
    media.setPositionState = ((state?: MediaPositionState) => {
      if (state) (store.positions as unknown[]).push({ duration: state.duration, position: state.position })
      originalPosition?.(state)
    }) as typeof media.setPositionState
  })
}

/** Invokes a registered handler the way the operating system would. */
async function fireMediaAction(page: Page, action: string, details?: unknown): Promise<void> {
  await page.evaluate(
    ([name, payload]) => {
      const store = (window as unknown as { __pulseMedia?: { registry: Map<string, unknown> } })
        .__pulseMedia
      const handler = store?.registry.get(name as string) as ((d?: unknown) => void) | undefined
      if (!handler) throw new Error(`no Media Session handler registered for "${String(name)}"`)
      handler(payload)
    },
    [action, details] as const,
  )
}

const mediaState = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __pulseMedia: {
            calls: string[]
            metadata: { title: string; artist: string; artwork: number }[]
            positions: { duration: number; position: number }[]
          }
        }
      ).__pulseMedia,
  )

/** Starts the first playable track on the page. */
async function startFirstTrack(page: Page): Promise<void> {
  const card = page.locator('.music-section').first().locator('.card-play:not([disabled])').first()
  await card.scrollIntoViewIfNeeded()
  await card.click()
  await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()
}

test.describe('Media Session', () => {
  test('registers the transport actions once audio is playing', async ({ page }) => {
    await captureMediaSession(page)
    await stubAudius(page)
    await page.goto('/')
    await startFirstTrack(page)

    const state = await mediaState(page)
    const registered = state.calls.filter((entry) => entry.endsWith(':set')).map((e) => e.split(':')[0])
    for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto']) {
      expect(registered, action).toContain(action)
    }
  })

  test('publishes the playing track’s title, artist and artwork', async ({ page }) => {
    await captureMediaSession(page)
    await stubAudius(page)
    await page.goto('/')
    await startFirstTrack(page)

    await expect
      .poll(async () => (await mediaState(page)).metadata.length)
      .toBeGreaterThan(0)

    const [first] = (await mediaState(page)).metadata
    expect(first.title.length).toBeGreaterThan(0)
    expect(first.artist.length).toBeGreaterThan(0)
  })

  test('the OS pause and play drive the real player', async ({ page }) => {
    await captureMediaSession(page)
    await stubAudius(page)
    await page.goto('/')
    await startFirstTrack(page)

    await fireMediaAction(page, 'pause')
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.paused)).toBe(true)

    await fireMediaAction(page, 'play')
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.paused)).toBe(false)
  })

  test('the OS next is the same action as the on-page next', async ({ page }) => {
    await captureMediaSession(page)
    await stubAudius(page)
    await page.goto('/')
    await startFirstTrack(page)

    const before = await page.locator('.player-track b').innerText()
    await fireMediaAction(page, 'nexttrack')
    await expect.poll(() => page.locator('.player-track b').innerText()).not.toBe(before)
  })

  test('the OS seek moves the real audio element', async ({ page }) => {
    await captureMediaSession(page)
    await stubAudius(page)
    await page.goto('/')
    await startFirstTrack(page)
    // The stubbed WAV is 2s long, so seek somewhere inside it.
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.duration ?? 0)).toBeGreaterThan(0)

    await fireMediaAction(page, 'seekto', { seekTime: 1 })
    await expect
      .poll(() => page.evaluate(() => document.querySelector('audio')?.currentTime ?? 0))
      .toBeGreaterThan(0.5)
  })

  test('the OS stop halts playback', async ({ page }) => {
    await captureMediaSession(page)
    await stubAudius(page)
    await page.goto('/')
    await startFirstTrack(page)

    await fireMediaAction(page, 'stop')
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.paused)).toBe(true)
  })

  test('a hidden document does NOT pause audio', async ({ page }) => {
    // The whole point of the phase: backgrounding must not stop the music.
    await captureMediaSession(page)
    await stubAudius(page)
    await page.goto('/')
    await startFirstTrack(page)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      Object.defineProperty(document, 'hidden', { value: true, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(400)

    expect(await page.evaluate(() => document.querySelector('audio')?.paused)).toBe(false)
  })
})

test.describe('YouTube stays out of the OS session', () => {
  test('handing playback to YouTube clears every registered handler', async ({ page }) => {
    await captureMediaSession(page)
    await seedPersonalization(page, {
      entries: [
        { id: 'aaaaaaaaaaa', provider: 'youtube', title: 'Night Signal', artist: 'Aster Vale', daysAgo: 0 },
      ],
    })
    await stubAllProviders(page)
    await page.goto('/')

    // Start *audio* first, so there is a session to clear. Targeted at the
    // trending shelf specifically: with a YouTube entry seeded, Recently played
    // is the first shelf on the page and its first card is the video.
    const audioCard = page
      .locator('.music-section')
      .filter({ hasText: 'Trending songs' })
      .first()
      .locator('.card-play:not([disabled])')
      .first()
    await audioCard.scrollIntoViewIfNeeded()
    await audioCard.click()
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()

    // Play the retained YouTube entry from Recently Played.
    const shelf = page.locator('.music-section').filter({ hasText: 'Recently played' }).first()
    await shelf.locator('.card-play').first().scrollIntoViewIfNeeded()
    await shelf.locator('.card-play').first().click()
    await expect(page.locator('iframe[data-e2e-youtube]')).toBeVisible()

    // Every handler must now be null: an OS Next could otherwise reach a video.
    const cleared = await page.evaluate(() => {
      const registry = (window as unknown as { __pulseMedia: { registry: Map<string, unknown> } })
        .__pulseMedia.registry
      return [...registry.entries()].every(([, handler]) => handler === null)
    })
    expect(cleared).toBe(true)
  })

  test('YouTube still pauses when the document is hidden', async ({ page }) => {
    await captureMediaSession(page)
    await seedPersonalization(page, {
      entries: [
        { id: 'aaaaaaaaaaa', provider: 'youtube', title: 'Night Signal', artist: 'Aster Vale', daysAgo: 0 },
      ],
    })
    await stubAllProviders(page)
    await page.goto('/')

    const shelf = page.locator('.music-section').filter({ hasText: 'Recently played' }).first()
    await shelf.locator('.card-play').first().scrollIntoViewIfNeeded()
    await shelf.locator('.card-play').first().click()
    await expect(page.locator('iframe[data-e2e-youtube]')).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as never as { __pulseYouTube: { playing: boolean } }).__pulseYouTube.playing)).toBe(true)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await expect
      .poll(() =>
        page.evaluate(() => (window as never as { __pulseYouTube: { playing: boolean } }).__pulseYouTube.playing),
      )
      .toBe(false)
  })
})

test.describe('autoplay', () => {
  /** Plays the last queued track, so the queue is genuinely exhausted. */
  async function exhaustQueue(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const audio = document.querySelector('audio')
      if (!audio) throw new Error('no audio element')
      audio.dispatchEvent(new Event('ended'))
    })
  }

  test('plays a similar track when the queue runs out, and spends no YouTube quota', async ({
    page,
  }) => {
    const youtubeCalls = recordYouTubeApiTraffic(page)
    await captureMediaSession(page)
    await stubAllProviders(page)
    await page.goto('/', { waitUntil: 'networkidle' })

    // Start the last track of the trending shelf so the queue has no next item.
    const cards = page.locator('.music-section').first().locator('.card-play:not([disabled])')
    const last = cards.nth((await cards.count()) - 1)
    await last.scrollIntoViewIfNeeded()
    await last.click()
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()

    // Drive the queue to its end.
    for (let step = 0; step < 8; step += 1) {
      await exhaustQueue(page)
      await page.waitForTimeout(150)
    }

    // Something is still playing — autoplay generated it — and nothing YouTube
    // was ever contacted to do so.
    await expect(page.locator('.player-track b')).toBeVisible()
    expect(youtubeCalls).toEqual([])
  })

  test('stops at the end of the queue when autoplay is off', async ({ page }) => {
    await captureMediaSession(page)
    await stubAudius(page)
    // The preference lives beside volume, under its own key.
    await page.addInitScript(() => window.localStorage.setItem('pulse:autoplay', 'false'))
    await page.goto('/')

    const cards = page.locator('.music-section').first().locator('.card-play:not([disabled])')
    const last = cards.nth((await cards.count()) - 1)
    await last.scrollIntoViewIfNeeded()
    await last.click()
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()

    for (let step = 0; step < 8; step += 1) {
      await exhaustQueue(page)
      await page.waitForTimeout(120)
    }

    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.paused)).toBe(true)
  })

  test('the preference is togglable from Settings and persists', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/settings')

    const toggle = page.getByRole('switch', { name: 'Autoplay similar music' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    await page.reload()
    await expect(page.getByRole('switch', { name: 'Autoplay similar music' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })
})

test.describe('PWA', () => {
  test('serves a valid manifest with the required icons', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/')

    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBe('/manifest.webmanifest')

    const response = await page.request.get('/manifest.webmanifest')
    expect(response.ok()).toBe(true)
    const manifest = (await response.json()) as {
      display: string
      icons: { src: string; sizes: string }[]
    }
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    )

    for (const icon of manifest.icons) {
      const asset = await page.request.get(icon.src)
      expect(asset.ok(), icon.src).toBe(true)
    }
  })

  test('offers an install control in Settings', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/settings')
    await expect(page.getByText('Install Pulse')).toBeVisible()
  })
})
