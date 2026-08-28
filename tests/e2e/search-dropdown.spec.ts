import { expect, test } from '@playwright/test'
import {
  readPersonalization,
  recordYouTubeApiTraffic,
  seedPersonalization,
  stubAllProviders,
  stubAudius,
} from './fixtures'

/**
 * Phase 5 — the search history dropdown, and the Recently Played corrections it
 * inherits, in a real browser.
 */

const SEARCHES = [
  { query: 'Adele Hello', daysAgo: 0 },
  { query: 'aram asatryan', daysAgo: 1 },
  { query: 'sara al sawas', daysAgo: 2 },
]

const field = 'Search songs and artists'

/** Every Audius/Jamendo/YouTube request the page makes. */
function recordProviderTraffic(page: import('@playwright/test').Page): string[] {
  const calls: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return
    if (/i\.ytimg\.com|cn\d|audiusindex|\.jpg|\.png/.test(url)) return
    if (/api\.audius\.co|\/api\/jamendo|\/api\/youtube|googleapis\.com/.test(url)) calls.push(url)
  })
  return calls
}

test.describe('Scenario A — the dropdown opens with recent searches', () => {
  test('focusing the field reveals recent searches, most recent first', async ({ page }) => {
    await seedPersonalization(page, { searches: SEARCHES })
    await stubAudius(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()

    await page.getByLabel(field).click()

    const dropdown = page.getByTestId('search-suggestions')
    await expect(dropdown).toBeVisible()
    await expect(dropdown.locator('.suggestion-text')).toHaveText([
      'Adele Hello',
      'aram asatryan',
      'sara al sawas',
    ])
  })

  test('choosing a recent query searches it and closes the dropdown', async ({ page }) => {
    await seedPersonalization(page, { searches: SEARCHES })
    await stubAudius(page)
    await page.goto('/')
    await page.getByLabel(field).click()

    await page.getByRole('option', { name: 'Search again for aram asatryan' }).click()

    await expect(page).toHaveURL(/\/search\?q=aram(%20|\+)asatryan/)
    await expect(page.getByRole('heading', { name: /Results for “aram asatryan”/ })).toBeVisible()
    await expect(page.getByTestId('search-suggestions')).toHaveCount(0)
    await expect(page.getByLabel(field)).toHaveValue('aram asatryan')
  })

  test('the reused query moves back to the top of the history', async ({ page }) => {
    await seedPersonalization(page, { searches: SEARCHES })
    await stubAudius(page)
    await page.goto('/')
    await page.getByLabel(field).click()
    await page.getByRole('option', { name: 'Search again for sara al sawas' }).click()
    await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()

    await page.getByLabel(field).click()
    await expect(
      page.getByTestId('search-suggestions').locator('.suggestion-text').first(),
    ).toHaveText('sara al sawas')
  })

  test('Back returns to the previous search', async ({ page }) => {
    await seedPersonalization(page, { searches: SEARCHES })
    await stubAudius(page)
    await page.goto('/search?q=night')
    await expect(page.getByRole('heading', { name: /Results for “night”/ })).toBeVisible()

    // The field carries the current query, and the dropdown filters by what is
    // in it — so clearing first is what a visitor does to browse their history.
    await page.getByLabel(field).click()
    await page.getByLabel(field).fill('')
    await page.getByRole('option', { name: 'Search again for Adele Hello' }).click()
    await expect(page.getByRole('heading', { name: /Results for “Adele Hello”/ })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('heading', { name: /Results for “night”/ })).toBeVisible()
  })
})

test.describe('Scenario B — typing filters local history', () => {
  test('shows only matching history and makes no provider request to do it', async ({ page }) => {
    const calls = recordProviderTraffic(page)
    await seedPersonalization(page, { searches: SEARCHES })
    await stubAudius(page)
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Trending songs' })).toBeVisible()
    // Wait for the whole discovery load to settle, not just the first shelf —
    // otherwise its tail would be counted against the dropdown.
    await expect(page.locator('.music-section .media-card').first()).toBeVisible()
    await page.waitForLoadState('networkidle')

    // Everything discovery needed is already loaded; from here the dropdown is
    // on its own.
    calls.length = 0
    await page.getByLabel(field).click()
    await expect(page.getByTestId('search-suggestions')).toBeVisible()
    expect(calls, 'opening the dropdown made a provider request').toEqual([])

    await page.getByLabel(field).press('ArrowDown')
    await page.getByLabel(field).press('ArrowDown')
    await page.getByLabel(field).press('ArrowUp')
    expect(calls, 'arrow navigation made a provider request').toEqual([])

    await page.getByLabel(field).pressSequentially('sar', { delay: 20 })
    await expect(
      page.getByTestId('search-suggestions').locator('.suggestion-text'),
    ).toHaveText(['sara al sawas'])
    // Filtering itself is in-memory. The debounced search-as-you-type that
    // follows is pre-existing behaviour and is asserted separately.
    expect(calls, 'filtering made a provider request').toEqual([])
  })
})

test.describe('Scenario C — keyboard', () => {
  test('ArrowDown then Enter runs the highlighted search', async ({ page }) => {
    await seedPersonalization(page, { searches: SEARCHES })
    await stubAudius(page)
    await page.goto('/')

    await page.getByLabel(field).click()
    await page.getByLabel(field).press('ArrowDown')
    await expect(page.getByLabel(field)).toHaveAttribute(
      'aria-activedescendant',
      'search-suggestion-0',
    )
    await page.getByLabel(field).press('Enter')

    await expect(page.getByRole('heading', { name: /Results for “Adele Hello”/ })).toBeVisible()
  })

  test('Escape closes the dropdown and keeps focus and text', async ({ page }) => {
    await seedPersonalization(page, { searches: SEARCHES })
    await stubAudius(page)
    await page.goto('/')

    await page.getByLabel(field).click()
    await page.getByLabel(field).pressSequentially('ara', { delay: 20 })
    await page.getByLabel(field).press('Escape')

    await expect(page.getByTestId('search-suggestions')).toHaveCount(0)
    await expect(page.getByLabel(field)).toBeFocused()
    await expect(page.getByLabel(field)).toHaveValue('ara')
  })
})

test.describe('Scenario D — removing one recent search', () => {
  test('removal persists across a reload and runs no search', async ({ page }) => {
    await seedPersonalization(page, { searches: SEARCHES })
    await stubAudius(page)
    await page.goto('/')
    await page.getByLabel(field).click()

    await page
      .getByRole('button', { name: 'Remove “aram asatryan” from recent searches' })
      .click()

    await expect(page.getByTestId('search-suggestions')).toBeVisible()
    await expect(page).toHaveURL(/\/$/)

    await page.reload()
    await page.getByLabel(field).click()
    await expect(page.getByTestId('search-suggestions').locator('.suggestion-text')).toHaveText([
      'Adele Hello',
      'sara al sawas',
    ])
  })
})

test.describe('Scenario E — clearing search history', () => {
  test('clears searches, keeps Recently Played, and survives a reload', async ({ page }) => {
    await seedPersonalization(page, {
      searches: SEARCHES,
      entries: [{ id: 't1', title: 'Neon Corridor', artist: 'Aster Vale', daysAgo: 0 }],
    })
    await stubAudius(page)
    await page.goto('/')
    await page.getByLabel(field).click()

    await page.getByTestId('search-suggestions').getByRole('button', { name: 'Clear' }).click()

    const dropdown = page.getByTestId('search-suggestions')
    await expect(dropdown.locator('.suggestion-text')).toHaveCount(0)
    await expect(dropdown.getByText('Recently played')).toBeVisible()

    await page.reload()
    const stored = await readPersonalization(page)
    expect(stored?.searchHistory).toEqual([])
    expect((stored?.listeningHistory as unknown[]).length).toBe(1)
  })
})

test.describe('Scenario F — recently played in the dropdown', () => {
  test('shows compact rows and replays a catalogue track through the audio engine', async ({
    page,
  }) => {
    await seedPersonalization(page, {
      searches: SEARCHES,
      entries: [{ id: 't1', title: 'Neon Corridor', artist: 'Aster Vale', daysAgo: 0 }],
    })
    await stubAudius(page)
    await page.goto('/')
    await page.getByLabel(field).click()

    const dropdown = page.getByTestId('search-suggestions')
    await expect(dropdown.getByText('Recently played')).toBeVisible()
    await dropdown
      .getByRole('option', { name: 'Play Neon Corridor by Aster Vale from Audius' })
      .click()

    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()
    await expect(page.getByTestId('search-suggestions')).toHaveCount(0)
  })
})

test.describe('Scenario G — YouTube in the dropdown', () => {
  test('opens the iframe player and spends no Data API quota', async ({ page }) => {
    const apiCalls = recordYouTubeApiTraffic(page)
    await seedPersonalization(page, {
      searches: SEARCHES,
      entries: [
        {
          id: 'aaaaaaaaaaa',
          provider: 'youtube',
          title: 'Night Signal',
          artist: 'Aster Vale',
          daysAgo: 0,
        },
      ],
    })
    await stubAllProviders(page)
    await page.goto('/')

    await page.getByLabel(field).click()
    const dropdown = page.getByTestId('search-suggestions')
    await expect(dropdown.getByText('Night Signal')).toBeVisible()
    // Rendering the dropdown, with a YouTube row in it, costs nothing.
    expect(apiCalls).toEqual([])

    await dropdown
      .getByRole('option', { name: 'Play Night Signal by Aster Vale from YouTube' })
      .click()

    await expect(page.locator('iframe[data-e2e-youtube]')).toBeVisible()
    const audioSrc = await page.evaluate(() => document.querySelector('audio')?.src ?? '')
    expect(audioSrc).not.toContain('youtube')

    // Playing legitimately loads YouTube's own player; what must stay at zero is
    // the Data API, which is what actually spends the daily search allowance.
    expect(apiCalls.filter((url) => url.includes('/api/youtube'))).toEqual([])
    expect(apiCalls.every((url) => /youtube\.com/.test(url))).toBe(true)
  })
})

test.describe('Scenario H — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the dropdown is usable and does not overflow the viewport', async ({ page }) => {
    await seedPersonalization(page, {
      searches: SEARCHES,
      entries: [{ id: 't1', title: 'Neon Corridor', artist: 'Aster Vale', daysAgo: 0 }],
    })
    await stubAudius(page)
    await page.goto('/')

    await page.getByLabel(field).click()
    const dropdown = page.getByTestId('search-suggestions')
    await expect(dropdown).toBeVisible()

    const box = await dropdown.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    // Comfortable touch targets.
    const row = await dropdown.locator('.suggestion-row').first().boundingBox()
    expect(row!.height).toBeGreaterThanOrEqual(40)

    // The page itself must not gain a horizontal scrollbar.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflows).toBe(false)
  })

  test('a recent search can be chosen by touch', async ({ page }) => {
    await seedPersonalization(page, { searches: SEARCHES })
    await stubAudius(page)
    await page.goto('/')

    await page.getByLabel(field).click()
    await page.getByRole('option', { name: 'Search again for Adele Hello' }).click()
    await expect(page.getByRole('heading', { name: /Results for “Adele Hello”/ })).toBeVisible()
  })
})

