# Queue and playback integration

Preserve the invariant:

Audius + Jamendo -> one existing `HTMLAudioElement`
YouTube -> one official visible IFrame player

Do not add crossfade or a second audio element.

Differentiate queue origin if needed:

`user | search | station | history | recommendation | autoplay`

Keep explicit queue and autoplay buffer conceptually separate so user intent always wins.

Media Session Next must call the same Next action as the on-page control. Media Session Previous must call the same Previous action.

When an autoplay item begins:
- update player store
- update Media Session metadata
- keep normal Recently Played/history behavior
- use normal qualification threshold
- keep provider attribution

No special history bypass.

Do not persist playable stream URLs.

True crossfade/gapless playback is out of scope because it would materially change the established engine.
