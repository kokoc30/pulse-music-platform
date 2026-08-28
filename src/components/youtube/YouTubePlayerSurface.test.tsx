import { describe, expect, it } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { MINIMUM_DIMENSION } from '@/player/youtube-engine'
import { playYouTubeVideo } from '@/player/youtube-actions'
import { useYouTubeStore } from '@/player/youtube-store'
import { playTrack } from '@/player/player-actions'
import { usePlayerStore } from '@/player/player-store'
import { youtubePayload } from '@/test/fixtures/youtube'
import { renderApp } from '@/test/render'

/**
 * The visible player surface.
 *
 * Almost every assertion here is a policy requirement rather than a design
 * preference: the surface must exist and be on screen while a video plays, it
 * must be at least 200 x 200, nothing may be drawn over the iframe, the close
 * control must sit outside it, and a hidden document must pause playback
 * (docs/youtube-policy-audit.md §4 and §6).
 */

const video = (overrides = {}) => normalizeYouTubeVideo(youtubePayload(overrides))

async function openSurface(overrides = {}) {
  const harness = renderApp({ route: '/' })
  await act(async () => {
    await playYouTubeVideo(video(overrides), { userInitiated: true })
  })
  const surface = await screen.findByTestId('youtube-surface')
  await waitFor(() => expect(harness.youtube.created).toBe(1))
  return { ...harness, surface }
}

describe('the surface is genuinely visible', () => {
  it('renders nothing at all until a YouTube item is opened', () => {
    renderApp({ route: '/' })
    expect(screen.queryByTestId('youtube-surface')).not.toBeInTheDocument()
  })

  it('appears as soon as a video is played, before anything is asked to play', async () => {
    const { surface } = await openSurface()
    expect(surface).toBeInTheDocument()
    expect(surface).toBeVisible()
  })

  it('is never hidden, collapsed, transparent or moved off-screen', async () => {
    const { surface } = await openSurface()
    const style = window.getComputedStyle(surface)
    expect(style.display).not.toBe('none')
    expect(style.visibility).not.toBe('hidden')
    expect(style.opacity === '' || Number(style.opacity) > 0).toBe(true)
    expect(surface.hidden).toBe(false)
    expect(surface).not.toHaveAttribute('aria-hidden', 'true')
  })

  it('declares the documented 200 x 200 minimum on the iframe stage', async () => {
    const { surface } = await openSurface()
    const stage = within(surface).getByTestId('youtube-stage')
    expect(stage.style.minWidth).toBe(`${MINIMUM_DIMENSION}px`)
    expect(stage.style.minHeight).toBe(`${MINIMUM_DIMENSION}px`)
    expect(MINIMUM_DIMENSION).toBe(200)
  })

  it('builds the player at the recommended 16:9 size', async () => {
    const { youtube } = await openSurface()
    expect(youtube.players[0].options.width).toBe(480)
    expect(youtube.players[0].options.height).toBe(270)
  })

  it('survives navigation, because it lives above the router', async () => {
    const { user, surface } = await openSurface()
    expect(surface).toBeInTheDocument()
    await user.click(screen.getAllByRole('link', { name: /^Home$/i })[0])
    // Still there, still the same item: playback is never interrupted by
    // navigating, which is what keeps it a foreground player.
    expect(screen.getByTestId('youtube-surface')).toBeInTheDocument()
    expect(useYouTubeStore.getState().item?.videoId).toBe('aaaaaaaaaaa')
  })
})

