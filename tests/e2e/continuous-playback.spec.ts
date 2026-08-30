import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  SEARCH_RESULTS,
  YOUTUBE_RESULTS,
  recordYouTubeApiTraffic,
  stubAllProviders,
  stubProviders,
} from './fixtures'

/**
 * **Playback never stops on its own**, in a real browser.
 *
 * The two reported bugs, stated as behaviour: an audio track that ends starts a
 * *different* track without anyone touching the app, and a video that ends
 * starts a *different* video in the same open sheet. Neither may answer the end
 * of a track by playing that track again, and neither may quietly stop and
 * wait to be rescued.
 *
 * Every provider is stubbed, so nothing here depends on a live catalogue or on
 * the day's YouTube allowance. The audio stub serves a real two-second WAV, so
 * the `ended` event under test is the browser's own rather than a simulated one.
 */

const barTitle = (page: Page) => page.locator('.player-track b')

/** Jumps to the last moment of the stub, rather than waiting the track out. */
async function runTrackToEnd(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.querySelector('audio')?.duration ?? 0))
    .toBeGreaterThan(0)
  await page.evaluate(() => {
    const audio = document.querySelector('audio')
    if (audio) audio.currentTime = Math.max(audio.duration - 0.05, 0)
  })
}

test.describe('audio keeps going on its own', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('a track that ends is followed by a different track', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').filter({ hasText: 'Night Signal' }).first().click()
    await expect(barTitle(page)).toHaveText('Night Signal')

    await runTrackToEnd(page)

    await expect(barTitle(page)).not.toHaveText('Night Signal', { timeout: 15_000 })
    await expect(barTitle(page)).not.toBeEmpty()
    // Still playing, rather than paused on a dead end.
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 })
  })

  test('three tracks in a row, all different, with nothing pressed', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').filter({ hasText: 'Night Signal' }).first().click()
    await expect(barTitle(page)).toHaveText('Night Signal')

    const heard = ['Night Signal']
    for (let step = 0; step < 2; step += 1) {
      const previous = heard[heard.length - 1]
      await runTrackToEnd(page)
      await expect(barTitle(page)).not.toHaveText(previous, { timeout: 15_000 })
      heard.push((await barTitle(page).textContent()) ?? '')
    }

    expect(new Set(heard).size).toBe(heard.length)
  })

  /**
   * The reported symptom, asserted as the absence of itself.
   *
   * A track ending must never be answered by the same track starting, whatever
   * the catalogue can or cannot offer.
   */
  test('never replays the track that just finished', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').filter({ hasText: 'Night Signal' }).first().click()
    await expect(barTitle(page)).toHaveText('Night Signal')

    await runTrackToEnd(page)
    await expect(barTitle(page)).not.toHaveText('Night Signal', { timeout: 15_000 })

    // Genuinely a fresh load rather than a rewind of the same one: the element
    // leaves its ended state, on a track the bar now names differently. Polled,
    // because the bar is updated from the store the moment the next track is
    // chosen, which is a stream lookup earlier than the element is reloaded.
    await expect
      .poll(() => page.evaluate(() => document.querySelector('audio')?.ended ?? true))
      .toBe(false)
  })
})

test.describe('an empty catalogue explains itself instead of looping', () => {
  test('says it cannot find more, and does not start the track again', async ({ page }) => {
    // One playable result and nothing behind it: no similar tracks, no trending
    // fallback, and a YouTube fallback that returns nothing either.
    await stubAllProviders(page, {
      audius: { searchResults: [SEARCH_RESULTS[0]], trending: [] },
      jamendo: { empty: true },
      youtube: { empty: true },
    })

    await page.goto('/search?q=night')
    await page.locator('.song-row').filter({ hasText: 'Night Signal' }).first().click()
    await expect(barTitle(page)).toHaveText('Night Signal')

    await runTrackToEnd(page)

    await expect(page.getByText("Can't find more tracks right now.")).toBeVisible({
      timeout: 20_000,
    })
    // The bar still names the track that finished — it did not start again.
    await expect(barTitle(page)).toHaveText('Night Signal')
    expect(await page.evaluate(() => document.querySelector('audio')?.paused ?? true)).toBe(true)
  })
})

