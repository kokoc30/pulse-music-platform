import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  collapseSheet,
  recordYouTubeTraffic,
  stageHitTest,
  stubAllProviders,
  stubProviders,
} from './fixtures'

/**
 * Phase 3 end to end: the explicit YouTube fallback
 * (agents/27_PHASE3_TESTING_QA.md → "E2E").
 *
 * Everything is intercepted at the network layer, including the IFrame API
 * script itself, so no test here spends a real YouTube search or contacts a
 * Google server. The `recordYouTubeTraffic` helper proves that rather than
 * assuming it.
 */

const surface = '[data-testid="youtube-stage"]'
const stage = '[data-testid="youtube-stage"]'
const rows = '[data-testid="youtube-result"]'

/**
 * What the fake IFrame API recorded, read from inside the page.
 *
 * Every one of these is written as a self-contained browser expression rather
 * than a shared Node helper: anything handed to `page.evaluate` is serialised
 * and runs in the browser, where a closure over a Node-side function does not
 * exist.
 */
type YouTubeGlobals = {
  created?: number
  playCalls?: number
  lastVideoId?: string | null
  playing?: boolean
  destroyed?: number
  playerVars?: Record<string, unknown>
}

const readYouTubeGlobals = () =>
  ((window as unknown as { __pulseYouTube?: YouTubeGlobals }).__pulseYouTube ??
    {}) as YouTubeGlobals

const audioState = () =>
  ({
    paused: document.querySelector('audio')?.paused ?? true,
    src: document.querySelector('audio')?.src ?? '',
  }) as const

test.describe('quota discipline', () => {
  test('an ordinary search makes zero YouTube requests', async ({ page }) => {
    await stubProviders(page)
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/search?q=night')
    await expect(page.getByRole('heading', { name: 'Songs' })).toBeVisible()
    await expect(page.locator('.song-row').first()).toBeVisible()

    expect(traffic).toEqual([])
  })

  test('typing makes zero YouTube requests', async ({ page }) => {
    await stubProviders(page)
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/')
    await page.getByLabel('Search songs and artists').fill('night signal')
    await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()

    expect(traffic).toEqual([])
  })

  test('one deliberate press makes exactly one YouTube request', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/search?q=nothing here')
    await page.getByTestId('youtube-fallback').click()
    await expect(page.locator(rows).first()).toBeVisible()

    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(1)
  })

  test('pressing again for the same query costs nothing more', async ({ page }) => {
    // YouTube answers with nothing, which is what keeps the manual control on
    // screen for a second press: once it finds rows, the empty state and its
    // button give way to the results section.
    await stubAllProviders(page, {
      audius: { emptySearch: true },
      jamendo: { empty: true },
      youtube: { empty: true },
    })
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/search?q=nothing here')
    await page.getByTestId('youtube-fallback').click()
    await expect(page.getByText(/No YouTube videos matched/i)).toBeVisible()
    await page.getByTestId('youtube-fallback').click()
    await expect(page.getByText(/No YouTube videos matched/i)).toBeVisible()

    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(1)
  })
})

test.describe('the fallback surfaces where it should', () => {
  test('offers the prompt when nothing matched', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=nothing here')

    const button = page.getByTestId('youtube-fallback')
    await expect(button).toBeVisible()
    await expect(button).toHaveText(/Search YouTube/)
  })

  test('offers the subtle variant alongside good results', async ({ page }) => {
    await stubAllProviders(page)
    await page.goto('/search?q=night')
    await expect(page.getByTestId('youtube-fallback-more')).toBeVisible()
    await expect(page.getByTestId('youtube-fallback')).toHaveCount(0)
  })

  test('labels the results as YouTube and never merges them into Songs', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=nothing here')
    await page.getByTestId('youtube-fallback').click()

    await expect(page.getByRole('heading', { name: /YouTube results/ })).toBeVisible()
    await expect(page.locator(rows)).toHaveCount(4)
    await expect(page.locator('.song-row')).toHaveCount(0)
  })

  test('attributes every row and links to the real watch page', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=nothing here')
    await page.getByTestId('youtube-fallback').click()
    await expect(page.locator(rows).first()).toBeVisible()

    const links = page.locator(`${rows} a`)
    await expect(links).toHaveCount(4)
    for (let index = 0; index < 4; index += 1) {
      const link = links.nth(index)
      await expect(link).toHaveText(/YouTube/)
      await expect(link).toHaveAttribute('href', /^https:\/\/www\.youtube\.com\/watch\?v=/)
      // `noreferrer` would suppress the Referer YouTube requires.
      const rel = (await link.getAttribute('rel')) ?? ''
      expect(rel).not.toContain('noreferrer')
    }
  })

  test('shows the thumbnail unmodified in a 16:9 box', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=nothing here')
    await page.getByTestId('youtube-fallback').click()

    const thumb = page.locator('[data-testid="youtube-thumbnail"]').first()
    await expect(thumb).toBeVisible()
    const box = await thumb.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1)
    // `contain`, not `cover`: the image is never cropped to fill the frame.
    const fit = await thumb.locator('img').evaluate((img) => getComputedStyle(img).objectFit)
    expect(fit).toBe('contain')
  })
})

