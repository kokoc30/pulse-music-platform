import { StrictMode } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import type { RenderOptions, RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PrivacyPage } from '@/pages/PrivacyPage'
import { SearchPage } from '@/pages/SearchPage'
import { createAudiusProvider } from '@/music/audius/adapter'
import { setAudiusSdk } from '@/music/audius/client'
import { resetStreamOriginFailures } from '@/music/audius/content-nodes'
import { setMusicProvider } from '@/music/provider'
import { clearDiscoveryCache } from '@/features/discovery/useDiscovery'
import { setAudioEngine } from '@/player/audio-engine'
import { createFakeAudioEngine } from '@/player/fake-audio-engine'
import type { FakeAudioEngine } from '@/player/fake-audio-engine'
import { resetMediaRetries } from '@/player/player-actions'
import { initialPlayerState, usePlayerStore } from '@/player/player-store'
import { resetPlaybackCoordinator } from '@/player/playback-coordinator'
import { createFakeYouTubeFactory } from '@/player/youtube/fake-adapter'
import type { FakeYouTubeFactory } from '@/player/youtube/fake-adapter'
import { createYouTubeIframeEngine, setYouTubeEngine } from '@/player/youtube-engine'
import { initialYouTubeState, useYouTubeStore } from '@/player/youtube-store'
import { clearYouTubeSessionCache } from '@/music/youtube'
import { useUiStore } from '@/app/ui-store'
import { clearArtistTrackCache } from '@/features/discovery/useHomeDashboard'
import { PERSONALIZATION_STORAGE_KEY, resetPersonalizationForTests } from '@/personalization'
import { toPersisted } from '@/personalization/storage'
import type { PersonalizationState } from '@/personalization'
import { SettingsPage } from '@/pages/SettingsPage'

export interface TestHarness {
  user: ReturnType<typeof userEvent.setup>
  engine: FakeAudioEngine
  /**
   * The doubled YouTube IFrame API. Component tests never create a real
   * `<iframe>` or touch the network (agents/24 → "Testability"), and this is
   * how they assert what the embedded player was actually asked to do.
   */
  youtube: FakeYouTubeFactory
}

let youtubeFactory: FakeYouTubeFactory = createFakeYouTubeFactory()

/** The fake YouTube factory backing the current test. */
export function youtubeTestFactory(): FakeYouTubeFactory {
  return youtubeFactory
}

/**
 * Resets every module-level singleton so component tests never leak state into
 * one another: provider, SDK instance, discovery cache, player store, UI store,
 * the audio engine, the YouTube engine, its store and its session cache, and —
 * since Phase 4 — the personalization store, its `localStorage` key and the
 * artist-affinity lookup cache.
 */
export function resetAppState(): FakeAudioEngine {
  setAudiusSdk(null)
  resetStreamOriginFailures()
  setMusicProvider(createAudiusProvider())
  clearDiscoveryCache()
  usePlayerStore.setState({ ...initialPlayerState, volume: 0.8, muted: false })
  resetMediaRetries()
  useUiStore.setState({
    notice: null,
    noticeToken: 0,
    queueOpen: false,
    mobileNavOpen: false,
    focusSearchToken: 0,
  })

  useYouTubeStore.setState({ ...initialYouTubeState })
  resetPlaybackCoordinator()
  clearYouTubeSessionCache()
  youtubeFactory = createFakeYouTubeFactory()
  setYouTubeEngine(createYouTubeIframeEngine({ factory: youtubeFactory, origin: 'http://localhost' }))

  resetPersonalizationForTests()
  clearArtistTrackCache()

  const engine = createFakeAudioEngine()
  setAudioEngine(engine)
  return engine
}

/**
 * Writes personalization state to `localStorage` through the same allow-list the
 * application uses, so a seeded test can never persist a shape production could
 * not have written.
 */
export function seedPersonalization(state: PersonalizationState): void {
  localStorage.setItem(PERSONALIZATION_STORAGE_KEY, JSON.stringify(toPersisted(state)))
}

interface RouterOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string
  /**
   * Wrap the tree in `<StrictMode>`, which double-invokes every effect.
   *
   * `main.tsx` renders under StrictMode in development, so anything that must
   * happen exactly once — notably the automatic YouTube fallback, which spends
   * real quota — has to survive that. Off by default so the other suites keep
   * their existing, cheaper render.
   */
  strict?: boolean
  /**
   * Persisted personalization state to write *after* the reset and *before* the
   * first render — exactly the position a returning visitor's browser is in.
   *
   * It has to be an option rather than something a test writes itself, because
   * `resetAppState` clears the key: seeding beforehand would be wiped, and
   * seeding afterwards would arrive too late for the hydration effect.
   */
  personalization?: PersonalizationState
}

/**
 * The `.song-row` container that owns a given play button.
 *
 * A track row is no longer a single `<button>`: it is a container holding a
 * stretched play button *and* a sibling source link, because Jamendo requires a
 * backlink per content item and an `<a>` cannot nest inside a `<button>`
 * (see `TrackRow`). Row-level state — `aria-current`, `aria-disabled`, the
 * duration cell, the provider credit — therefore lives on the container, while
 * the accessible name lives on the button. Tests reach one from the other here.
 */
export function rowFor(playButton: HTMLElement): HTMLElement {
  const row = playButton.closest('.song-row')
  if (!(row instanceof HTMLElement)) {
    throw new Error('That button is not inside a .song-row')
  }
  return row
}

/** Every rendered track row container, in document order. */
export function trackRows(container: HTMLElement = document.body): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.song-row')]
}

/** Renders the full app shell (header, sidebar, player) at a given route. */
export function renderApp(options: RouterOptions = {}): RenderResult & TestHarness {
  const engine = resetAppState()
  if (options.personalization) seedPersonalization(options.personalization)
  const user = userEvent.setup()
  const tree = (
    <MemoryRouter initialEntries={[options.route ?? '/']}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
  const result = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree, options)
  return { ...result, user, engine, youtube: youtubeFactory }
}

/** Renders a single component inside a router, without the app shell. */
export function renderWithRouter(
  ui: ReactElement,
  options: RouterOptions = {},
): RenderResult & TestHarness {
  const engine = resetAppState()
  const user = userEvent.setup()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[options.route ?? '/']}>{children}</MemoryRouter>
  )
  const result = render(ui, { ...options, wrapper })
  return { ...result, user, engine, youtube: youtubeFactory }
}
