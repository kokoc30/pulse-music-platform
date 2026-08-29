# Phase 7 definition of done

## Library
- [ ] Your Library route
- [ ] Liked Songs
- [ ] local playlists
- [ ] create/rename/delete
- [ ] add/remove
- [ ] reorder
- [ ] local library search
- [ ] sorting
- [ ] persistence across reloads
- [ ] mobile usable
- [ ] accessible controls

## Player integration
- [ ] play playlist
- [ ] play from row
- [ ] shuffle
- [ ] repeat modes if not already present
- [ ] queue precedence correct
- [ ] Media Session path unchanged
- [ ] Phase 6 autoplay only after explicit continuation is exhausted
- [ ] no second playback engine

## Recommendations
- [ ] like is explicit positive signal for Audius/Jamendo
- [ ] playlist add is bounded explicit positive signal
- [ ] Not interested
- [ ] undo
- [ ] Made-for-you mix(es)
- [ ] cold-start honesty
- [ ] diversity
- [ ] saved mix snapshot
- [ ] consent respected
- [ ] no sensitive identity inference

## Provider safety
- [ ] Pulse Like clearly local
- [ ] no implicit provider account mutation
- [ ] no provider OAuth added
- [ ] YouTube metadata retention <= 30 days when saved
- [ ] YouTube API metadata excluded from derived recommendations
- [ ] no YouTube statistics persisted
- [ ] no YouTube media cached/downloaded
- [ ] YouTube background-play prohibition preserved
- [ ] Jamendo/Audius attribution preserved

## Security
- [ ] no API secrets in browser storage
- [ ] no stream URLs persisted
- [ ] no raw provider response persisted
- [ ] bundle secret scan PASS
- [ ] Vercel ESM/serverless fix preserved

## Gates
- [ ] typecheck PASS
- [ ] lint PASS
- [ ] unit/component PASS
- [ ] build PASS
- [ ] E2E PASS
- [ ] verify:bundle PASS
- [ ] direct Vercel provider endpoints do not crash
- [ ] production HTTPS manual QA complete

Do not claim PASS if persistent library, playlist playback, recommendation integration or policy rules are not actually verified.
