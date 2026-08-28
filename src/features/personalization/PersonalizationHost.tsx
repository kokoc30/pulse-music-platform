import { useEffect } from 'react'
import { pickArtwork } from '@/music/normalize'
import type { Track, YouTubeVideoItem } from '@/music/types'
import { getAudioEngine } from '@/player/audio-engine'
import { usePlayerStore } from '@/player/player-store'
import type { QueueContext } from '@/player/player-store'
import { useYouTubeStore } from '@/player/youtube-store'
import { createListenTracker } from '@/personalization/listen-tracker'
import type { PlayedItem } from '@/personalization/history'
import { listenContextFor, searchQueryFor } from '@/personalization/play-context'
import { usePersonalizationStore } from '@/personalization/store'
import { YOUTUBE_PURGE_INTERVAL_MS } from '@/personalization/youtube-retention'

/**
 * Turns real playback into local listening history.
 *
 * Mounted once, above the router, beside `PlayerEngineHost` — for the same
 * reason: navigation must not restart a listen that is still in progress. It
 * renders nothing.
 *
 * **Two independent trackers.** The audio engine and the YouTube embed are
 * separate players with separate stores, and they stay separate here. A YouTube
 * video is never described as a `Track`, so it cannot reach the audio path, and
 * its metadata never mixes into the catalogue preference profile.
 *
 * **Cheap by construction.** The subscriptions read two fields and hand them to
 * a pure tracker; storage is written only when a listen qualifies, completes, is
 * skipped or is replaced. A `timeupdate` at 4 Hz costs one number comparison
 * (STEP 26).
 *
 * **Consent is checked at the point of writing, not here.** The trackers always
 * run; the store drops the result when personalization is off. That keeps the
 * "nothing is stored" guarantee in one place — the store's `commit` — rather
 * than spread across every subscriber (STEP 18).
 */
export function PersonalizationHost(): null {
  useEffect(() => {
    usePersonalizationStore.getState().hydrate()
  }, [])

  // Listening history from the audio engine.
  useEffect(() => {
    const tracker = createListenTracker((session) =>
      usePersonalizationStore.getState().recordSession(session),
    )

    let currentId: string | null = null

    const unsubscribeStore = usePlayerStore.subscribe((state) => {
      const track = state.currentTrack
      if (!track) {
        if (currentId !== null) {
          tracker.stop()
          currentId = null
        }
        return
      }

      if (track.id !== currentId) {
        currentId = track.id
        const item = toPlayedItem(track, state.queueContext)
        tracker.start(item)
        // Returning to something already in history is immediate evidence for
        // the shelf and none at all for the profile, so it moves the row to the
        // front without crediting a listen. A brand-new track is ignored here
        // and still has to qualify before it appears.
        usePersonalizationStore.getState().noteReplayStarted(item)
        return
      }

      tracker.progress(state.currentTime)
    })

    // `ended` is the only way to know a track finished rather than being
    // replaced, and the engine supports several subscribers, so this observes
    // without disturbing `PlayerEngineHost`.
    const unsubscribeEngine = getAudioEngine().subscribe({
      onEnded: () => {
        tracker.complete()
        currentId = null
      },
    })

    return () => {
      unsubscribeStore()
      unsubscribeEngine()
      // A closing tab still gets credit for what it heard.
      tracker.stop()
    }
  }, [])

  // Listening history from the YouTube surface.
  useEffect(() => {
    const tracker = createListenTracker((session) =>
      usePersonalizationStore.getState().recordSession(session),
    )

    let currentId: string | null = null

    const unsubscribe = useYouTubeStore.subscribe((state) => {
      const item = state.item
      if (!item) {
        if (currentId !== null) {
          tracker.stop()
          currentId = null
        }
        return
      }

      if (item.id !== currentId) {
        currentId = item.id
        const played = toYouTubePlayedItem(item)
        tracker.start(played)
        usePersonalizationStore.getState().noteReplayStarted(played)
      }

      if (state.status === 'ended') {
        tracker.complete()
        currentId = null
        return
      }

      tracker.progress(state.currentTime)
    })

    return () => {
      unsubscribe()
      tracker.stop()
    }
  }, [])

  // The YouTube retention sweep. Start-up is covered by `hydrate()`; this keeps
  // a tab left open for weeks from ever surfacing an expired entry.
  useEffect(() => {
    const timer = setInterval(
      () => usePersonalizationStore.getState().purgeExpired(),
      YOUTUBE_PURGE_INTERVAL_MS,
    )
    return () => clearInterval(timer)
  }, [])

  return null
}

/** Allow-listed projection of a catalogue track. Never spreads the track. */
function toPlayedItem(track: Track, queueContext: QueueContext | null): PlayedItem {
  const item: PlayedItem = {
    provider: track.provider,
    providerItemId: track.providerId,
    title: track.title,
    artist: track.artistName,
    durationSeconds: track.durationSeconds,
    context: listenContextFor(queueContext),
  }
  if (track.artistId) item.artistId = track.artistId
  const artworkUrl = pickArtwork(track.artwork, 'medium')
  if (artworkUrl) {
    item.artworkUrl = artworkUrl
    // The mirror origins travel with the URL. Without them a history card has a
    // single candidate, and one unhealthy Audius content node — which is a
    // routine occurrence — leaves it on the blank placeholder while every other
    // card in the app fails over and renders.
    if (track.artwork.mirrors?.length) item.artworkMirrors = track.artwork.mirrors
  }
  if (track.genre) item.genre = track.genre
  // The Jamendo backlink its API terms require, and the Audius permalink.
  const sourceUrl = track.sourceUrl ?? track.permalink
  if (sourceUrl) item.sourceUrl = sourceUrl
  const searchQuery = searchQueryFor(queueContext)
  if (searchQuery) item.searchQuery = searchQuery
  return item
}

/**
 * Allow-listed projection of a YouTube video.
 *
 * Title, channel, thumbnail URL, duration and the watch-page backlink — the same
 * fields already displayed on screen, and nothing else. No statistics are
 * requested by this app in the first place, so none can be recorded here
 * (docs/youtube-personalization-policy-audit.md §5).
 */
function toYouTubePlayedItem(item: YouTubeVideoItem): PlayedItem {
  const played: PlayedItem = {
    provider: 'youtube',
    providerItemId: item.videoId,
    title: item.title,
    artist: item.channelTitle,
    sourceUrl: item.sourceUrl,
    embeddable: item.embeddable,
    madeForKids: item.madeForKids,
    context: 'search',
  }
  if (item.thumbnailUrl) played.thumbnailUrl = item.thumbnailUrl
  if (item.durationSeconds) played.durationSeconds = item.durationSeconds
  return played
}
