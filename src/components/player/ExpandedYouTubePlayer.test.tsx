import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { renderApp } from '@/test/render'
import { installIntersectionObserver } from '@/test/intersection'
import type { IntersectionHarness } from '@/test/intersection'
import { audiusRef, libraryWith, youtubeRef } from '@/test/fixtures/library'
import { youtubePayload } from '@/test/fixtures/youtube'
import { normalizeYouTubeVideo } from '@/music/youtube'
import { useLibraryStore } from '@/library/store'
import { collectionSession } from '@/player/collection-session'
import { activeEngine } from '@/player/playback-coordinator'
import { usePlayerStore } from '@/player/player-store'
import { unifiedNext } from '@/player/unified-actions'
import { playYouTubeResult } from '@/player/youtube-actions'
import { useYouTubeStore } from '@/player/youtube-store'
import { resetYouTubeVisibility } from '@/player/youtube-visibility'

/**
 * The two defects a real phone showed, and the rules that replace them.
 *
 * **Bug A.** A Liked Songs list of `Audio A, YouTube B, Audio C`. A finished, the
 * collection correctly advanced to B, the metadata changed — and the visitor was
 * left looking at a page with a cued video docked at the bottom, needing to find
 * and press something to hear the song the list had already moved on to. The
 * cause was a measurement taken before the thing it measures existed: the
 * collection read `youTubeVisibleRatio()` at the moment it *decided* B was next,
 * when the stage had not mounted, no observer had run and the honest answer was
 * "there is no player". The zero was then treated as an observation, and
 * `mayAutoplay` — correctly, given a zero — refused.
 *
 * **Bug B.** Expanding a video drew the full Now Playing panel *above* a bottom
 * bar that was still on screen with its own Play, its own Next and Previous, its
 * own heart, its own progress rail, and the 200px live video itself. Two of every
 * control, over one player. The cause was structural: the embed had to live
 * somewhere permanent, it lived in the bar, and so the panel was laid out to stop
 * short of the bar rather than replace it.
 *
 * Every test below drives the real actions and the real components. The one
 * thing doubled is the environment: jsdom has no `IntersectionObserver`, so a
 * real one with a test-chosen ratio is installed. Nothing writes a ratio into the
 * module the production code reads — the number always arrives through an
 * observation of the actual stage element, which is what makes "it did not fake
 * the visibility" a claim these tests can support.
 */

const LIKED_CONTEXT = { id: 'library:liked', label: 'Liked Songs' }

const VIDEO_B = youtubeRef({
  key: 'youtube:aaaaaaaaaaa',
  providerItemId: 'aaaaaaaaaaa',
  title: 'Tangarjhek Manyak',
  artist: 'Aram Asatryan - Topic',
})

/** Audio A, YouTube B, Audio C — the list from the report. */
const mixedLibrary = () =>
  libraryWith({
    tracks: [
      audiusRef({ key: 'audius:trk1', providerItemId: 'trk1', title: 'Midnight Signal' }),
      VIDEO_B,
      audiusRef({ key: 'audius:trk3', providerItemId: 'trk3', title: 'No Artwork Here' }),
    ],
    liked: ['audius:trk1', 'youtube:aaaaaaaaaaa', 'audius:trk3'],
  })

let observer: IntersectionHarness

beforeEach(() => {
  resetYouTubeVisibility()
  observer = installIntersectionObserver(0)
})

afterEach(() => {
  observer.restore()
  resetYouTubeVisibility()
})

async function hydrated() {
  await waitFor(() => expect(useLibraryStore.getState().hydrated).toBe(true))
}

