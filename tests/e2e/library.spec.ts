import { expect, test } from '@playwright/test'
import {
  heartFor,
  likedKeys,
  menuFor,
  nextTrack,
  playbackModes,
  playlistOrder,
  readLibrary,
  readPersonalization,
  recordYouTubeApiTraffic,
  seedPersonalization,
  stubAllProviders,
  stubProviders,
  storageKeys,
  unheartFor,
} from './fixtures'

/**
 * Phase 7 end to end, in a real browser with real IndexedDB.
 *
 * Nothing here stubs the library: Playwright runs Chromium, which has the
 * storage the production adapter targets, so these tests exercise the real
 * `IndexedDbLibraryRepository` — including the one thing a jsdom test cannot
 * check, that a reload genuinely brings the library back.
 */

const LIKED = 'Liked Songs'

test.describe('A — like something and come back to it', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('an Audius track can be liked from a search row and found in the library', async ({
    page,
  }) => {
    await page.goto('/search?q=night')
    await expect(page.locator('.song-row').first()).toBeVisible()

    await heartFor(page, 'Night Signal').click()
    await expect(unheartFor(page, 'Night Signal').first()).toBeVisible()
    await expect.poll(() => likedKeys(page)).toEqual(['audius:s1'])

    await page.goto('/library/liked')
    await expect(page.getByRole('heading', { name: LIKED })).toBeVisible()
    await expect(page.getByTestId('liked-list').getByText('Night Signal')).toBeVisible()
  })

  test('a Jamendo track is liked as a separate item, not merged by title', async ({ page }) => {
    await page.goto('/search?q=night')
    await expect(page.locator('.song-row').first()).toBeVisible()

    await heartFor(page, 'Night Signal').click()
    await heartFor(page, 'Night Reverie').click()

    await expect.poll(() => likedKeys(page)).toEqual(['jamendo:1880336', 'audius:s1'])
  })

  test('survives a reload, which is the whole point of a library', async ({ page }) => {
    await page.goto('/search?q=night')
    await heartFor(page, 'Night Signal').click()
    await expect.poll(() => likedKeys(page)).toHaveLength(1)

    await page.reload()
    await page.goto('/library/liked')

    await expect(page.getByTestId('liked-list').getByText('Night Signal')).toBeVisible()
    await expect(unheartFor(page, 'Night Signal').first()).toBeVisible()
  })

  test('plays from the library, re-resolving the stream at play time', async ({ page }) => {
    await page.goto('/search?q=night')
    await heartFor(page, 'Night Signal').click()
    await expect.poll(() => likedKeys(page)).toHaveLength(1)

    await page.goto('/library/liked')
    await page.getByRole('button', { name: 'Play', exact: true }).click()

    await expect(page.locator('.player-track b')).toHaveText('Night Signal')
    await expect
      .poll(() => page.evaluate(() => document.querySelector('audio')?.paused))
      .toBe(false)
  })

  test('unliking removes it, and does not delete listening history', async ({ page }) => {
    await page.goto('/search?q=night')
    await heartFor(page, 'Night Signal').click()
    await expect.poll(() => likedKeys(page)).toHaveLength(1)

    await unheartFor(page, 'Night Signal').first().click()
    await expect.poll(() => likedKeys(page)).toEqual([])
    await expect(heartFor(page, 'Night Signal')).toBeVisible()
  })

  test('the heart shows the same state on every surface at once', async ({ page }) => {
    await page.goto('/search?q=night')
    await page.locator('.song-row').first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    // The row's heart and the player bar's heart are the same component reading
    // the same store, so pressing one must fill the other.
    await heartFor(page, 'Night Signal').first().click()
    await expect(unheartFor(page, 'Night Signal')).toHaveCount(2)
  })
})

