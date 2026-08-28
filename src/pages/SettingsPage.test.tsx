import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { makeEntry, makeSearch, makeState } from '@/test/fixtures/personalization'
import { HOME_SECTION_TITLES } from '@/personalization/selectors'
import { usePersonalizationStore } from '@/personalization/store'
import { PERSONALIZATION_STORAGE_KEY } from '@/personalization/types'

const populated = () =>
  makeState({
    listeningHistory: [
      makeEntry({ id: 'h1', title: 'Midnight Signal', artist: 'Nova Sound', playCount: 4, daysAgo: 1 }),
      makeEntry({ id: 'h2', title: 'Paper Lanterns', artist: 'Nova Sound', playCount: 2, daysAgo: 2 }),
    ],
    searchHistory: [makeSearch({ query: 'kosandra' })],
  })

const state = () => usePersonalizationStore.getState().state

/** Presses a destructive control and confirms it. */
async function confirmAction(user: ReturnType<typeof renderApp>['user'], name: string) {
  await user.click(await screen.findByRole('button', { name }))
  const confirm = await screen.findByRole('button', { name })
  await user.click(confirm)
}

describe('settings page', () => {
  describe('personalization switch', () => {
    it('reports that personalization is on, with what is stored', async () => {
      renderApp({ route: '/settings', personalization: populated() })
      expect(await screen.findByText(/Personalisation is on/)).toBeInTheDocument()
      expect(screen.getByText(/2 items and 1 search remembered/)).toBeInTheDocument()
    })

    it('reports that personalization is off for a browser that declined', async () => {
      renderApp({ route: '/settings', personalization: makeState({ consent: 'denied' }) })
      expect(await screen.findByText(/Personalisation is off/)).toBeInTheDocument()
    })

    it('turns personalization off and deletes what was stored', async () => {
      const { user } = renderApp({ route: '/settings', personalization: populated() })
      await user.click(await screen.findByRole('button', { name: 'Turn off' }))

      expect(state().consent).toBe('denied')
      expect(state().listeningHistory).toEqual([])
      expect(state().searchHistory).toEqual([])
      // The row itself, not the confirmation toast, which says the same thing.
      expect(await screen.findByText('Personalisation is off')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
    })

    it('turns personalization back on', async () => {
      const { user } = renderApp({
        route: '/settings',
        personalization: makeState({ consent: 'denied' }),
      })
      await user.click(await screen.findByRole('button', { name: 'Turn on' }))
      expect(state().consent).toBe('granted')
    })
  })

  describe('destructive actions require confirmation (STEP 16, STEP 27)', () => {
    it('does not clear anything on the first press', async () => {
      const { user } = renderApp({ route: '/settings', personalization: populated() })
      await user.click(await screen.findByRole('button', { name: 'Clear listening history' }))

      expect(state().listeningHistory).toHaveLength(2)
      expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
    })

    it('can be cancelled without losing anything', async () => {
      const { user } = renderApp({ route: '/settings', personalization: populated() })
      await user.click(await screen.findByRole('button', { name: 'Clear listening history' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(state().listeningHistory).toHaveLength(2)
      expect(screen.queryByText('This cannot be undone.')).toBeNull()
    })

    it('announces the confirmation to assistive technology', async () => {
      const { user } = renderApp({ route: '/settings', personalization: populated() })
      await user.click(await screen.findByRole('button', { name: 'Clear listening history' }))
      expect(screen.getByRole('status')).toHaveTextContent('This cannot be undone.')
    })
  })

  describe('the three clear actions are genuinely distinct', () => {
    it('clear listening history keeps submitted searches', async () => {
      const { user } = renderApp({ route: '/settings', personalization: populated() })
      await confirmAction(user, 'Clear listening history')

      await waitFor(() => expect(state().listeningHistory).toEqual([]))
      expect(state().searchHistory).toHaveLength(1)
    })

    it('clear search history keeps listening history', async () => {
      const { user } = renderApp({ route: '/settings', personalization: populated() })
      await confirmAction(user, 'Clear search history')

      await waitFor(() => expect(state().searchHistory).toEqual([]))
      expect(state().listeningHistory).toHaveLength(2)
    })

    it('reset recommendations clears every signal but keeps the consent choice', async () => {
      const { user } = renderApp({ route: '/settings', personalization: populated() })
      await confirmAction(user, 'Reset recommendations')

      await waitFor(() => expect(state().listeningHistory).toEqual([]))
      expect(state().searchHistory).toEqual([])
      expect(state().dismissedItems).toEqual([])
      expect(state().consent).toBe('granted')
    })

    it('leaves the player volume and mute settings alone', async () => {
      localStorage.setItem('pulse:volume', '0.33')
      localStorage.setItem('pulse:muted', 'true')

      const { user } = renderApp({ route: '/settings', personalization: populated() })
      await confirmAction(user, 'Reset recommendations')
      await waitFor(() => expect(state().listeningHistory).toEqual([]))

      expect(localStorage.getItem('pulse:volume')).toBe('0.33')
      expect(localStorage.getItem('pulse:muted')).toBe('true')
    })

    it('writes the cleared state to storage, so it survives a reload', async () => {
      const { user } = renderApp({ route: '/settings', personalization: populated() })
      await confirmAction(user, 'Clear listening history')
      await waitFor(() => expect(state().listeningHistory).toEqual([]))

      const raw = JSON.parse(localStorage.getItem(PERSONALIZATION_STORAGE_KEY) ?? '{}') as {
        listeningHistory: unknown[]
      }
      expect(raw.listeningHistory).toEqual([])
    })
  })

  describe('disabled controls', () => {
    it('offers nothing to clear when there is nothing stored', async () => {
      renderApp({ route: '/settings', personalization: makeState() })
      expect(await screen.findByRole('button', { name: 'Clear listening history' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Clear search history' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Reset recommendations' })).toBeDisabled()
    })

    it('offers nothing to clear when personalization is off', async () => {
      renderApp({ route: '/settings', personalization: makeState({ consent: 'denied' }) })
      expect(await screen.findByRole('button', { name: 'Clear listening history' })).toBeDisabled()
    })
  })

  describe('disclosure', () => {
    it('states the retention rules for each provider, including YouTube', async () => {
      renderApp({ route: '/settings', personalization: populated() })
      expect(await screen.findByText(/up to 250 items/i)).toBeInTheDocument()
      expect(screen.getByText(/within 30 days/i)).toBeInTheDocument()
      expect(screen.getByText(/No YouTube statistics are stored/i)).toBeInTheDocument()
    })

    it('states that nothing is uploaded and there is no account', async () => {
      renderApp({ route: '/settings', personalization: populated() })
      expect(await screen.findByText(/Everything stays in this browser/i)).toBeInTheDocument()
      expect(screen.getByText(/there is no\s+account/i)).toBeInTheDocument()
    })

    it('links to the privacy page', async () => {
      renderApp({ route: '/settings', personalization: populated() })
      expect(
        await screen.findByRole('link', { name: 'Read the full privacy page' }),
      ).toHaveAttribute('href', '/privacy')
    })
  })

  it('clearing history returns the home page to cold start', async () => {
    const { user } = renderApp({ route: '/settings', personalization: populated() })
    await confirmAction(user, 'Reset recommendations')
    await waitFor(() => expect(state().listeningHistory).toEqual([]))

    await user.click(screen.getByRole('link', { name: 'Back to Pulse' }))

    expect(
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: HOME_SECTION_TITLES.recommended })).toBeNull()
    expect(screen.queryByRole('heading', { name: HOME_SECTION_TITLES.recent })).toBeNull()
  })

  it('is reachable from the footer and the sidebar', async () => {
    renderApp()
    await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending })

    const links = screen.getAllByRole('link', { name: 'Settings' })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toHaveAttribute('href', '/settings')
  })

  it('says so when the browser will not let it store anything', async () => {
    renderApp({ route: '/settings' })
    usePersonalizationStore.setState({ status: 'unavailable', storageAvailable: false })

    expect(
      await screen.findByText(/not allowing Pulse to store anything/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled()
  })
})

describe('the personalization prompt', () => {
  it('is offered once, and both answers are equally available', async () => {
    renderApp()
    const prompt = await screen.findByTestId('personalization-prompt')

    const enable = within(prompt).getByRole('button', { name: 'Enable' })
    const notNow = within(prompt).getByRole('button', { name: 'Not now' })
    expect(enable).toBeEnabled()
    expect(notNow).toBeEnabled()
    // Neither is pre-selected, and neither is hidden behind the other.
    expect(enable).not.toHaveAttribute('aria-pressed')
    expect(notNow).not.toHaveAttribute('aria-pressed')
  })

  it('starts recording once accepted, and disappears', async () => {
    const { user } = renderApp()
    const prompt = await screen.findByTestId('personalization-prompt')
    await user.click(within(prompt).getByRole('button', { name: 'Enable' }))

    expect(state().consent).toBe('granted')
    await waitFor(() => expect(screen.queryByTestId('personalization-prompt')).toBeNull())
  })

  it('records nothing after "Not now", and does not ask again', async () => {
    const { user } = renderApp()
    const prompt = await screen.findByTestId('personalization-prompt')
    await user.click(within(prompt).getByRole('button', { name: 'Not now' }))

    expect(state().consent).toBe('denied')
    await waitFor(() => expect(screen.queryByTestId('personalization-prompt')).toBeNull())

    // A second visit does not re-ask.
    renderApp({ personalization: makeState({ consent: 'denied' }) })
    await screen.findAllByRole('heading', { name: HOME_SECTION_TITLES.trending })
    expect(screen.queryByTestId('personalization-prompt')).toBeNull()
  })

  it('is not shown to a browser that already answered', async () => {
    renderApp({ personalization: makeState({ consent: 'granted' }) })
    await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending })
    expect(screen.queryByTestId('personalization-prompt')).toBeNull()
  })

  it('links to the settings page rather than burying the choice', async () => {
    renderApp()
    const prompt = await screen.findByTestId('personalization-prompt')
    expect(within(prompt).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    )
  })
})
