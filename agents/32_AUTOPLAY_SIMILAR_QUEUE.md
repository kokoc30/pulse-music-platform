# Intelligent similar-track autoplay

## User behavior
Add a persisted playback preference:

`Autoplay similar music`

Recommended default: ON. Keep it separate from personalization consent.

If consent is denied, autoplay still works from current-track metadata only; it must not use stored profile history.

## Queue priority
1. explicit user queue
2. explicit playlist/station continuation if already defined
3. autoplay-generated similar audio
4. stop

Autoplay can never jump ahead of a user-queued item.

## Candidate planner
Create a pure deterministic planner, for example:

`src/player/autoplay/{types,similarity,candidates,planner,cache,index}.ts`

It returns `Track` candidates; it does not own playback.

## Audius
Do not invent an undocumented "similar" endpoint. Use bounded existing candidates/session discovery plus actual Audius metadata when present:
- genre
- mood
- tags
- BPM
- musical key
- artist

Missing metadata is neutral.

## Jamendo
Jamendo officially supports:

`GET /v3.0/tracks/similar`

Add a narrow server action such as:

`/api/jamendo?action=similar&id=<trackId>`

Keep `JAMENDO_CLIENT_ID` server-only. Fixed result limit, sanitized fields, no download URLs, no open proxy.

## Similarity
Use explainable local scoring:
- Jamendo provider similarity score
- genre
- tag overlap
- mood
- BPM proximity
- artist relationship
- optional existing local profile affinity only when consent is granted

No LLM, embeddings, paid recommender or opaque randomness.

## Diversity
- never pick current track
- exclude explicit queue duplicates
- strongly avoid last 10–20 played tracks
- max 1 same-artist item in next 3
- max 2 same-artist items in next 10
- immediate next maximizes similarity
- later positions may reserve ~10–20% exploration
- deterministic tie-break

Maintain a small in-memory autoplay buffer, e.g. 5 items. Refill only when explicit queue is low/empty. Keep metadata requests bounded.

## End flow
On natural end:
- explicit next exists -> play it
- else autoplay ON and current is Audius/Jamendo -> play best generated candidate
- else stop

Manual Next follows the same precedence. Previous uses existing playback history only.

If one generated candidate fails, try a bounded alternate; never infinite-loop.

## YouTube
Never:
- auto-search YouTube
- auto-queue YouTube
- derive cross-platform autoplay from YouTube API metadata
- background-play YouTube