/** Starts the mixed collection on its first, catalogue, item. */
async function startMixedCollection(visibleRatio: number) {
  // Chosen *before* the transition, so the observation that eventually arrives
  // is caused by the stage mounting rather than by this line.
  observer.setRatio(visibleRatio)

  const harness = renderApp({ route: '/library/liked', library: mixedLibrary() })
  await hydrated()
  usePlayerStore.setState({ autoplaySimilar: false })

  await harness.user.click(await screen.findByRole('button', { name: /^Play Midnight Signal/ }))
  await waitFor(() => expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal'))
  return harness
}

/** The audio track finishes on its own, with nobody touching anything. */
async function letTheTrackEnd(engine: { emitEnded: () => void }) {
  await act(async () => {
    engine.emitEnded()
    await Promise.resolve()
  })
}

const expanded = () => screen.queryByRole('dialog', { name: 'Now playing' })
const miniPlayer = () => document.querySelector('.music-player')
const stages = () => screen.queryAllByTestId('youtube-stage')

/** Every embedded player on the page, however it got there. */
const embeddedFrames = () =>
  document.querySelectorAll('iframe[title="YouTube video player"]').length

/* ==========================================================================
   Bug A — the collection hand-off into a saved video
   ========================================================================== */

describe('a saved list reaching a video on its own', () => {
  it('opens the expanded player, with the video in it, without anyone swiping', async () => {
    const { engine } = await startMixedCollection(0.95)

    await letTheTrackEnd(engine)

    await waitFor(() => expect(useYouTubeStore.getState().item?.title).toBe('Tangarjhek Manyak'))
    // The whole of Bug A: the list moved on, and so did the screen.
    const dialog = await screen.findByRole('dialog', { name: 'Now playing' })
    expect(within(dialog).getByRole('heading', { name: 'Tangarjhek Manyak' })).toBeInTheDocument()
    expect(dialog.contains(stages()[0])).toBe(true)
    expect(activeEngine()).toBe('youtube')
  })

  /**
   * The measurement, and the proof that it is one.
   *
   * The observer is asked for 0.95 and the video plays. Nothing wrote 0.95 into
   * `youtube-visibility`; the only route it takes is an `IntersectionObserver`
   * entry for the stage element, so the assertion that the stage is under
   * observation is part of the claim rather than decoration.
   */
  it('starts the video once the real observer reports the player is visible', async () => {
    const { engine } = await startMixedCollection(0.95)

    await letTheTrackEnd(engine)

    await waitFor(() => expect(useYouTubeStore.getState().status).toBe('playing'))
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(false)
    // The number came from an observation of the player itself.
    expect(observer.observed()).toContain(stages()[0])
  })

  it('cues and waits when the observer settles below the threshold', async () => {
    const { engine } = await startMixedCollection(0.4)

    await letTheTrackEnd(engine)

    await waitFor(() => expect(useYouTubeStore.getState().item?.title).toBe('Tangarjhek Manyak'))
    // Revealed, ready, and stopped — never started behind a visitor who cannot
    // see it, and never skipped either.
    expect(expanded()).not.toBeNull()
    expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
    expect(useYouTubeStore.getState().status).toBe('cued')
    expect(within(expanded()!).getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('does not begin a video while the document is hidden, and keeps it', async () => {
    const { engine } = await startMixedCollection(0.95)
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

    try {
      await letTheTrackEnd(engine)

      await waitFor(() => expect(useYouTubeStore.getState().item?.title).toBe('Tangarjhek Manyak'))
      expect(useYouTubeStore.getState().awaitingUserPlay).toBe(true)
      // Held at B rather than skipped past it to C.
      expect(usePlayerStore.getState().currentTrack?.title).not.toBe('No Artwork Here')
      expect(collectionSession().position).toBe(1)
    } finally {
      hidden.mockRestore()
    }
  })

  it('carries on into the next saved catalogue item when the video ends', async () => {
    const { engine, youtube } = await startMixedCollection(0.95)
    await letTheTrackEnd(engine)
    await waitFor(() => expect(useYouTubeStore.getState().status).toBe('playing'))

    // Exactly what the IFrame API sends when a video finishes.
    await act(async () => {
      youtube.current()?.emitState(0)
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(usePlayerStore.getState().currentTrack?.title).toBe('No Artwork Here'),
    )
    expect(activeEngine()).toBe('audio')
    // The same expanded view stayed open and changed its content in place: the
    // large cover is where the video was, and no second surface was opened.
    expect(expanded()).not.toBeNull()
    expect(expanded()!.querySelector('.now-playing-art')).not.toBeNull()
    expect(stages()).toHaveLength(0)
  })

  it("answers Next with the collection's next item, not an old search result", async () => {
    // A search session is open on the same video, from before.
    const results = ['bbbbbbbbbbb', 'aaaaaaaaaaa', 'ccccccccccc'].map((videoId) =>
      normalizeYouTubeVideo(youtubePayload({ videoId })),
    )
    observer.setRatio(0.95)
    const harness = renderApp({ route: '/library/liked', library: mixedLibrary() })
    await hydrated()
    usePlayerStore.setState({ autoplaySimilar: false })
    await act(async () => {
      await playYouTubeResult(results, results[1], 'a query')
    })

    // Now the visitor plays the list instead, and it reaches the same video.
    await harness.user.click(await screen.findByRole('button', { name: /^Play Midnight Signal/ }))
    await waitFor(() =>
      expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal'),
    )
    await letTheTrackEnd(harness.engine)
    await waitFor(() => expect(useYouTubeStore.getState().item?.title).toBe('Tangarjhek Manyak'))

    await act(async () => {
      unifiedNext()
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(usePlayerStore.getState().currentTrack?.title).toBe('No Artwork Here'),
    )
    expect(useYouTubeStore.getState().item?.videoId).not.toBe('ccccccccccc')
  })
})

/* ==========================================================================
   Bug B — one presentation at a time
   ========================================================================== */

describe('the expanded view for a video', () => {
  async function expandedOnVideo() {
    const harness = await startMixedCollection(0.95)
    await letTheTrackEnd(harness.engine)
    await screen.findByRole('dialog', { name: 'Now playing' })
    return harness
  }

  it('replaces the mini-player rather than sitting on top of it', async () => {
    await expandedOnVideo()

    // The screenshot's defect, stated directly: there is no bottom bar left
    // underneath to be a second player.
    expect(miniPlayer()).toBeNull()
  })

  it('shows exactly one of every transport control', async () => {
    await expandedOnVideo()

    // Scoped to the player rather than to the panel, because the claim is about
    // the player as a whole: a duplicate in a bar docked underneath would be a
    // second answer to the same question wherever inside it lived.
    const player = within(document.querySelector('.player-shell') as HTMLElement)
    expect(player.getAllByRole('button', { name: /^(Play|Pause)$/ })).toHaveLength(1)
    expect(player.getAllByRole('button', { name: 'Next track' })).toHaveLength(1)
    expect(player.getAllByRole('button', { name: 'Previous track' })).toHaveLength(1)
    expect(player.getAllByRole('button', { name: /Liked Songs in Pulse$/ })).toHaveLength(1)
    expect(player.getAllByRole('slider', { name: 'Seek' })).toHaveLength(1)
    // One progress presentation, not two: the mini-player's rail is not on the
    // page to be a second one.
    expect(document.querySelectorAll('.progress')).toHaveLength(1)
  })

  it('puts the video in the primary media region, above the title', async () => {
    await expandedOnVideo()
    const dialog = expanded()!

    const frame = dialog.querySelector('.yt-stage-frame')
    const title = dialog.querySelector('.now-playing-titles')
    expect(frame).not.toBeNull()
    expect(title).not.toBeNull()
    // `DOCUMENT_POSITION_FOLLOWING` — the title comes after the video.
    expect(frame!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // And the collapse handle comes before both.
    const handle = dialog.querySelector('.now-playing-head')
    expect(handle!.compareDocumentPosition(frame!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never has more than one embedded player on the page', async () => {
    const { user } = await expandedOnVideo()
    expect(embeddedFrames()).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(expanded()).toBeNull())
    expect(embeddedFrames()).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Open Now Playing' }))
    await screen.findByRole('dialog', { name: 'Now playing' })
    expect(embeddedFrames()).toBe(1)
  })

  /**
   * The identity claim, which is why the stage is a sibling of both
   * presentations rather than a child of either.
   *
   * Reparenting an iframe reloads it, so expanding and collapsing must not do
   * it. The same DOM node, the same engine player and the same position survive
   * a full round trip.
   */
  it('keeps the same player, position and session across expand and collapse', async () => {
    const { user, youtube } = await expandedOnVideo()
    const stage = stages()[0]
    const player = youtube.current()
    useYouTubeStore.getState().setProgress(73, 240)

    await user.click(screen.getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(expanded()).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Open Now Playing' }))
    await screen.findByRole('dialog', { name: 'Now playing' })

    expect(stages()[0]).toBe(stage)
    expect(youtube.current()).toBe(player)
    // One player was ever built, and it was never destroyed on the way.
    expect(youtube.created).toBe(1)
    expect(useYouTubeStore.getState().currentTime).toBe(73)
    expect(collectionSession().context).toEqual(LIKED_CONTEXT)
  })

  it('registers one visibility observer, not one per presentation', async () => {
    const { user } = await expandedOnVideo()
    const before = observer.activeObservers()

    await user.click(screen.getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(expanded()).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Open Now Playing' }))
    await screen.findByRole('dialog', { name: 'Now playing' })

    expect(observer.activeObservers()).toBe(before)
  })

  it('leaves one compact presentation behind when it comes down', async () => {
    const { user } = await expandedOnVideo()

    await user.click(screen.getByRole('button', { name: 'Collapse Now Playing' }))
    await waitFor(() => expect(expanded()).toBeNull())

    // One bar, one player, and no leftover expanded controls under it.
    expect(miniPlayer()).not.toBeNull()
    expect(stages()).toHaveLength(1)
    expect(document.querySelectorAll('.now-playing-body')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Collapse Now Playing' })).toBeNull()
    // Still the same video, still playing.
    expect(useYouTubeStore.getState().item?.title).toBe('Tangarjhek Manyak')
    expect(useYouTubeStore.getState().status).toBe('playing')
  })

  /**
   * Hiding the bar with CSS would leave every one of its controls in the
   * accessibility tree and in the Tab order, which is the same defect wearing a
   * different hat: a visitor tabbing through the expanded player would reach a
   * second Play they cannot see. Nothing is hidden — the mini-player is simply
   * not rendered.
   */
  it('leaves no focusable control from the other presentation', async () => {
    await expandedOnVideo()
    const dialog = expanded()!

    // Every player control on the page is inside the expanded view. The page
    // behind it keeps its own buttons — it is a modal over a page, not a
    // replacement for one — but there is no second *player* to tab into.
    for (const name of ['Next track', 'Previous track', 'Open Now Playing']) {
      for (const control of screen.queryAllByRole('button', { name })) {
        expect(dialog.contains(control)).toBe(true)
      }
    }
    expect(screen.queryByRole('button', { name: /Close the YouTube player/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Now Playing' })).toBeNull()
  })
})

/* ==========================================================================
   A direct press is treated the same way
   ========================================================================== */

describe('pressing a saved video', () => {
  it('opens the expanded player and starts it, keeping the collection', async () => {
    observer.setRatio(0.95)
    const { user } = renderApp({ route: '/library/liked', library: mixedLibrary() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play Tangarjhek Manyak/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Now playing' })
    expect(within(dialog).getByRole('heading', { name: 'Tangarjhek Manyak' })).toBeInTheDocument()
    await waitFor(() => expect(useYouTubeStore.getState().status).toBe('playing'))
    expect(embeddedFrames()).toBe(1)
    expect(
      within(document.querySelector('.player-shell') as HTMLElement).getAllByRole('button', {
        name: /^(Play|Pause)$/,
      }),
    ).toHaveLength(1)
    // Origin is preserved: this is the list's second item, not a lone video.
    expect(collectionSession().context).toEqual(LIKED_CONTEXT)
    expect(collectionSession().position).toBe(1)
  })
})

/* ==========================================================================
   Audio is not dragged along
   ========================================================================== */

describe('an audio track', () => {
  it('still starts in the mini-player, with nothing expanded', async () => {
    observer.setRatio(0.95)
    const { user } = renderApp({ route: '/library/liked', library: mixedLibrary() })
    await hydrated()

    await user.click(await screen.findByRole('button', { name: /^Play Midnight Signal/ }))
    await waitFor(() =>
      expect(usePlayerStore.getState().currentTrack?.title).toBe('Midnight Signal'),
    )

    expect(expanded()).toBeNull()
    expect(miniPlayer()).not.toBeNull()
  })
})