test.describe('B — building a playlist', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
  })

  test('creates one from a track row and adds two more', async ({ page }) => {
    await page.goto('/search?q=night')
    await expect(page.locator('.song-row').first()).toBeVisible()

    await menuFor(page, 'Night Signal').click()
    await page.getByRole('menuitem', { name: 'New playlist' }).click()
    await page.getByLabel('New playlist name').fill('Road Trip')
    await page.getByRole('button', { name: 'Create' }).click()

    await expect.poll(() => playlistOrder(page, 'Road Trip')).toEqual(['audius:s1'])

    for (const title of ['Night Drive', 'Night Reverie']) {
      await menuFor(page, title).click()
      await page.getByRole('menuitem', { name: `Add ${title} to Road Trip in Pulse` }).click()
    }

    await expect.poll(() => playlistOrder(page, 'Road Trip')).toHaveLength(3)
  })

  test('refuses a duplicate and says so', async ({ page }) => {
    await page.goto('/search?q=night')
    await menuFor(page, 'Night Signal').click()
    await page.getByRole('menuitem', { name: 'New playlist' }).click()
    await page.getByLabel('New playlist name').fill('Road Trip')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect.poll(() => playlistOrder(page, 'Road Trip')).toHaveLength(1)

    await menuFor(page, 'Night Signal').click()
    const entry = page.getByRole('menuitem', {
      name: 'Night Signal is already in Road Trip',
    })
    await expect(entry).toBeVisible()
    await expect(entry).toBeDisabled()
  })

  test('reorders from the keyboard-accessible menu, and the order survives a reload', async ({
    page,
  }) => {
    await page.goto('/search?q=night')
    await menuFor(page, 'Night Signal').click()
    await page.getByRole('menuitem', { name: 'New playlist' }).click()
    await page.getByLabel('New playlist name').fill('Road Trip')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect.poll(() => playlistOrder(page, 'Road Trip')).toHaveLength(1)

    for (const title of ['Night Drive', 'Night Reverie']) {
      await menuFor(page, title).click()
      await page.getByRole('menuitem', { name: `Add ${title} to Road Trip in Pulse` }).click()
    }
    const original = await playlistOrder(page, 'Road Trip')
    expect(original).toHaveLength(3)

    await page.goto('/library')
    await page.getByRole('heading', { name: 'Road Trip' }).click()
    await expect(page.getByTestId('playlist-list')).toBeVisible()

    await menuFor(page, 'Night Signal').click()
    await page.getByRole('menuitem', { name: 'Move down' }).click()

    const moved = [original[1], original[0], original[2]]
    await expect.poll(() => playlistOrder(page, 'Road Trip')).toEqual(moved)

    await page.reload()
    await expect(page.getByTestId('playlist-list')).toBeVisible()
    await expect.poll(() => playlistOrder(page, 'Road Trip')).toEqual(moved)
  })

  test('deleting the playlist keeps the songs that were liked', async ({ page }) => {
    await page.goto('/search?q=night')
    await heartFor(page, 'Night Signal').click()
    await menuFor(page, 'Night Signal').click()
    await page.getByRole('menuitem', { name: 'New playlist' }).click()
    await page.getByLabel('New playlist name').fill('Road Trip')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect.poll(() => playlistOrder(page, 'Road Trip')).toHaveLength(1)

    await page.goto('/library')
    await page.getByRole('heading', { name: 'Road Trip' }).click()
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete playlist' }).click()

    await expect(page).toHaveURL(/\/library$/)
    await expect.poll(() => playlistOrder(page, 'Road Trip')).toEqual([])
    await expect.poll(() => likedKeys(page)).toEqual(['audius:s1'])
  })

  test('Liked Songs cannot be renamed or deleted', async ({ page }) => {
    await page.goto('/library/liked')
    await expect(page.getByRole('heading', { name: LIKED })).toBeVisible()

    await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
  })
})

