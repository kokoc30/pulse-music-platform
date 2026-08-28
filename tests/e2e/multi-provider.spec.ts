import { expect, test } from '@playwright/test'
import { stubProviders } from './fixtures'

/**
 * Phase 2 end to end: one search, two catalogues, one player
 * (agents/18_PHASE2_TESTING_QA.md → "E2E").
 *
 * Everything is deterministic — both providers are stubbed at the network layer
 * and the audio is a locally generated WAV — so nothing here depends on the live
 * Jamendo service or on a real credential.
 */

const audioState = () =>
  ({
    paused: document.querySelector('audio')?.paused ?? true,
    currentTime: document.querySelector('audio')?.currentTime ?? 0,
    src: document.querySelector('audio')?.src ?? '',
    count: document.querySelectorAll('audio').length,
  }) as const

test.describe('unified multi-provider search', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('merges both catalogues into one ranked list with no provider tabs', async ({ page }) => {
    await page.goto('/search?q=night')

    await expect(page.getByRole('heading', { name: /Results for “night”/ })).toBeVisible()
    // 3 Audius rows + 2 Jamendo rows, in a single list.
    await expect(page.locator('.song-row')).toHaveCount(5)
    await expect(page.locator('.song-row').filter({ hasText: 'Night Signal' })).toHaveCount(1)
    await expect(page.locator('.song-row').filter({ hasText: 'Night Reverie' })).toHaveCount(1)

    // One list, one heading — the reference composition is unchanged.
    await expect(page.getByRole('heading', { name: 'Songs' })).toHaveCount(1)
    await expect(page.getByRole('tab')).toHaveCount(0)
  })

  test('credits Jamendo on its rows and leaves Audius rows untouched', async ({ page }) => {
    await page.goto('/search?q=night')

    const jamendoRow = page.locator('.song-row').filter({ hasText: 'Night Reverie' })
    await expect(jamendoRow.locator('.provider-credit')).toHaveText(/Jamendo/)

    const audiusRow = page.locator('.song-row').filter({ hasText: 'Night Signal' })
    await expect(audiusRow.locator('.provider-credit')).toHaveCount(0)
  })

  test('every rendered Jamendo row carries its own direct backlink', async ({ page }) => {
    await page.goto('/search?q=night')
    await expect(page.locator('.song-row')).toHaveCount(5)

    // Two Jamendo rows in the fixture, each linking to its own track page.
    const links = page.locator('.song-row a.provider-credit-link')
    await expect(links).toHaveCount(2)

    const hrefs = await links.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')))
    expect(hrefs).toEqual([
      'https://www.jamendo.com/track/1880336/night-reverie',
      'https://www.jamendo.com/track/1880337/night-cedar',
    ])
    expect(new Set(hrefs).size).toBe(2)

    for (const attr of [
      ['target', '_blank'],
      ['rel', 'noopener noreferrer'],
    ] as const) {
      await expect(links.first()).toHaveAttribute(attr[0], attr[1])
      await expect(links.last()).toHaveAttribute(attr[0], attr[1])
    }

    // The anchor must not be inside the row's play button.
    const nested = await page
      .locator('.song-row button a')
      .count()
    expect(nested).toBe(0)
  })

  test('clicking the Jamendo backlink does not start playback', async ({ page }) => {
    await page.goto('/search?q=night')
    const link = page
      .locator('.song-row')
      .filter({ hasText: 'Night Reverie' })
      .locator('a.provider-credit-link')

    // The link keeps its real target="_blank", so the click opens a popup and
    // never navigates this page. Stub the destination so no live request is made.
    await page.context().route('https://www.jamendo.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>jamendo stub</title>' }),
    )

    const popup = page.waitForEvent('popup')
    await link.click()
    await (await popup).close()

    // The row's play action must not have fired underneath the link.
    expect((await page.evaluate(audioState)).src).toBe('')
    await expect(page.getByRole('region', { name: 'Now playing' })).toHaveCount(0)
  })

  test('the row is keyboard operable without the anchor swallowing it', async ({ page }) => {
    await page.goto('/search?q=night')
    const row = page.locator('.song-row').filter({ hasText: 'Night Reverie' })

    // The play affordance is a real, focusable button inside the row.
    await row.getByRole('button', { name: /Play Night Reverie/i }).focus()
    await page.keyboard.press('Enter')

    await expect(page.locator('.player-track b')).toHaveText('Night Reverie')
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)
  })

  test('exposes a safe backlink to the Jamendo page for the playing track', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').filter({ hasText: 'Night Reverie' }).click()

    const player = page.getByRole('region', { name: 'Now playing' })
    const link = player.getByRole('link', { name: /View “Night Reverie” on Jamendo/i })
    await expect(link).toHaveAttribute('href', /^https:\/\/www\.jamendo\.com\/track\/1880336\//)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('never requests Jamendo metadata directly from the browser', async ({ page }) => {
    const direct: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('api.jamendo.com')) direct.push(request.url())
    })

    await page.goto('/search?q=night')
    await expect(page.locator('.song-row')).toHaveCount(5)
    await page.locator('.song-row').filter({ hasText: 'Night Reverie' }).click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)

    // Metadata goes through the same-origin function; only the returned audio
    // and artwork URLs are fetched from Jamendo hosts, and neither carries a
    // credential (agents/16_JAMENDO_SERVERLESS_SECURITY.md).
    expect(direct).toEqual([])
  })
})

