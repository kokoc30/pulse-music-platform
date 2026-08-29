import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { recordYouTubeApiTraffic, stubAllProviders, stubProviders } from './fixtures'

/**
 * The two flows a visitor reported, in a real browser.
 *
 * · Playing one song from a search and finding Next greyed out, then finding
 *   that switching Repeat on made it replay the same song.
 * · Starting a YouTube video and watching the bottom bar go on announcing the
 *   Audius track that had stopped.
 */

const bar = (page: Page) => page.locator('.music-player')
const barTitle = (page: Page) => page.locator('.player-track b')

const audioState = () => {
  const audio = document.querySelector('audio')
  return { paused: audio?.paused ?? true, count: document.querySelectorAll('audio').length }
}

/**
 * Where the audio transport actually lives at this viewport.
 *
 * The reference hides every control but the round play button below 560px, so a
 * phone reaches Next, Repeat and Shuffle through the expanded Now Playing sheet
 * instead. Both are the same store and the same actions, so the rules under test
 * are identical — only the surface differs.
 */
async function transport(page: Page) {
  if (await bar(page).getByRole('button', { name: 'Next track' }).isVisible()) return bar(page)
  await page.getByRole('button', { name: 'Open Now Playing' }).click()
  const sheet = page.getByRole('dialog', { name: 'Now playing' })
  await expect(sheet).toBeVisible()
  return sheet
}

async function playFirstSearchResult(page: Page) {
  await page.goto('/search?q=night')
  await page.locator('.song-row').first().click()
  await expect(barTitle(page)).toHaveText('Night Signal')
  await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)
}

test.describe('a single search seed can still move forward', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('Next is enabled on a one-track seed, without touching Repeat', async ({ page }) => {
    await playFirstSearchResult(page)

    // The reported state: one track queued, repeat off, autoplay on.
    const queue = await page.evaluate(() => document.querySelectorAll('.song-row').length)
    expect(queue).toBeGreaterThan(0)

    await expect((await transport(page)).getByRole('button', { name: 'Next track' })).toBeEnabled()
  })

  test('pressing Next leaves the song rather than replaying it', async ({ page }) => {
    await playFirstSearchResult(page)

    await (await transport(page)).getByRole('button', { name: 'Next track' }).click()

    await expect(barTitle(page)).not.toHaveText('Night Signal')
  })

  test('Repeat one still does not turn Next into a replay button', async ({ page }) => {
    await playFirstSearchResult(page)

    const controls = await transport(page)
    await controls.getByRole('button', { name: 'Repeat off' }).click()
    await controls.getByRole('button', { name: 'Repeat playlist' }).click()
    await expect(controls.getByRole('button', { name: 'Repeat one' })).toBeVisible()

    await controls.getByRole('button', { name: 'Next track' }).click()

    await expect(barTitle(page)).not.toHaveText('Night Signal')
  })
})

