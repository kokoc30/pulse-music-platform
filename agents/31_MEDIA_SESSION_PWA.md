# Media Session + PWA

## Media Session
Use `navigator.mediaSession` only for `provider: audius | jamendo`, `mediaKind: audio`.

Feature-detect and register handlers safely:
- play
- pause
- stop
- previoustrack
- nexttrack
- seekto
- seekbackward
- seekforward

All handlers must call existing player/queue actions. Never reimplement playback or queue logic.

Set `MediaMetadata` from the current audio track:
- title
- artist
- album only when real
- safe artwork from the existing artwork resolver/failover

Mirror the real player with:
- `navigator.mediaSession.playbackState`
- `setPositionState()` when supported

Throttle position updates; do not write them at high frequency.

For audio providers, do not pause merely because `document.hidden === true`. Let the browser/OS continue audio where supported.

When switching to YouTube, clear/suspend Pulse's app-owned audio Media Session integration. Preserve the existing YouTube hidden-document pause rule.

## Stop/notification
Map the Media Session `stop` action to the existing stop action. Clear Media Session state/metadata when stopped. On Chromium, clearing the audio source may dismiss the notification if compatible with the current engine, but do not assume swiping a system notification invokes the site's handler on every OS.

## PWA
Add a valid manifest:
- `name`: Pulse Music Platform
- `short_name`: Pulse
- `start_url`: `/`
- `scope`: `/`
- `display`: `standalone`
- existing Pulse theme/background colors
- 192×192 icon
- 512×512 icon
- maskable icon when possible

Use existing branding.

Add a subtle Install Pulse control in Settings:
- Chromium: progressive enhancement via `beforeinstallprompt`
- iOS: only show Add to Home Screen instructions after explicit user interest

## Service worker
Use it only for app-shell/static assets.

Never intentionally cache:
- Audius/Jamendo audio streams
- signed Audius stream URLs
- YouTube audiovisual content
- `/api/youtube`
- `/api/jamendo`

Do not build offline song downloads.

Never attempt audio playback inside a service worker.
