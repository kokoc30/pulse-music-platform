import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  canGoNext,
  heartFor,
  likedKeys,
  nowPlayingSheet,
  openQueue,
  recordYouTubeApiTraffic,
  stubProviders,
} from './fixtures'

/**
 * Liked Songs, continuing on its own, in a real browser.
 *
 * The reported bug in one sentence: a saved song finishes and the next saved
 * song does not follow. So nothing here presses Next to make the point — the
 * tracks are run to their end and the assertion is about what happens with
 * nobody touching the app. The audio stub serves a real WAV, so the `ended`
 * event under test is the browser's own.
 *
 * Three saved songs across two catalogues, because a saved list is a list of
 * *references* and one of them being Jamendo rather than Audius must make no
 * difference to whether it plays after the one before it.
 */

const barTitle = (page: Page) => page.locator('.player-track b')

/**
 * Jumps to the last moment of the stub rather than waiting the track out.
 *
 * The check and the write are one `evaluate` on purpose. Polling the duration
 * and then jumping in a second call leaves a window in which the hand-off to the
 * next track swaps the element's source — and a `duration` of `NaN` makes
 * `currentTime` throw. Here the element is only touched once it has a real
 * duration, in the same turn that reads it.
 */
async function runTrackToEnd(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const audio = document.querySelector('audio')
        if (!audio) return false
        const { duration } = audio
        if (!Number.isFinite(duration) || duration <= 0) return false
        audio.currentTime = Math.max(duration - 0.05, 0)
        return true
      }),
    )
    .toBe(true)
}

/**
 * Likes three playable songs, newest first.
 *
 * Liked Songs is most-recently-liked first, so hearting Night Signal, then Night
 * Drive, then Night Reverie puts the list on screen in the reverse order — which
 * is the order these tests then assert playback follows.
 */
async function likeThree(page: Page) {
  await page.goto('/search?q=night')
  await expect(page.locator('.song-row').first()).toBeVisible()

  await heartFor(page, 'Night Signal').click()
  await heartFor(page, 'Night Drive').click()
  await heartFor(page, 'Night Reverie').click()
  await expect.poll(() => likedKeys(page)).toHaveLength(3)
}

const VISIBLE_ORDER = ['Night Reverie', 'Night Drive', 'Night Signal']

async function openLiked(page: Page) {
  await page.goto('/library/liked')
  const rows = page.getByTestId('liked-list').locator('.song-row')
  await expect(rows).toHaveCount(3)
  return rows
}

test.describe('a saved list plays as a list', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('three saved songs follow one another with nothing pressed', async ({ page }) => {
    await likeThree(page)
    const rows = await openLiked(page)

    await rows.nth(0).click()
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[0])

    await runTrackToEnd(page)
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[1], { timeout: 15_000 })

    await runTrackToEnd(page)
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[2], { timeout: 15_000 })

    // Still playing, rather than paused on a dead end.
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 })
  })

  test('the context stays Liked Songs, never Search or Autoplay', async ({ page }) => {
    await likeThree(page)
    const rows = await openLiked(page)
    await rows.nth(0).click()
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[0])

    await runTrackToEnd(page)
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[1], { timeout: 15_000 })

    await openQueue(page)
    await expect(page.locator('.queue-head p')).toHaveText('From Liked Songs')
  })

  test('Next stays available while the collection still has songs in it', async ({ page }) => {
    await likeThree(page)
    const rows = await openLiked(page)
    await rows.nth(0).click()
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[0])

    expect(await canGoNext(page)).toBe(true)
  })

  test('the songs already saved are what plays, not something generated', async ({ page }) => {
    await likeThree(page)
    const rows = await openLiked(page)
    await rows.nth(0).click()
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[0])

    await runTrackToEnd(page)
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[1], { timeout: 15_000 })
    await runTrackToEnd(page)
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[2], { timeout: 15_000 })
  })
})

