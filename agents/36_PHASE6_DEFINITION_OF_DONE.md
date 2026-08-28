# Phase 6 definition of done

## Media Session
- [ ] existing single audio element preserved
- [ ] feature detection
- [ ] audio metadata/artwork
- [ ] play/pause/stop
- [ ] previous/next
- [ ] seeking
- [ ] playback state
- [ ] position state
- [ ] no duplicate handlers
- [ ] YouTube excluded from Pulse background audio controls
- [ ] YouTube hidden pause preserved

## PWA
- [ ] valid manifest
- [ ] 192/512 icons
- [ ] standalone mode
- [ ] install UX
- [ ] safe service-worker shell cache only
- [ ] no media offline cache
- [ ] safe update while audio plays

## Autoplay
- [ ] toggle
- [ ] explicit queue wins
- [ ] Audius metadata similarity
- [ ] Jamendo `/tracks/similar`
- [ ] deterministic scoring
- [ ] diversity/recent exclusion
- [ ] bounded requests
- [ ] bounded failure retry
- [ ] no YouTube auto-search/queue/background
- [ ] normal Phase 4 history qualification
- [ ] consent rules preserved

## Security/regression
- [ ] Jamendo client id server-only
- [ ] YouTube key server-only
- [ ] no stream URLs persisted
- [ ] bundle scan PASS
- [ ] Phase 1–5 tests still green
- [ ] search dropdown intact
- [ ] Recently Played artwork/order intact
- [ ] personalized home intact
- [ ] multilingual search intact
- [ ] YouTube quota safeguards intact

## Gates
- [ ] typecheck
- [ ] lint
- [ ] unit/component
- [ ] build
- [ ] E2E
- [ ] bundle scan
- [ ] final live smoke when quota permits
- [ ] real Android/iOS device QA recorded if devices available

If physical-device testing is unavailable, final status may be:
`PARTIAL — implementation PASS, physical-device background verification pending`.
