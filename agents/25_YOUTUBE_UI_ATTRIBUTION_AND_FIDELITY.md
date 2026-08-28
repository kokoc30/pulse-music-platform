# 25 — YouTube UI, Attribution, and Reference Fidelity

## Required Reference Deviation

YouTube video results cannot be disguised as ordinary square-artwork audio rows. Document all YouTube UI additions in `docs/reference-deviations.md`.

## Fallback State

Minimal extension:

```text
No strong matches found on Audius or Jamendo.
[ Search YouTube ]
```

If configured, a subtle `Search YouTube for more` action may also appear after normal results.

## Results Section

Render a separately labeled section:

```text
YouTube results
```

Do not silently merge YouTube videos into `Songs`.

Each item shows:
- unmodified 16:9 thumbnail,
- title,
- channel title,
- YouTube source attribution,
- duration if available,
- direct YouTube watch link.

Do not crop thumbnails into square album art or apply visual filters over them.

## Suggested Thumbnail Geometry

Desktop row: roughly 80x45 or equivalent 16:9.

Larger card: 160x90 or larger 16:9.

Mobile: preserve 16:9.

## Visible Player Surface

When a YouTube item is active, render a persistent player surface that remains visible across app navigation or pause if it cannot remain visible.

Desktop: aim around 480x270 where practical.

Mobile: full width and at least policy minimum dimensions; never obscure native controls.

No overlays on iframe.

## Bottom Player

Existing bottom metadata may display title/channel/provider, but do not crop a YouTube thumbnail into fake album art. Use letterboxed thumbnail or provider treatment.

## Accessibility

- fallback action is a real button,
- each result has clear provider/source information,
- iframe has meaningful `title`,
- close button is outside iframe and stops/pauses playback,
- direct YouTube link is accessible.

Everything unrelated to YouTube should remain visually unchanged.