test.describe('the visible player', () => {
  test.beforeEach(async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=nothing here')
    await page.getByTestId('youtube-fallback').click()
    await expect(page.locator(rows).first()).toBeVisible()
  })

  test('appears, visible and above the documented minimum size', async ({ page }) => {
    await page.locator(rows).first().click()

    await expect(page.locator(surface)).toBeVisible()
    const rendered = await stageHitTest(page)
    expect(rendered.width).toBeGreaterThanOrEqual(200)
    expect(rendered.height).toBeGreaterThanOrEqual(200)
  })

  test('holds one real iframe, with nothing drawn over it', async ({ page }) => {
    await page.locator(rows).first().click()
    await expect(page.locator(`${stage} iframe`)).toHaveCount(1)

    // Nothing else is inside the stage, and nothing paints on top of its centre.
    const childCount = await page.locator(stage).evaluate((node) => node.children.length)
    expect(childCount).toBe(1)

    const topmostIsIframe = await page.locator(stage).evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return el?.tagName.toLowerCase() === 'iframe'
    })
    expect(topmostIsIframe).toBe(true)
  })

  test('keeps native controls on and passes only documented playerVars', async ({ page }) => {
    await page.locator(rows).first().click()
    await expect(page.locator(`${stage} iframe`)).toHaveCount(1)

    const vars = (await page.evaluate(readYouTubeGlobals)).playerVars ?? {}
    expect(vars.controls).toBe(1)
    expect(vars.autoplay).toBe(0)
    expect(vars.enablejsapi).toBe(1)
    expect(vars.playsinline).toBe(1)
    expect(typeof vars.origin).toBe('string')
    // Deprecated and no-op parameters are not sent.
    expect(vars).not.toHaveProperty('modestbranding')
  })

  /**
   * The production build has no debug mode, and this is the build that proves
   * it: these specs run against `vite preview` of the real bundle, where
   * `import.meta.env.DEV` is false.
   *
   * The diagnostic readout existed to place one hand-off failure on a physical
   * phone. That is done, and it is not something to leave switchable in a music
   * player — a visitor pasting a URL should not land on a monospace table of
   * engineering measurements sitting on top of their music.
   */
  test('shows no diagnostic panel in production, even with ?debugPlayback=1', async ({ page }) => {
    const traced: string[] = []
    page.on('console', (message) => {
      if (message.text().includes('[pulse:playback]')) traced.push(message.text())
    })

    await page.goto('/search?q=nothing here&debugPlayback=1')
    await page.getByTestId('youtube-fallback').click()
    await page.locator(rows).first().click()
    await expect(page.locator(`${stage} iframe`)).toHaveCount(1)

    // The product UI, on whichever viewport this project runs.
    const sheet = page.getByRole('dialog', { name: /now playing/i })
    await expect(sheet).toBeVisible()
    await expect(page.locator(surface)).toBeVisible()
    await expect(sheet.getByRole('button', { name: /^(Play|Pause)$/ })).toBeVisible()
    await expect(sheet.getByRole('slider', { name: /seek/i })).toBeVisible()

    // And none of the instrument: no panel, no leftover container, no labels.
    await expect(page.locator('.playback-debug')).toHaveCount(0)
    await expect(page.getByLabel('Playback diagnostics')).toHaveCount(0)
    for (const label of ['iframe autoplay', 'player creation', 'withheld', 'wait ended']) {
      await expect(sheet.getByText(label, { exact: true })).toHaveCount(0)
    }
    // Nor a gap where it used to be: nothing in the sheet is an empty box.
    await expect(sheet.locator('dl')).toHaveCount(0)

    // The console stays quiet too.
    expect(traced).toEqual([])
  })

  test('keeps the close control outside the iframe', async ({ page }) => {
    await page.locator(rows).first().click()
    await expect(page.locator(`${stage} iframe`)).toHaveCount(1)

    // Dismissing is a mini-player control, deliberately not sitting beside the
    // collapse chevron: a cross where a chevron belongs is how a visitor loses
    // their place by pressing the obvious thing.
    await collapseSheet(page)
    const close = page.getByRole('button', { name: /Close the YouTube player/ })
    const insideStage = await close.evaluate((node) =>
      Boolean(node.closest('[data-testid="youtube-stage"]')),
    )
    expect(insideStage).toBe(false)
  })

  /**
   * The cross lives on the bar, and the expanded sheet is centred over the
   * bar's control cluster — so reaching it means bringing the sheet down first,
   * at every width. Collapsing already pauses the video; dismissing is the
   * separate, stronger step that releases the item altogether and destroys the
   * player rather than leaving one loaded and unseen.
   */
  test('closing releases the player and leaves nothing loaded', async ({ page }) => {
    await page.locator(rows).first().click()
    await expect(page.locator(`${stage} iframe`)).toHaveCount(1)

    await collapseSheet(page)
    await page.getByRole('button', { name: /Close the YouTube player/ }).click()

    await expect(page.locator(surface)).toHaveCount(0)
    // Nothing is left loaded behind it either: this search had no audio track
    // underneath, so the bar goes with the item it was describing.
    await expect(page.locator('.music-player')).toHaveCount(0)

    const state = await page.evaluate(readYouTubeGlobals)
    expect(state.playing).toBe(false)
    expect(state.destroyed).toBeGreaterThan(0)
  })

  /** Exactly what a phone sends when the app is backgrounded or the screen locks. */
  const setDocumentHidden = (page: Page, hidden: boolean) =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', {
        value: value ? 'hidden' : 'visible',
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
    }, hidden)

  test('pauses when the document becomes hidden', async ({ page }) => {
    await page.locator(rows).first().click()
    await expect(page.locator(`${stage} iframe`)).toHaveCount(1)
    await expect.poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.playing)).toBe(true)

    await setDocumentHidden(page, true)

    await expect.poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.playing)).toBe(false)
  })

  /**
   * The other half of the same rule.
   *
   * Coming back to the app and finding the audio still going and the video
   * silently stopped is the behaviour that was reported, and it reads as a bug
   * because the visitor never pressed pause. The pause itself is untouched —
   * nothing plays while the app is away.
   */
  test('picks the video back up when the app returns', async ({ page }) => {
    await page.locator(rows).first().click()
    await expect.poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.playing)).toBe(true)

    await setDocumentHidden(page, true)
    await expect.poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.playing)).toBe(false)

    await setDocumentHidden(page, false)

    await expect.poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.playing)).toBe(true)
    // And without the background explanation flashing up to explain something
    // that is in the middle of being undone.
    await expect(page.locator('.player-policy')).toHaveCount(0)
  })

  test('leaves a video the visitor paused exactly as they left it', async ({ page }) => {
    await page.locator(rows).first().click()
    await expect.poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.playing)).toBe(true)

    await page.getByRole('button', { name: 'Pause' }).click()
    await expect.poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.playing)).toBe(false)
    const pressed = (await page.evaluate(readYouTubeGlobals)).playCalls

    await setDocumentHidden(page, true)
    await setDocumentHidden(page, false)

    // Not resumed, and not even asked to play: their pause is their decision.
    expect((await page.evaluate(readYouTubeGlobals)).playing).toBe(false)
    expect((await page.evaluate(readYouTubeGlobals)).playCalls).toBe(pressed)
  })

  /**
   * What survives a route change is the **player itself**, not just the loaded
   * item.
   *
   * This used to assert the opposite: the embed was mounted in the expanded
   * sheet and nowhere else, so collapsing destroyed it by design and a route
   * change left only the store's idea of which video was loaded. The stage is a
   * stable child of the player shell now, and the shell is rendered once above
   * the router, so both collapsing and navigating are changes of view around a
   * player that never stops.
   */
  test('keeps the video playing across a collapse and a route change', async ({ page }) => {
    await page.locator(rows).first().click()
    await expect(page.locator(surface)).toBeVisible()
    const players = (await page.evaluate(readYouTubeGlobals)).created

    await collapseSheet(page)
    const title = await page.locator('.player-track b').innerText()

    await page.locator('.brand').click()
    await expect(page).toHaveURL(/\/$/)

    // Same bar, same title, same single player — not a rebuilt one.
    await expect(page.locator('.player-track b')).toHaveText(title)
    await expect(page.locator(surface)).toBeVisible()
    await expect(page.locator(`${stage} iframe`)).toHaveCount(1)
    expect((await page.evaluate(readYouTubeGlobals)).created).toBe(players)
    await expect
      .poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.lastVideoId))
      .toBe('aaaaaaaaaaa')
  })
})

