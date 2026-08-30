import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  collapseSheet,
  heartFor,
  likedKeys,
  nowPlayingSheet,
  recordYouTubeApiTraffic,
  stubAllProviders,
} from './fixtures'

/**
 * The reported real-device flow, in a real browser, at the reported size.
 *
 * Liked Songs holding `Audio, YouTube, Audio`. The first song finishes on its
 * own and the list moves on to the video — and what the screenshot showed at
 * that point was two defects at once:
 *
 * · the video was *cued*, not playing, with nothing on screen to explain why,
 *   because the visibility measurement that authorises an automatic start was
 *   read before the player it measures existed;
 * · and once the visitor did open Now Playing, the expanded panel sat on top of
 *   a bottom bar that still carried a complete second transport and the 200px
 *   live video itself — two Play buttons, two Next buttons, two hearts and two
 *   progress rails, over one player.
 *
 * Nothing here presses anything to reach the hand-off: the track is run to its
 * end and the assertions are about what happens with nobody touching the app.
 */

const MOBILE = { width: 390, height: 844 }

const player = (page: Page) => page.locator('.player-shell')
const bar = (page: Page) => page.locator('.music-player')
const stage = (page: Page) => page.getByTestId('youtube-stage')
const playerTitle = (page: Page) => page.locator('.player-track b, .now-playing-titles h2')

const youtubeGlobals = () =>
  (window as unknown as { __pulseYouTube?: { playing?: boolean; created?: number } })
    .__pulseYouTube ?? {}

/** Jumps to the last moment of the audio stub rather than waiting it out. */
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
 * Liked Songs holding a catalogue track, a saved video, and a catalogue track.
 *
 * Most-recently-liked first, so hearting them in this order puts them on screen
 * as `Night Signal, Night Signal (Official Video), Night Drive` — audio, video,
 * audio, which is the list from the report.
 */
async function likeAudioVideoAudio(page: Page) {
  await page.goto('/search?q=night')
  await expect(page.locator('.song-row').first()).toBeVisible()
  await heartFor(page, 'Night Drive').click()

  await page.getByTestId('youtube-fallback-more').click()
  await expect(page.getByTestId('youtube-result').first()).toBeVisible()
  await heartFor(page, 'Night Signal (Official Video)').click()

  await heartFor(page, 'Night Signal').click()
  await expect.poll(() => likedKeys(page)).toHaveLength(3)
}

async function openLiked(page: Page) {
  await page.goto('/library/liked')
  const rows = page.getByTestId('liked-list').locator('.song-row')
  await expect(rows).toHaveCount(3)
  return rows
}

/** Starts the list on its first, catalogue, item and lets it finish. */
async function reachTheVideo(page: Page) {
  const rows = await openLiked(page)
  await rows.nth(0).click()
  await expect(playerTitle(page)).toHaveText('Night Signal')

  await runTrackToEnd(page)
  await expect(playerTitle(page)).toHaveText('Night Signal (Official Video)', { timeout: 15_000 })
}

