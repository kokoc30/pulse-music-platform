import { expect, test } from '@playwright/test'
import { heartFor, likedKeys, menuFor, playlistOrder, stubAudius, stubProviders } from './fixtures'

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

/**
 * Phase 7 on a phone.
 *
 * agents/46 → "F — Mobile/PWA" asks for four things specifically: the heart is
 * easy to tap, playlist menus fit the viewport, library navigation is usable,
 * and nothing overflows. Each is asserted here rather than left to the desktop
 * suite, because every one of them is a decision the mobile rules change.
 */
test.describe('mobile library', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 560, 'mobile viewport only')

  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  const noOverflow = async (page: import('@playwright/test').Page) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  }

  test('the heart is visible and large enough to tap on a search row', async ({ page }) => {
    await page.goto('/search?q=night')
    const heart = heartFor(page, 'Night Signal')
    await expect(heart).toBeVisible()

    // The reference hides every `svg` inside a row at this width, because they
    // were decorative. These are controls, so the icon has to survive.
    await expect(heart.locator('svg')).toBeVisible()

    const box = (await heart.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(28)
    expect(box.height).toBeGreaterThanOrEqual(28)

    await heart.click()
    await expect.poll(() => likedKeys(page)).toEqual(['audius:s1'])
  })

  test('the playlist menu fits inside the viewport', async ({ page }) => {
    await page.goto('/search?q=night')
    await menuFor(page, 'Night Signal').click()

    const popover = page.locator('.track-menu-popover')
    await expect(popover).toBeVisible()

    const box = (await popover.boundingBox())!
    const width = page.viewportSize()!.width
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
    await noOverflow(page)
  })

  test('an open menu is clickable, not buried under the next row', async ({ page }) => {
    await page.goto('/search?q=night')
    await menuFor(page, 'Night Signal').click()

    await page.getByRole('menuitem', { name: 'New playlist' }).click()
    await page.getByLabel('New playlist name').fill('Phone List')
    await page.getByRole('button', { name: 'Create' }).click()

    await expect.poll(() => playlistOrder(page, 'Phone List')).toEqual(['audius:s1'])
  })

  test('the library is reachable from the drawer, and lays out cleanly', async ({ page }) => {
    await page.goto('/')
    await page.locator('.mobile-menu').click()
    await page.getByRole('link', { name: 'Your Library' }).click()

    await expect(page.getByRole('heading', { name: 'Your Library' })).toBeVisible()
    await noOverflow(page)

    await page.getByRole('link', { name: /Liked Songs/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Liked Songs' })).toBeVisible()
    await noOverflow(page)
  })

  test('a playlist page lays out cleanly and plays', async ({ page }) => {
    await page.goto('/search?q=night')
    await menuFor(page, 'Night Signal').click()
    await page.getByRole('menuitem', { name: 'New playlist' }).click()
    await page.getByLabel('New playlist name').fill('Phone List')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect.poll(() => playlistOrder(page, 'Phone List')).toHaveLength(1)

    await page.goto('/library')
    await page.getByRole('heading', { name: 'Phone List' }).click()
    await expect(page.getByTestId('playlist-list')).toBeVisible()
    await noOverflow(page)

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')
    await noOverflow(page)
  })

  test('the now-playing heart survives the mini-player collapse', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    // The reference hides `.player-track > button` at this width; that slot is
    // now the real heart, and the mini-player is where it is most reached for.
    const heart = page.locator('.player-track > .like-button')
    await expect(heart).toBeVisible()
    await heart.click()
    await expect.poll(() => likedKeys(page)).toEqual(['audius:s1'])
  })

  test('playback modes stay reachable where the mini-player has no room', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    await page.locator('.mobile-menu').click()
    await page.getByRole('button', { name: 'Play queue' }).click()

    const modes = page.locator('.queue-modes')
    await expect(modes).toBeVisible()
    await expect(modes.getByRole('button', { name: 'Repeat off' })).toBeVisible()
    await expect(modes.getByRole('button', { name: 'Shuffle off' })).toBeVisible()
    await noOverflow(page)
  })
})