test.describe('audio is unaffected by any of that', () => {
  /**
   * The regression guard for the rule above.
   *
   * The background pause and the resume that undoes it are YouTube's alone. An
   * `HTMLAudioElement` has no such restriction — the browser keeps it playing
   * while the app is away — and nothing in this application pauses it on the way
   * out or presses play on the way back.
   */
  test('a track keeps playing across a background and a return', async ({ page }) => {
    await stubProviders(page)
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect.poll(() => page.evaluate(audioState).then((s) => s.paused)).toBe(false)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect((await page.evaluate(audioState)).paused).toBe(false)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect((await page.evaluate(audioState)).paused).toBe(false)
  })
})

test.describe('provider transitions', () => {
  test('YouTube pauses the audio element', async ({ page }) => {
    await stubAllProviders(page)
    await page.goto('/search?q=night')

    // Audius/Jamendo first.
    await page.locator('.song-row').first().click()
    await expect.poll(() => page.evaluate(audioState).then((state) => state.paused)).toBe(false)

    // Then YouTube: the audio element must stop, and the video's own view opens,
    // because that is the only place the embed is ever mounted.
    await page.getByTestId('youtube-fallback-more').click()
    await expect(page.locator(rows).first()).toBeVisible()
    await page.locator(rows).first().click()
    await expect(page.locator(surface)).toBeVisible()
    await expect.poll(() => page.evaluate(audioState).then((state) => state.paused)).toBe(true)
    await expect.poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.playing)).toBe(true)
  })

  /**
   * Starting a track *while the video is still running* is what proves the
   * handover, and collapsing is now the ordinary route back to the list at every
   * width — it changes the view and leaves the player alone, so the video is
   * genuinely still playing when the row is pressed.
   */
  test('starting audio stops the video', async ({ page }) => {
    await stubAllProviders(page)
    await page.goto('/search?q=night')
    await page.getByTestId('youtube-fallback-more').click()
    await expect(page.locator(rows).first()).toBeVisible()
    await page.locator(rows).first().click()
    await expect(page.locator(surface)).toBeVisible()
    await expect.poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.playing)).toBe(true)

    await collapseSheet(page)
    await expect.poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.playing)).toBe(true)

    await page.locator('.song-row').first().click()
    await expect.poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.playing)).toBe(false)
    await expect.poll(() => page.evaluate(audioState).then((state) => state.paused)).toBe(false)
  })

  test('a YouTube URL never reaches the audio element', async ({ page }) => {
    await stubAllProviders(page)
    await page.goto('/search?q=night')
    await page.getByTestId('youtube-fallback-more').click()
    await page.locator(rows).first().click()
    await expect(page.locator(surface)).toBeVisible()

    const state = await page.evaluate(audioState)
    expect(state.src).not.toMatch(/youtube|ytimg|googlevideo/)
  })

  /**
   * The claim is that the *same* player takes the second video, which needs the
   * first still mounted when the second is picked. Collapsing keeps it mounted —
   * it is a change of view over a running player — so the route to row two is
   * the same at every width now, and the count stays meaningful.
   */
  test('YouTube to YouTube reuses the single player', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=nothing here')
    await page.getByTestId('youtube-fallback').click()

    await page.locator(rows).nth(0).click()
    await expect(page.locator(`${stage} iframe`)).toHaveCount(1)
    await collapseSheet(page)
    await page.locator(rows).nth(1).click()

    await expect
      .poll(() => page.evaluate(readYouTubeGlobals).then((g) => g.lastVideoId))
      .toBe('bbbbbbbbbbb')
    // One player object built, one iframe in the document: the second video was
    // loaded into the first player rather than handed a new one.
    expect(await page.evaluate(readYouTubeGlobals).then((g) => g.created)).toBe(1)
    await expect(page.locator(`${stage} iframe`)).toHaveCount(1)
  })
})

