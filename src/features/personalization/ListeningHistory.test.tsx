import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { makeEntry, makeState } from '@/test/fixtures/personalization'
import { HOME_SECTION_TITLES } from '@/personalization/selectors'
import { usePersonalizationStore } from '@/personalization/store'
import { usePlayerStore } from '@/player/player-store'
import { useYouTubeStore } from '@/player/youtube-store'
import type { FakeAudioEngine } from '@/player/fake-audio-engine'

/**
 * Playback → history, through the real components.
 *
 * The fake audio engine drives real `timeupdate` events into the real player
 * store, which the real `PersonalizationHost` observes. Nothing here calls the
 * tracker directly, so what is under test is the whole chain a listener actually
 * exercises.
 */

/** The clock the personalization fixtures are anchored to. */
const CLOCK = Date.parse('2026-06-15T12:00:00Z')

const history = () => usePersonalizationStore.getState().state.listeningHistory
const profile = () => usePersonalizationStore.getState().profile

/** Advances playback by emitting the position samples a real engine would. */
function listenFor(engine: FakeAudioEngine, seconds: number, from = 0): void {
  for (let position = from + 1; position <= from + seconds; position += 1) {
    engine.emitTimeUpdate(position)
  }
}

async function startFirstTrendingTrack() {
  const heading = await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending })
  const shelf = heading.closest('.music-section') as HTMLElement
  return within(shelf).findByRole('button', { name: /^Play Midnight Signal by Nova Sound$/ })
}

