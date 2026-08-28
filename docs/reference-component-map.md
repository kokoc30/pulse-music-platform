# Reference → Production Component Map

The reference implements the whole design in one file (`refe/client/src/pages/Home.tsx`, 237 lines) plus two
inline helpers. Production decomposes it along the boundaries required by
`agents/04_TARGET_FILE_STRUCTURE.md`, keeping **every reference class name** so the ported stylesheet applies
unchanged and the fidelity comparison stays honest.

---

## Layout / shell

| Reference markup | Class | Production component |
|---|---|---|
| root `<div>` | `.pulse-app` | `src/components/layout/AppShell.tsx` |
| `<header>` | `.site-header` | `src/components/layout/SiteHeader.tsx` |
| `<div class="app-frame">` | `.app-frame` | `AppShell.tsx` |
| `<aside>` library | `.shell-sidebar` | `src/components/navigation/LibrarySidebar.tsx` |
| `<main>` | `.browse-surface` | `AppShell.tsx` (routed `<Outlet/>`) |
| `<aside>` right rail | `.right-rail` | `src/components/layout/RightRail.tsx` |
| footer | `.site-footer` | `src/components/layout/SiteFooter.tsx` |
| *(none — button was inert)* | `.mobile-menu` target | `src/components/navigation/MobileNavDrawer.tsx` |

## Navigation / header

| Reference markup | Class | Production component |
|---|---|---|
| brand anchor + `<img>` | `.brand` | `src/components/navigation/BrandMark.tsx` (original SVG) |
| home button | `.home-button` | inside `SiteHeader` (`<Link to="/">`) |
| search `<label>` + `<input>` + `⌘` | `.top-search` | `src/components/search/SearchBar.tsx` |
| 3 utility anchors | `.utility-links` | inside `SiteHeader` (real section anchors) |
| install / sign-up / log-in cluster | `.install-button` `.signup-link` `.login-button` | inside `SiteHeader` — re-pointed at truthful actions, see D-04/D-05 |

## Discovery

| Reference markup | Class | Production component |
|---|---|---|
| `SectionHeader` helper | `.section-header` | `src/components/track/SectionHeader.tsx` |
| `<section>` shelf | `.music-section` | `src/features/discovery/DiscoveryShelf.tsx` |
| square card | `.media-card` / `.art-wrap` | `src/components/track/TrackCard.tsx` |
| `PlayAction` helper | `.card-play` | `src/components/track/PlayAction.tsx` |
| circular portrait card | `.artist-card` / `.artist-image` | `src/components/track/ArtistCard.tsx` |
| tinted station tile | `.station-card` / `.station-cover` | `src/components/track/StationCard.tsx` |
| gradient chart tile | `.chart-card` / `.chart-cover` | `src/components/track/ChartCard.tsx` |
| two library cards | `.side-card` | inside `LibrarySidebar` |

## Search

| Reference markup | Class | Production component |
|---|---|---|
| results `<section>` | `.search-results` | `src/features/search/SearchResults.tsx` |
| title row + Clear | `.result-title-row` `.clear-search` | inside `SearchResults` |
| top result | `.top-result-card` | `src/components/search/TopResultCard.tsx` |
| song list | `.song-list` | `src/components/track/TrackList.tsx` |
| song row | `.song-row` | `src/components/track/TrackRow.tsx` |
| now-playing bars | `.equalizer` | `src/components/track/Equalizer.tsx` |
| empty state | `.empty-results` | `src/components/feedback/EmptyState.tsx` |
| *(none)* | `.song-row` skeletons | `src/components/feedback/TrackListSkeleton.tsx` |
| *(none)* | `.empty-results` geometry | `src/components/feedback/ErrorState.tsx` |

## Player

| Reference markup | Class | Production component |
|---|---|---|
| player `<section>` | `.music-player` | `src/components/player/GlobalPlayer.tsx` |
| artwork + title/artist + like | `.player-track` | `src/components/player/PlayerTrackInfo.tsx` |
| prev / play / next | `.player-controls > div` | `src/components/player/PlayerControls.tsx` |
| time + rail | `.progress` | `src/components/player/PlayerProgress.tsx` |
| volume icons + rail | `.player-volume` | `src/components/player/VolumeControl.tsx` |
| *(none)* | queue overlay | `src/components/queue/QueuePanel.tsx` |
| bottom banner | `.join-strip` | `src/components/player/JoinStrip.tsx` |
| toast | `.notice` | `src/components/feedback/NoticeToast.tsx` |

## Non-visual production layers (no reference counterpart)

| Layer | Files |
|---|---|
| Domain model | `src/music/types.ts` |
| Provider interface | `src/music/provider.ts` |
| Normalization | `src/music/normalize.ts` |
| Audius adapter | `src/music/audius/{client,adapter,errors,genres,content-nodes}.ts` |
| Audio engine | `src/player/audio-engine.ts` (+ `fake-audio-engine.ts` for tests) |
| Player store | `src/player/{player-store,player-actions,player-selectors}.ts` |
| Smart search | `src/music/search/{text,aliases,expand,similarity,relevance,smart-search}.ts` |
| Feature hooks | `src/features/search/useTrackSearch.ts`, `src/features/discovery/useDiscovery.ts` |
| Formatting | `src/lib/format.ts` |

## Components deliberately **not** ported

`refe/client/src/components/ui/**` (57 shadcn/Radix files), `ManusDialog.tsx`, `Map.tsx`,
`ErrorBoundary.tsx` (production has its own), `ThemeContext.tsx` (production is dark-only, matching the
reference's hard-coded `defaultTheme="dark"`), `hooks/useComposition.ts`, `hooks/usePersistFn.ts`,
`const.ts` (contains an **OAuth login URL builder** — explicitly out of V1 scope), `server/`, `shared/`.

None of these are used by the reference's music design.
