import { expect, test } from '@playwright/test'
import {
  readPersonalization,
  recordYouTubeApiTraffic,
  recordYouTubeTraffic,
  seedPersonalization,
  shelfTitles,
  stubAllProviders,
  stubAudius,
} from './fixtures'

/**
 * Phase 4 end to end, in a real browser with real `localStorage`.
 *
 * Each context starts clean — Playwright gives every test a fresh browser
 * context, so "a brand-new visitor" is the default rather than something that
 * has to be arranged. State is seeded through an init script when a *returning*
 * visitor is what is being tested.
 */

const TRENDING = 'Trending songs'
const RECOMMENDED = 'Recommended for you'
const RECENT = 'Recently played'

/** Enough qualified listening to reach the warm stage. */
const WARM = {
  entries: [
    { id: 't1', title: 'Neon Corridor', artist: 'Aster Vale', playCount: 3, daysAgo: 2 },
    { id: 't2', title: 'Glass Harbour', artist: 'Ilo Rhen', playCount: 2, daysAgo: 3 },
    { id: 't3', title: 'Slow Transit', artist: 'Mora Kest', playCount: 2, daysAgo: 4 },
  ],
}

test.describe('Scenario 1 — cold start', () => {
  test('a brand-new visitor sees the discovery dashboard', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: TRENDING })).toBeVisible()
    expect(await shelfTitles(page)).toEqual([
      TRENDING,
      'Popular artists',
      'Popular this month',
      'Popular radio',
      'Featured Charts',
    ])
  })

  test('claims no personalization it does not have', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: TRENDING })).toBeVisible()

    await expect(page.getByRole('heading', { name: RECOMMENDED })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: RECENT })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /Because you listened to/ })).toHaveCount(0)
  })

  test('offers the choice without blocking the page', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/')

    const prompt = page.getByTestId('personalization-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt.getByRole('button', { name: 'Enable' })).toBeEnabled()
    await expect(prompt.getByRole('button', { name: 'Not now' })).toBeEnabled()
    await expect(page.getByLabel('Search songs and artists')).toBeEnabled()
  })

  test('stores nothing before the choice is made', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: TRENDING })).toBeVisible()

    expect(await readPersonalization(page)).toBeNull()
  })
})

test.describe('Scenario 2 — listening creates history', () => {
  test('a real, qualifying listen appears in Recently played', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/')

    await page.getByTestId('personalization-prompt').getByRole('button', { name: 'Enable' }).click()

    // The E2E fixture tracks are 8 seconds long, so the threshold is the
    // 10-second floor — which a track that plays to the end cannot reach. The
    // engine is therefore driven directly, exactly as a longer real track would
    // drive it, rather than faking the personalization layer.
    await page.locator('.music-section').first().locator('.card-play').first().click({ force: true })
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()

    await page.evaluate(async () => {
      const audio = document.querySelector('audio')
      if (!audio) throw new Error('no audio element')
      // A real position run: the tracker credits elapsed position, not the
      // playhead, so this is the same evidence genuine playback produces.
      for (let position = 1; position <= 40; position += 1) {
        // `writable` matters: the app assigns `currentTime` itself when it loads or
        // seeks, and a non-writable data property makes that throw under strict mode.
        Object.defineProperty(audio, 'currentTime', {
          value: position,
          configurable: true,
          writable: true,
        })
        audio.dispatchEvent(new Event('timeupdate'))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    })

    await expect(page.getByRole('heading', { name: RECENT })).toBeVisible()
    const shelf = page.locator('.music-section').filter({ hasText: RECENT }).first()
    await expect(shelf.getByText('Neon Corridor')).toBeVisible()
  })

  test('a five-second play does not become a listen', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/')
    await page.getByTestId('personalization-prompt').getByRole('button', { name: 'Enable' }).click()

    await page.locator('.music-section').first().locator('.card-play').first().click({ force: true })
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()

    await page.evaluate(async () => {
      const audio = document.querySelector('audio')
      if (!audio) throw new Error('no audio element')
      for (let position = 1; position <= 5; position += 1) {
        // `writable` matters: the app assigns `currentTime` itself when it loads or
        // seeks, and a non-writable data property makes that throw under strict mode.
        Object.defineProperty(audio, 'currentTime', {
          value: position,
          configurable: true,
          writable: true,
        })
        audio.dispatchEvent(new Event('timeupdate'))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    })

    const stored = await readPersonalization(page)
    const entries = (stored?.listeningHistory ?? []) as Array<{ playCount: number }>
    expect(entries.every((entry) => entry.playCount === 0)).toBe(true)
    await expect(page.getByRole('heading', { name: RECOMMENDED })).toHaveCount(0)
  })
})