test.describe('a video keeps going in the presentation it is already in', () => {
  test.beforeEach(async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
  })

  const currentVideoId = (page: Page) =>
    page.evaluate(
      () =>
        (window as unknown as { __pulseYouTube?: { lastVideoId: string | null } }).__pulseYouTube
          ?.lastVideoId ?? null,
    )

  const endCurrent = async (page: Page) => {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            typeof (window as unknown as { __pulseYouTube?: { endCurrent?: unknown } })
              .__pulseYouTube?.endCurrent === 'function',
        ),
      )
      .toBe(true)
    await page.evaluate(() =>
      (
        window as unknown as { __pulseYouTube: { endCurrent: () => void } }
      ).__pulseYouTube.endCurrent(),
    )
  }

  async function startFirstResult(page: Page) {
    await page.goto('/search?q=night')
    await page.getByTestId('youtube-fallback').click()
    await expect(page.getByTestId('youtube-result').first()).toBeVisible()
    await page
      .getByTestId('youtube-result')
      .filter({ hasText: 'Night Signal (Official Video)' })
      .click()
    await expect(page.getByTestId('youtube-stage')).toBeVisible()
  }

  test('a different video loads, into the same player, changing nothing else', async ({ page }) => {
    await startFirstResult(page)
    await expect.poll(() => currentVideoId(page)).toBe('aaaaaaaaaaa')

    await endCurrent(page)

    await expect.poll(() => currentVideoId(page)).toBe('bbbbbbbbbbb')
    // The player is where it was, in the presentation the visitor was already
    // in — a press on a result opened the expanded one, and an ending changes
    // the video without touching the surface in either direction.
    const dialog = page.getByRole('dialog', { name: 'Now playing' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('youtube-stage')).toBeVisible()
    await expect(page.getByTestId('youtube-stage')).toHaveCount(1)
    await expect(dialog.getByRole('heading', { name: 'Night Drive Live' })).toBeVisible()
  })

  test('there is no replay control to press', async ({ page }) => {
    await startFirstResult(page)
    await endCurrent(page)
    await expect.poll(() => currentVideoId(page)).toBe('bbbbbbbbbbb')

    // The app has never drawn one and must not start: the player's own end
    // screen belongs to YouTube, and standing in front of it with a button of
    // ours would both overlay the iframe and mean playback had stopped.
    await expect(page.getByRole('button', { name: /replay|play again|watch again/i })).toHaveCount(
      0,
    )
  })

  /**
   * The end of the results is where the reported bug lived: the session ran out
   * and the visitor was stranded. Now the session is extended — bounded by the
   * per-sitting allowance, and only ever with videos it does not already hold.
   */
  test('an exhausted session is extended with related videos', async ({ page }) => {
    // The search returns two results; the related lookup answers with two more.
    await stubAllProviders(page, {
      audius: { emptySearch: true },
      jamendo: { empty: true },
      youtube: {
        videos: [
          YOUTUBE_RESULTS[0],
          {
            videoId: 'eeeeeeeeeee',
            title: 'Night Signal Reprise',
            channelTitle: 'Aster Vale',
            durationSeconds: 200,
          },
        ],
      },
    })

    await startFirstResult(page)
    await expect.poll(() => currentVideoId(page)).toBe('aaaaaaaaaaa')

    await endCurrent(page)

    await expect.poll(() => currentVideoId(page)).toBe('eeeeeeeeeee')
    await expect(page.getByTestId('youtube-stage')).toHaveCount(1)
  })

  /**
   * The quota rule, as behaviour: continuation is worth spending searches on,
   * but not one per video. The lookahead fires on the *last* eligible result of
   * a session, so advancing into the middle of one costs nothing at all.
   */
  test('advancing inside the results already held costs no search', async ({ page }) => {
    await stubAllProviders(page, {
      audius: { emptySearch: true },
      jamendo: { empty: true },
      youtube: {
        videos: [
          YOUTUBE_RESULTS[0],
          YOUTUBE_RESULTS[1],
          {
            videoId: 'eeeeeeeeeee',
            title: 'Night Signal Reprise',
            channelTitle: 'Aster Vale',
            durationSeconds: 200,
          },
        ],
      },
    })

    await startFirstResult(page)
    const calls = recordYouTubeApiTraffic(page)

    await endCurrent(page)
    await expect.poll(() => currentVideoId(page)).toBe('bbbbbbbbbbb')

    expect(calls.filter((url) => url.includes('/api/youtube'))).toEqual([])
  })
})
