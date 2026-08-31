import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { useUiStore } from '@/app/ui-store'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { youtubePayload } from '@/test/fixtures/youtube'
import { renderApp } from '@/test/render'
import { usePlayerStore } from '@/player/player-store'
import {
  LEGACY_DEBUG_STORAGE_KEY,
  forgetLegacyPlaybackDebugFlag,
  isPlaybackDebugEnabled,
  setPlaybackDebug,
  tracePlayback,
} from '@/player/playback-trace'
import { playYouTubeVideo } from '@/player/youtube-actions'
import { useYouTubeStore } from '@/player/youtube-store'

/**
 * The diagnostic readout is gone from the product.
 *
 * It existed for one reason: a hand-off failure that reproduced only on a
 * physical phone, where a debugger is least useful. That investigation is
 * closed — the real device now reports
 * `loadVideoById → unstarted → buffering → playing` on an automatic
 * Audio → YouTube transition — and a public debug mode is not something to leave
 * in a music player. Every visitor was one URL away from a monospace table of
 * engineering measurements sitting on top of their music.
 *
 * These tests pin the removal rather than the deletion: they assert that no
 * surface renders it and that no visitor can switch it on, so a future change
 * that quietly reintroduces either fails here.
 *
 * The regression tests that *proved* the playback bugs are untouched and stay
 * where they are — `youtube-player-recovery.test.ts`,
 * `youtube-autostart.test.ts`, `youtube-engine.test.ts`. The instrument they
 * read (`tracePlayback` and friends) is retained for exactly that purpose.
 */

const VIDEO = normalizeYouTubeVideo(
  youtubePayload({
    videoId: 'aram0000001',
    title: 'Sourp Sarkis',
    channelTitle: 'Aram Asatryan - Topic',
  }),
)

/** Every label the removed readout drew, verbatim. */
const DEBUG_LABELS = [
  'status',
  'ratio',
  'measured',
  'waited (ms)',
  'wait ended',
  'api ready',
  'player ready',
  'player creation',
  'creation gen',
  'creation timed out',
  'iframe autoplay',
  'decision',
  'withheld',
  'commands',
  'states',
  'outcome',
  'blocked',
  'awaiting',
]

function expectNoDiagnostics(scope: HTMLElement) {
  expect(screen.queryByLabelText('Playback diagnostics')).not.toBeInTheDocument()
  expect(document.querySelector('.playback-debug')).toBeNull()
  for (const label of DEBUG_LABELS) {
    expect(within(scope).queryByText(label)).not.toBeInTheDocument()
  }
  // Nor an empty container left behind where the table used to be, which would
  // hold its own gap in the sheet's stack.
  expect(scope.querySelector('dl')).toBeNull()
}

const sheet = () => screen.getByRole('dialog', { name: /now playing/i })

beforeEach(() => {
  useYouTubeStore.setState({ sessionItems: [], sessionIndex: -1 })
})

afterEach(() => {
  setPlaybackDebug(null)
  vi.unstubAllEnvs()
})