test.describe('the bar follows the engine that is playing', () => {
  const ARAM = [
    { videoId: 'aram0000001', title: 'Sourp Sarkis', channelTitle: 'Aram Asatryan - Topic' },
    { videoId: 'aram0000002', title: 'Barov Ari', channelTitle: 'Aram Asatryan - Topic' },
    { videoId: 'aram0000003', title: 'Nani Im Nani', channelTitle: 'Aram Asatryan - Topic' },
  ]

  /** The three real Jamendo rows for `aram asatryan`; none is a strong match. */
  const ARAM_NOISE = [
    { id: 'n1', title: "Eternos Rivales - Fil d'aram", artist: 'Eternos Rivales', duration: 8 },
    { id: 'n2', title: '01. Meteo sombre (prod. Aram)', artist: 'L.IAM', duration: 8 },
    { id: 'n3', title: 'Orom Aram', artist: 'Joel Vanoli', duration: 8 },
  ]

  test.beforeEach(async ({ page }) => {
    await stubAllProviders(page, {
      jamendo: { tracks: ARAM_NOISE },
      youtube: { videos: ARAM },
    })
  })

  test('the reported flow end to end: audio, then YouTube, then back', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(barTitle(page)).toHaveText('Night Signal')

    // An explicit submission with nothing strong in the open catalogues runs the
    // YouTube fallback once, on its own.
    const field = page.getByLabel('Search songs and artists')
    await field.click()
    await field.fill('aram asatryan')
    await field.press('Enter')

    const results = page.locator('[data-testid="youtube-result"]')
    await expect(results.first()).toBeVisible()
    await results.first().click()

    // The official player opens…
    await expect(page.getByTestId('youtube-surface')).toBeVisible()
    // …and the bar now names the video, not the Audius track.
    await expect(barTitle(page)).toHaveText('Sourp Sarkis')
    await expect(bar(page)).toContainText('Aram Asatryan - Topic')
    await expect(bar(page)).toContainText('YouTube')

    // Exactly one engine: the audio element is paused, and there is still only one.
    const state = await page.evaluate(audioState)
    expect(state.paused).toBe(true)
    expect(state.count).toBe(1)

    // Closing the video hands the bar back to the preserved, paused track.
    await page.getByRole('button', { name: /Close the YouTube player/ }).click()
    await expect(page.getByTestId('youtube-surface')).toHaveCount(0)
    await expect(barTitle(page)).toHaveText('Night Signal')
    // Exact: 'Play' is a substring of 'Open Now Playing' and 'Play queue'.
    await expect(bar(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    expect((await page.evaluate(audioState)).paused).toBe(true)
  })

  test('the bar steps the YouTube session and spends no quota doing it', async ({
    page,
  }, testInfo) => {
    // Below 560px the reference leaves only the round play button on the bar, so
    // stepping there is done in the player's own footer — which is on screen
    // anyway, and is covered by tests/e2e/search-seed-continuation.spec.ts.
    test.skip(testInfo.project.name === 'chromium-mobile', 'mini-player carries play/pause only')

    await page.goto('/search?q=aram asatryan')
    await page.getByTestId('youtube-fallback').click()
    await page.locator('[data-testid="youtube-result"]').first().click()
    await expect(barTitle(page)).toHaveText('Sourp Sarkis')

    const calls = recordYouTubeApiTraffic(page)

    await bar(page).getByRole('button', { name: 'Next YouTube result' }).click()
    await expect(barTitle(page)).toHaveText('Barov Ari')

    await bar(page).getByRole('button', { name: 'Previous YouTube result' }).click()
    await expect(barTitle(page)).toHaveText('Sourp Sarkis')

    expect(calls).toEqual([])
  })

  test('the bar never draws over the player', async ({ page }) => {
    await page.goto('/search?q=aram asatryan')
    await page.getByTestId('youtube-fallback').click()
    await page.locator('[data-testid="youtube-result"]').first().click()
    await expect(page.getByTestId('youtube-surface')).toBeVisible()

    const stage = (await page.getByTestId('youtube-stage').boundingBox())!
    const player = (await bar(page).boundingBox())!
    // The bar sits entirely below the video stage.
    expect(player.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1)
    // And nothing of the bar is inside the stage.
    const inStage = await page.evaluate(
      () => document.querySelectorAll('[data-testid="youtube-stage"] .music-player').length,
    )
    expect(inStage).toBe(0)
  })

  test('the audio Now Playing sheet cannot be opened while a video is playing', async ({
    page,
  }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(barTitle(page)).toHaveText('Night Signal')

    await page.goto('/search?q=aram asatryan')
    await page.getByTestId('youtube-fallback').click()
    await page.locator('[data-testid="youtube-result"]').first().click()
    await expect(barTitle(page)).toHaveText('Sourp Sarkis')

    await expect(page.getByRole('button', { name: 'Open Now Playing' })).toHaveCount(0)
    await expect(page.getByTestId('now-playing')).toHaveCount(0)
  })
})