test.describe('a saved list reaching a video on its own', () => {
  test.use({ viewport: MOBILE })

  test.beforeEach(async ({ page }) => {
    await stubAllProviders(page)
  })

  test('opens the expanded player and starts the video, unprompted', async ({ page }) => {
    await likeAudioVideoAudio(page)
    await reachTheVideo(page)

    // Bug A: the list moved on, and so did the screen. No swipe, no press.
    const sheet = nowPlayingSheet(page)
    await expect(sheet).toBeVisible()
    await expect(
      sheet.getByRole('heading', { name: 'Night Signal (Official Video)' }),
    ).toBeVisible()
    await expect(sheet.getByTestId('youtube-stage')).toBeVisible()

    // And the player is genuinely running, because a real IntersectionObserver
    // reported the stage that had just been revealed. The measurement is the
    // browser's own — nothing here supplies a ratio.
    await expect
      .poll(() => page.evaluate(youtubeGlobals).then((g) => g.playing ?? false))
      .toBe(true)
  })

  /**
   * The screenshot, stated as assertions.
   *
   * Every count here was two in the report, and each one was the same defect:
   * the expanded panel was laid out to stop short of the bar rather than replace
   * it, because the bar was where the video lived.
   */
  test('shows exactly one of every control, with no second player below', async ({ page }) => {
    await likeAudioVideoAudio(page)
    await reachTheVideo(page)
    const sheet = nowPlayingSheet(page)
    await expect(sheet).toBeVisible()

    await expect(bar(page)).toHaveCount(0)
    await expect(stage(page)).toHaveCount(1)
    await expect(player(page).getByRole('button', { name: /^(Play|Pause)$/ })).toHaveCount(1)
    await expect(player(page).getByRole('button', { name: 'Next track' })).toHaveCount(1)
    await expect(player(page).getByRole('button', { name: 'Previous track' })).toHaveCount(1)
    await expect(player(page).getByRole('button', { name: /Liked Songs in Pulse$/ })).toHaveCount(1)
    await expect(player(page).locator('.progress')).toHaveCount(1)
    await expect(player(page).getByRole('button', { name: 'Collapse Now Playing' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Open Now Playing' })).toHaveCount(0)
    await expect(page.locator('.now-playing-titles')).toHaveCount(1)
  })

  /**
   * The vertical order the report asked for, measured rather than assumed:
   * handle, then video, then title, then progress, then transport — with the
   * primary Play control on screen rather than pushed off the bottom by the
   * video above it.
   */
  test('stacks the video above the title and keeps the transport on screen', async ({ page }) => {
    await likeAudioVideoAudio(page)
    await reachTheVideo(page)
    const sheet = nowPlayingSheet(page)
    await expect(sheet).toBeVisible()

    const boxes = await page.evaluate(() => {
      const top = (selector: string) => {
        const node = document.querySelector(selector)
        return node ? node.getBoundingClientRect().top : Number.NaN
      }
      const play = document.querySelector('.now-playing-play')?.getBoundingClientRect() ?? {
        top: Number.NaN,
        bottom: Number.NaN,
      }
      return {
        handle: top('.now-playing-head'),
        video: top('.yt-stage-frame'),
        title: top('.now-playing-titles'),
        rail: top('.now-playing-body .progress'),
        transport: top('.now-playing-transport'),
        playTop: play.top,
        playBottom: play.bottom,
        viewport: window.innerHeight,
      }
    })

    expect(boxes.handle).toBeLessThan(boxes.video)
    expect(boxes.video).toBeLessThan(boxes.title)
    expect(boxes.title).toBeLessThan(boxes.rail)
    expect(boxes.rail).toBeLessThan(boxes.transport)
    // The primary Play control is fully on screen, insets and all.
    expect(boxes.playTop).toBeGreaterThanOrEqual(0)
    expect(boxes.playBottom).toBeLessThanOrEqual(boxes.viewport)
  })

  test('the page never scrolls sideways at this width', async ({ page }) => {
    await likeAudioVideoAudio(page)
    await reachTheVideo(page)
    await expect(nowPlayingSheet(page)).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  /**
   * Down to one compact player, up to one expanded player, and the same video
   * throughout — never rebuilt, because reparenting or remounting an iframe
   * reloads it and would restart the song.
   */
  test('collapses to one compact player and expands back to the same one', async ({ page }) => {
    await likeAudioVideoAudio(page)
    await reachTheVideo(page)
    await expect.poll(() => page.evaluate(youtubeGlobals).then((g) => g.created ?? 0)).toBe(1)

    await collapseSheet(page)

    // One bar, one player, nothing of the expanded view left behind it.
    await expect(bar(page)).toHaveCount(1)
    await expect(stage(page)).toHaveCount(1)
    await expect(page.locator('.now-playing-body')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Collapse Now Playing' })).toHaveCount(0)
    // The bar is a compact row again, not a video card.
    await expect
      .poll(() =>
        bar(page)
          .boundingBox()
          .then((box) => box?.height ?? Number.NaN),
      )
      .toBeLessThan(140)
    await expect(bar(page).locator('.player-track img')).toBeVisible()

    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(nowPlayingSheet(page)).toBeVisible()
    await expect(stage(page)).toHaveCount(1)
    await expect(playerTitle(page)).toHaveText('Night Signal (Official Video)')
    // The same player object: none was destroyed and none was built.
    expect(await page.evaluate(youtubeGlobals).then((g) => g.created ?? 0)).toBe(1)
  })

  /**
   * The whole list, end to end, with the expanded view open throughout.
   *
   * The video ends and the next *saved catalogue track* follows it, in the same
   * view, with the large cover where the video was. That is one player changing
   * what it is showing, not a surface closing and another opening.
   */
  test('carries on into the next saved song when the video ends', async ({ page }) => {
    await likeAudioVideoAudio(page)
    await reachTheVideo(page)
    const sheet = nowPlayingSheet(page)
    await expect(sheet).toBeVisible()

    await page.evaluate(() =>
      (
        window as unknown as { __pulseYouTube: { endCurrent: () => void } }
      ).__pulseYouTube.endCurrent(),
    )

    await expect(sheet.getByRole('heading', { name: 'Night Drive' })).toBeVisible({
      timeout: 15_000,
    })
    // Same view, still open, with the cover in the slot the video occupied.
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('.now-playing-art')).toBeVisible()
    await expect(stage(page)).toHaveCount(0)
    await expect(bar(page)).toHaveCount(0)
  })

  /**
   * Origin still decides Next. The video came from Liked Songs, so Next means
   * the next saved item — never the next result of the search that put those
   * rows on screen in the first place.
   */
  test('Next from the video goes to the next saved song, not a search result', async ({ page }) => {
    await likeAudioVideoAudio(page)
    await reachTheVideo(page)
    const sheet = nowPlayingSheet(page)
    await expect(sheet).toBeVisible()

    await sheet.getByRole('button', { name: 'Next track' }).click()

    await expect(sheet.getByRole('heading', { name: 'Night Drive' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(sheet).not.toContainText('Night Drive Live')
  })

  test('the whole hand-off spends no YouTube quota', async ({ page }) => {
    await likeAudioVideoAudio(page)
    const calls = recordYouTubeApiTraffic(page)

    await reachTheVideo(page)
    await expect(nowPlayingSheet(page)).toBeVisible()
    await collapseSheet(page)
    await page.getByRole('button', { name: 'Open Now Playing' }).click()
    await expect(nowPlayingSheet(page)).toBeVisible()

    expect(calls.filter((url) => url.includes('/api/youtube'))).toEqual([])
  })
})

test.describe('the same hand-off on a desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(async ({ page }) => {
    await stubAllProviders(page)
  })

  test('is one coherent view, with no giant player bar beneath it', async ({ page }) => {
    await likeAudioVideoAudio(page)
    await reachTheVideo(page)

    const sheet = nowPlayingSheet(page)
    await expect(sheet).toBeVisible()
    await expect(bar(page)).toHaveCount(0)
    await expect(sheet.getByTestId('youtube-stage')).toBeVisible()
    await expect(player(page).getByRole('button', { name: /^(Play|Pause)$/ })).toHaveCount(1)

    // A centred stage with room for a 16:9 video, rather than a narrow sheet
    // with one squeezed into it.
    const box = (await sheet.getByTestId('youtube-stage').boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(480)
    expect(box.width / box.height).toBeCloseTo(16 / 9, 1)
  })
})

test.describe('a video the visitor presses themselves', () => {
  test.use({ viewport: MOBILE })

  test.beforeEach(async ({ page }) => {
    await stubAllProviders(page)
  })

  test('opens the expanded player and keeps the collection behind it', async ({ page }) => {
    await likeAudioVideoAudio(page)
    const rows = await openLiked(page)

    await rows.nth(1).click()

    const sheet = nowPlayingSheet(page)
    await expect(sheet).toBeVisible()
    await expect(
      sheet.getByRole('heading', { name: 'Night Signal (Official Video)' }),
    ).toBeVisible()
    await expect(stage(page)).toHaveCount(1)
    await expect(player(page).getByRole('button', { name: /^(Play|Pause)$/ })).toHaveCount(1)
    await expect
      .poll(() => page.evaluate(youtubeGlobals).then((g) => g.playing ?? false))
      .toBe(true)

    // Still inside Liked Songs: Next is the saved song below it.
    await sheet.getByRole('button', { name: 'Next track' }).click()
    await expect(sheet.getByRole('heading', { name: 'Night Drive' })).toBeVisible({
      timeout: 15_000,
    })
  })
})

test.describe('an audio track is not dragged along', () => {
  test.use({ viewport: MOBILE })

  test('still starts in the mini-player, with nothing expanded', async ({ page }) => {
    await stubAllProviders(page)
    await likeAudioVideoAudio(page)
    const rows = await openLiked(page)

    await rows.nth(0).click()
    await expect(playerTitle(page)).toHaveText('Night Signal')

    await expect(nowPlayingSheet(page)).toHaveCount(0)
    await expect(bar(page)).toHaveCount(1)
  })
})

/* ==========================================================================
   Which layer refused — the diagnosis, as assertions
   ========================================================================== */

/**
 * The single question the reported failure turned on.
 *
 * "The expanded player opened and the video did not start" is produced by two
 * entirely different things, and they need opposite fixes:
 *
 * · the application never issued a play command — a visibility or timing bug
 *   that belongs to this codebase;
 * · the application issued one and the browser refused it — a mobile autoplay
 *   policy, which nothing here may work around.
 *
 * These read the commands the app actually sent to the documented IFrame API, so
 * the answer is evidence rather than inference.
 */
test.describe('what the application actually asked the player to do', () => {
  test.use({ viewport: MOBILE })

  test.beforeEach(async ({ page }) => {
    await stubAllProviders(page)
  })

  /**
   * §23's mandatory assertion, stated in the terms a visitor would use: the
   * transport shows **Pause**, which it only ever does while something is
   * genuinely playing — and nobody pressed Play to get there.
   */
  test('issues a play command and reaches Pause without anyone tapping', async ({ page }) => {
    await likeAudioVideoAudio(page)

    let playPresses = 0
    await page.exposeFunction('__pulseCountPlayPress', () => {
      playPresses += 1
    })
    await page.evaluate(() => {
      document.addEventListener(
        'click',
        (event) => {
          const target = event.target as HTMLElement | null
          if (target?.closest('button[aria-label="Play"]')) {
            ;(window as unknown as { __pulseCountPlayPress: () => void }).__pulseCountPlayPress()
          }
        },
        true,
      )
    })

    await reachTheVideo(page)

    const sheet = nowPlayingSheet(page)
    await expect(sheet).toBeVisible()
    // Play became Pause on its own.
    await expect(sheet.getByRole('button', { name: 'Pause' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0)
    expect(playPresses).toBe(0)

    // And the command that produced it was a documented play, not a cue.
    const commands = await page.evaluate(
      () =>
        (window as unknown as { __pulseYouTube?: { commands?: string[] } }).__pulseYouTube
          ?.commands ?? [],
    )
    expect(commands.at(-1)).not.toBe('cue')
    expect(['loadVideoById', 'playVideo']).toContain(commands.at(-1))
  })

  /**
   * The other cause, reproduced deliberately: the player refuses the scripted
   * start the way a mobile browser does.
   *
   * Everything the application controls went right — the view opened, the player
   * was visible, a real play command went out — and the refusal came back. The
   * correct response is a single Play button and one quiet line, with no retry
   * and no attempt to get around the policy.
   */
  test('handles a genuine refusal without retrying or skipping the item', async ({ page }) => {
    await likeAudioVideoAudio(page)
    await page.addInitScript(() => {
      // Armed before the player exists, so the very first scripted start is the
      // one that is refused.
      const install = () => {
        const globals = window as unknown as { __pulseYouTube?: { blockAutoplay: boolean } }
        if (globals.__pulseYouTube) globals.__pulseYouTube.blockAutoplay = true
        else setTimeout(install, 10)
      }
      install()
    })

    await reachTheVideo(page)
    const sheet = nowPlayingSheet(page)
    await expect(sheet).toBeVisible()

    const state = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __pulseYouTube?: { playCalls?: number; blocked?: number; commands?: string[] }
            }
          ).__pulseYouTube ?? {},
      )

    // The app asked. That is the whole point of this test.
    await expect.poll(() => state().then((s) => s.blocked ?? 0)).toBeGreaterThan(0)
    const afterBlock = await state()
    expect(['loadVideoById', 'playVideo']).toContain(afterBlock.commands?.at(-1))

    // One Play button, and the honest explanation beside it.
    await expect(sheet.getByRole('button', { name: 'Play', exact: true })).toHaveCount(1)
    await expect(sheet.getByText(/asked for a tap before playing/i)).toBeVisible()

    // No retry loop, and the collection did not move past the item.
    await page.waitForTimeout(2_000)
    expect((await state()).playCalls).toBe(afterBlock.playCalls)
    await expect(
      sheet.getByRole('heading', { name: 'Night Signal (Official Video)' }),
    ).toBeVisible()

    // And a real press still works, which is the only thing that should.
    await sheet.getByRole('button', { name: 'Play', exact: true }).click()
    expect((await state()).playCalls).toBeGreaterThan(afterBlock.playCalls ?? 0)
  })
})
