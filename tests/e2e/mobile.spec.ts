import { expect, test } from '@playwright/test'
import { stubAudius } from './fixtures'

/**
 * Runs on both projects, but the assertions that matter are the mobile ones —
 * agents/09_TESTING_QA.md requires E2E coverage of the mobile UI.
 */
test.describe('mobile UI', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 560, 'mobile viewport only')

  test.beforeEach(async ({ page }) => {
    await stubAudius(page)
  })

  test('collapses to the reference mobile shell', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()

    await expect(page.locator('.mobile-menu')).toBeVisible()
    await expect(page.locator('.shell-sidebar')).toBeHidden()
    await expect(page.locator('.home-button')).toBeHidden()
    await expect(page.locator('.utility-links')).toBeHidden()
    await expect(page.getByLabel('Search songs and artists')).toBeVisible()
    await expect(page.locator('.login-button')).toBeVisible()
  })

  test('never scrolls the page horizontally', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('the menu button opens the navigation drawer', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()

    await page.getByRole('button', { name: 'Open menu' }).click()
    const drawer = page.getByRole('navigation', { name: 'Main menu' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('link', { name: /Home/ })).toBeVisible()

    await drawer.getByRole('button', { name: 'Close menu' }).click()
    await expect(drawer).toHaveCount(0)
  })

  test('shows the mini-player and plays from it', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()

    const player = page.getByRole('region', { name: 'Now playing' })
    await expect(player).toBeVisible()
    await expect(player.locator('.player-track b')).toHaveText('Night Signal')

    // The reference collapses the mini-player to artwork + text + play button.
    await expect(player.locator('.progress')).toBeHidden()
    await expect(player.locator('.player-volume')).toBeHidden()
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()

    const box = await player.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(70)

    await player.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  })

  test('the queue is reachable from the drawer on mobile', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()

    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: /Play queue/ }).click()

    const panel = page.getByRole('complementary', { name: 'Play queue', exact: true })
    await expect(panel).toBeVisible()
    await expect(panel.locator('.song-row').first()).toBeVisible()
  })

  test('search results stay legible at 390px', async ({ page }) => {
    await page.goto('/search?q=night')
    await expect(page.locator('.top-result-card')).toBeVisible()

    const rowBox = await page.locator('.song-row').first().boundingBox()
    expect(rowBox?.width ?? 0).toBeLessThanOrEqual(390)
    expect(rowBox?.height ?? 0).toBeGreaterThanOrEqual(50)
  })
})