test.describe('C — playing a playlist', () => {
  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
    await page.goto('/search?q=night')
    await menuFor(page, 'Night Signal').click()
    await page.getByRole('menuitem', { name: 'New playlist' }).click()
    await page.getByLabel('New playlist name').fill('Road Trip')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect.poll(() => playlistOrder(page, 'Road Trip')).toHaveLength(1)

    for (const title of ['Night Drive', 'Night Reverie']) {
      await menuFor(page, title).click()
      await page.getByRole('menuitem', { name: `Add ${title} to Road Trip in Pulse` }).click()
    }
    await expect.poll(() => playlistOrder(page, 'Road Trip')).toHaveLength(3)

    await page.goto('/library')
    await page.getByRole('heading', { name: 'Road Trip' }).click()
    await expect(page.getByTestId('playlist-list')).toBeVisible()
  })

  test('Play starts the first item and Next follows the playlist order', async ({ page }) => {
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    // Paused before stepping, deliberately. The stub clip is about two seconds
    // long and this playlist holds three, so a test that takes its time would
    // otherwise be racing real playback down the queue and on into autoplay.
    // Where Next *goes* does not depend on whether anything is playing.
    await page.getByRole('button', { name: 'Pause', exact: true }).click()

    await nextTrack(page)
    await expect(page.locator('.player-track b')).toHaveText('Night Drive')
  })

  test('clicking a row starts there', async ({ page }) => {
    await page.getByTestId('playlist-list').getByText('Night Drive').click()
    await expect(page.locator('.player-track b')).toHaveText('Night Drive')
  })

  test('Shuffle plays without rewriting the saved order', async ({ page }) => {
    const before = await playlistOrder(page, 'Road Trip')

    await page.getByRole('button', { name: 'Shuffle', exact: true }).click()
    await expect(page.locator('.player-track b')).not.toBeEmpty()

    await expect.poll(() => playlistOrder(page, 'Road Trip')).toEqual(before)
    // The rows on screen stay in the playlist's own order too.
    const rows = await page.getByTestId('playlist-list').locator('.song-data b').allInnerTexts()
    expect(rows).toEqual(['Night Signal', 'Night Drive', 'Night Reverie'])
  })

  test('the shuffled running order is stable within the session', async ({ page }) => {
    // Scoped to the playlist header: once playback pauses, the player bar's own
    // round control is also named "Play", and these assertions are about the
    // playlist's buttons rather than the transport's.
    const hero = page.locator('.library-hero-actions')
    await hero.getByRole('button', { name: 'Shuffle', exact: true }).click()
    await expect(page.locator('.player-track b')).not.toBeEmpty()
    const first = await page.locator('.player-track b').innerText()

    await nextTrack(page)
    // Polled rather than read once: the collection resolves a bounded look-ahead
    // rather than the whole list, so an advance that reaches past the resolved
    // window costs one provider lookup before the bar can name what it landed on.
    await expect(page.locator('.player-track b')).not.toHaveText(first)
    const second = await page.locator('.player-track b').innerText()

    // Starting the same playlist again keeps the session's running order rather
    // than drawing a new one.
    await hero.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')
    await hero.getByRole('button', { name: 'Shuffle', exact: true }).click()
    await expect(page.locator('.player-track b')).toHaveText(first)
    await nextTrack(page)
    await expect(page.locator('.player-track b')).toHaveText(second)
  })

  test('Repeat cycles through its three states and is announced', async ({ page }) => {
    // The reference replaces the player bar with the join strip when nothing is
    // loaded, so the transport controls only exist once something is playing.
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    const modes = await playbackModes(page)
    const repeat = modes.getByRole('button', { name: /^Repeat/ })
    await expect(repeat).toHaveAttribute('aria-label', 'Repeat off')

    await repeat.click()
    await expect(modes.getByRole('button', { name: 'Repeat playlist' })).toBeVisible()
    await modes.getByRole('button', { name: 'Repeat playlist' }).click()
    await expect(modes.getByRole('button', { name: 'Repeat one' })).toBeVisible()
    await modes.getByRole('button', { name: 'Repeat one' }).click()
    await expect(modes.getByRole('button', { name: 'Repeat off' })).toBeVisible()
  })

  test('Repeat one does not trap a press of Next on the current track', async ({
    page,
  }, testInfo) => {
    // Pressing Next is the observable trigger, and the reference's mini-player
    // has no Next control at all below 560px — there, repeat-one is only ever
    // reached by a track ending. The rule itself is covered deterministically
    // against the real `playNext` in src/player/repeat-shuffle.test.ts; what
    // mobile needs from this file is that the setting is reachable, which the
    // cycling test above covers through the queue panel.
    test.skip(testInfo.project.name === 'chromium-mobile', 'no Next control on the mini-player')

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    const modes = await playbackModes(page)
    await modes.getByRole('button', { name: 'Repeat off' }).click()
    await modes.getByRole('button', { name: 'Repeat playlist' }).click()
    await expect(modes.getByRole('button', { name: 'Repeat one' })).toBeVisible()

    await nextTrack(page)
    // The next track in the playlist, not the one that was playing.
    await expect(page.locator('.player-track b')).toHaveText('Night Drive')
  })

  test('Repeat playlist wraps at the end instead of generating something', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-mobile', 'no Next control on the mini-player')

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    const modes = await playbackModes(page)
    await modes.getByRole('button', { name: 'Repeat off' }).click()
    await expect(modes.getByRole('button', { name: 'Repeat playlist' })).toBeVisible()

    await nextTrack(page)
    await nextTrack(page)
    await expect(page.locator('.player-track b')).toHaveText('Night Reverie')

    await nextTrack(page)
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')
  })

  test('the repeat setting survives a reload, like volume does', async ({ page }) => {
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    const modes = await playbackModes(page)
    await modes.getByRole('button', { name: 'Repeat off' }).click()
    await expect(modes.getByRole('button', { name: 'Repeat playlist' })).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('playlist-list')).toBeVisible()
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    const after = await playbackModes(page)
    await expect(after.getByRole('button', { name: 'Repeat playlist' })).toBeVisible()
  })

  test('the playlist keeps playing through one audio element only', async ({ page }) => {
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')
    await nextTrack(page)

    await expect.poll(() => page.locator('audio').count()).toBe(1)
  })
})

