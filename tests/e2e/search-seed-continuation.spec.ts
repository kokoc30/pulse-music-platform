import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  collapseSheet,
  playlistOrder,
  recordYouTubeApiTraffic,
  stubAllProviders,
  stubProviders,
  transport,
} from './fixtures'

/**
 * The two playback-semantics fixes, end to end in a real browser.
 *
 * **Search seeds.** Clicking one result plays one song; when it ends, the Phase 6
 * similarity planner chooses what follows instead of the next search row.
 *
 * **YouTube continuation.** A video that ends moves to the next eligible result
 * the search already returned — while the player is on screen, and never by
 * asking YouTube for anything.
 */

/** The queue as the player actually holds it. */
async function queueTitles(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.queue-panel .song-data b'))
    return rows.map((node) => node.textContent ?? '')
  })
}

async function openQueue(page: Page) {
  const sidebar = page.getByRole('button', { name: 'Open the play queue' })
  if (await sidebar.isVisible()) {
    await sidebar.click()
    return
  }
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('button', { name: 'Play queue' }).click()
}

test.describe('a search result is a seed, not a queue', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('playing one result queues that result and nothing else', async ({ page }) => {
    await page.goto('/search?q=night')
    await expect(page.locator('.song-row').first()).toBeVisible()

    await page.locator('.song-row').filter({ hasText: 'Night Signal' }).first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    await openQueue(page)
    await expect(page.getByTestId('queue-list')).toBeVisible()
    // Previously this held every playable search result.
    expect(await queueTitles(page)).toEqual(['Night Signal'])
  })

  test('the other results stay on the page, simply unqueued', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').filter({ hasText: 'Night Signal' }).first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    await expect(page.getByTestId('track-list').getByText('Night Drive')).toBeVisible()
    await openQueue(page)
    expect(await queueTitles(page)).not.toContain('Night Drive')
  })

  test('a finished seed reaches autoplay rather than the next search row', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').filter({ hasText: 'Night Signal' }).first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    // Jump to the end of the two-second stub rather than waiting it out.
    await expect
      .poll(() => page.evaluate(() => document.querySelector('audio')?.duration ?? 0))
      .toBeGreaterThan(0)
    await page.evaluate(() => {
      const audio = document.querySelector('audio')
      if (audio) audio.currentTime = Math.max(audio.duration - 0.05, 0)
    })

    // Something plays: the planner answered from the session pool. Which track
    // it picks is the planner's business and is asserted deterministically in
    // src/player/search-seed-autoplay.test.ts — what matters here is that the
    // queue did not simply run on.
    await expect(page.locator('.player-track b')).not.toHaveText('Night Signal', {
      timeout: 15_000,
    })
    await expect(page.locator('.player-track b')).not.toBeEmpty()
  })

  test('a deliberately queued track still wins over autoplay', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').filter({ hasText: 'Night Signal' }).first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    await page.getByRole('button', { name: 'More actions for Night Drive' }).click()
    await page.getByRole('menuitem', { name: 'Add Night Drive to the play queue' }).click()

    await openQueue(page)
    expect(await queueTitles(page)).toEqual(['Night Signal', 'Night Drive'])
  })

  test('a playlist still plays through in order', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.getByRole('button', { name: 'More actions for Night Signal' }).click()
    await page.getByRole('menuitem', { name: 'New playlist' }).click()
    await page.getByLabel('New playlist name').fill('Order Test')
    await page.getByRole('button', { name: 'Create' }).click()

    await expect.poll(() => playlistOrder(page, 'Order Test')).toHaveLength(1)

    await page.getByRole('button', { name: 'More actions for Night Drive' }).click()
    await page.getByRole('menuitem', { name: 'Add Night Drive to Order Test in Pulse' }).click()
    await expect.poll(() => playlistOrder(page, 'Order Test')).toHaveLength(2)

    await page.goto('/library')
    await page.getByRole('heading', { name: 'Order Test' }).click()
    await expect(page.getByTestId('playlist-list')).toBeVisible()
    await expect(page.getByTestId('playlist-list').locator('.song-row')).toHaveCount(2)

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    // A collection keeps sequential queue semantics — this is the behaviour the
    // seed change must not have touched. Polled rather than read once: starting
    // a track now also tops the autoplay supply up in the background, so the
    // panel can commit a frame later than the title in the bar does.
    await openQueue(page)
    await expect.poll(() => queueTitles(page)).toEqual(['Night Signal', 'Night Drive'])
  })
})