test.describe('made-for-kids and non-embeddable results', () => {
  test.beforeEach(async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=nothing here')
    await page.getByTestId('youtube-fallback').click()
    await expect(page.locator(rows).first()).toBeVisible()
  })

  test('stay visible and openable on YouTube, with no in-app play control', async ({ page }) => {
    const kids = page.locator(rows).filter({ hasText: 'Night Songs For Kids' })
    await expect(kids).toHaveCount(1)
    await expect(kids).toHaveAttribute('data-embeddable', 'false')
    await expect(kids.getByRole('button')).toHaveCount(0)
    await expect(kids.getByRole('link')).toHaveAttribute('href', /watch\?v=ccccccccccc/)
    await expect(kids).toContainText(/made for kids/i)
  })

  test('never build a player, even if the row is clicked', async ({ page }) => {
    await page.locator(rows).filter({ hasText: 'Night Songs For Kids' }).click()
    await expect(page.locator(surface)).toHaveCount(0)
    expect(await page.evaluate(readYouTubeGlobals).then((g) => g.created ?? 0)).toBe(0)
  })

  test('a video with embedding disabled behaves the same way', async ({ page }) => {
    const blocked = page.locator(rows).filter({ hasText: 'Night Vault Session' })
    await expect(blocked).toHaveAttribute('data-embeddable', 'false')
    await expect(blocked).toContainText(/turned off embedding/i)
  })
})

