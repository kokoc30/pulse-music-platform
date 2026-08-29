# Playlist playback and queue integration

## One playback path

Playlist playback must use the same existing player/queue actions.

Do not add a playlist-specific audio engine.

## Play playlist

Pressing Play:

- start at first playable item
- load remaining playlist order into explicit queue
- preserve provider attribution
- use existing Audio vs YouTube engine rules

The user-created playlist is explicit user intent, so it outranks Phase 6 autoplay.

## Shuffle

Implement deterministic session shuffle:

- Fisher-Yates or equivalent
- avoid immediate repeat of current item
- preserve a session order so Next/Previous are predictable
- re-shuffle only when explicitly requested or playlist playback starts anew

Do not mutate persisted playlist order when shuffling.

## Repeat modes

Professional player controls should support:

```text
Repeat off
Repeat playlist
Repeat one
```

Add only if not already present.

Priority at track end:

```text
repeat one
  -> replay current

explicit queue / playlist continuation
  -> next explicit item

repeat playlist at end
  -> first item

Phase 6 autoplay
  -> similar generated item

otherwise
  -> stop
```

Do not let autoplay override repeat or explicit playlist continuation.

## Play from middle

Clicking track N:
- start N
- queue N+1...
- Previous uses actual playback history / playlist session semantics already defined

## Add playlist to queue

Provide:
```text
Add to queue
Play next
```

for playlists where consistent with current UX.

Never create duplicate consecutive entries accidentally.

## Remove while playing

If the currently playing item is removed from the playlist:
- playback continues
- future playlist queue state reconciles
- no abrupt stop unless the user explicitly stops

If a future queued playlist item is removed:
- remove the queued playlist-origin instance if the queue architecture can identify it safely
- do not remove unrelated user-queued copies

## Provider resolution

Saved library items are metadata references.

On playback:
- Audius -> existing current re-resolution/stream flow
- Jamendo -> existing current re-resolution/stream flow
- YouTube -> existing official visible IFrame flow, only if saved metadata is still policy-valid/current enough

Never persist stream URLs.

## Unavailable tracks

If provider content disappears:
- mark row unavailable after a genuine resolution failure
- skip it during Play All after one bounded attempt
- keep it visible so the user can remove it
- do not infinite retry

## Media Session

Playlist Next/Previous must share the same player/queue action as:
- on-page player controls
- lock-screen controls
- notification controls

No separate logic.

## Autoplay transition

When a finite user playlist ends:

- Repeat Playlist -> loop
- otherwise, if Phase 6 Autoplay is ON -> continue with similar Audius/Jamendo music
- YouTube current item still must not become a hidden/background YouTube autoplay chain