test.describe('mixed-provider playback through one engine', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('plays a Jamendo track straight from Jamendo storage', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').filter({ hasText: 'Night Reverie' }).click()

    const player = page.getByRole('region', { name: 'Now playing' })
    await expect(player.getByText('Night Reverie')).toBeVisible()
    await expect(player.getByText('Lumen Field')).toBeVisible()

    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)
    await expect.poll(() => page.evaluate(audioState).then((s) => s.currentTime)).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(audioState).then((s) => s.src)).toContain('storage.jamendo.test')
  })

  test('switches Audius -> Jamendo -> Audius on the one audio element', async ({ page }) => {
    await page.goto('/search?q=night')

    await page.locator('.song-row').filter({ hasText: 'Night Signal' }).click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.src)).toContain('audio.e2e.test')

    await page.locator('.song-row').filter({ hasText: 'Night Reverie' }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Reverie')
    await expect.poll(() => page.evaluate(audioState).then((s) => s.src)).toContain('storage.jamendo.test')

    await page.locator('.song-row').filter({ hasText: 'Night Drive' }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Drive')
    await expect.poll(() => page.evaluate(audioState).then((s) => s.src)).toContain('audio.e2e.test')

    // Still exactly one <audio> for the whole application.
    expect((await page.evaluate(audioState)).count).toBe(1)
  })

  test('switches Jamendo -> Jamendo without a second player', async ({ page }) => {
    await page.goto('/search?q=night')

    await page.locator('.song-row').filter({ hasText: 'Night Reverie' }).click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.src)).toContain('trackid=1880336')

    await page.locator('.song-row').filter({ hasText: 'Night Cedar' }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Cedar')
    await expect.poll(() => page.evaluate(audioState).then((s) => s.src)).toContain('trackid=1880337')
    expect((await page.evaluate(audioState)).count).toBe(1)
  })

  test('a Jamendo track keeps playing across navigation', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').filter({ hasText: 'Night Reverie' }).click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)

    await page.getByRole('link', { name: 'Pulse home' }).first().click()
    await expect(page).toHaveURL(/\/$/)

    await expect(page.locator('.player-track b')).toHaveText('Night Reverie')
    expect((await page.evaluate(audioState)).paused).toBe(false)
    expect((await page.evaluate(audioState)).count).toBe(1)
  })

  test('pause and play work on a Jamendo track', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) <= 560, 'reference hides these controls on mobile')
    await page.goto('/search?q=night')
    await page.locator('.song-row').filter({ hasText: 'Night Reverie' }).click()

    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(true)

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)
  })
})

test.describe('provider outages degrade instead of breaking', () => {
  test('an unconfigured Jamendo leaves an Audius-only app that looks normal', async ({ page }) => {
    await stubProviders(page, { jamendo: { unavailable: true } })
    await page.goto('/search?q=night')

    await expect(page.locator('.song-row')).toHaveCount(3)
    await expect(page.locator('.song-row').filter({ hasText: 'Night Signal' })).toHaveCount(1)
    await expect(page.getByText(/Search is unavailable/)).toHaveCount(0)
    await expect(page.getByText(/JAMENDO_CLIENT_ID/)).toHaveCount(0)
  })

  test('a broken Jamendo leaves an Audius-only app that looks normal', async ({ page }) => {
    await stubProviders(page, { jamendo: { failing: true } })
    await page.goto('/search?q=night')

    await expect(page.locator('.song-row')).toHaveCount(3)
    await expect(page.getByText(/Search is unavailable/)).toHaveCount(0)
  })

  test('a broken Audius leaves a working Jamendo-only app', async ({ page }) => {
    await stubProviders(page, { audius: { failStatus: 500 } })
    await page.goto('/search?q=night')

    await expect(page.locator('.song-row')).toHaveCount(2)
    await expect(page.locator('.song-row').filter({ hasText: 'Night Reverie' })).toBeVisible()
    await expect(page.getByText(/Search is unavailable/)).toHaveCount(0)

    // And it still plays.
    await page.locator('.song-row').filter({ hasText: 'Night Reverie' }).click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)
  })

  test('both catalogues down shows the existing error state', async ({ page }) => {
    await stubProviders(page, { audius: { failStatus: 500 }, jamendo: { failing: true } })
    await page.goto('/search?q=night')

    await expect(page.getByText('Search is unavailable')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  test('a Jamendo row with no stream is shown as unavailable, not hidden', async ({ page }) => {
    await stubProviders(page, {
      jamendo: {
        tracks: [{ id: '9', title: 'Night Ghost', artist: 'Ghost Radio', duration: 8, streamable: false }],
      },
    })
    await page.goto('/search?q=night')

    const row = page.locator('.song-row').filter({ hasText: 'Night Ghost' })
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('aria-disabled', 'true')
    await expect(row.getByRole('button')).toBeDisabled()
  })
})

test.describe('mobile', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 560, 'mobile-only expectations')

  test('shows merged results and Jamendo attribution on a phone', async ({ page }) => {
    await stubProviders(page)
    await page.goto('/search?q=night')

    await expect(page.locator('.song-row')).toHaveCount(5)
    const jamendoRow = page.locator('.song-row').filter({ hasText: 'Night Reverie' })
    await expect(jamendoRow.locator('.provider-credit')).toHaveText(/Jamendo/)

    await jamendoRow.click()
    await expect(page.locator('.player-track b')).toHaveText('Night Reverie')
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)
  })
})
