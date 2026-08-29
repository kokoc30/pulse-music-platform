import { expect, test } from '@playwright/test'
import { stubAudius } from './fixtures'

const audioState = () =>
  ({
    paused: document.querySelector('audio')?.paused ?? true,
    currentTime: document.querySelector('audio')?.currentTime ?? 0,
    src: document.querySelector('audio')?.src ?? '',
  }) as const

test.describe('critical flow: open → search → click → audio plays', () => {
  test.beforeEach(async ({ page }) => {
    await stubAudius(page)
  })

  test('search returns results and clicking one starts real playback', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Search songs and artists').fill('night')

    await expect(page).toHaveURL(/\/search\?q=night/)
    await expect(page.getByRole('heading', { name: /Results for “night”/ })).toBeVisible()
    await expect(page.locator('.top-result-card')).toBeVisible()
    await expect(page.locator('.song-row')).toHaveCount(3)

    await page.locator('.song-row').first().click()

    const player = page.getByRole('region', { name: 'Now playing' })
    await expect(player).toBeVisible()
    await expect(player.getByText('Night Signal')).toBeVisible()
    await expect(player.getByText('Aster Vale')).toBeVisible()

    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)
    await expect.poll(() => page.evaluate(audioState).then((s) => s.currentTime)).toBeGreaterThan(0)
  })

  test('play and pause toggle the real audio element', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(true)

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)
  })

  // Below 560px the reference collapses the player to a mini-player: previous,
  // next, the progress bar and the volume cluster are all display:none. Those
  // controls are therefore desktop-only; mobile reaches the queue through the
  // navigation drawer (see mobile.spec.ts and docs/reference-deviations.md D-12).
  test('next and previous move through a queue the visitor built', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) <= 560, 'reference hides these controls on mobile')
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    /**
     * The queue is built deliberately now.
     *
     * A search row is a *seed*: it plays one song rather than silently queueing
     * every other result, so the second entry comes from the row menu. The
     * transport controls themselves are unchanged, which is what this test is
     * about (docs/SEARCH_SEED_AND_YOUTUBE_CONTINUATION_FIX.md).
     */
    await page.getByRole('button', { name: 'More actions for Night Drive' }).click()
    await page.getByRole('menuitem', { name: 'Add Night Drive to the play queue' }).click()

    await page.getByRole('button', { name: 'Next track' }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Drive')

    await page.getByRole('button', { name: 'Previous track' }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')
  })

  test('seeking moves the real playhead', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) <= 560, 'reference hides the progress bar on mobile')
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()

    const seek = page.getByRole('slider', { name: 'Seek' })
    await expect.poll(() => seek.getAttribute('aria-disabled')).toBeNull()

    await seek.focus()
    await seek.press('End')
    await expect.poll(() => page.evaluate(audioState).then((s) => s.currentTime)).toBeGreaterThan(1)

    await seek.press('Home')
    await expect.poll(() => page.evaluate(audioState).then((s) => s.currentTime)).toBeLessThan(0.5)
  })

  test('volume and mute change the real audio element', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) <= 560, 'reference hides the volume cluster on mobile')
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()

    const volume = page.getByRole('slider', { name: 'Volume' })
    await volume.focus()
    await volume.press('Home')
    await expect(volume).toHaveAttribute('aria-valuetext', '0%')

    await volume.press('End')
    await expect(volume).toHaveAttribute('aria-valuetext', '100%')
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.volume)).toBe(1)

    await page.getByRole('button', { name: 'Mute' }).click()
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.muted)).toBe(true)
    await page.getByRole('button', { name: 'Unmute' }).click()
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.muted)).toBe(false)
  })

  test('a finished track keeps playing something', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    // Jump to the very end of the two-second stub rather than waiting it out.
    await expect
      .poll(() => page.evaluate(() => document.querySelector('audio')?.duration ?? 0))
      .toBeGreaterThan(0)
    await page.evaluate(() => {
      const audio = document.querySelector('audio')
      if (audio) audio.currentTime = Math.max(audio.duration - 0.05, 0)
    })

    /**
     * Which track follows is now the autoplay planner's decision, not the search
     * order's: a seed with nothing queued behind it reaches Phase 6. What this
     * test still guarantees is that playback continues rather than stopping
     * dead. The planner's own choices are pinned deterministically in
     * src/player/search-seed-autoplay.test.ts.
     */
    await expect(page.locator('.player-track b')).not.toHaveText('Night Signal', {
      timeout: 15_000,
    })
    await expect(page.locator('.player-track b')).not.toBeEmpty()
  })

  test('the queue panel lists the queue and can jump within it', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) <= 560, 'mobile opens the queue from the drawer')
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()

    // Built deliberately: a search click seeds one track, so the second entry
    // comes from the row menu rather than from the result list.
    await page.getByRole('button', { name: 'More actions for Night Drive' }).click()
    await page.getByRole('menuitem', { name: 'Add Night Drive to the play queue' }).click()

    await page.getByRole('button', { name: 'Queue', exact: true }).click()
    const panel = page.getByRole('complementary', { name: 'Play queue', exact: true })
    await expect(panel).toBeVisible()
    await expect(panel.locator('.song-row')).toHaveCount(2)

    await panel.locator('.song-row').nth(1).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Drive')

    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  })

  test('a gated track is shown as unavailable and cannot be started', async ({ page }) => {
    await page.goto('/search?q=night')
    const gated = page.locator('.song-row[data-streamable="false"]')
    await expect(gated).toHaveCount(1)
    await expect(gated).toHaveAttribute('aria-disabled', 'true')
    // Named: since Phase 7 the row also carries the Pulse heart and the overflow
    // menu, which stay enabled — a gated track can still be saved for later.
    await expect(gated.locator('.song-row-action')).toBeDisabled()
    await expect(gated.locator('.song-duration')).toHaveText('Gated')
  })

  test('a stream failure surfaces an error and leaves the app usable', async ({ page }) => {
    await stubAudius(page, { failStream: true })
    await page.goto('/search?q=night')
    await page.locator('.song-row:not([aria-disabled="true"])').first().click()

    await expect(page.locator('.notice')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await expect(page.getByLabel('Search songs and artists')).toBeEnabled()
  })

  test('rapid track switching lets the newest choice win', async ({ page }) => {
    await page.goto('/search?q=night')
    const rows = page.locator('.song-row:not([aria-disabled="true"])')
    await rows.nth(0).click()
    await rows.nth(1).click()

    await expect(page.locator('.player-track b')).toHaveText('Night Drive')
    await expect
      .poll(() => page.evaluate(() => document.querySelector('audio')?.paused))
      .toBe(false)
  })
})

test.describe('search states', () => {
  test('shows the no-results state', async ({ page }) => {
    await stubAudius(page, { emptySearch: true })
    await page.goto('/search?q=zzqqxx')
    await expect(page.getByText('No matching music yet')).toBeVisible()
    await expect(page.locator('.song-row')).toHaveCount(0)
  })

  test('shows a retryable provider error state', async ({ page }) => {
    await stubAudius(page, { failStatus: 500 })
    await page.goto('/search?q=night')
    await expect(page.getByText('Search is unavailable')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' }).first()).toBeVisible()
  })

  test('shows a rate-limit message distinct from a generic failure', async ({ page }) => {
    await stubAudius(page, { failStatus: 429 })
    await page.goto('/search?q=night')
    await expect(page.getByText(/Too many requests/)).toBeVisible()
  })

  test('clearing the search returns to browse', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/search?q=night')
    await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()

    await page.getByRole('button', { name: /Clear/ }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()
  })
})