test.describe('degraded states', () => {
  test('a deployment with no key says so and keeps the catalogues working', async ({ page }) => {
    await stubAllProviders(page, { youtube: { unavailable: true } })
    await page.goto('/search?q=night')

    await expect(page.locator('.song-row').first()).toBeVisible()
    const before = await page.locator('.song-row').count()

    await page.getByTestId('youtube-fallback-more').click()
    await expect(page.getByText(/not available on this deployment/i)).toBeVisible()
    await expect(page.locator('.song-row')).toHaveCount(before)
  })

  test('an exhausted quota shows the documented message', async ({ page }) => {
    await stubAllProviders(page, {
      audius: { emptySearch: true },
      jamendo: { empty: true },
      youtube: { quotaExceeded: true },
    })
    await page.goto('/search?q=nothing here')
    await page.getByTestId('youtube-fallback').click()

    await expect(
      page.getByText('YouTube search is temporarily unavailable. Try again later.'),
    ).toBeVisible()
  })
})

test.describe('privacy disclosure', () => {
  test('is reachable and states what YouTube receives', async ({ page }) => {
    await stubProviders(page)
    await page.goto('/')

    await page.locator('.site-footer').getByRole('link', { name: 'Privacy' }).click()
    await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible()
    await expect(page.getByText(/YouTube and Google may receive your IP address/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /Google privacy policy/i })).toHaveAttribute(
      'href',
      'https://policies.google.com/privacy',
    )
  })

  test('loads no YouTube player on first paint', async ({ page }) => {
    await stubAllProviders(page)
    const traffic = recordYouTubeTraffic(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Trending/i }).first()).toBeVisible()

    expect(traffic).toEqual([])
    expect(await page.evaluate(() => 'YT' in window)).toBe(false)
  })
})