describe('nothing overlays the iframe', () => {
  it('gives the iframe a container with no other children', async () => {
    const { surface } = await openSurface()
    const stage = within(surface).getByTestId('youtube-stage')
    // The API replaces the node it is given with its own iframe; the stage
    // holds that and nothing else. No gradient, no click shield, no controls.
    expect(stage.children).toHaveLength(1)
    expect(stage.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('keeps the close control outside the iframe container', async () => {
    const { surface } = await openSurface()
    const stage = within(surface).getByTestId('youtube-stage')
    const close = within(surface).getByRole('button', { name: /Close the YouTube player/i })
    expect(stage.contains(close)).toBe(false)
  })

  it('keeps the play/pause control and the attribution outside it too', async () => {
    const { surface } = await openSurface()
    const stage = within(surface).getByTestId('youtube-stage')
    const toggle = within(surface).getByRole('button', { name: /(Play|Pause) the YouTube video/i })
    const link = within(surface).getByRole('link', { name: /Watch .* on YouTube/i })
    expect(stage.contains(toggle)).toBe(false)
    expect(stage.contains(link)).toBe(false)
  })

  it('never disables the players own native controls', async () => {
    const { youtube } = await openSurface()
    // The engine passes only documented playerVars, and `controls` is never
    // turned off — that would obscure the native controls the policy requires.
    expect(JSON.stringify(youtube.players[0].options)).not.toContain('controls":0')
  })
})

describe('attribution on the surface', () => {
  it('names the video, the channel and YouTube, and links to the watch page', async () => {
    const { surface } = await openSurface()
    expect(within(surface).getByText('Qele Qele')).toBeInTheDocument()
    expect(within(surface).getByText('Sirusho')).toBeInTheDocument()
    const link = within(surface).getByRole('link', { name: /Watch Qele Qele on YouTube/i })
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=aaaaaaaaaaa')
    expect(link).toHaveTextContent('YouTube')
    expect(link.getAttribute('rel')).not.toContain('noreferrer')
  })

  it('gives the surface an accessible name', async () => {
    const { surface } = await openSurface()
    expect(surface).toHaveAccessibleName('YouTube player')
  })
})

describe('playback is bounded by visibility', () => {
  it('pauses when the document becomes hidden', async () => {
    const { youtube } = await openSurface()
    await waitFor(() => expect(youtube.current()?.playing).toBe(true))

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(youtube.current()?.playing).toBe(false)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('does not resume by itself when the document comes back', async () => {
    const { youtube } = await openSurface()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(youtube.current()?.playing).toBe(false)
  })

  it('stops playback and destroys the player when closed', async () => {
    const { user, surface, youtube } = await openSurface()
    const player = youtube.players[0]
    await user.click(within(surface).getByRole('button', { name: /Close the YouTube player/i }))

    await waitFor(() => expect(screen.queryByTestId('youtube-surface')).not.toBeInTheDocument())
    expect(player.playing).toBe(false)
    expect(player.destroyed).toBe(true)
  })
})

describe('the surface play/pause control', () => {
  it('pauses and resumes the embedded player', async () => {
    const { user, surface, youtube } = await openSurface()
    await waitFor(() => expect(youtube.current()?.playing).toBe(true))

    await user.click(within(surface).getByRole('button', { name: /Pause the YouTube video/i }))
    expect(youtube.current()?.playing).toBe(false)

    await user.click(within(surface).getByRole('button', { name: /Play the YouTube video/i }))
    expect(youtube.current()?.playing).toBe(true)
  })
})

describe('the audio player is left coherent', () => {
  it('does not claim to be playing while YouTube has the floor', async () => {
    const { engine } = renderApp({ route: '/' })

    // A real Jamendo track: it carries its own stream URL, so this exercises
    // the actual audio path rather than a hand-set store value.
    await act(async () => {
      await playTrack({
        id: 'jamendo:j1',
        mediaKind: 'audio',
        provider: 'jamendo',
        providerId: 'j1',
        title: 'Reverie',
        artistName: 'Lumen Field',
        artwork: {},
        durationSeconds: 180,
        isStreamable: true,
        streamUrl: 'https://prod-1.storage.jamendo.com/?trackid=j1',
      })
    })
    expect(usePlayerStore.getState().status).toBe('playing')
    expect(engine.playing).toBe(true)

    await act(async () => {
      await playYouTubeVideo(video(), { userInitiated: true })
    })

    // The bottom bar must not show a pause icon over a silent audio element.
    expect(usePlayerStore.getState().status).toBe('paused')
    expect(engine.playing).toBe(false)
  })
})
