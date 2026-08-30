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

/** The player, in whichever of its two presentations is on screen. */
const playerShell = (page: Page) => page.locator('.player-shell')
const bar = (page: Page) => page.locator('.music-player')

/**
 * What the player says is playing, whichever presentation is up.
 *
 * The two are alternatives — one bar or one expanded view, never both — so a
 * single locator across both titles resolves to exactly one element at a time.
 * That is the point of asserting through it: "the player names the video" is a
 * claim about the player, not about one of its layouts.
 */
const playerTitle = (page: Page) => page.locator('.player-track b, .now-playing-titles h2')

const audioState = () => {
  const audio = document.querySelector('audio')
  return { paused: audio?.paused ?? true, count: document.querySelectorAll('audio').length }
}

async function playFirstSearchResult(page: Page) {
  await page.goto('/search?q=night')
  await page.locator('.song-row').first().click()
  await expect(playerTitle(page)).toHaveText('Night Signal')
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

    await expect(playerTitle(page)).not.toHaveText('Night Signal')
  })

  test('Repeat one still does not turn Next into a replay button', async ({ page }) => {
    await playFirstSearchResult(page)

    const controls = await transport(page)
    await controls.getByRole('button', { name: 'Repeat off' }).click()
    await controls.getByRole('button', { name: 'Repeat playlist' }).click()
    await expect(controls.getByRole('button', { name: 'Repeat one' })).toBeVisible()

    await controls.getByRole('button', { name: 'Next track' }).click()

    await expect(playerTitle(page)).not.toHaveText('Night Signal')
  })
})