test.describe('open-catalog confidence drives the fallback', () => {
  /**
   * The three rows the live Jamendo catalogue really returned for
   * `aram asatryan`. Each shares only the generic token `aram` with the query
   * and carries no evidence at all for `asatryan`.
   *
   * Before the coverage rule one of them became Top Result, and the mere fact
   * that *some* row existed pushed the YouTube fallback into its subtle
   * variant — hiding the prominent one at the exact moment it was needed.
   */
  const ARAM_NOISE = [
    { id: 'n1', title: "Eternos Rivales - Fil d'aram", artist: 'Eternos Rivales', duration: 8 },
    { id: 'n2', title: '01. Meteo sombre (prod. Aram)', artist: 'L.IAM', duration: 8 },
    { id: 'n3', title: 'Orom Aram', artist: 'Joel Vanoli', duration: 8 },
  ]

  test('weak rows produce the prominent Search YouTube, not a Top Result', async ({ page }) => {
    await stubAllProviders(page, {
      audius: { emptySearch: true },
      jamendo: { tracks: ARAM_NOISE },
    })
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/search?q=aram asatryan')

    await expect(page.getByTestId('youtube-fallback')).toBeVisible()
    await expect(page.getByTestId('youtube-fallback-more')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Top result' })).toHaveCount(0)
    await expect(page.locator('.song-row')).toHaveCount(0)
    await expect(
      page.getByText(/Nothing in the Audius or Jamendo catalogues strongly matched/i),
    ).toBeVisible()

    // Reaching that state costs no quota.
    expect(traffic).toEqual([])
  })

  test('none of the weak titles is rendered at all', async ({ page }) => {
    await stubAllProviders(page, {
      audius: { emptySearch: true },
      jamendo: { tracks: ARAM_NOISE },
    })
    await page.goto('/search?q=aram asatryan')
    await expect(page.getByTestId('youtube-fallback')).toBeVisible()

    for (const spec of ARAM_NOISE) {
      await expect(page.getByText(spec.title, { exact: false })).toHaveCount(0)
    }
  })

  test('pressing the prominent fallback runs exactly one YouTube search', async ({ page }) => {
    await stubAllProviders(page, {
      audius: { emptySearch: true },
      jamendo: { tracks: ARAM_NOISE },
    })
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/search?q=aram asatryan')
    await page.getByTestId('youtube-fallback').click()
    await expect(page.locator('[data-testid="youtube-result"]').first()).toBeVisible()

    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(1)
  })

  test('a genuine match still shows normal results and only the subtle variant', async ({
    page,
  }) => {
    await stubAllProviders(page, {
      audius: { emptySearch: true },
      jamendo: {
        tracks: [
          ...ARAM_NOISE,
          { id: 'g1', title: 'Barov Ari', artist: 'Aram Asatryan', duration: 8 },
        ],
      },
    })
    await page.goto('/search?q=aram asatryan')

    await expect(page.getByRole('heading', { name: 'Top result' })).toBeVisible()
    await expect(page.getByTestId('youtube-fallback-more')).toBeVisible()
    await expect(page.getByTestId('youtube-fallback')).toHaveCount(0)
    // The noise is filtered out; only the real match remains.
    await expect(page.locator('.song-row')).toHaveCount(1)
  })
})

test.describe('automatic YouTube fallback after an explicit submission', () => {
  /**
   * The frontend decision logic is **not** stubbed here. Audius, Jamendo and
   * `/api/youtube` are doubled at the network layer, but whether a request is
   * made at all — and when — is decided by the real hook, the real submission
   * signal and the real open-catalog confidence flag.
   */
  const SAWAS = [
    {
      videoId: 'sawas000001',
      title: 'Saria Al Sawas - Bas asmae Mini video clip',
      channelTitle: 'Saria Al Sawas',
    },
    {
      videoId: 'sawas000002',
      title: 'Saria Al Sawas feat. Kosaik Haulii - Wajeh El Goumar',
      channelTitle: 'Saria Al Sawas',
    },
    { videoId: 'sawas000003', title: 'Ma Mallet', channelTitle: 'Saria Al Sawas - Topic' },
  ]

  /** Types into the real search control and presses Enter — the explicit submit. */
  async function submit(page: import('@playwright/test').Page, query: string) {
    const field = page.getByLabel('Search songs and artists')
    await field.click()
    await field.fill(query)
    await field.press('Enter')
  }

  test('makes zero requests before submit and exactly one after', async ({ page }) => {
    await stubAllProviders(page, {
      audius: { emptySearch: true },
      jamendo: { empty: true },
      youtube: { videos: SAWAS },
    })
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/')
    const field = page.getByLabel('Search songs and artists')
    await field.click()
    await field.fill('sara al sawas')

    // The debounced Audius + Jamendo search settles on its own first.
    await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()
    await expect(page.getByTestId('youtube-fallback')).toBeVisible()
    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(0)

    await field.press('Enter')

    await expect(page.locator(rows).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /YouTube results/ })).toBeVisible()
    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(1)
  })

  test('renders the YouTube rows without a second click', async ({ page }) => {
    await stubAllProviders(page, {
      audius: { emptySearch: true },
      jamendo: { empty: true },
      youtube: { videos: SAWAS },
    })
    await page.goto('/')
    await submit(page, 'sara al sawas')

    await expect(page.locator(rows)).toHaveCount(3)
    await expect(page.getByText('Saria Al Sawas - Bas asmae Mini video clip')).toBeVisible()
    // No leftover failure headline above real results.
    await expect(page.getByText('No strong matches found.')).toHaveCount(0)
  })

  test('a strong open-catalog match makes zero automatic requests', async ({ page }) => {
    await stubAllProviders(page)
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/')
    await submit(page, 'night')

    await expect(page.getByRole('heading', { name: 'Top result' })).toBeVisible()
    await expect(page.locator('.song-row').first()).toBeVisible()
    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(0)

    // The manual control still works, and costs exactly one search.
    await page.getByTestId('youtube-fallback-more').click()
    await expect(page.locator(rows).first()).toBeVisible()
    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(1)
  })

  test('search-as-you-type never spends a search, however long the phrase', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/')
    const field = page.getByLabel('Search songs and artists')
    await field.click()
    // Typed slowly enough that the debounce settles more than once on the way.
    await field.pressSequentially('sara al sawas', { delay: 120 })

    await expect(page.getByTestId('youtube-fallback')).toBeVisible()
    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(0)
  })

  test('a deep link keeps the manual control and spends nothing', async ({ page }) => {
    // Opening a URL directly is not an in-app submission: the prominent button
    // is offered, and nothing is spent until it is pressed.
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/search?q=sara al sawas')

    await expect(page.getByTestId('youtube-fallback')).toBeVisible()
    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(0)

    await page.getByTestId('youtube-fallback').click()
    await expect(page.locator(rows).first()).toBeVisible()
    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(1)
  })
})

