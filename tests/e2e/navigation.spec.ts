import { expect, test } from '@playwright/test'
import { stubAudius } from './fixtures'

test.describe('navigation and persistence', () => {
  test.beforeEach(async ({ page }) => {
    await stubAudius(page)
  })

  test('playback survives SPA navigation', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    await page.locator('.brand').click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()

    await expect(page.locator('.player-track b')).toHaveText('Night Signal')
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.paused)).toBe(false)
    await expect.poll(() => page.locator('audio').count()).toBe(1)
  })

  test('playback survives changing the search query', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    const input = page.getByLabel('Search songs and artists')
    await input.fill('drive')
    await expect(page.getByRole('heading', { name: /Results for “drive”/ })).toBeVisible()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')
  })

  test('a deep-linked /search URL loads directly on refresh', async ({ page }) => {
    await page.goto('/search?q=night')
    await expect(page.getByRole('heading', { name: /Results for “night”/ })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: /Results for “night”/ })).toBeVisible()
    await expect(page.locator('.song-row').first()).toBeVisible()
  })

  test('an unknown route renders the not-found page inside the shell', async ({ page }) => {
    await page.goto('/no-such-page')
    await expect(page.getByText('Page not found')).toBeVisible()
    await expect(page.locator('.site-header')).toBeVisible()

    await page.getByRole('link', { name: 'Back to home' }).click()
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()
  })

  test('the header search shortcut focuses the field', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()

    await page.keyboard.press('Control+k')
    await expect(page.getByLabel('Search songs and artists')).toBeFocused()
  })

  test('an artist card searches for that artist', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Search for Aster Vale' }).click()
    await expect(page).toHaveURL(/\/search\?q=Aster%20Vale/)
  })

  test('volume preference survives a reload without autoplaying', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) <= 560, 'reference hides the volume cluster on mobile')
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()

    const volume = page.getByRole('slider', { name: 'Volume' })
    await volume.focus()
    await volume.press('Home')
    await expect(volume).toHaveAttribute('aria-valuetext', '0%')

    await page.reload()
    await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()
    // Restored preference, and nothing started playing by itself.
    expect(await page.evaluate(() => localStorage.getItem('pulse:volume'))).toBe('0')
    await expect(page.getByRole('region', { name: 'Now playing' })).toHaveCount(0)
  })
})

test.describe('accessibility basics', () => {
  test.beforeEach(async ({ page }) => {
    await stubAudius(page)
  })

  test('every player control is a button with an accessible name', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) <= 560, 'reference collapses the player on mobile')
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()

    for (const name of ['Previous track', 'Pause', 'Next track', 'Mute', 'Play queue']) {
      // Exact matching: the card play FAB's label also starts with 'Play'/'Pause'.
      const control = page.getByRole('button', { name, exact: true })
      await expect(control).toBeVisible()
      expect(await control.evaluate((node) => node.tagName)).toBe('BUTTON')
    }
  })

  test('sliders expose an accessible value', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) <= 560, 'reference hides both sliders on mobile')
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()

    await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', /of/)
    await expect(page.getByRole('slider', { name: 'Volume' })).toHaveAttribute(
      'aria-valuetext',
      /%$/,
    )
  })

  test('the search field can be reached and used by keyboard alone', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()

    await page.keyboard.press('Control+k')
    await page.keyboard.type('night')
    await expect(page.getByRole('heading', { name: /Results for “night”/ })).toBeVisible()
  })

  test('focus-visible styling is defined for interactive elements', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Control+k')
    const outline = await page
      .getByLabel('Search songs and artists')
      .evaluate((node) => getComputedStyle(node).outlineColor)
    expect(outline).toBeTruthy()
  })
})
