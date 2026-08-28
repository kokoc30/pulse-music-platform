import { expect, test } from '@playwright/test'
import { stubAudius } from './fixtures'

test.describe('discovery', () => {
  test('home loads the reference shell and real shelf data', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/')

    await expect(page.locator('.site-header')).toBeVisible()
    await expect(page.locator('.browse-surface')).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Popular artists' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Popular this month' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Popular radio' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Featured Charts' })).toBeVisible()

    const trending = page.locator('.music-section').first()
    await expect(trending.locator('.media-card')).toHaveCount(4)
    await expect(trending.getByText('Neon Corridor')).toBeVisible()
  })

  test('does not autoplay on first load', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()

    await expect(page.getByRole('region', { name: 'About Pulse' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Now playing' })).toHaveCount(0)
    expect(await page.locator('audio').count()).toBeLessThanOrEqual(1)
    const paused = await page.evaluate(() => document.querySelector('audio')?.paused ?? true)
    expect(paused).toBe(true)
  })

  test('a failing provider leaves the shell and search usable', async ({ page }) => {
    await stubAudius(page, { failStatus: 500 })
    await page.goto('/')

    await expect(page.locator('.shelf-error').first()).toBeVisible()
    await expect(page.locator('.shelf-error').first().getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByLabel('Search songs and artists')).toBeEnabled()
    await expect(page.locator('.site-header')).toBeVisible()
  })

  test('creates exactly one audio element for the whole session', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/')

    const card = page.locator('.music-section').first().locator('.card-play').first()
    await card.click({ force: true })
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()

    await page.getByLabel('Search songs and artists').fill('night')
    await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()
    await page.locator('.song-row:not([aria-disabled="true"])').first().click()

    await expect.poll(() => page.locator('audio').count()).toBe(1)
  })
})