test.describe('the reported Aram Asatryan submission', () => {
  /**
   * The catalogues answer, but with nothing that means anything.
   *
   * This is the exact live data: Audius returns one row whose title, uploader
   * and handle contain neither `aram` nor `asatryan` (it is tagged with them,
   * and tags are deliberately not scored), and Jamendo returns three rows that
   * share only the generic token `aram`. Every one of them is weak — verified
   * against the real scorer, not assumed — so an explicit submission must spend
   * exactly one YouTube search.
   *
   * The distinction that matters here is the one the earlier tests in this file
   * do not cover: the catalogues are **not empty**. They answered; they just did
   * not answer *this*.
   */
  const ARAM_JAMENDO = [
    { id: 'n1', title: "Eternos Rivales - Fil d'aram", artist: 'Eternos Rivales', duration: 8 },
    { id: 'n2', title: '01. Meteo sombre (prod. Aram)', artist: 'L.IAM', duration: 8 },
    { id: 'n3', title: 'Orom Aram', artist: 'Joel Vanoli', duration: 8 },
  ]

  const ARAM_VIDEOS = [
    { videoId: 'aram0000001', title: 'Sourp Sarkis', channelTitle: 'Aram Asatryan - Topic' },
    { videoId: 'aram0000002', title: 'Barov Ari', channelTitle: 'Aram Asatryan - Topic' },
  ]

  async function stubAram(page: import('@playwright/test').Page) {
    await stubAllProviders(page, {
      audius: { emptySearch: true },
      jamendo: { tracks: ARAM_JAMENDO },
      youtube: { videos: ARAM_VIDEOS },
    })
  }

  test('an explicit submission runs the fallback exactly once, unprompted', async ({ page }) => {
    await stubAram(page)
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/')
    const field = page.getByLabel('Search songs and artists')
    await field.click()
    await field.fill('aram asatryan')
    await field.press('Enter')

    await expect(page.locator(rows).first()).toBeVisible()
    await expect(page.getByText('Sourp Sarkis')).toBeVisible()
    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(1)
    // No manual button left over: it already ran.
    await expect(page.getByTestId('youtube-fallback')).toHaveCount(0)
  })

  test('typing the whole phrase spends nothing and keeps the manual control', async ({ page }) => {
    await stubAram(page)
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/')
    const field = page.getByLabel('Search songs and artists')
    await field.click()
    await field.fill('aram asatryan')

    await expect(page.getByTestId('youtube-fallback')).toBeVisible()
    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(0)
  })

  test('submitting the same phrase twice still spends only one search', async ({ page }) => {
    await stubAram(page)
    const traffic = recordYouTubeTraffic(page)

    await page.goto('/')
    const field = page.getByLabel('Search songs and artists')
    await field.click()
    await field.fill('aram asatryan')
    await field.press('Enter')
    await expect(page.locator(rows).first()).toBeVisible()

    await field.press('Enter')
    await page.waitForTimeout(500)

    expect(traffic.filter((url) => url.includes('/api/youtube'))).toHaveLength(1)
  })
})
