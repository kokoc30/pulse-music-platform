# 21 — YouTube Policy and Product Boundaries

## Playback Boundary

YouTube audiovisual content must play only through the supported embedded YouTube player.

Never:
- separate audio/video,
- expose MP3/audio URLs,
- download/cache/rehost audiovisual content,
- proxy media bytes,
- hide the player while playing,
- intentionally support background playback,
- obscure native controls,
- block/alter ads,
- modify YouTube player behavior outside documented APIs.

The existing HTMLAudioElement remains only for Audius/Jamendo.

## Visible Player

Current official minimum embedded-player viewport is at least **200px x 200px**. Current guidance recommends 16:9 around **480x270** where practical.

Use one persistent visible player surface while a YouTube item is active. Do not use `display:none`, zero opacity, offscreen positioning, or collapsed dimensions while playing.

If the user closes the YouTube surface, pause/stop YouTube.

## No Overlay

Nothing may cover the iframe, including custom controls, gradients, click interceptors, or decorative frames. Place app controls outside the iframe.

Keep native YouTube controls enabled and usable.

## Background Playback

On `document.visibilitychange`, if the document becomes hidden and YouTube is playing, pause YouTube. Do not intentionally enable hidden/background playback.

## Automatic Playback

Direct user click may activate YouTube playback after the player is visibly rendered. Scripted/autoplay transitions must obey current YouTube visibility requirements; current guidance requires the player to be visible and more than half visible before automatic playback.

If uncertain, cue/select the next YouTube item and require an explicit play action.

## Domain Model

Do not pretend YouTube is a normal audio track. Prefer a discriminated model:

```ts
type MediaItem = AudioTrack | YouTubeVideoItem

interface AudioTrack {
  mediaKind: 'audio'
  provider: 'audius' | 'jamendo'
}

interface YouTubeVideoItem {
  mediaKind: 'youtube-video'
  provider: 'youtube'
  videoId: string
  title: string
  channelTitle: string
  thumbnailUrl: string
  sourceUrl: string
  madeForKids: boolean | null
}
```

Never put a YouTube embed/watch URL into `HTMLAudioElement.src`.

## Attribution

Every YouTube result must be clearly identifiable as YouTube content. Preserve title/channel identity and unmodified YouTube thumbnail presentation. Provide a direct YouTube watch link and follow current YouTube branding guidance.
