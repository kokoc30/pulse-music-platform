# Native future path

## What the web/PWA can deliver
On supporting browsers:
- installed app-like launch
- Audius/Jamendo background audio while the page/app is backgrounded or screen locked
- lock-screen/media notification metadata
- play/pause/next/previous/seek controls
- headset/media-key controls
- intelligent autoplay

## What it cannot guarantee
Do not promise:
- continued playback after force-close
- playback after OS process eviction
- identical controls on every browser/device
- native Android foreground-service behavior
- native iOS background-audio entitlement behavior

A service worker cannot close this gap.

## If true Spotify-class native lifecycle behavior becomes required
Use a later native shell/app.

A practical route is Capacitor around the existing React/Vite UI, with native playback integrations:
- Android: current platform MediaSession/Media3 foreground playback architecture
- iOS: AVAudioSession playback category + Audio/AirPlay/Picture-in-Picture background mode + Now Playing controls

Do not implement this in Phase 6.

A native wrapper still does not grant permission to background-play YouTube API content.
