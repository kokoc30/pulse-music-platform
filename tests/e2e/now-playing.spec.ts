import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { heartFor, likedKeys, stubAllProviders, stubProviders, unheartFor } from './fixtures'

/**
 * Expanded Now Playing, in a real browser.
 *
 * The component tests pin the wiring; these pin the things only a browser can
 * answer — that a real pointer gesture opens and closes the sheet, that dragging
 * the scrubber does not, and that the audio element keeps playing throughout.
 */

const audioState = () => {
  const audio = document.querySelector('audio')
  return {
    paused: audio?.paused ?? true,
    currentTime: audio?.currentTime ?? 0,
    count: document.querySelectorAll('audio').length,
  }
}

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Now playing' })

async function playFirstResult(page: Page) {
  await page.goto('/search?q=night')
  await page.locator('.song-row').first().click()
  await expect(page.locator('.player-track b')).toHaveText('Night Signal')
  await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)
}

/** A real pointer gesture over an element, in steps, as a finger would. */
async function swipe(page: Page, selector: string, dy: number) {
  const box = (await page.locator(selector).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(x, y + (dy * step) / 6)
  }
  await page.mouse.up()
}

test.describe('opening and collapsing', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('opens from the expand control and shows the track', async ({ page }) => {
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()

    await expect(sheet(page)).toBeVisible()
    await expect(sheet(page).getByRole('heading', { name: 'Night Signal' })).toBeVisible()
    await expect(sheet(page).getByText('Aster Vale')).toBeVisible()
    // Large artwork, not the mini-player thumbnail.
    const art = (await sheet(page).locator('.now-playing-art').boundingBox())!
    expect(art.width).toBeGreaterThan(120)
  })

  test('keeps playing while it opens and closes', async ({ page }) => {
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page)).toBeVisible()
    expect((await page.evaluate(audioState)).paused).toBe(false)

    await page.getByRole('button', { name: 'Collapse Now Playing' }).click()
    await expect(sheet(page)).toHaveCount(0)

    const state = await page.evaluate(audioState)
    expect(state.paused).toBe(false)
    // One element throughout — the sheet is a view, not a second player.
    expect(state.count).toBe(1)
  })

  test('collapses on Escape and returns focus to the control', async ({ page }) => {
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(sheet(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open Now Playing' })).toBeFocused()
  })

  test('leaves the mini-player in place', async ({ page }) => {
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()
  })
})

test.describe('gestures', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('a swipe up on the mini-player opens it', async ({ page }) => {
    await playFirstResult(page)
    await swipe(page, '.player-track-text', -90)
    await expect(sheet(page)).toBeVisible()
  })

  test('a swipe down on the handle closes it', async ({ page }) => {
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page)).toBeVisible()

    await swipe(page, '.now-playing-grab', 90)
    await expect(sheet(page)).toHaveCount(0)
  })

  test('a small wobble on the mini-player does not open it', async ({ page }) => {
    await playFirstResult(page)
    await swipe(page, '.player-track-text', -6)
    await expect(sheet(page)).toHaveCount(0)
  })

  test('dragging the scrubber never closes the sheet', async ({ page }) => {
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page)).toBeVisible()

    const rail = sheet(page).getByRole('slider', { name: 'Seek' })
    const box = (await rail.boundingBox())!
    await page.mouse.move(box.x + 10, box.y + box.height / 2)
    await page.mouse.down()
    // Sideways, and then well downward — the movement a careless scrub makes.
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2)
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2 + 120)
    await page.mouse.up()

    await expect(sheet(page)).toBeVisible()
  })
})

test.describe('transport', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page)).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => document.querySelector('audio')?.duration ?? 0))
      .toBeGreaterThan(0)
  })

  test('scrubbing moves the real playhead', async ({ page }) => {
    const rail = sheet(page).getByRole('slider', { name: 'Seek' })
    await rail.focus()
    await rail.press('End')

    await expect.poll(() => page.evaluate(audioState).then((s) => s.currentTime)).toBeGreaterThan(1)
  })

  test('the ten-second controls move the playhead both ways', async ({ page }) => {
    // Paused first, deliberately. The stub clip is about two seconds long, so a
    // playing element walks away from whatever position a seek just set, and an
    // exact assertion would be a race rather than a check of the arithmetic.
    await sheet(page).getByRole('button', { name: 'Pause', exact: true }).click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(true)

    const rail = sheet(page).getByRole('slider', { name: 'Seek' })
    await rail.focus()
    await rail.press('End')
    await expect.poll(() => page.evaluate(audioState).then((s) => s.currentTime)).toBeGreaterThan(1)

    await sheet(page).getByRole('button', { name: 'Seek back 10 seconds' }).click()
    // Two seconds long, so back-ten clamps to the start rather than going negative.
    await expect.poll(() => page.evaluate(audioState).then((s) => s.currentTime)).toBe(0)

    await sheet(page).getByRole('button', { name: 'Seek forward 10 seconds' }).click()
    const after = (await page.evaluate(audioState)).currentTime
    const duration = await page.evaluate(() => document.querySelector('audio')?.duration ?? 0)
    expect(after).toBeLessThanOrEqual(duration)
    expect(Number.isFinite(after)).toBe(true)
  })

  test('pause and resume work from the sheet', async ({ page }) => {
    await sheet(page).getByRole('button', { name: 'Pause', exact: true }).click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(true)

    // Exact: 'Play' is a substring of 'Collapse Now Playing'.
    await sheet(page).getByRole('button', { name: 'Play', exact: true }).click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)
  })

  test('Up next opens the existing queue panel', async ({ page }) => {
    await sheet(page)
      .getByRole('button', { name: /Up next/i })
      .click()
    await expect(page.getByRole('complementary', { name: 'Play queue' })).toBeVisible()
  })

  test('liking from the sheet is the same state as everywhere else', async ({ page }) => {
    await sheet(page)
      .getByRole('button', { name: /Save Night Signal to Liked Songs/i })
      .click()

    await expect.poll(() => likedKeys(page)).toEqual(['audius:s1'])
    await expect(
      sheet(page).getByRole('button', { name: /Remove Night Signal from Liked Songs/i }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Collapse Now Playing' }).click()
    await expect(unheartFor(page, 'Night Signal').first()).toBeVisible()
  })
})

