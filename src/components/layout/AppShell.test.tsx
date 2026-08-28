import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { usePlayerStore } from '@/player/player-store'

async function startPlayback() {
  const harness = renderApp({ route: '/search?q=nova sound' })
  const list = await screen.findByTestId('track-list')
  await harness.user.click(
    within(list).getByRole('button', { name: /^Play Midnight Signal by Nova Sound$/i }),
  )
  await screen.findByRole('region', { name: 'Now playing' })
  return harness
}

describe('app shell', () => {
  it('renders the reference frame: header, sidebar, browse surface, rail', async () => {
    const { container } = renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })

    expect(container.querySelector('.pulse-app')).not.toBeNull()
    expect(container.querySelector('.site-header')).not.toBeNull()
    expect(container.querySelector('.app-frame')).not.toBeNull()
    expect(container.querySelector('.shell-sidebar')).not.toBeNull()
    expect(container.querySelector('.browse-surface')).not.toBeNull()
    expect(container.querySelector('.right-rail')).not.toBeNull()
  })

  it('keeps the current track across SPA navigation', async () => {
    const { user, engine } = await startPlayback()
    expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal')
    const loadsBefore = engine.loadCount

    await user.click(screen.getByRole('link', { name: 'Home' }))
    await screen.findByRole('heading', { name: 'Trending songs' })

    expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal')
    expect(screen.getByRole('region', { name: 'Now playing' })).toBeInTheDocument()
    // The engine was not rebuilt or re-sourced by navigating.
    expect(engine.loadCount).toBe(loadsBefore)
    expect(engine.playing).toBe(true)
  })

  it('keeps the current track when the search query changes', async () => {
    const { user } = await startPlayback()

    const input = screen.getByLabelText('Search songs and artists')
    await user.clear(input)
    await user.type(input, 'paper')
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Results for “paper”/ })).toBeInTheDocument(),
    )

    expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal')
  })

  it('renders a not-found page for an unknown route without losing the shell', async () => {
    const { container } = renderApp({ route: '/does-not-exist' })
    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    expect(container.querySelector('.site-header')).not.toBeNull()
  })

  it('shows the header primary action and starts the trending queue from it', async () => {
    const { user, engine } = renderApp()
    // The banner offers the same action, so scope to the header explicitly.
    const header = await screen.findByRole('banner')
    const playTrending = within(header).getByRole('button', { name: 'Play trending' })
    await waitFor(() => expect(playTrending).toBeEnabled())

    await user.click(playTrending)
    await waitFor(() => expect(engine.playing).toBe(true))
    expect(usePlayerStore.getState().queueContext?.label).toBe('Trending songs')
  })

  it('exposes the browse-section links the reference header reserves', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })
    const nav = screen.getByRole('navigation', { name: 'Browse sections' })
    expect(within(nav).getByRole('link', { name: 'Trending' })).toHaveAttribute(
      'href',
      '/#trending',
    )
    expect(within(nav).getByRole('link', { name: 'Artists' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Stations' })).toBeInTheDocument()
  })
})

describe('mobile navigation', () => {
  it('opens the drawer the reference button never wired up', async () => {
    const { user } = renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    const drawer = await screen.findByRole('navigation', { name: 'Main menu' })
    expect(within(drawer).getByRole('link', { name: /Home/ })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: /Play queue/ })).toBeInTheDocument()
  })

  it('closes the drawer on Escape', async () => {
    const { user } = renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    await screen.findByRole('navigation', { name: 'Main menu' })

    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'Main menu' })).not.toBeInTheDocument(),
    )
  })

  it('hands focus to the search field from the drawer', async () => {
    const { user } = renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    const drawer = await screen.findByRole('navigation', { name: 'Main menu' })
    await user.click(within(drawer).getByRole('button', { name: /Search/ }))

    await waitFor(() => expect(screen.getByLabelText('Search songs and artists')).toHaveFocus())
  })

  it('opens the queue from the drawer', async () => {
    const { user } = renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    const drawer = await screen.findByRole('navigation', { name: 'Main menu' })
    await user.click(within(drawer).getByRole('button', { name: /Play queue/ }))

    expect(await screen.findByRole('complementary', { name: 'Play queue' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).not.toBeInTheDocument()
  })
})

describe('sidebar', () => {
  it('offers real actions in the reference card slots', async () => {
    const { user } = renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })

    await user.click(screen.getByRole('button', { name: 'Search music' }))
    expect(screen.getByLabelText('Search songs and artists')).toHaveFocus()

    expect(screen.getByRole('button', { name: 'Play underground' })).toBeEnabled()
  })

  it('plays the underground queue from the sidebar', async () => {
    const { user, engine } = renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })

    await user.click(screen.getByRole('button', { name: 'Play underground' }))
    await waitFor(() => expect(engine.playing).toBe(true))
    expect(usePlayerStore.getState().queueContext?.label).toBe('Underground trending')
  })

  it('links out with safe rel attributes only', async () => {
    const { container } = renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })

    const external = [...container.querySelectorAll('a[target="_blank"]')]
    expect(external.length).toBeGreaterThan(0)
    for (const link of external) {
      expect(link.getAttribute('rel')).toContain('noopener')
      expect(link.getAttribute('rel')).toContain('noreferrer')
    }
  })
})
