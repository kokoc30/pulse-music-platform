import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  collapseSheet,
  recordYouTubeApiTraffic,
  stageHitTest,
  stubAllProviders,
  stubProviders,
  transport,
} from './fixtures'

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
    await expect(page.getByTestId('youtube-stage')).toBeVisible()
    // …and the bar now names the video, not the Audius track.
    await expect(barTitle(page)).toHaveText('Sourp Sarkis')
    await expect(bar(page)).toContainText('Aram Asatryan - Topic')
    await expect(bar(page)).toContainText('YouTube')

    // Exactly one engine: the audio element is paused, and there is still only one.
    const state = await page.evaluate(audioState)
    expect(state.paused).toBe(true)
    expect(state.count).toBe(1)

    // Closing the video hands the bar back to the preserved, paused track. The
    // cross is on the bar, under the sheet, so the sheet comes down first.
    await collapseSheet(page)
    await page.getByRole('button', { name: /Close the YouTube player/ }).click()
    await expect(page.getByTestId('youtube-stage')).toHaveCount(0)
    await expect(barTitle(page)).toHaveText('Night Signal')
    // Exact: 'Play' is a substring of 'Open Now Playing' and 'Play queue'.
    await expect(bar(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    expect((await page.evaluate(audioState)).paused).toBe(true)
  })

  /**
   * Stepping is driven from the expanded sheet, because for a video that is the
   * surface a visitor has: the embed is mounted there, so the sheet is open the
   * whole time a video plays, and it is centred over the bar's own control
   * cluster. Both carry the same unified actions over the same store, and the
   * bar goes on naming what is playing throughout — which is what is asserted.
   */
  test('the transport steps the YouTube session and spends no quota doing it', async ({ page }) => {
    await page.goto('/search?q=aram asatryan')
    await page.getByTestId('youtube-fallback').click()
    await page.locator('[data-testid="youtube-result"]').first().click()
    await expect(barTitle(page)).toHaveText('Sourp Sarkis')

    const calls = recordYouTubeApiTraffic(page)
    const controls = await transport(page)

    await controls.getByRole('button', { name: 'Next track' }).click()
    await expect(barTitle(page)).toHaveText('Barov Ari')

    await controls.getByRole('button', { name: 'Previous track' }).click()
    await expect(barTitle(page)).toHaveText('Sourp Sarkis')

    expect(calls).toEqual([])
  })

  /**
   * The player now *docks into* the bar rather than floating above it, so "the
   * bar is below the stage" is no longer the invariant — and it never was the
   * one that mattered. What the policies actually require is that no part of
   * this application is painted in front of the player, and that the player
   * keeps its documented minimum size. Both are asserted directly here, by
   * hit-testing the real compositor rather than by comparing rectangles.
   */
  test('nothing is ever painted in front of the player', async ({ page }) => {
    await page.goto('/search?q=aram asatryan')
    await page.getByTestId('youtube-fallback').click()
    await page.locator('[data-testid="youtube-result"]').first().click()
    await expect(page.getByTestId('youtube-stage')).toBeVisible()

    // Nothing of the bar is inside the stage: every control is a sibling.
    const inStage = await page.evaluate(
      () => document.querySelectorAll('[data-testid="youtube-stage"] .music-player').length,
    )
    expect(inStage).toBe(0)

    const stage = await stageHitTest(page)

    // The documented floor, in the rendered layout rather than in a stylesheet.
    expect(stage.width).toBeGreaterThanOrEqual(200)
    expect(stage.height).toBeGreaterThanOrEqual(200)

    // And whatever the compositor puts at the stage's corners and centre is the
    // stage itself, not the bar in front of it.
    expect(stage.covering).toEqual(['stage', 'stage', 'stage'])
  })

  test('the same expanded sheet opens for a video', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(barTitle(page)).toHaveText('Night Signal')

    await page.goto('/search?q=aram asatryan')
    await page.getByTestId('youtube-fallback').click()
    await page.locator('[data-testid="youtube-result"]').first().click()
    await expect(barTitle(page)).toHaveText('Sourp Sarkis')

    // The sheet used to be withheld outright while a video was on screen. It is
    // the video's own view now, and starting a video opens it — that is where
    // the player is mounted, so the surface is on screen before anything plays.
    const dialog = page.getByRole('dialog', { name: 'Now playing' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Sourp Sarkis' })).toBeVisible()
    await expect(dialog).not.toContainText('Night Signal')

    // Exactly one player, and it is inside that view rather than in the bar.
    await expect(page.getByTestId('youtube-stage')).toHaveCount(1)
    await expect(dialog.getByTestId('youtube-stage')).toBeVisible()
    await expect(bar(page).locator('iframe')).toHaveCount(0)

    // It is a panel, not a modal — the one way the video sheet still differs
    // from the track sheet it now matches pixel for pixel.
    await expect(dialog).not.toHaveAttribute('aria-modal', 'true')

    // The sheet belongs to playback rather than to the route, so it survives a
    // navigation with its player intact. Reaching the header means bringing the
    // sheet down first on a phone, where it is the whole viewport.
    await collapseSheet(page)
    await page.getByRole('link', { name: 'Pulse home' }).click()
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()
    await expect(barTitle(page)).toHaveText('Sourp Sarkis')
  })
})