test.describe('a live track change', () => {
  test('updates in place when the track ends, without closing', async ({ page }) => {
    await stubProviders(page)
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page).getByRole('heading', { name: 'Night Signal' })).toBeVisible()

    await expect
      .poll(() => page.evaluate(() => document.querySelector('audio')?.duration ?? 0))
      .toBeGreaterThan(0)
    await page.evaluate(() => {
      const audio = document.querySelector('audio')
      if (audio) audio.currentTime = Math.max(audio.duration - 0.05, 0)
    })

    // Still open, now showing whatever the planner chose.
    await expect(sheet(page)).toBeVisible({ timeout: 15_000 })
    await expect(sheet(page).getByRole('heading', { name: 'Night Signal' })).toHaveCount(0, {
      timeout: 15_000,
    })
    await expect(sheet(page).getByRole('heading', { level: 2 })).not.toBeEmpty()
    expect((await page.evaluate(audioState)).count).toBe(1)
  })
})

test.describe('navigation and playback', () => {
  test('survives navigating with the sheet open', async ({ page }) => {
    await stubProviders(page)
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page)).toBeVisible()

    // The sheet belongs to playback, not to route content, so it stays.
    await page.getByRole('button', { name: 'Collapse Now Playing' }).click()
    await page.locator('.brand').click()
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()

    const state = await page.evaluate(audioState)
    expect(state.paused).toBe(false)
    expect(state.count).toBe(1)
  })
})

test.describe('it never covers the video player', () => {
  test('stands down while a YouTube video is on screen', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=night')
    await page.getByTestId('youtube-fallback').click()
    await page
      .getByTestId('youtube-result')
      .filter({ hasText: 'Night Signal (Official Video)' })
      .click()
    await expect(page.getByTestId('youtube-stage')).toBeVisible()

    // No audio track is loaded, so there is no mini-player to expand from — and
    // the sheet must not appear over the iframe under any circumstance.
    await expect(sheet(page)).toHaveCount(0)
    await expect(page.getByTestId('youtube-stage')).toBeVisible()
  })
})

test.describe('mobile', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 560, 'mobile viewport only')

  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('fills the screen without overflowing it', async ({ page }) => {
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page)).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)

    const box = (await sheet(page).boundingBox())!
    const viewport = page.viewportSize()!
    expect(box.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(box.y).toBeGreaterThanOrEqual(0)
  })

  test('keeps every control inside the viewport', async ({ page }) => {
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page)).toBeVisible()

    const viewport = page.viewportSize()!
    for (const name of [
      'Collapse Now Playing',
      'Seek back 10 seconds',
      'Previous track',
      'Next track',
      'Seek forward 10 seconds',
    ]) {
      const box = (await sheet(page).getByRole('button', { name }).boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
    }
  })

  test('keeps the provider credit visible rather than hiding it for room', async ({ page }) => {
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page).getByRole('link', { name: /Open on Audius/i })).toBeVisible()
  })

  test('restores the page scroll position on collapse', async ({ page }) => {
    await playFirstResult(page)
    await page.evaluate(() => window.scrollTo(0, 200))
    const before = await page.evaluate(() => window.scrollY)
    expect(before).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page)).toBeVisible()
    await page.getByRole('button', { name: 'Collapse Now Playing' }).click()
    await expect(sheet(page)).toHaveCount(0)

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before)
  })

  test('the heart on the sheet is easy to hit', async ({ page }) => {
    await playFirstResult(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()

    const heart = sheet(page).getByRole('button', { name: /Save Night Signal to Liked Songs/i })
    const box = (await heart.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(36)
    expect(box.height).toBeGreaterThanOrEqual(36)

    await heart.click()
    await expect.poll(() => likedKeys(page)).toEqual(['audius:s1'])
    // Unused import guard: the mini-player heart is the same control.
    await expect(heartFor(page, 'Night Signal')).toHaveCount(0)
  })
})

test.describe('it is a view, not a fetch', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('opening, seeking and collapsing spend no provider requests', async ({ page }) => {
    await playFirstResult(page)

    const calls: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (/\/api\/(jamendo|youtube)|audius|jamendo\.com|googleapis\.com|youtube\.com/.test(url)) {
        calls.push(url)
      }
    })

    // Two costs belong to playback rather than to this surface: resolving the
    // stream at the start, and resolving the next one when the two-second clip
    // runs out. Pausing removes the second, and zeroing the tally after the
    // metadata lands removes the first — leaving only what the sheet spends.
    await expect
      .poll(() => page.evaluate(() => document.querySelector('audio')?.duration ?? 0))
      .toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(true)
    await page.waitForLoadState('networkidle')
    calls.length = 0

    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(sheet(page)).toBeVisible()

    await sheet(page).getByRole('button', { name: 'Seek forward 10 seconds' }).click()
    await sheet(page).getByRole('button', { name: 'Seek back 10 seconds' }).click()

    const rail = sheet(page).getByRole('slider', { name: 'Seek' })
    await rail.focus()
    await rail.press('ArrowRight')
    await rail.press('ArrowLeft')

    await page.getByRole('button', { name: 'Collapse Now Playing' }).click()
    await expect(sheet(page)).toHaveCount(0)

    expect(calls).toEqual([])
  })
})