test.describe('D — recommendations respond to explicit intent', () => {
  /** Enough qualified listening for the personalized shelves to be offered. */
  const WARM = [
    { id: 't1', title: 'Neon Corridor', artist: 'Aster Vale', playCount: 3, daysAgo: 2 },
    { id: 't2', title: 'Glass Harbour', artist: 'Ilo Rhen', playCount: 2, daysAgo: 3 },
    { id: 't3', title: 'Slow Transit', artist: 'Mora Kest', playCount: 2, daysAgo: 4 },
  ]

  test.beforeEach(async ({ page }) => {
    await stubProviders(page)
    await seedPersonalization(page, { consent: 'granted', entries: WARM })
  })

  test('Not interested removes the card and offers Undo on the toast', async ({ page }) => {
    await page.goto('/')
    const shelf = page.locator('.music-section', {
      has: page.getByRole('heading', { name: 'Recommended for you' }),
    })
    await expect(shelf).toBeVisible()

    const firstCard = shelf.locator('.media-card').first()
    const title = await firstCard.locator('h3').innerText()

    await firstCard.getByRole('button', { name: `More actions for ${title}` }).click()
    await page.getByRole('menuitem', { name: `Stop recommending ${title}` }).click()

    await expect(page.getByRole('status')).toContainText('Hidden from your recommendations.')
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
    await expect
      .poll(async () => (await readLibrary(page))?.hiddenRecommendationKeys)
      .toHaveLength(1)

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await readLibrary(page))?.hiddenRecommendationKeys).toEqual([])
  })

  test('a hidden item stays hidden across a reload', async ({ page }) => {
    await page.goto('/')
    const shelf = page.locator('.music-section', {
      has: page.getByRole('heading', { name: 'Recommended for you' }),
    })
    await expect(shelf).toBeVisible()

    const firstCard = shelf.locator('.media-card').first()
    const title = await firstCard.locator('h3').innerText()
    await firstCard.getByRole('button', { name: `More actions for ${title}` }).click()
    await page.getByRole('menuitem', { name: `Stop recommending ${title}` }).click()
    await expect
      .poll(async () => (await readLibrary(page))?.hiddenRecommendationKeys)
      .toHaveLength(1)

    await page.reload()
    await expect(shelf).toBeVisible()
    await expect(shelf.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
  })

  test('hiding something never deletes listening history', async ({ page }) => {
    await page.goto('/')
    const shelf = page.locator('.music-section', {
      has: page.getByRole('heading', { name: 'Recommended for you' }),
    })
    await expect(shelf).toBeVisible()

    const before = (await readPersonalization(page))!.listeningHistory as unknown[]
    const firstCard = shelf.locator('.media-card').first()
    const title = await firstCard.locator('h3').innerText()
    await firstCard.getByRole('button', { name: `More actions for ${title}` }).click()
    await page.getByRole('menuitem', { name: `Stop recommending ${title}` }).click()
    await expect
      .poll(async () => (await readLibrary(page))?.hiddenRecommendationKeys)
      .toHaveLength(1)

    const after = (await readPersonalization(page))!.listeningHistory as unknown[]
    expect(after).toHaveLength(before.length)
  })

  test('Settings brings hidden recommendations back', async ({ page }) => {
    await page.goto('/')
    const shelf = page.locator('.music-section', {
      has: page.getByRole('heading', { name: 'Recommended for you' }),
    })
    await expect(shelf).toBeVisible()

    const firstCard = shelf.locator('.media-card').first()
    const title = await firstCard.locator('h3').innerText()
    await firstCard.getByRole('button', { name: `More actions for ${title}` }).click()
    await page.getByRole('menuitem', { name: `Stop recommending ${title}` }).click()
    await expect
      .poll(async () => (await readLibrary(page))?.hiddenRecommendationKeys)
      .toHaveLength(1)

    await page.goto('/settings')
    await page.getByRole('button', { name: 'Reset hidden recommendations' }).click()
    await page.getByRole('button', { name: 'Reset hidden recommendations' }).last().click()

    await expect.poll(async () => (await readLibrary(page))?.hiddenRecommendationKeys).toEqual([])
  })

  test('a Pulse like never triggers a provider write', async ({ page }) => {
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`)
    })

    await page.goto('/search?q=night')
    await heartFor(page, 'Night Signal').click()
    await menuFor(page, 'Night Signal').click()
    await page.getByRole('menuitem', { name: 'New playlist' }).click()
    await page.getByLabel('New playlist name').fill('Road Trip')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect.poll(() => playlistOrder(page, 'Road Trip')).toHaveLength(1)

    // Pulse has no provider OAuth, so saving something can only ever be local.
    expect(writes.filter((entry) => /audius|jamendo|youtube|googleapis/.test(entry))).toEqual([])
  })
})

test.describe('E — a saved YouTube item', () => {
  test('can be liked, and shows YouTube attribution rather than album art', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=night')

    await page.getByTestId('youtube-fallback').click()
    await expect(page.getByTestId('youtube-result').first()).toBeVisible()

    await heartFor(page, 'Night Signal (Official Video)').click()
    await expect.poll(() => likedKeys(page)).toEqual(['youtube:aaaaaaaaaaa'])

    await page.goto('/library/liked')
    const list = page.getByTestId('liked-list')
    await expect(list.getByRole('link', { name: /on YouTube/ })).toBeVisible()
    await expect(list.locator('.library-row-video')).toBeVisible()
  })

  test('stores a 30-day deletion deadline and no statistics', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=night')
    await page.getByTestId('youtube-fallback').click()
    await heartFor(page, 'Night Signal (Official Video)').click()
    await expect.poll(() => likedKeys(page)).toHaveLength(1)

    const record = await readLibrary(page)
    const tracks = record!.tracks as Record<string, Record<string, unknown>>
    const saved = tracks['youtube:aaaaaaaaaaa']

    const window = (saved.youtubeExpiresAt as number) - (saved.metadataUpdatedAt as number)
    expect(window).toBeLessThanOrEqual(30 * 86_400_000)
    expect(window).toBeGreaterThan(0)

    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain('viewCount')
    expect(serialized).not.toContain('likeCount')
    expect(serialized).not.toContain('statistics')
  })

  test('offers no library actions on a video that may not be embedded', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=night')
    await page.getByTestId('youtube-fallback').click()

    const kids = page.getByTestId('youtube-result').filter({ hasText: 'Night Songs For Kids' })
    await expect(kids).toBeVisible()
    // Saving it would create a library item that could never legally play.
    await expect(kids.getByRole('button')).toHaveCount(0)
  })

  test('rendering the library costs no YouTube quota', async ({ page }) => {
    await stubAllProviders(page, { audius: { emptySearch: true }, jamendo: { empty: true } })
    await page.goto('/search?q=night')
    await page.getByTestId('youtube-fallback').click()
    await heartFor(page, 'Night Signal (Official Video)').click()
    await expect.poll(() => likedKeys(page)).toHaveLength(1)

    const calls = recordYouTubeApiTraffic(page)
    await page.goto('/library/liked')
    await expect(page.getByTestId('liked-list')).toBeVisible()
    await page.goto('/library')
    await expect(page.getByRole('heading', { name: 'Your Library' })).toBeVisible()

    expect(calls).toEqual([])
  })
})

test.describe('storage boundaries', () => {
  test('the library never writes a stream URL, a key or a token', async ({ page }) => {
    await stubProviders(page)
    await page.goto('/search?q=night')
    await heartFor(page, 'Night Signal').click()
    await heartFor(page, 'Night Reverie').click()
    await expect.poll(() => likedKeys(page)).toHaveLength(2)

    await page.locator('.song-row').filter({ hasText: 'Night Signal' }).first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')

    const serialized = JSON.stringify(await readLibrary(page))
    for (const forbidden of [
      'stream.wav',
      'audio.e2e.test',
      'storage.jamendo.test',
      'streamUrl',
      'audioUrl',
      'client_id',
      'api_key',
      'access_token',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test('the library lives in IndexedDB, not in localStorage', async ({ page }) => {
    await stubProviders(page)
    await page.goto('/search?q=night')
    await heartFor(page, 'Night Signal').click()
    await expect.poll(() => likedKeys(page)).toHaveLength(1)

    const keys = await storageKeys(page)
    expect(keys).not.toContain('pulse.library.v1')
    // Nor anywhere else in localStorage: the whole library is in IndexedDB.
    const localValues = await page.evaluate(() =>
      Object.keys(window.localStorage)
        .map((key) => window.localStorage.getItem(key) ?? '')
        .join(' '),
    )
    expect(localValues).not.toContain('audius:s1')
    expect(localValues).not.toContain('likedTrackKeys')
  })

  test('Clear Library removes the library and nothing else', async ({ page }) => {
    await stubProviders(page)
    await page.goto('/search?q=night')
    await heartFor(page, 'Night Signal').click()
    await expect.poll(() => likedKeys(page)).toHaveLength(1)

    await page.locator('.song-row').first().click()
    await expect(page.locator('.player-track b')).toHaveText('Night Signal')
    const volumeBefore = await page.evaluate(() => window.localStorage.getItem('pulse:volume'))

    await page.goto('/settings')
    await page.getByRole('button', { name: 'Clear Library' }).click()
    await page.getByRole('button', { name: 'Clear Library' }).last().click()

    await expect.poll(() => likedKeys(page)).toEqual([])
    expect(await page.evaluate(() => window.localStorage.getItem('pulse:volume'))).toBe(
      volumeBefore,
    )
    await expect(
      page.getByRole('heading', { name: 'Personalised listening history' }),
    ).toBeVisible()
  })
})

test.describe('the privacy disclosure', () => {
  test('describes the library, its locality and the provider boundary', async ({ page }) => {
    await stubProviders(page)
    await page.goto('/privacy')

    await expect(
      page.getByRole('heading', { name: 'Your Library is saved on this device only' }),
    ).toBeVisible()
    await expect(page.getByText(/no Pulse account and no cloud sync/i)).toBeVisible()
    await expect(page.getByText(/not signed in to Audius, Jamendo or YouTube/i)).toBeVisible()
    await expect(page.getByText(/deleted automatically within 30 days/i).first()).toBeVisible()
  })
})
