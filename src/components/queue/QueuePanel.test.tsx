import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp, rowFor } from '@/test/render'
import { usePlayerStore } from '@/player/player-store'

async function startPlaybackFromSearch() {
  const harness = renderApp({ route: '/search?q=nova sound' })
  const list = await screen.findByTestId('track-list')
  await harness.user.click(
    within(list).getByRole('button', { name: /^Play Midnight Signal by Nova Sound$/i }),
  )
  await screen.findByRole('region', { name: 'Now playing' })
  return harness
}

describe('queue panel', () => {
  it('is closed until a control opens it', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })
    expect(screen.queryByRole('complementary', { name: 'Play queue' })).not.toBeInTheDocument()
  })

  it('opens from the header Queue control and lists the current queue', async () => {
    const { user } = await startPlaybackFromSearch()

    await user.click(screen.getByRole('button', { name: 'Queue' }))

    const panel = await screen.findByRole('complementary', { name: 'Play queue' })
    expect(within(panel).getByRole('heading', { name: 'Queue' })).toBeInTheDocument()
    const rows = within(panel).getAllByRole('button', { name: /^Play .* by /i })
    expect(rows).toHaveLength(usePlayerStore.getState().queue.length)
  })

  it('names the context the queue was built from', async () => {
    const { user } = await startPlaybackFromSearch()
    await user.click(screen.getByRole('button', { name: 'Queue' }))
    const panel = await screen.findByRole('complementary', { name: 'Play queue' })
    expect(within(panel).getByText('From “nova sound”')).toBeInTheDocument()
  })

  it('plays a different queue entry when it is clicked', async () => {
    const { user } = await startPlaybackFromSearch()
    await user.click(screen.getByRole('button', { name: 'Queue' }))

    const panel = await screen.findByRole('complementary', { name: 'Play queue' })
    await user.click(within(panel).getByRole('button', { name: /^Play Paper Lanterns by Nova Sound$/i }))

    await waitFor(() =>
      expect(usePlayerStore.getState().currentTrack?.title).toBe('Paper Lanterns'),
    )
  })

  it('marks the current queue entry', async () => {
    const { user } = await startPlaybackFromSearch()
    await user.click(screen.getByRole('button', { name: 'Queue' }))

    const panel = await screen.findByRole('complementary', { name: 'Play queue' })
    const current = within(panel).getByRole('button', {
      name: /^Play Midnight Signal by Nova Sound$/i,
    })
    expect(rowFor(current)).toHaveAttribute('aria-current', 'true')
  })

  it('shows an empty message before anything has played', async () => {
    const { user } = renderApp()
    await screen.findByRole('heading', { name: 'Trending songs' })
    await user.click(screen.getByRole('button', { name: 'Queue' }))

    const panel = await screen.findByRole('complementary', { name: 'Play queue' })
    expect(within(panel).getByText(/Nothing queued yet/)).toBeInTheDocument()
  })

  it('closes on Escape and returns nothing to the page', async () => {
    const { user } = await startPlaybackFromSearch()
    await user.click(screen.getByRole('button', { name: 'Queue' }))
    await screen.findByRole('complementary', { name: 'Play queue' })

    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Play queue' })).not.toBeInTheDocument(),
    )
  })

  it('closes from its own close button', async () => {
    const { user } = await startPlaybackFromSearch()
    await user.click(screen.getByRole('button', { name: 'Queue' }))
    const panel = await screen.findByRole('complementary', { name: 'Play queue' })

    await user.click(within(panel).getByRole('button', { name: 'Close queue' }))
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Play queue' })).not.toBeInTheDocument(),
    )
  })

  it('moves focus into the panel when it opens', async () => {
    const { user } = await startPlaybackFromSearch()
    await user.click(screen.getByRole('button', { name: 'Queue' }))
    const panel = await screen.findByRole('complementary', { name: 'Play queue' })
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Close queue' })).toHaveFocus(),
    )
  })
})
