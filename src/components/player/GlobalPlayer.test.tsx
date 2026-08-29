import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { MAX_MEDIA_RETRIES } from '@/player/player-actions'
import { usePlayerStore } from '@/player/player-store'

async function playFirstSearchResult() {
  const harness = renderApp({ route: '/search?q=nova sound' })
  const list = await screen.findByTestId('track-list')
  const row = within(list).getByRole('button', { name: /^Play Midnight Signal by Nova Sound$/i })
  await harness.user.click(row)
  await screen.findByRole('region', { name: 'Now playing' })
  return harness
}

describe('global player', () => {
  it('shows the acquisition banner until a track is chosen, and never autoplays', async () => {
    const { engine } = renderApp()
    expect(await screen.findByRole('region', { name: 'About Pulse' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Now playing' })).not.toBeInTheDocument()
    expect(engine.playing).toBe(false)
    expect(engine.src).toBeNull()
  })

  it('activates on a user click and shows the real track metadata', async () => {
    const { engine } = await playFirstSearchResult()

    const player = screen.getByRole('region', { name: 'Now playing' })
    expect(within(player).getByText('Midnight Signal')).toBeInTheDocument()
    expect(within(player).getByText('Nova Sound')).toBeInTheDocument()
    expect(engine.src).toBe('https://cn1.example.audius/tracks/cidstream/abc?signature=x')
    await waitFor(() => expect(engine.playing).toBe(true))
  })

  it('toggles play and pause through the round play button', async () => {
    const { user, engine } = await playFirstSearchResult()

    const pauseButton = await screen.findByRole('button', { name: 'Pause' })
    await user.click(pauseButton)
    expect(engine.playing).toBe(false)
    expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(engine.playing).toBe(true))
  })

  it('renders progress from the audio engine rather than a fixed value', async () => {
    const { engine } = await playFirstSearchResult()

    engine.emitDuration(180)
    usePlayerStore.getState().setDuration(180)
    engine.emitTimeUpdate(42)

    const slider = await screen.findByRole('slider', { name: 'Seek' })
    await waitFor(() => expect(slider).toHaveAttribute('aria-valuetext', '0:42 of 3:00'))
    expect(screen.getByText('0:42')).toBeInTheDocument()
    expect(screen.getByText('3:00')).toBeInTheDocument()
  })

  it('seeks with the keyboard and clamps at both ends', async () => {
    const { user, engine } = await playFirstSearchResult()
    engine.emitDuration(200)
    usePlayerStore.getState().setDuration(200)

    const slider = await screen.findByRole('slider', { name: 'Seek' })
    slider.focus()

    await user.keyboard('{End}')
    await waitFor(() => expect(usePlayerStore.getState().currentTime).toBe(200))

    await user.keyboard('{Home}')
    await waitFor(() => expect(usePlayerStore.getState().currentTime).toBe(0))

    await user.keyboard('{ArrowLeft}')
    expect(usePlayerStore.getState().currentTime).toBe(0)
  })

  it('disables seeking before a duration is known', async () => {
    await playFirstSearchResult()
    usePlayerStore.getState().setDuration(0)
    const slider = await screen.findByRole('slider', { name: 'Seek' })
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'true'))
  })

  it('changes volume and reports it accessibly', async () => {
    const { user, engine } = await playFirstSearchResult()
    const slider = await screen.findByRole('slider', { name: 'Volume' })
    slider.focus()

    await user.keyboard('{Home}')
    await waitFor(() => expect(usePlayerStore.getState().volume).toBe(0))
    expect(slider).toHaveAttribute('aria-valuetext', '0%')

    await user.keyboard('{End}')
    await waitFor(() => expect(engine.volume).toBe(1))
    expect(slider).toHaveAttribute('aria-valuetext', '100%')
  })

  it('mutes and unmutes without losing the previous volume', async () => {
    const { user, engine } = await playFirstSearchResult()
    usePlayerStore.getState().setVolume(0.4)

    await user.click(screen.getByRole('button', { name: 'Mute' }))
    expect(engine.muted).toBe(true)
    expect(usePlayerStore.getState().volume).toBe(0.4)

    await user.click(await screen.findByRole('button', { name: 'Unmute' }))
    expect(engine.muted).toBe(false)
    await waitFor(() => expect(engine.volume).toBe(0.4))
  })

  it('steps through the queue with next and previous', async () => {
    const { user } = await playFirstSearchResult()

    /**
     * The queue is now built deliberately.
     *
     * A search row is a *seed*: clicking one plays that song and nothing else,
     * so the sibling results are no longer queued on the visitor's behalf
     * (docs/SEARCH_SEED_AND_YOUTUBE_CONTINUATION_FIX.md). Adding a second track
     * through the row menu is the replacement path, and it is what this test
     * needs a multi-item queue for.
     */
    const list = await screen.findByTestId('track-list')
    await user.click(
      within(list).getByRole('button', { name: 'More actions for Paper Lanterns' }),
    )
    await user.click(
      screen.getByRole('menuitem', { name: 'Add Paper Lanterns to the play queue' }),
    )
    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Next track' }))
    await waitFor(() =>
      expect(usePlayerStore.getState().currentTrack?.title).toBe('Paper Lanterns'),
    )

    await user.click(screen.getByRole('button', { name: 'Previous track' }))
    await waitFor(() =>
      expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal'),
    )
  })

  it('disables previous at the head of the queue when nothing has played', async () => {
    await playFirstSearchResult()
    expect(screen.getByRole('button', { name: 'Previous track' })).toBeDisabled()
  })

  it('advances automatically when a track ends', async () => {
    const { engine } = await playFirstSearchResult()
    engine.emitEnded()

    // A seed with an empty queue behind it reaches Phase 6 autoplay, which ranks
    // what the session already loaded. Here the closest match happens to be the
    // other Nova Sound track — chosen by the similarity planner rather than by
    // being the next search row, which is the distinction this phase introduced.
    await waitFor(() => expect(usePlayerStore.getState().currentTrack?.title).not.toBe('Midnight Signal'))
    expect(usePlayerStore.getState().currentTrack).not.toBeNull()
  })

  it('retries against a different Audius content node, keeping the signed path', async () => {
    const { engine } = await playFirstSearchResult()
    const first = new URL(engine.src!)

    engine.emitError('The audio stream was interrupted by a network problem.')

    await waitFor(() => expect(usePlayerStore.getState().status).toBe('playing'))
    expect(engine.loadCount).toBe(2)

    const second = new URL(engine.src!)
    // A different host, but the identical signed path — the signature covers the
    // track, not the node.
    expect(second.origin).not.toBe(first.origin)
    expect(second.pathname + second.search).toBe(first.pathname + first.search)
    expect(usePlayerStore.getState().error).toBeNull()
  })

  it('leaves the loading state and surfaces a notice once the retries are spent', async () => {
    const { engine } = await playFirstSearchResult()

    for (let attempt = 0; attempt < MAX_MEDIA_RETRIES; attempt += 1) {
      engine.emitError('transient node failure')
      await waitFor(() => expect(usePlayerStore.getState().status).toBe('playing'))
    }
    engine.emitError('This audio file could not be decoded by your browser.')

    await waitFor(() => expect(usePlayerStore.getState().status).toBe('error'))
    expect(
      await screen.findByText('This audio file could not be decoded by your browser.'),
    ).toBeInTheDocument()
    // The rest of the app stays usable.
    expect(screen.getByLabelText('Search songs and artists')).toBeEnabled()
  })

  it('exposes every control as a real button with an accessible name', async () => {
    await playFirstSearchResult()
    for (const name of ['Previous track', 'Pause', 'Next track', 'Mute', 'Play queue']) {
      const control = screen.getByRole('button', { name })
      expect(control.tagName).toBe('BUTTON')
    }
  })

  it('links out to the track on Audius with safe rel attributes', async () => {
    await playFirstSearchResult()
    const link = screen.getByRole('link', { name: /Open Midnight Signal on Audius/i })
    expect(link).toHaveAttribute('href', 'https://audius.co/nova/midnight-signal')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
  })
})
