import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { usePlayerStore } from '@/player/player-store'

/**
 * What a click on a search result actually queues, through the real page.
 *
 * `search-seed-autoplay.test.ts` covers the precedence arithmetic; this file
 * covers the thing a visitor can see — that choosing one song does not silently
 * enqueue everything else the search happened to return.
 */

async function searchAndPlay(title: string) {
  const harness = renderApp({ route: '/search?q=nova sound' })
  const list = await screen.findByTestId('track-list')
  await harness.user.click(
    within(list).getByRole('button', { name: new RegExp(`^Play ${title} by `, 'i') }),
  )
  await screen.findByRole('region', { name: 'Now playing' })
  return harness
}

const queueTitles = () => usePlayerStore.getState().queue.map((track) => track.title)

describe('a search result is a seed, not a collection', () => {
  it('queues only the chosen track', async () => {
    await searchAndPlay('Midnight Signal')

    await waitFor(() => expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal'))
    expect(queueTitles()).toEqual(['Midnight Signal'])
  })

  it('queues only the chosen track when it is not the first row', async () => {
    await searchAndPlay('Paper Lanterns')

    await waitFor(() => expect(usePlayerStore.getState().currentTrack?.title).toBe('Paper Lanterns'))
    expect(queueTitles()).toEqual(['Paper Lanterns'])
  })

  it('still names the search as the playback context', async () => {
    await searchAndPlay('Midnight Signal')
    expect(usePlayerStore.getState().queueContext).toEqual({
      id: 'search:nova sound',
      label: '“nova sound”',
    })
  })

  it('leaves the other results on the page, simply unqueued', async () => {
    await searchAndPlay('Midnight Signal')

    const list = screen.getByTestId('track-list')
    expect(within(list).getByText('Paper Lanterns')).toBeInTheDocument()
    expect(queueTitles()).not.toContain('Paper Lanterns')
  })

  it('replaces a previous queue rather than continuing it', async () => {
    // A stale collection must not survive into a seed session: `playTrack` falls
    // back to the store's queue when given none, which is exactly the trap
    // `playSeedTrack` closes by always passing `[track]`.
    const { user } = await searchAndPlay('Midnight Signal')
    usePlayerStore.getState().setQueue(
      [
        ...usePlayerStore.getState().queue,
        { ...usePlayerStore.getState().queue[0], id: 'audius:stale', title: 'Stale Item' },
      ],
      0,
      { id: 'playlist:old', label: 'Old' },
    )
    expect(queueTitles()).toHaveLength(2)

    const list = screen.getByTestId('track-list')
    await user.click(within(list).getByRole('button', { name: /^Play Paper Lanterns by /i }))

    await waitFor(() => expect(queueTitles()).toEqual(['Paper Lanterns']))
  })

  it('offers Add to queue so a visitor can still build one deliberately', async () => {
    const { user } = await searchAndPlay('Midnight Signal')

    const list = screen.getByTestId('track-list')
    await user.click(within(list).getByRole('button', { name: 'More actions for Paper Lanterns' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add Paper Lanterns to the play queue' }))

    await waitFor(() => expect(queueTitles()).toEqual(['Midnight Signal', 'Paper Lanterns']))
    expect(await screen.findByRole('status')).toHaveTextContent('Added Paper Lanterns to the queue')
  })

  it('does not offer Add to queue for a track that cannot stream', async () => {
    // "gated" matches only the non-streamable fixture row, which stays visible
    // and savable — but there is nothing to queue, so the item is absent.
    const { user } = renderApp({ route: '/search?q=gated' })
    const list = await screen.findByTestId('track-list')
    await user.click(within(list).getByRole('button', { name: 'More actions for Gated Premiere' }))

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /to the play queue/i })).toBeNull()
    // The heart is still offered: a gated track can be saved for later.
    expect(
      within(list).getByRole('button', { name: /Save Gated Premiere to Liked Songs in Pulse/i }),
    ).toBeInTheDocument()
  })
})