describe('playback writes local listening history', () => {
  beforeEach(() => {
    // The seeded fixtures are anchored to a fixed date; the retention rules read
    // the real clock, so the two have to agree.
    vi.useFakeTimers({ now: CLOCK, shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records nothing at all before consent is given', async () => {
    const { user, engine } = renderApp()
    await user.click(await startFirstTrendingTrack())
    await waitFor(() => expect(engine.playing).toBe(true))

    listenFor(engine, 120)
    engine.emitEnded()

    expect(history()).toEqual([])
    expect(localStorage.getItem('pulse.personalization.v1')).toBeNull()
  })

  describe('with personalization enabled', () => {
    it('does not record a five-second accidental play as a listen', async () => {
      const { user, engine } = renderApp()
      await user.click(await screen.findByRole('button', { name: 'Enable' }))

      await user.click(await startFirstTrendingTrack())
      await waitFor(() => expect(engine.playing).toBe(true))
      listenFor(engine, 5)

      // The play is remembered as a near-zero signal, but is not a listen.
      await waitFor(() => expect(history().length).toBeLessThanOrEqual(1))
      expect(profile().qualifiedListenCount).toBe(0)
      expect(profile().stage).toBe('cold')
    })

    it('records a qualified listen once the threshold is crossed', async () => {
      const { user, engine } = renderApp()
      await user.click(await screen.findByRole('button', { name: 'Enable' }))

      await user.click(await startFirstTrendingTrack())
      await waitFor(() => expect(engine.playing).toBe(true))
      listenFor(engine, 35)

      await waitFor(() => expect(profile().qualifiedListenCount).toBe(1))
      const [entry] = history()
      expect(entry.title).toBe('Midnight Signal')
      expect(entry.artist).toBe('Nova Sound')
      expect(entry.provider).toBe('audius')
      expect(entry.playCount).toBe(1)
      expect(entry.context).toBe('trending')
    })

    it('persists that listen to storage immediately', async () => {
      const { user, engine } = renderApp()
      await user.click(await screen.findByRole('button', { name: 'Enable' }))

      await user.click(await startFirstTrendingTrack())
      await waitFor(() => expect(engine.playing).toBe(true))
      listenFor(engine, 35)

      await waitFor(() => {
        const raw = localStorage.getItem('pulse.personalization.v1')
        expect(raw).not.toBeNull()
        const parsed = JSON.parse(raw as string) as { listeningHistory: unknown[] }
        expect(parsed.listeningHistory).toHaveLength(1)
      })
    })

    it('shows the track on the home page without a reload', async () => {
      const { user, engine } = renderApp()
      await user.click(await screen.findByRole('button', { name: 'Enable' }))

      await user.click(await startFirstTrendingTrack())
      await waitFor(() => expect(engine.playing).toBe(true))
      listenFor(engine, 35)

      const shelf = (
        await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recent })
      ).closest('.music-section') as HTMLElement
      expect(within(shelf).getByText('Midnight Signal')).toBeInTheDocument()
    })

    it('records a completion when the track finishes', async () => {
      const { user, engine } = renderApp()
      await user.click(await screen.findByRole('button', { name: 'Enable' }))

      await user.click(await startFirstTrendingTrack())
      await waitFor(() => expect(engine.playing).toBe(true))
      // The fixture track is 3:34, and a real browser only reports the media as
      // ended once it has actually reached the end.
      listenFor(engine, 214)
      engine.emitEnded()

      await waitFor(() => expect(history()[0]?.completionRatio).toBe(1))
      // One listen, not two, despite the mid-play and end-of-play commits.
      expect(history()[0].playCount).toBe(1)
    })

    it('does not count a scrub to the end as a listen', async () => {
      const { user, engine } = renderApp()
      await user.click(await screen.findByRole('button', { name: 'Enable' }))

      await user.click(await startFirstTrendingTrack())
      await waitFor(() => expect(engine.playing).toBe(true))

      listenFor(engine, 3)
      // The scrubber is dragged to 3:30 of a 3:34 track.
      engine.emitTimeUpdate(210)
      engine.emitTimeUpdate(211)

      await waitFor(() => expect(history().length).toBeLessThanOrEqual(1))
      expect(profile().qualifiedListenCount).toBe(0)
    })

    it('keeps one row when the same track is played again', async () => {
      const { user, engine } = renderApp()
      await user.click(await screen.findByRole('button', { name: 'Enable' }))

      const play = await startFirstTrendingTrack()
      await user.click(play)
      await waitFor(() => expect(engine.playing).toBe(true))
      listenFor(engine, 35)
      await waitFor(() => expect(profile().qualifiedListenCount).toBe(1))

      // Selecting it again restarts the session.
      usePlayerStore.getState().setCurrentTrack(null)
      await user.click(await startFirstTrendingTrack())
      await waitFor(() => expect(engine.playing).toBe(true))
      listenFor(engine, 35)

      await waitFor(() => expect(history()[0].playCount).toBe(2))
      expect(history()).toHaveLength(1)
    })

    it('builds an artist preference from what was actually played', async () => {
      const { user, engine } = renderApp()
      await user.click(await screen.findByRole('button', { name: 'Enable' }))

      await user.click(await startFirstTrendingTrack())
      await waitFor(() => expect(engine.playing).toBe(true))
      listenFor(engine, 40)

      await waitFor(() => expect(profile().artists.length).toBeGreaterThan(0))
      expect(profile().artists[0].name).toBe('Nova Sound')
    })
  })

  describe('Recently Played replays through the right engine', () => {
    it('replays a catalogue track through the audio engine', async () => {
      const { user, engine } = renderApp({
        personalization: makeState({
          listeningHistory: [
            makeEntry({ id: 'trk1', title: 'Midnight Signal', artist: 'Nova Sound', daysAgo: 0 }),
          ],
        }),
      })

      const shelf = (
        await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recent })
      ).closest('.music-section') as HTMLElement

      await user.click(
        within(shelf).getByRole('button', { name: /^Play Midnight Signal by Nova Sound$/ }),
      )

      await waitFor(() => expect(engine.playing).toBe(true))
      expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal')
      expect(usePlayerStore.getState().queueContext?.label).toBe(HOME_SECTION_TITLES.recent)
    })

    it('replays a YouTube entry through the embedded player, never the audio element', async () => {
      const { user, engine, youtube } = renderApp({
        personalization: makeState({
          listeningHistory: [
            makeEntry({
              id: 'aaaaaaaaaaa',
              provider: 'youtube',
              title: 'Night Signal',
              artist: 'Aster Vale',
              daysAgo: 0,
            }),
          ],
        }),
      })

      const shelf = (
        await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recent })
      ).closest('.music-section') as HTMLElement

      await user.click(within(shelf).getByRole('button', { name: /^Play Night Signal by Aster Vale$/ }))

      await waitFor(() => expect(useYouTubeStore.getState().item?.videoId).toBe('aaaaaaaaaaa'))
      expect(youtube.players.length).toBeGreaterThan(0)
      // The audio element was never asked to load anything.
      expect(engine.playing).toBe(false)
      expect(usePlayerStore.getState().currentTrack).toBeNull()
    })

    it('keeps the YouTube backlink on the card', async () => {
      renderApp({
        personalization: makeState({
          listeningHistory: [
            makeEntry({ id: 'aaaaaaaaaaa', provider: 'youtube', title: 'Night Signal', daysAgo: 0 }),
          ],
        }),
      })

      const shelf = (
        await screen.findByRole('heading', { name: HOME_SECTION_TITLES.recent })
      ).closest('.music-section') as HTMLElement

      const link = within(shelf).getByRole('link', { name: /Open Night Signal on YouTube/ })
      expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=aaaaaaaaaaa')
      // `noreferrer` is prohibited for YouTube API clients.
      expect(link.getAttribute('rel')).toBe('noopener')
    })
  })

  describe('search history', () => {
    it('records an explicitly submitted search, once', async () => {
      const { user } = renderApp({ personalization: makeState() })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending })

      const field = screen.getByLabelText('Search songs and artists')
      await user.type(field, 'night{Enter}')

      await waitFor(() =>
        expect(usePersonalizationStore.getState().state.searchHistory).toHaveLength(1),
      )
      const [entry] = usePersonalizationStore.getState().state.searchHistory
      expect(entry.query).toBe('night')
      expect(entry.submitCount).toBe(1)
    })

    it('records nothing while the visitor is only typing', async () => {
      const { user } = renderApp({ personalization: makeState() })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending })

      const field = screen.getByLabelText('Search songs and artists')
      // Search-as-you-type replaces history rather than pushing it, so no
      // submission key exists and nothing is recorded.
      await user.type(field, 'night')
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: /Results for/ })).toBeInTheDocument(),
      )

      expect(usePersonalizationStore.getState().state.searchHistory).toEqual([])
    })

    it('records nothing when personalization is off', async () => {
      const { user } = renderApp({ personalization: makeState({ consent: 'denied' }) })
      await screen.findByRole('heading', { name: HOME_SECTION_TITLES.trending })

      await user.type(screen.getByLabelText('Search songs and artists'), 'night{Enter}')
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: /Results for/ })).toBeInTheDocument(),
      )

      expect(usePersonalizationStore.getState().state.searchHistory).toEqual([])
    })
  })
})
