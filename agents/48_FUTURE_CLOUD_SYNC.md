# Future path — accounts, sync and collaborative playlists

Do not implement this in Phase 7.

## Why Phase 7 should remain local

The current Pulse product has no Pulse identity system. Adding auth/database while simultaneously adding playlists would combine two large changes and make debugging/policy review harder.

Phase 7 should establish a clean library domain first.

## Future Phase 8 or 9

A professional cloud-sync architecture could add:

- Pulse account
- email/passkey/social login
- server database
- encrypted/secure session
- cloud library sync
- cross-device history
- cross-device playlists
- conflict resolution
- public/private playlist visibility
- shareable playlist URLs
- collaborative playlist members
- playlist ownership/permissions
- follow other Pulse users
- optional provider account connections

## Migration requirement

The future backend should reuse:

```text
LibraryTrackRef
Playlist
Liked Songs membership
stable provider:id identity
```

rather than inventing a second schema.

A storage interface should make this possible:

```ts
interface LibraryRepository {
  getState()
  transaction(...)
  subscribe(...)
  export(...)
}
```

Phase 7 may use an IndexedDB implementation.

Future:
```text
IndexedDbLibraryRepository
CloudLibraryRepository
SyncedLibraryRepository
```

## Provider-native account connection

Audius supports login/OAuth and authenticated favorite/playlist operations.

Jamendo supports OAuth2 with a `music` scope and write methods for favorites/likes.

YouTube user-authorized actions require Google OAuth scopes and user consent and may trigger Google app verification requirements.

Do not mix provider OAuth into general Pulse login without a clear consent model.

## Collaborative playlists

Require backend authorization.

Do not attempt collaborative playlists through localStorage/IndexedDB.

## Import/export

A future low-risk intermediate feature before accounts:

```text
Export Pulse Library
Import Pulse Library
```

as a user-controlled JSON backup.

Not required in Phase 7.
