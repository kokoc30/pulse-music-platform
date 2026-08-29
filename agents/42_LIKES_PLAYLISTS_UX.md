# Liked Songs and playlists UX

## Your Library

Add a first-class route:

```text
/library
```

Desktop sidebar/nav should expose:

```text
Your Library
```

Mobile should expose it through the existing responsive navigation.

Library page sections:

- Liked Songs
- Your playlists
- optional Recently played shortcut
- optional Made for you shortcut

Do not overcrowd.

## Heart / Like

Add a consistent Pulse-local heart action to:

- search result rows/cards
- home recommendation cards
- Recently Played
- player bar
- queue
- playlist track rows
- artist/track surfaces where current UI supports actions

States:

```text
outline heart -> not liked
filled/active heart -> liked
```

Accessible labels:

```text
Like "Track Title"
Remove "Track Title" from Liked Songs
```

The Pulse heart is **Pulse library state**, not a claim that a provider's native like count changed.

Do not display "liked on YouTube/Audius/Jamendo" unless provider OAuth is actually implemented.

## Add to playlist

Create a shared overflow/context action:

```text
Add to playlist
```

Opening it shows:

- existing user playlists
- Create new playlist

Selecting an existing playlist:
- add once
- show success toast
- close menu
- no network request required

If already present:
- disable or show "Already added"
- no duplicate entry by default

## Create playlist

Fields:

- name required
- description optional

Validation:
- trim whitespace
- max length
- reject empty
- safe Unicode
- no HTML interpretation

Generate a stable local id.

After creation, allow immediate add of the initiating track.

## Playlist detail page

Route:

```text
/playlist/:playlistId
```

Display:

- auto-generated cover collage
- playlist name
- description
- number of songs
- approximate duration when known
- Play
- Shuffle
- track list
- per-row context menu

Actions:

- rename
- edit description
- delete playlist
- add/remove tracks
- reorder tracks
- add playlist to queue
- play from a selected row

## Cover collage

Do not generate/persist image bytes.

Build a UI collage from up to the first four valid artwork references.

Rules:
- 0 art -> Pulse placeholder
- 1 art -> full cover
- 2–4 art -> simple grid
- failed images fall back safely
- YouTube thumbnails remain clearly attributed and must not be misleadingly presented as album art where existing policy/UI distinguishes them

## Reordering

Support:

- pointer drag-and-drop if the existing app has a suitable interaction
- keyboard-accessible alternatives:
  - Move up
  - Move down
  - Move to top
  - Move to bottom

Do not make drag-only functionality.

Persist order immediately on successful mutation.

## Delete playlist

Require confirmation.

Deleting a playlist:
- does not unlike its tracks
- does not delete listening history
- does not affect provider accounts
- garbage-collects unreferenced local track metadata only when safe

## Empty states

Liked Songs empty:
```text
Songs you like will appear here.
```

No playlists:
```text
Create a playlist to keep music together.
```

Playlist empty:
```text
Add songs from Search, Home or Recently Played.
```

Keep wording concise.

## Toasts

Use non-blocking toasts for:
- Added to Liked Songs
- Removed from Liked Songs
- Added to playlist
- Removed from playlist
- Playlist created
- Playlist deleted
- Already in playlist

Avoid modal dialogs for normal success.

## Search within library

Add local search/filter to `/library` and playlist detail pages.

It must be local only:
- no Audius call
- no Jamendo call
- no YouTube call

Filter by saved title, artist, playlist name.

## Sorting

Liked Songs:
- Recently liked
- Title
- Artist

Playlists:
- Recently updated
- Name
- Recently created

Playlist tracks:
- custom order is primary
- optional view-only sort may be added only if it does not silently rewrite custom order