test.describe('consent', () => {
  test('no dropdown when personalization is declined, and search still works', async ({ page }) => {
    await seedPersonalization(page, { consent: 'denied', searches: SEARCHES })
    await stubAudius(page)
    await page.goto('/')

    await page.getByLabel(field).click()
    await expect(page.getByTestId('search-suggestions')).toHaveCount(0)

    await page.getByLabel(field).fill('night')
    await page.getByLabel(field).press('Enter')
    await expect(page.getByRole('heading', { name: /Results for “night”/ })).toBeVisible()
  })
})

test.describe('Recently Played artwork and live ordering', () => {
  test('a history card renders a real image, not the placeholder', async ({ page }) => {
    await seedPersonalization(page, {
      entries: [{ id: 't1', title: 'Neon Corridor', artist: 'Aster Vale', daysAgo: 0 }],
    })
    await stubAudius(page)
    await page.goto('/')

    const shelf = page.locator('.music-section').filter({ hasText: 'Recently played' }).first()
    const img = shelf.locator('.history-card img').first()
    await expect(img).toBeVisible()
    const src = await img.getAttribute('src')
    expect(src).toMatch(/^https?:\/\//)
  })

  test('replaying an existing item moves it to first without a reload, and persists', async ({
    page,
  }) => {
    await seedPersonalization(page, {
      entries: [
        { id: 't1', title: 'Neon Corridor', artist: 'Aster Vale', daysAgo: 0 },
        { id: 't2', title: 'Glass Harbour', artist: 'Ilo Rhen', daysAgo: 2 },
      ],
    })
    await stubAudius(page)
    await page.goto('/')

    const shelf = page.locator('.music-section').filter({ hasText: 'Recently played' }).first()
    await expect(shelf.locator('.media-card h3')).toHaveText(['Neon Corridor', 'Glass Harbour'])

    // Start the older one from the shelf itself.
    const older = shelf.locator('.media-card').filter({ hasText: 'Glass Harbour' }).first()
    await older.locator('.card-play').scrollIntoViewIfNeeded()
    await older.locator('.card-play').click()

    await expect(shelf.locator('.media-card h3')).toHaveText(['Glass Harbour', 'Neon Corridor'])
    // No duplicate row.
    await expect(shelf.locator('.media-card')).toHaveCount(2)

    await page.reload()
    const afterReload = page.locator('.music-section').filter({ hasText: 'Recently played' }).first()
    await expect(afterReload.locator('.media-card h3')).toHaveText([
      'Glass Harbour',
      'Neon Corridor',
    ])
  })

  test('a brand-new track appears only once it qualifies', async ({ page }) => {
    await seedPersonalization(page, {
      entries: [{ id: 't2', title: 'Glass Harbour', artist: 'Ilo Rhen', daysAgo: 1 }],
    })
    await stubAudius(page)
    await page.goto('/')

    const shelf = page.locator('.music-section').filter({ hasText: 'Recently played' }).first()
    await expect(shelf.locator('.media-card h3')).toHaveText(['Glass Harbour'])

    // Start a track that is *not* in history and play only five seconds.
    const trending = page.locator('.music-section').filter({ hasText: 'Trending songs' }).first()
    const fresh = trending.locator('.media-card').filter({ hasText: 'Slow Transit' }).first()
    await fresh.locator('.card-play').scrollIntoViewIfNeeded()
    await fresh.locator('.card-play').click()
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()

    const drive = (seconds: number) =>
      page.evaluate(async (total) => {
        const audio = document.querySelector('audio')
        if (!audio) throw new Error('no audio element')
        for (let position = 1; position <= total; position += 1) {
          Object.defineProperty(audio, 'currentTime', {
            value: position,
            configurable: true,
            writable: true,
          })
          audio.dispatchEvent(new Event('timeupdate'))
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }, seconds)

    await drive(5)
    await expect(shelf.locator('.media-card h3')).toHaveText(['Glass Harbour'])

    await drive(40)
    await expect(shelf.locator('.media-card h3').first()).toHaveText('Slow Transit')
  })
})