describe('the expanded Now Playing view carries no engineering information', () => {
  /**
   * The switch is forced *on*, which is the strongest form of the claim: there
   * is no longer any state of the debug flag that produces a panel, because
   * there is no longer a panel.
   */
  it('renders no diagnostics for a YouTube video, even with the debug flag on', async () => {
    setPlaybackDebug(true)
    renderApp({ route: '/search?q=aram asatryan' })
    await playYouTubeVideo(VIDEO, { userInitiated: true })

    await waitFor(() => expect(useUiStore.getState().nowPlayingOpen).toBe(true))
    const view = await screen.findByRole('dialog', { name: /now playing/i })

    // The product UI is all still there…
    expect(within(view).getByText('Sourp Sarkis')).toBeInTheDocument()
    expect(within(view).getByText(/Aram Asatryan - Topic/)).toBeInTheDocument()
    expect(within(view).getByRole('button', { name: /^(Play|Pause)$/ })).toBeInTheDocument()
    expect(within(view).getByRole('button', { name: /next/i })).toBeInTheDocument()
    expect(within(view).getByRole('button', { name: /previous/i })).toBeInTheDocument()
    // …and none of the instrument is.
    expectNoDiagnostics(view)
  })

  it('renders no diagnostics for an audio track either', async () => {
    setPlaybackDebug(true)
    const harness = renderApp({ route: '/search?q=nova sound' })
    const list = await screen.findByTestId('track-list')
    await harness.user.click(
      within(list).getByRole('button', { name: /^Play Midnight Signal by Nova Sound$/i }),
    )
    await waitFor(() =>
      expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal'),
    )

    useUiStore.getState().setNowPlayingOpen(true)
    const view = await screen.findByRole('dialog', { name: /now playing/i })

    expect(within(view).getByText('Midnight Signal')).toBeInTheDocument()
    expectNoDiagnostics(view)
  })

  /** The seek rail follows the notice directly: nothing sits between them. */
  it('leaves no gap where the readout used to be', async () => {
    setPlaybackDebug(true)
    renderApp({ route: '/search?q=aram asatryan' })
    await playYouTubeVideo(VIDEO, { userInitiated: true })
    await waitFor(() => expect(useUiStore.getState().nowPlayingOpen).toBe(true))

    const rail = within(sheet()).getByRole('slider', { name: /seek/i })
    expect(rail).toBeInTheDocument()
    // Whatever precedes the scrubber, it is not an empty diagnostic container.
    const stack = rail.closest('.now-playing') ?? sheet()
    expect(stack.querySelector('.playback-debug')).toBeNull()
  })
})

describe('a visitor cannot switch playback tracing on', () => {
  it('is off in a production build, whatever the URL says', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    setPlaybackDebug(null)

    const search = vi
      .spyOn(window, 'location', 'get')
      .mockReturnValue({ ...window.location, search: '?debugPlayback=1' })
    try {
      expect(isPlaybackDebugEnabled()).toBe(false)
    } finally {
      search.mockRestore()
    }
  })

  /**
   * The control for the test above. Without it, a stub that silently failed to
   * take effect would leave that assertion passing for the wrong reason.
   */
  it('is still available in development, which is what makes the above meaningful', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('PROD', false)
    setPlaybackDebug(null)

    const search = vi
      .spyOn(window, 'location', 'get')
      .mockReturnValue({ ...window.location, search: '?debugPlayback=1' })
    try {
      expect(isPlaybackDebugEnabled()).toBe(true)
    } finally {
      search.mockRestore()
    }
  })

  it('prints nothing to the console in a production build', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    setPlaybackDebug(null)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      tracePlayback('decide:result', { mode: 'play' })
      expect(info).not.toHaveBeenCalled()
    } finally {
      info.mockRestore()
    }
  })

  /**
   * The stored flag no longer switches anything on, and is removed once so it
   * does not sit in a tester's browser being mistaken for live configuration.
   */
  it('ignores the obsolete stored flag and clears it, touching nothing else', () => {
    window.localStorage.setItem(LEGACY_DEBUG_STORAGE_KEY, '1')
    window.localStorage.setItem('pulse.personalization.v1', '{"kept":true}')
    setPlaybackDebug(null)

    expect(isPlaybackDebugEnabled()).toBe(false)

    forgetLegacyPlaybackDebugFlag()

    expect(window.localStorage.getItem(LEGACY_DEBUG_STORAGE_KEY)).toBeNull()
    // Exactly one key, and it is not anybody else's.
    expect(window.localStorage.getItem('pulse.personalization.v1')).toBe('{"kept":true}')
    window.localStorage.removeItem('pulse.personalization.v1')
  })

  it('is harmless when there is nothing stored to clear', () => {
    expect(() => forgetLegacyPlaybackDebugFlag()).not.toThrow()
  })
})
