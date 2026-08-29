# Provider and policy boundaries for library features

Research reviewed on 2026-08-28.

## Audius

Audius currently supports:
- tracks
- playlists
- user favorites/library
- playlist creation/update
- authenticated user actions through Audius login/OAuth

Official docs describe the SDK as able to favorite, repost, curate playlists and let users log in to act on their behalf.

Phase 7 decision:
- Pulse library remains local
- do NOT silently mutate the user's Audius account
- do NOT add Audius OAuth in this phase
- persist Audius provider id + safe display metadata
- re-resolve playback through existing Audius logic

Future phase may add "Connect Audius" and explicit sync.

## Jamendo

Jamendo currently supports:
- public playlists
- playlist tracks
- OAuth2
- write methods including user favorite/like
- user library relations
- `/tracks/similar`

Authenticated Jamendo favorites/likes require an access token and `music` scope.

Phase 7 decision:
- Pulse Like is local
- do not imply Jamendo account was liked/favorited
- no Jamendo OAuth in this phase
- persist Jamendo id + safe display metadata
- re-resolve audio through existing logic

## YouTube — critical

Current YouTube API Services Developer Policies state:
- limited Non-Authorized API Data may only be stored temporarily, no longer than 30 calendar days, after which it must be deleted or refreshed
- API Clients must use reasonable efforts to keep stored API Data current
- API Clients must not use API Data to create new or derived data/metrics
- authorized data actions require explicit user consent
- YouTube background play remains prohibited for the current API-client architecture

Current Pulse has no YouTube OAuth/User Credentials.

Therefore YouTube search metadata is **Non-Authorized Data**.

### Phase 7 YouTube save rule

Pulse may support adding a YouTube result to local Liked Songs or a local playlist only as a **temporary local saved item** with:

```text
storedAt
youtubeExpiresAt <= storedAt + 30 days
```

Store only:
- videoId
- title
- channel
- permitted thumbnail
- duration if already allowed by current normalization
- source/watch URL if current policy implementation already allows it
- MadeForKids/embeddability status only as required by existing player safety

Do NOT store:
- view count
- YouTube like count
- comments/statistics
- media URL
- audiovisual bytes

### Expiration

On startup and periodically:
- purge expired YouTube metadata from library views, OR
- mark the item stale and require refresh before display/play

Preferred professional behavior:

- keep the Pulse-owned playlist membership record separately if it can be done without retaining prohibited YouTube API Data
- remove API-derived metadata at expiry
- show an unavailable/stale placeholder
- offer an explicit `Refresh YouTube item` action
- refresh via a narrow `videos.list`-by-ID endpoint, not `search.list`, so it costs minimal quota and does not change the user's chosen identity

If legal/policy interpretation is uncertain, take the stricter route and fully remove the expired YouTube saved item.

Do not invent a loophole around the 30-day rule.

### Refresh endpoint

If implemented, use a narrow server-only contract, conceptually:

```text
GET /api/youtube?action=refresh&id=<videoId>
```

or a bounded batch IDs form.

Requirements:
- validates YouTube video id
- max bounded ids
- exactly one `videos.list`
- no `search.list`
- re-check embeddability and MadeForKids
- sanitized response
- no API key leak
- no automatic high-frequency refresh
- use only when item is stale/explicitly requested or at a carefully documented refresh boundary

Do not turn `/api/youtube` into a generic proxy.

## YouTube recommendation exclusion

Do not use:
- YouTube title
- channel
- thumbnail
- duration
- statistics
- other YouTube API metadata

to calculate cross-provider music preference, recommendation scores, "similarity", user taste clusters or mixes.

Existing first-party user-entered search text remains separate first-party input.

## Clear disclosure

Pulse UI should distinguish:

```text
Liked in Pulse
Saved in Pulse playlist
```

from provider-native actions.

Do not use provider logos to imply a provider-side mutation occurred.

## Privacy

Update `/privacy` if the library adds new stored categories.

Explain:
- saved library is local to device
- no Pulse account/cloud sync
- YouTube saved metadata is temporary and subject to refresh/expiry
- deleting Pulse library does not delete content from provider accounts
