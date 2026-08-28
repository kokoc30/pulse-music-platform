import { useEffect, useState } from 'react'
import { showNotice } from '@/app/ui-store'
import {
  isInstallAvailable,
  isRunningInstalled,
  needsManualInstallGuidance,
  onInstallAvailabilityChange,
  promptInstall,
} from '@/pwa/install'
import { usePlayerStore } from '@/player/player-store'

/**
 * Playback preferences and the install affordance.
 *
 * Both belong in Settings rather than on the home page: neither is something a
 * visitor should trip over, and an install prompt over the content is exactly
 * the nag this app has avoided everywhere else.
 */
export function PlaybackSettings() {
  const autoplaySimilar = usePlayerStore((state) => state.autoplaySimilar)
  const setAutoplaySimilar = usePlayerStore((state) => state.setAutoplaySimilar)

  return (
    <>
      <h2>Playback</h2>

      <div className="settings-row">
        <div>
          <b>Autoplay similar music</b>
          <span>
            When your queue runs out, keep playing something similar from the Audius and Jamendo
            catalogues. Chosen on this device from the track that just finished — its genre, tags,
            mood and tempo. YouTube is never played automatically.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoplaySimilar}
          aria-label="Autoplay similar music"
          onClick={() => {
            setAutoplaySimilar(!autoplaySimilar)
            showNotice(
              autoplaySimilar
                ? 'Autoplay is off. Playback will stop when the queue ends.'
                : 'Autoplay is on. Similar music will keep playing.',
            )
          }}
        >
          {autoplaySimilar ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      <InstallRow />
    </>
  )
}

/**
 * Install Pulse.
 *
 * Three different browsers, three honest answers: Chromium can be asked
 * directly, iOS needs written steps, and everything else is told plainly that
 * its browser decides. Nothing is shown to a visitor who already installed it.
 */
function InstallRow() {
  const [available, setAvailable] = useState(isInstallAvailable)
  const [installed, setInstalled] = useState(isRunningInstalled)
  const [showIosSteps, setShowIosSteps] = useState(false)

  useEffect(() => {
    setInstalled(isRunningInstalled())
    return onInstallAvailabilityChange(setAvailable)
  }, [])

  if (installed) {
    return (
      <div className="settings-row">
        <div>
          <b>Pulse is installed</b>
          <span>
            You are running the installed app. Audio keeps playing when you switch apps or lock the
            screen, for as long as your device allows it.
          </span>
        </div>
      </div>
    )
  }

  const manual = needsManualInstallGuidance()

  return (
    <>
      <div className="settings-row">
        <div>
          <b>Install Pulse</b>
          <span>
            Adds Pulse to your home screen and opens it in its own window, with lock-screen playback
            controls. Nothing extra is downloaded and no account is involved.
          </span>
        </div>
        {available ? (
          <button
            type="button"
            onClick={() => {
              void promptInstall().then((outcome) => {
                if (outcome === 'accepted') showNotice('Pulse is being installed.')
              })
            }}
          >
            Install
          </button>
        ) : manual ? (
          <button type="button" onClick={() => setShowIosSteps((shown) => !shown)}>
            {showIosSteps ? 'Hide steps' : 'How to install'}
          </button>
        ) : (
          <button type="button" disabled aria-describedby="install-unavailable">
            Install
          </button>
        )}
      </div>

      {/* Shown only once asked for: iOS offers no install API, so the steps are
          written out rather than guessed at on the visitor's behalf. */}
      {showIosSteps ? (
        <p className="settings-hint" data-testid="ios-install-steps">
          In Safari, press the Share button, then <b>Add to Home Screen</b>, then <b>Add</b>. Pulse
          will open in its own window from your home screen.
        </p>
      ) : null}

      {!available && !manual ? (
        <p className="settings-hint" id="install-unavailable">
          Your browser has not offered an install for Pulse yet. Chrome and Edge usually offer one
          after you have visited a few times; Firefox and desktop Safari do not install web apps.
        </p>
      ) : null}
    </>
  )
}