test.describe('Scenario 3 — warm profile', () => {
  test('leads with Recommended for you and Recently played', async ({ page }) => {
    await seedPersonalization(page, WARM)
    await stubAudius(page)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: RECOMMENDED })).toBeVisible()
    const titles = await shelfTitles(page)
    expect(titles[0]).toBe(RECOMMENDED)
    expect(titles[1]).toBe(RECENT)
  })

  test('reduces the prominence of the static discovery shelves', async ({ page }) => {
    await seedPersonalization(page, WARM)
    await stubAudius(page)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: RECOMMENDED })).toBeVisible()
    const titles = await shelfTitles(page)
    const trendingIndex = titles.indexOf(TRENDING)
    expect(trendingIndex === -1 || trendingIndex >= 2).toBe(true)
    expect(titles).not.toContain('Popular radio')
  })

  test('keeps the page at five shelves', async ({ page }) => {
    await seedPersonalization(page, WARM)
    await stubAudius(page)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: RECOMMENDED })).toBeVisible()
    await expect(page.locator('.music-section')).toHaveCount(5)
  })

  test('does not show the same artist more than twice in a shelf', async ({ page }) => {
    await seedPersonalization(page, WARM)
    await stubAudius(page)
    await page.goto('/')

    const shelf = page.locator('.music-section').filter({ hasText: RECOMMENDED }).first()
    await expect(shelf.locator('.media-card').first()).toBeVisible()

    const artists = await shelf.locator('.media-card p').allInnerTexts()
    for (const artist of new Set(artists)) {
      expect(artists.filter((name) => name === artist).length).toBeLessThanOrEqual(2)
    }
  })
})

test.describe('Scenario 4 — persistence', () => {
  test('history survives a full page reload', async ({ page }) => {
    await seedPersonalization(page, WARM)
    await stubAudius(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: RECOMMENDED })).toBeVisible()

    await page.reload()

    await expect(page.getByRole('heading', { name: RECOMMENDED })).toBeVisible()
    await expect(page.getByRole('heading', { name: RECENT })).toBeVisible()
  })

  test('survives navigating away and back', async ({ page }) => {
    await seedPersonalization(page, WARM)
    await stubAudius(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: RECOMMENDED })).toBeVisible()

    await page.getByLabel('Search songs and artists').fill('night')
    await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()
    await page.getByRole('button', { name: 'Clear' }).click()

    await expect(page.getByRole('heading', { name: RECOMMENDED })).toBeVisible()
  })
})

