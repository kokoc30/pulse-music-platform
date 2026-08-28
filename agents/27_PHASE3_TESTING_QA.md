# 27 — Phase 3 Testing and QA

## Baseline

Before editing, record:

```powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
pnpm verify:bundle

$env:AUDIUS_SMOKE="1"
$env:JAMENDO_SMOKE="1"
pnpm test:smoke
```

Existing Audius/Jamendo behavior must remain green.

## New Unit Tests

### Search/API
- literal query preservation,
- Arabic query,
- Armenian query,
- Cyrillic query,
- `type=video`,
- embeddable/syndicated filters,
- music filter,
- maxResults cap,
- safeSearch,
- one `search.list` per explicit action,
- one batched `videos.list`,
- quota-error mapping.

### Quota Discipline
- normal typing causes zero YouTube calls,
- normal Audius/Jamendo search causes zero YouTube calls,
- fallback button click causes one YouTube search,
- no alias fanout,
- no automatic pagination,
- repeated session query uses cache if implemented.

### Normalization
- `youtube:<id>`,
- entity decoding,
- channel title,
- 16:9 thumbnail metadata,
- duration parsing,
- MadeForKids,
- watch URL.

### Security
- no `VITE_YOUTUBE_API_KEY`,
- no key in client source/response,
- key redaction,
- narrow endpoint,
- bundle scan.

## Playback Tests

Cover:
- Audius -> YouTube,
- Jamendo -> YouTube,
- YouTube -> Audius,
- YouTube -> Jamendo,
- YouTube -> YouTube,
- exactly one active engine,
- YouTube never enters HTMLAudioElement,
- audio never enters iframe engine.

## IFrame Adapter Tests

Mock `YT.Player` and test:
- ready,
- state changes,
- play/pause,
- seek,
- volume,
- ended,
- error,
- teardown,
- single instance.

## Visibility Tests

- closing player pauses,
- hidden document pauses,
- insufficient visibility blocks scripted play,
- direct playback reveals surface first.

## UI Tests

- fallback action appears only where appropriate,
- separate YouTube results label,
- attribution/source link,
- unmodified 16:9 thumbnail presentation,
- visible iframe surface,
- accessible iframe title,
- close control outside iframe.

## MFK Tests

- status parsed,
- chosen compliant handling,
- external-only fallback if necessary.

## E2E

1. normal search -> zero YouTube calls,
2. no strong result -> fallback button,
3. explicit fallback -> YouTube results,
4. source clearly labeled,
5. result -> visible player,
6. close -> pause,
7. YouTube <-> audio transitions,
8. mobile minimum player size,
9. missing key,
10. quota exceeded,
11. MFK behavior,
12. privacy link.

Normal E2E must not use live YouTube.

## Live Smoke

Add `YOUTUBE_SMOKE=1` using server-only `YOUTUBE_API_KEY`.

Verify:
- one real music search,
- batched enrichment,
- embeddability metadata,
- MadeForKids field,
- safe normalized output,
- no key leak.

Do not download media or extract audio.

## Manual QA

Test explicit YouTube fallback using:
- Armenian script query,
- Arabic script query,
- Cyrillic/Russian query,
- mainstream English song.

Verify official visible player, native controls, no iframe overlap, source attribution, and Google Cloud quota consumption.

## Full Gate

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
pnpm verify:bundle

$env:AUDIUS_SMOKE="1"
$env:JAMENDO_SMOKE="1"
$env:YOUTUBE_SMOKE="1"
pnpm test:smoke
```

Fix all regressions before finalizing.