test.describe('the player follows the engine that is playing', () => {
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
    await expect(playerTitle(page)).toHaveText('Night Signal')

    // An explicit submission with nothing strong in the open catalogues runs the
    // YouTube fallback once, on its own.
    const field = page.getByLabel('Search songs and artists')
    await field.click()
    await field.fill('aram asatryan')
    await field.press('Enter')

    const results = page.locator('[data-testid="youtube-result"]')
    await expect(results.first()).toBeVisible()
    await results.first().click()

    // The official player opens, as the expanded view a press on a video earns…
    await expect(page.getByTestId('youtube-stage')).toBeVisible()
    // …and the player now names the video, not the Audius track.
    await expect(playerTitle(page)).toHaveText('Sourp Sarkis')
    await expect(playerShell(page)).toContainText('Aram Asatryan - Topic')
    await expect(playerShell(page)).toContainText('YouTube')

    // Exactly one engine: the audio element is paused, and there is still only one.
    const state = await page.evaluate(audioState)
    expect(state.paused).toBe(true)
    expect(state.count).toBe(1)

    // Dismissing is a different act from collapsing and has a different control,
    // on the mini-player: come down first, then close the video. It hands the
    // player back to the preserved, paused track.
    await collapseSheet(page)
    await page.getByRole('button', { name: /Close the YouTube player/ }).click()
    await expect(page.getByTestId('youtube-stage')).toHaveCount(0)
    await expect(playerTitle(page)).toHaveText('Night Signal')
    // Exact: 'Play' is a substring of 'Open Now Playing' and 'Play queue'.
    await expect(bar(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    expect((await page.evaluate(audioState)).paused).toBe(true)
  })

  /**
   * Stepping is driven from whichever presentation is up, because both carry the
   * same controls wired to the same unified actions over the same store. For a
   * video that is the expanded view, which a press on a result opens; the player
   * goes on naming what is playing throughout, which is what is asserted.
   */
  test('the transport steps the YouTube session and spends no quota doing it', async ({ page }) => {
    await page.goto('/search?q=aram asatryan')
    await page.getByTestId('youtube-fallback').click()
    await page.locator('[data-testid="youtube-result"]').first().click()
    await expect(playerTitle(page)).toHaveText('Sourp Sarkis')

    const calls = recordYouTubeApiTraffic(page)
    const controls = await transport(page)

    await controls.getByRole('button', { name: 'Next track' }).click()
    await expect(playerTitle(page)).toHaveText('Barov Ari')

    await controls.getByRole('button', { name: 'Previous track' }).click()
    await expect(playerTitle(page)).toHaveText('Sourp Sarkis')

    expect(calls).toEqual([])
  })

  /**
   * The player's *box* moves between two geometries and its DOM node never does,
   * so "the bar is below the stage" was never the invariant that mattered. What
   * the policies actually require is that no part of this application is painted
   * in front of the player, and that the player keeps its documented minimum
   * size. Both are asserted directly here, by hit-testing the real compositor
   * rather than by comparing rectangles.
   */
  test('nothing is ever painted in front of the player', async ({ page }) => {
    await page.goto('/search?q=aram asatryan')
    await page.getByTestId('youtube-fallback').click()
    await page.locator('[data-testid="youtube-result"]').first().click()
    await expect(page.getByTestId('youtube-stage')).toBeVisible()

    // No control of ours is inside the stage: every one is a sibling.
    const inStage = await page.evaluate(
      () =>
        document.querySelectorAll('[data-testid="youtube-stage"] button, .yt-stage-mount ~ *')
          .length,
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

  test('the expanded player opens for a video, and comes down to one mini-player', async ({
    page,
  }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(playerTitle(page)).toHaveText('Night Signal')
    // A track starts in the mini-player and expands only when asked.
    const dialog = page.getByRole('dialog', { name: 'Now playing' })
    await expect(dialog).toHaveCount(0)

    await page.goto('/search?q=aram asatryan')
    await page.getByTestId('youtube-fallback').click()
    await page.locator('[data-testid="youtube-result"]').first().click()

    // A press on a video opens the expanded player, because the official video
    // is the content the visitor chose.
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Sourp Sarkis' })).toBeVisible()
    await expect(dialog).not.toContainText('Night Signal')

    // Exactly one player, inside it, and no mini-player left underneath.
    await expect(page.getByTestId('youtube-stage')).toHaveCount(1)
    await expect(dialog.getByTestId('youtube-stage')).toBeVisible()
    await expect(bar(page)).toHaveCount(0)
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    // Coming down leaves one compact player with the same video in it, still
    // the same iframe — and the player belongs to playback rather than to the
    // route, so it survives a navigation intact.
    await collapseSheet(page)
    await expect(bar(page)).toHaveCount(1)
    await expect(page.getByTestId('youtube-stage')).toHaveCount(1)
    await page.getByRole('link', { name: 'Pulse home' }).click()
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()
    await expect(playerTitle(page)).toHaveText('Sourp Sarkis')
  })
})

/**
 * Where playback starts, and what expanding does to it.
 *
 * The reported complaint in one line: pressing an audio result started the
 * collapsed bar, and pressing a YouTube result took over the screen — with a
 * second complete transport left underneath it. There is one player shell now
 * with two presentations, exactly one of them rendered at a time, and the video
 * is the primary media region of the expanded one.
 */
test.describe('where playback starts', () => {
  test.beforeEach(async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
  })

  async function playFirstVideo(page: Page) {
    await page.goto('/search?q=aram asatryan')
    await page.getByTestId('youtube-fallback').click()
    await page.locator('[data-testid="youtube-result"]').first().click()
    await expect(page.getByTestId('youtube-stage')).toBeVisible()
  }

  test('a YouTube result starts in the expanded player, playing', async ({ page }) => {
    await playFirstVideo(page)

    const dialog = page.getByRole('dialog', { name: 'Now playing' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('youtube-stage')).toBeVisible()
    // And no mini-player left behind it to be a second one.
    await expect(bar(page)).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __pulseYouTube?: { playing?: boolean } }).__pulseYouTube
              ?.playing ?? false,
        ),
      )
      .toBe(true)
  })

  test('the player clears 200 x 200 in both presentations', async ({ page }) => {
    await playFirstVideo(page)

    // Through `stageHitTest`, which lets every animation on the page settle
    // before it measures. A box read while the expanded panel is still rising —
    // or still coming down — describes a geometry the stage has already left,
    // and the documented floor is a claim about the rendered layout rather than
    // about a frame in the middle of a transition.
    const expanded = await stageHitTest(page)
    expect(expanded.width).toBeGreaterThanOrEqual(200)
    expect(expanded.height).toBeGreaterThanOrEqual(200)

    await collapseSheet(page)

    const docked = await stageHitTest(page)
    expect(docked.width).toBeGreaterThanOrEqual(200)
    expect(docked.height).toBeGreaterThanOrEqual(200)
  })

  /**
   * The mini-player is a mini-player again.
   *
   * It briefly held the 200px live player in its artwork slot, which made it
   * roughly 216px tall on a phone — a video card wedged into a bar. The live
   * player is docked beside it now, so the bar itself is back to the compact
   * row every provider shares.
   */
  test('the collapsed bar is a compact row, not a video card', async ({ page }) => {
    await playFirstVideo(page)
    await collapseSheet(page)

    await expect
      .poll(() =>
        bar(page)
          .boundingBox()
          .then((box) => box?.height ?? Number.NaN),
      )
      .toBeLessThan(140)
    // Its artwork slot holds a still, not the player.
    await expect(bar(page).locator('.player-track img')).toBeVisible()
    await expect(bar(page).getByTestId('youtube-stage')).toHaveCount(0)
  })

  test('expanding and collapsing never rebuilds or stops the player', async ({ page }) => {
    await playFirstVideo(page)

    // Read as two numbers rather than as the whole recorder object: it also
    // carries a function, which does not survive serialisation, and it does not
    // exist at all until the doubled IFrame API script has run.
    const counts = () =>
      page.evaluate(() => {
        const recorder = (
          window as unknown as { __pulseYouTube?: { created?: number; destroyed?: number } }
        ).__pulseYouTube
        return { created: recorder?.created ?? 0, destroyed: recorder?.destroyed ?? 0 }
      })

    await expect.poll(() => counts().then((c) => c.created)).toBe(1)
    const before = await counts()

    await page.getByRole('button', { name: 'Collapse Now Playing' }).click()
    await expect(page.getByRole('dialog', { name: 'Now playing' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(page.getByRole('dialog', { name: 'Now playing' })).toBeVisible()

    // No second iframe, no destroyed one, and still playing. The stage is a
    // stable child of the player shell and only its box changes between the two
    // presentations — reparenting an iframe, or remounting one, reloads it.
    expect(await counts()).toEqual(before)
    await expect(
      page.getByRole('dialog', { name: 'Now playing' }).getByTestId('youtube-stage'),
    ).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __pulseYouTube?: { playing?: boolean } }).__pulseYouTube
              ?.playing ?? false,
        ),
      )
      .toBe(true)
  })

  test('nothing is painted over the player in either presentation', async ({ page }) => {
    await playFirstVideo(page)

    // The compositor's answer, not a rectangle comparison: whatever is at the
    // stage's centre and corners is the stage.
    const expanded = await stageHitTest(page)
    expect(expanded.width).toBeGreaterThanOrEqual(200)
    expect(expanded.height).toBeGreaterThanOrEqual(200)
    expect(expanded.covering).toEqual(['stage', 'stage', 'stage'])

    await collapseSheet(page)

    const docked = await stageHitTest(page)
    expect(docked.width).toBeGreaterThanOrEqual(200)
    expect(docked.height).toBeGreaterThanOrEqual(200)
    expect(docked.covering).toEqual(['stage', 'stage', 'stage'])
  })

  test('an audio result still starts in the bar, exactly as before', async ({ page }) => {
    await stubAllProviders(page)
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()

    await expect(playerTitle(page)).toHaveText('Night Signal')
    await expect(page.getByRole('dialog', { name: 'Now playing' })).toHaveCount(0)
  })
})