test.describe('Scenario 5 — reset', () => {
  test('clearing listening history returns the cold-start dashboard', async ({ page }) => {
    await seedPersonalization(page, WARM)
    await stubAudius(page)
    await page.goto('/settings')

    await page.getByRole('button', { name: 'Clear listening history' }).click()
    await page.getByRole('button', { name: 'Clear listening history' }).click()

    await page.goto('/')
    await expect(page.getByRole('heading', { name: TRENDING })).toBeVisible()
    await expect(page.getByRole('heading', { name: RECOMMENDED })).toHaveCount(0)
  })

  test('the reset survives a reload', async ({ page }) => {
    await seedPersonalization(page, WARM)
    await stubAudius(page)
    await page.goto('/settings')

    await page.getByRole('button', { name: 'Reset recommendations' }).click()
    await page.getByRole('button', { name: 'Reset recommendations' }).click()
    await expect(page.getByText(/Recommendations reset/)).toBeVisible()

    await page.goto('/')
    await page.reload()
    await expect(page.getByRole('heading', { name: TRENDING })).toBeVisible()
    await expect(page.getByRole('heading', { name: RECOMMENDED })).toHaveCount(0)
  })

  test('a destructive action needs two presses', async ({ page }) => {
    await seedPersonalization(page, WARM)
    await stubAudius(page)
    await page.goto('/settings')

    await page.getByRole('button', { name: 'Clear listening history' }).click()
    await expect(page.getByText('This cannot be undone.')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()

    const stored = await readPersonalization(page)
    expect((stored?.listeningHistory as unknown[]).length).toBe(3)
  })
})

test.describe('Scenario 6 — personalization disabled', () => {
  test('declining stores no history, even after playing and searching', async ({ page }) => {
    await stubAudius(page)
    await page.goto('/')

    await page.getByTestId('personalization-prompt').getByRole('button', { name: 'Not now' }).click()

    await page.locator('.music-section').first().locator('.card-play').first().click({ force: true })
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()
    await page.evaluate(async () => {
      const audio = document.querySelector('audio')
      if (!audio) return
      for (let position = 1; position <= 40; position += 1) {
        // `writable` matters: the app assigns `currentTime` itself when it loads or
        // seeks, and a non-writable data property makes that throw under strict mode.
        Object.defineProperty(audio, 'currentTime', {
          value: position,
          configurable: true,
          writable: true,
        })
        audio.dispatchEvent(new Event('timeupdate'))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    })

    await page.getByLabel('Search songs and artists').fill('night')
    await page.getByLabel('Search songs and artists').press('Enter')
    await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()

    await page.reload()

    const stored = await readPersonalization(page)
    expect(stored?.consent).toBe('denied')
    expect(stored?.listeningHistory).toEqual([])
    expect(stored?.searchHistory).toEqual([])
    await expect(page.getByRole('heading', { name: RECENT })).toHaveCount(0)
  })

  test('search and playback still work with personalization off', async ({ page }) => {
    await seedPersonalization(page, { consent: 'denied' })
    await stubAudius(page)
    await page.goto('/')

    await page.getByLabel('Search songs and artists').fill('night')
    await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()
    await page.locator('.song-row:not([aria-disabled="true"])').first().click()
    await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible()
  })
})

test.describe('Scenario 7 — multilingual profile', () => {
  test('responds to non-Latin searches without making an identity claim', async ({ page }) => {
    await seedPersonalization(page, {
      entries: WARM.entries,
      searches: [
        { query: 'سارية السواس', script: 'arabic', submitCount: 4 },
        { query: 'Кино Группа крови', script: 'cyrillic', submitCount: 2 },
        { query: 'Արամ Ասատրյան', script: 'armenian', submitCount: 1 },
      ],
    })
    await stubAudius(page)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: RECOMMENDED })).toBeVisible()
    await expect(page.locator('.music-section')).toHaveCount(5)

    // The signals exist; nothing on screen asserts anything about the visitor.
    const text = (await page.locator('body').innerText()).toLowerCase()
    expect(text).not.toMatch(/you are (arabic|russian|armenian)/)
    expect(text).not.toMatch(/your (nationality|ethnicity|religion|language)/)
  })

  test('preserves non-Latin queries byte-for-byte in storage', async ({ page }) => {
    await seedPersonalization(page, {
      searches: [
        { query: 'سارية السواس', script: 'arabic' },
        { query: 'Սիրուշո', script: 'armenian' },
        { query: 'кассандра', script: 'cyrillic' },
      ],
    })
    await stubAudius(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: TRENDING })).toBeVisible()

    const stored = await readPersonalization(page)
    const queries = (stored?.searchHistory as Array<{ query: string }>).map((s) => s.query)
    expect(queries).toContain('سارية السواس')
    expect(queries).toContain('Սիրուշո')
    expect(queries).toContain('кассандра')
  })
})