test.describe('starting from the middle', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('continues downward and does not wrap back to the first row', async ({ page }) => {
    await likeThree(page)
    const rows = await openLiked(page)

    await rows.nth(1).click()
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[1])

    await runTrackToEnd(page)
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[2], { timeout: 15_000 })

    // Repeat is off. Whatever follows may be a generated continuation, but it
    // must not be the row above the one the visitor picked.
    await runTrackToEnd(page)
    await expect(barTitle(page)).not.toHaveText(VISIBLE_ORDER[0], { timeout: 15_000 })
  })
})

test.describe('the Play button', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('starts at the first visible row and walks down the list', async ({ page }) => {
    await likeThree(page)
    await openLiked(page)

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[0])

    await runTrackToEnd(page)
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[1], { timeout: 15_000 })
  })
})

test.describe('sort and filter decide the order', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('a re-sorted list plays in the order it is shown in', async ({ page }) => {
    await likeThree(page)
    await openLiked(page)

    await page.getByLabel('Sort Liked Songs').selectOption('title')
    const rows = page.getByTestId('liked-list').locator('.song-row')
    // By title: Night Drive, Night Reverie, Night Signal.
    await expect(rows.nth(0)).toContainText('Night Drive')

    await rows.nth(0).click()
    await expect(barTitle(page)).toHaveText('Night Drive')

    await runTrackToEnd(page)
    await expect(barTitle(page)).toHaveText('Night Reverie', { timeout: 15_000 })
  })

  test('a filtered list plays only what is on screen', async ({ page }) => {
    await likeThree(page)
    await openLiked(page)

    await page.getByLabel('Find in Liked Songs').fill('night d')
    const rows = page.getByTestId('liked-list').locator('.song-row')
    await expect(rows).toHaveCount(1)

    await rows.nth(0).click()
    await expect(barTitle(page)).toHaveText('Night Drive')

    // Nothing that was filtered out was quietly queued behind it.
    await openQueue(page)
    const queue = page.locator('.queue-body .song-row')
    await expect(queue).toHaveCount(1)
  })
})

test.describe('editing the library while it plays', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('unliking the song that is playing does not stop it', async ({ page }) => {
    await likeThree(page)
    const rows = await openLiked(page)

    await rows.nth(0).click()
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[0])

    await rows
      .nth(0)
      .getByRole('button', { name: /Remove .* from Liked Songs/i })
      .click()
    await expect.poll(() => likedKeys(page)).toHaveLength(2)

    // The session is a snapshot of what the listener started.
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[0])
    await runTrackToEnd(page)
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[1], { timeout: 15_000 })
  })
})

test.describe('provider request budget', () => {
  test('rendering Liked Songs and playing from it spends no YouTube quota', async ({ page }) => {
    await stubProviders(page)
    const youtube = recordYouTubeApiTraffic(page)

    await likeThree(page)
    const rows = await openLiked(page)
    await rows.nth(0).click()
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[0])

    await runTrackToEnd(page)
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[1], { timeout: 15_000 })

    expect(youtube).toEqual([])
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('the sheet stays open and follows the collection to the next song', async ({ page }) => {
    await likeThree(page)
    const rows = await openLiked(page)

    await rows.nth(0).click()
    await expect(barTitle(page)).toHaveText(VISIBLE_ORDER[0])

    // Expand Now Playing and leave it open across the hand-off.
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    const sheet = nowPlayingSheet(page)
    await expect(sheet).toBeVisible()

    await runTrackToEnd(page)

    await expect(sheet).toBeVisible({ timeout: 15_000 })
    await expect(sheet.locator('h2').first()).toHaveText(VISIBLE_ORDER[1], { timeout: 15_000 })

    await runTrackToEnd(page)
    await expect(sheet).toBeVisible({ timeout: 15_000 })
    await expect(sheet.locator('h2').first()).toHaveText(VISIBLE_ORDER[2], { timeout: 15_000 })
  })
})
