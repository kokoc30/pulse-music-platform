import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { showNotice } from '@/app/ui-store'
import { PlaybackSettings } from '@/components/settings/PlaybackSettings'
import { clearLibrary } from '@/library/library-actions'
import { useLibraryStore } from '@/library/store'
import { MAX_HISTORY_DAYS, MAX_HISTORY_ITEMS, MAX_SEARCH_HISTORY, YOUTUBE_RETENTION_DAYS } from '@/personalization/config'
import { usePersonalizationStore } from '@/personalization/store'

/**
 * Personalization settings.
 *
 * A separate route rather than controls scattered over the home page: clearing
 * your listening history is not something to trip over between two shelves
 * (STEP 16).
 *
 * The three clear actions are genuinely distinct, and each says exactly what it
 * removes before it removes it. Every one asks for confirmation first, in place,
 * with the destructive button clearly labelled — no `window.confirm`, which is
 * unstyleable, unannounced to assistive technology and trivially blocked.
 *
 * Volume and mute are stored under different keys entirely and no control here
 * touches them, which is what "Reset recommendations" preserving non-sensitive
 * UI settings means in practice.
 */
export function SettingsPage() {
  const consent = usePersonalizationStore((store) => store.state.consent)
  const status = usePersonalizationStore((store) => store.status)
  const storageAvailable = usePersonalizationStore((store) => store.storageAvailable)
  const listenCount = usePersonalizationStore((store) => store.state.listeningHistory.length)
  const searchCount = usePersonalizationStore((store) => store.state.searchHistory.length)
  const qualified = usePersonalizationStore((store) => store.profile.qualifiedListenCount)
  const setConsent = usePersonalizationStore((store) => store.setConsent)
  const clearListening = usePersonalizationStore((store) => store.clearListeningHistory)
  const clearSearches = usePersonalizationStore((store) => store.clearSearchHistory)
  const resetAll = usePersonalizationStore((store) => store.resetRecommendations)

  // The library is a separate domain with separate storage, so it reads from its
  // own store and its controls sit under their own heading. Clearing one must
  // never quietly clear the other (agents/44 → "Privacy").
  const likedCount = useLibraryStore((store) => store.state.likedTrackKeys.length)
  const playlistCount = useLibraryStore((store) => store.state.playlistOrder.length)
  const libraryCount = useLibraryStore((store) => Object.keys(store.state.tracks).length)
  const hiddenCount = useLibraryStore((store) => store.state.hiddenRecommendationKeys.length)
  const libraryStorageAvailable = useLibraryStore((store) => store.storageAvailable)
  const libraryHydrated = useLibraryStore((store) => store.hydrated)
  const resetHidden = useLibraryStore((store) => store.resetHidden)

  useEffect(() => {
    document.title = 'Settings — Pulse'
    return () => {
      document.title = 'Pulse — Music Discovery'
    }
  }, [])

  const enabled = consent === 'granted'

  return (
    <section className="search-results prose-page">
      <div className="result-title-row">
        <div>
          <p className="eyebrow">About this app</p>
          <h1>Settings</h1>
        </div>
      </div>

      <div className="prose">
        <PlaybackSettings />

        <h2>Personalised listening history</h2>
        <p>
          Pulse can remember what you play and search for so your home page suggests music instead
          of always showing the same charts. <b>Everything stays in this browser</b> — there is no
          account, nothing is uploaded to Pulse, and nothing follows you to another device or
          another browser on this one.
        </p>

        {!storageAvailable && status === 'unavailable' ? (
          <p className="settings-warning" role="status">
            This browser is not allowing Pulse to store anything, so personalisation is switched off.
            Search and playback still work normally.
          </p>
        ) : null}

        <div className="settings-row">
          <div>
            <b>{enabled ? 'Personalisation is on' : 'Personalisation is off'}</b>
            <span>
              {enabled
                ? `${listenCount} ${listenCount === 1 ? 'item' : 'items'} and ${searchCount} ${searchCount === 1 ? 'search' : 'searches'} remembered on this device · ${qualified} qualifying ${qualified === 1 ? 'listen' : 'listens'}.`
                : 'Nothing is being recorded. Your home page shows the general discovery shelves.'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setConsent(enabled ? 'denied' : 'granted')
              showNotice(
                enabled
                  ? 'Personalisation is off. Your local history has been deleted.'
                  : 'Personalisation is on for this browser.',
              )
            }}
            disabled={!storageAvailable}
          >
            {enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
        {enabled ? null : (
          <p className="settings-hint">Turning it off also deletes whatever was already stored.</p>
        )}

        <h2>Clear what is stored</h2>

        <DestructiveAction
          id="clear-listening"
          title="Clear listening history"
          description="Removes every track and video Pulse has remembered on this device, and the listening preferences worked out from them. Your submitted searches are kept."
          confirmLabel="Clear listening history"
          disabled={!enabled || listenCount === 0}
          onConfirm={() => {
            clearListening()
            showNotice('Listening history cleared.')
          }}
        />

        <DestructiveAction
          id="clear-searches"
          title="Clear search history"
          description="Removes the searches you have submitted and their contribution to your suggestions. Your listening history is kept."
          confirmLabel="Clear search history"
          disabled={!enabled || searchCount === 0}
          onConfirm={() => {
            clearSearches()
            showNotice('Search history cleared.')
          }}
        />

        <DestructiveAction
          id="reset-recommendations"
          title="Reset recommendations"
          description="Clears every personalisation signal — listening history, searches and dismissed suggestions — and returns your home page to the general discovery shelves. Your volume and mute settings are not affected."
          confirmLabel="Reset recommendations"
          disabled={!enabled || (listenCount === 0 && searchCount === 0)}
          onConfirm={() => {
            resetAll()
            showNotice('Recommendations reset.')
          }}
        />

        <h2>Your Library</h2>
        <p>
          Liked Songs and playlists are saved <b>in this browser</b>, in its own storage, separately
          from your listening history. There is no Pulse account and no cloud sync, so they do not
          follow you to another device or another browser. Liking something in Pulse{' '}
          <b>does not</b> change your Audius, Jamendo or YouTube account — Pulse is not signed in to
          any of them.
        </p>

        <div className="settings-row">
          <div>
            <b>Saved on this device</b>
            <span>
              {likedCount} liked {likedCount === 1 ? 'song' : 'songs'} · {playlistCount}{' '}
              {playlistCount === 1 ? 'playlist' : 'playlists'} · {libraryCount} saved{' '}
              {libraryCount === 1 ? 'item' : 'items'}.
            </span>
          </div>
          <Link className="retry-button" to="/library">
            Open Your Library
          </Link>
        </div>

        {/* Not a live region, unlike the confirmations below. This describes a
            standing condition that is true from first paint and read in document
            order; announcing it as a status would repeat it on unrelated
            re-renders and compete with the confirmation that follows. */}
        {!libraryStorageAvailable && libraryHydrated ? (
          <p className="settings-warning">
            This browser is not letting Pulse store a library, so anything you save will be lost when
            you close the tab. Search and playback still work normally.
          </p>
        ) : null}

        <DestructiveAction
          id="reset-hidden"
          title="Reset hidden recommendations"
          description="Brings back everything you marked Not interested, so it can be suggested again. Your Liked Songs and playlists are not affected."
          confirmLabel="Reset hidden recommendations"
          disabled={hiddenCount === 0}
          onConfirm={() => {
            resetHidden()
            showNotice('Hidden recommendations reset.')
          }}
        />

        <DestructiveAction
          id="clear-library"
          title="Clear Library"
          description="Deletes every Liked Song, every playlist and every hidden-recommendation record saved in this browser. Because likes and playlists are themselves the signal, this also removes their influence on your recommendations. Your listening history, search history, volume and playback settings are not touched, and nothing changes on Audius, Jamendo or YouTube."
          confirmLabel="Clear Library"
          disabled={libraryCount === 0 && hiddenCount === 0}
          onConfirm={() => {
            void clearLibrary()
            showNotice('Your library has been cleared on this device.')
          }}
        />

        <h2>What is kept, and for how long</h2>
        <ul>
          <li>
            Music you play from Audius and Jamendo: up to {MAX_HISTORY_ITEMS} items, for up to{' '}
            {MAX_HISTORY_DAYS} days since you last played them.
          </li>
          <li>Searches you submit: the {MAX_SEARCH_HISTORY} most recent, deduplicated.</li>
          <li>
            Your library: the songs you like and the playlists you make, kept until you delete them.
            For each saved song Pulse keeps only the title, artist, cover image address, duration and
            the provider&rsquo;s own page — never a stream address.
          </li>
          <li>
            YouTube videos you play: title, channel, thumbnail address and duration only, deleted
            automatically within {YOUTUBE_RETENTION_DAYS} days, as YouTube&rsquo;s API policies
            require. No YouTube statistics are stored, and YouTube data never contributes to your
            music suggestions.
          </li>
          <li>
            Never stored: audio or video files, stream addresses, API keys or any credential.
          </li>
        </ul>

        <p className="prose-back">
          <Link to="/privacy">Read the full privacy page</Link> · <Link to="/">Back to Pulse</Link>
        </p>
      </div>
    </section>
  )
}

interface DestructiveActionProps {
  id: string
  title: string
  description: string
  confirmLabel: string
  disabled: boolean
  onConfirm: () => void
}

/**
 * A clear/reset control with in-place confirmation.
 *
 * The first press only reveals the confirmation, so nothing is deleted by a
 * stray click; the second press is explicitly labelled with what it will do. The
 * confirmation is a live region, so it is announced rather than silently
 * appearing (STEP 27).
 */
function DestructiveAction({
  id,
  title,
  description,
  confirmLabel,
  disabled,
  onConfirm,
}: DestructiveActionProps) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="settings-row settings-row-destructive">
      <div>
        <b id={`${id}-title`}>{title}</b>
        <span id={`${id}-description`}>{description}</span>
        {confirming ? (
          <span className="settings-confirm" role="status">
            This cannot be undone.
          </span>
        ) : null}
      </div>
      {confirming ? (
        <div className="settings-actions">
          <button type="button" className="ghost-button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => {
              setConfirming(false)
              onConfirm()
            }}
          >
            {confirmLabel}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-describedby={`${id}-description`}
          onClick={() => setConfirming(true)}
        >
          {title}
        </button>
      )}
    </div>
  )
}