test.describe('Scenario 8 — YouTube', () => {
  test('a retained entry appears as YouTube, with its 16:9 thumbnail', async ({ page }) => {
    await seedPersonalization(page, {
      entries: [
        {
          id: 'aaaaaaaaaaa',
          provider: 'youtube',
          title: 'Night Signal (Official Video)',
          artist: 'Aster Vale',
          daysAgo: 0,
        },
      ],
    })
    await stubAllProviders(page)
    await page.goto('/')

    const shelf = page.locator('.music-section').filter({ hasText: RECENT }).first()
    await expect(shelf.getByText('Night Signal (Official Video)')).toBeVisible()
    await expect(shelf.getByRole('link', { name: /on YouTube/ })).toBeVisible()
    await expect(shelf.locator('.yt-thumb-fill')).toBeVisible()
  })

  test('plays through the iframe player, never the audio element', async ({ page }) => {
    await seedPersonalization(page, {
      entries: [
        { id: 'aaaaaaaaaaa', provider: 'youtube', title: 'Night Signal', artist: 'Aster Vale', daysAgo: 0 },
      ],
    })
    await stubAllProviders(page)
    await page.goto('/')

    const shelf = page.locator('.music-section').filter({ hasText: RECENT }).first()
    await shelf.locator('.card-play').first().click({ force: true })

    await expect(page.locator('iframe[data-e2e-youtube]')).toBeVisible()
    const audioSrc = await page.evaluate(() => document.querySelector('audio')?.src ?? '')
    expect(audioSrc).not.toContain('youtube')
    expect(audioSrc).not.toContain('ytimg')
  })

  test('an expired entry has disappeared', async ({ page }) => {
    await seedPersonalization(page, {
      entries: [
        {
          id: 'expired1234',
          provider: 'youtube',
          title: 'Long Gone Video',
          artist: 'Old Channel',
          daysAgo: 1,
          storedDaysAgo: 45,
        },
        { id: 't1', title: 'Neon Corridor', artist: 'Aster Vale', daysAgo: 2 },
      ],
    })
    await stubAllProviders(page)
    await page.goto('/')

    const shelf = page.locator('.music-section').filter({ hasText: RECENT }).first()
    await expect(shelf.getByText('Neon Corridor')).toBeVisible()
    await expect(page.getByText('Long Gone Video')).toHaveCount(0)

    // The purge reaches disk, not just the render.
    const stored = await readPersonalization(page)
    const ids = (stored?.listeningHistory as Array<{ providerItemId: string }>).map(
      (entry) => entry.providerItemId,
    )
    expect(ids).not.toContain('expired1234')
  })

  test('loading Home spends no YouTube quota, however much is stored', async ({ page }) => {
    const apiCalls = recordYouTubeApiTraffic(page)
    const allCalls = recordYouTubeTraffic(page)
    await seedPersonalization(page, {
      entries: [
        { id: 'aaaaaaaaaaa', provider: 'youtube', title: 'Night Signal', artist: 'Aster Vale', daysAgo: 0 },
        ...WARM.entries,
      ],
      searches: [{ query: 'night signal', submitCount: 5 }],
    })
    await stubAllProviders(page)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: RECOMMENDED })).toBeVisible()
    await expect(page.locator('.music-section')).toHaveCount(5)
    await page.reload()
    await expect(page.getByRole('heading', { name: RECOMMENDED })).toBeVisible()

    // Not one request to the YouTube Data API, the IFrame player script or the
    // media CDN — across two full page loads, with a YouTube item on screen.
    expect(apiCalls).toEqual([])

    // The only YouTube traffic at all is the thumbnail, loaded from YouTube's
    // own CDN because the policies require the image to be shown unmodified
    // rather than copied or re-hosted. It costs no quota.
    expect(allCalls.every((url) => url.startsWith('https://i.ytimg.com/'))).toBe(true)
  })
})

test.describe('storage safety', () => {
  test('persists no secret of any kind', async ({ page }) => {
    await seedPersonalization(page, {
      entries: [
        ...WARM.entries,
        { id: 'aaaaaaaaaaa', provider: 'youtube', title: 'Night Signal', artist: 'Aster Vale', daysAgo: 0 },
      ],
      searches: [{ query: 'night' }],
    })
    await stubAllProviders(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: RECOMMENDED })).toBeVisible()

    const everything = await page.evaluate(() =>
      Object.keys(window.localStorage)
        .map((key) => `${key}=${window.localStorage.getItem(key) ?? ''}`)
        .join('\n')
        .toLowerCase(),
    )

    for (const forbidden of [
      'apikey',
      'youtube_api_key',
      'jamendo_client_id',
      'clientsecret',
      'authorization',
      'streamurl',
      'bearer',
      'viewcount',
      'likecount',
      'googlevideo.com',
    ]) {
      expect(everything, `storage contained "${forbidden}"`).not.toContain(forbidden)
    }
  })

  test('a corrupt stored value does not break the app', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('pulse.personalization.v1', '{"listeningHistory": [')
    })
    await stubAudius(page)

    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto('/')
    await expect(page.getByRole('heading', { name: TRENDING })).toBeVisible()
    await expect(page.getByLabel('Search songs and artists')).toBeEnabled()
    expect(errors).toEqual([])
  })

  test('a payload from a newer build is left alone, not reinterpreted', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'pulse.personalization.v1',
        JSON.stringify({ version: 999, listeningHistory: [{ marker: 'from-the-future' }] }),
      )
    })
    await stubAudius(page)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: TRENDING })).toBeVisible()
    await expect(page.getByRole('heading', { name: RECOMMENDED })).toHaveCount(0)

    const raw = await page.evaluate(() =>
      window.localStorage.getItem('pulse.personalization.v1'),
    )
    expect(raw).toContain('from-the-future')
  })
})