test.describe('YouTube continues through the results it already has', () => {
  test.beforeEach(async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
  })

  /** Opens the fallback and starts the first playable result. */
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

  const currentVideoId = (page: Page) =>
    page.evaluate(
      () =>
        (window as unknown as { __pulseYouTube?: { lastVideoId: string | null } }).__pulseYouTube
          ?.lastVideoId ?? null,
    )

  /** Waits for the doubled IFrame API to have built a player, then ends it. */
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

  test('a natural end starts the next eligible result', async ({ page }) => {
    await startFirstResult(page)
    await expect.poll(() => currentVideoId(page)).toBe('aaaaaaaaaaa')

    await endCurrent(page)

    // Skips the made-for-kids and embedding-disabled fixtures on the way.
    await expect.poll(() => currentVideoId(page)).toBe('bbbbbbbbbbb')
  })

  /**
   * The advance itself asks YouTube for nothing: it is answered entirely from
   * results the page already had.
   *
   * What it may do is start *one* lookahead, because `bbbbbbbbbbb` is the last
   * eligible row of this four-row fixture and a session about to run dry is
   * exactly when a search is worth spending. One, and never one per video —
   * `continuous-playback.spec.ts` pins the zero-cost case with a longer list.
   */
  test('it asks YouTube for at most one lookahead, never one per video', async ({ page }) => {
    await startFirstResult(page)
    const calls = recordYouTubeApiTraffic(page)

    await endCurrent(page)
    await expect.poll(() => currentVideoId(page)).toBe('bbbbbbbbbbb')

    expect(calls.filter((url) => url.includes('/api/youtube')).length).toBeLessThanOrEqual(1)
  })

  test('never embeds a result it may not embed', async ({ page }) => {
    await startFirstResult(page)
    await endCurrent(page)
    await expect.poll(() => currentVideoId(page)).toBe('bbbbbbbbbbb')

    await endCurrent(page)
    // 'ccccccccccc' is made for kids and 'ddddddddddd' has embedding disabled;
    // neither may ever be loaded into the player.
    await expect.poll(() => currentVideoId(page)).not.toBe('ccccccccccc')
    expect(await currentVideoId(page)).not.toBe('ddddddddddd')
  })

  /**
   * The end of the session is no longer the end of the story — but when the
   * search brings back nothing the page does not already have, the ending is
   * still an ending. What must never happen is the video restarting.
   */
  test('holds the player open at the end of the session rather than replaying', async ({
    page,
  }) => {
    await startFirstResult(page)
    await endCurrent(page)
    await expect.poll(() => currentVideoId(page)).toBe('bbbbbbbbbbb')

    await endCurrent(page)

    await expect(page.getByTestId('youtube-stage')).toHaveCount(1)
    await expect(page.getByTestId('youtube-stage')).toBeVisible()
    expect(await currentVideoId(page)).toBe('bbbbbbbbbbb')
  })

  test('continuous play can be switched off, and then it stops', async ({ page }) => {
    await startFirstResult(page)

    // The setting lives in the expanded view — it is the visitor's own
    // preference, and that is where a preference belongs. A press on a result
    // opens that view, so it is already the surface in front.
    await expect(page.getByRole('dialog', { name: 'Now playing' })).toBeVisible()
    await page.getByLabel('Continuous play').uncheck()

    await endCurrent(page)

    // The session did not advance, and nothing was requested to find out.
    expect(await currentVideoId(page)).toBe('aaaaaaaaaaa')
  })

  test('Next and Previous step through the session from outside the iframe', async ({ page }) => {
    await startFirstResult(page)
    const calls = recordYouTubeApiTraffic(page)

    /**
     * The unified transport carries them now, and it is the same pair of
     * controls whichever engine is live. Which *surface* they are reached from
     * is a layout detail: the expanded sheet is centred over the bar's control
     * cluster, so while it is open — always, for a video — the sheet's copy is
     * the one in front. Same store, same actions, same rules.
     */
    const controls = await transport(page)

    await controls.getByRole('button', { name: 'Next track' }).click()
    await expect.poll(() => currentVideoId(page)).toBe('bbbbbbbbbbb')

    await controls.getByRole('button', { name: 'Previous track' }).click()
    await expect.poll(() => currentVideoId(page)).toBe('aaaaaaaaaaa')

    // Stepping spends nothing of its own. Reaching the last result of a session
    // does start one lookahead, which is the whole of what the pair may cost.
    expect(calls.filter((url) => url.includes('/api/youtube')).length).toBeLessThanOrEqual(1)
    // Every control is a sibling of the stage, never drawn over the player.
    const inStage = await page.evaluate(
      () => document.querySelectorAll('[data-testid="youtube-stage"] button').length,
    )
    expect(inStage).toBe(0)
  })

  test('closing the player ends the session', async ({ page }) => {
    await startFirstResult(page)
    // The cross is on the bar, behind the sheet, so the sheet comes down first.
    await collapseSheet(page)
    await page.getByRole('button', { name: /Close the YouTube player/ }).click()

    await expect(page.getByTestId('youtube-stage')).toHaveCount(0)
    // And the item is released, not merely paused: nothing is left loaded.
    await expect(page.locator('.player-track b')).toHaveCount(0)
  })
})

test.describe('YouTube still stops in the background — by design', () => {
  test('a hidden document pauses playback and starts nothing', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=night')
    await page.getByTestId('youtube-fallback').click()
    await page
      .getByTestId('youtube-result')
      .filter({ hasText: 'Night Signal (Official Video)' })
      .click()
    await expect(page.getByTestId('youtube-stage')).toBeVisible()
    // The doubled IFrame API loads asynchronously; wait for the player it builds
    // before asserting anything about what that player is doing.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __pulseYouTube?: { playing: boolean } }).__pulseYouTube
              ?.playing ?? null,
        ),
      )
      .toBe(true)

    const calls = recordYouTubeApiTraffic(page)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // This is a PASS: the developer policies prohibit background play for an
    // embedded player, so pausing is the required behaviour rather than a bug.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __pulseYouTube?: { playing: boolean } }).__pulseYouTube
              ?.playing ?? null,
        ),
      )
      .toBe(false)
    expect(calls).toEqual([])

    // …and picks it back up once the visitor comes back, rather than explaining
    // itself. The explanation was the best that could be offered while returning
    // to a stopped video was the end of the story; it is not any more, and it is
    // kept for the case where the resume genuinely cannot happen.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __pulseYouTube?: { playing: boolean } }).__pulseYouTube
              ?.playing ?? null,
        ),
      )
      .toBe(true)
    await expect(
      page.getByText(/YouTube playback pauses when Pulse is in the background/),
    ).toHaveCount(0)
    // Still no request: resuming is a press against a player already loaded.
    expect(calls).toEqual([])
  })
})
