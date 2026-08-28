# Reference Route Map

`refe/` is a **single-route SPA** (`wouter`). Everything the user sees on `/` is driven by two pieces of
component state in `refe/client/src/pages/Home.tsx`:

```ts
const [query, setQuery] = useState("")                       // "" → browse,  non-blank → search results
const [currentTrack, setCurrentTrack] = useState<Track|null>() // null → .join-strip, set → .music-player
```

Production keeps the identical visual state machine but promotes search to a real URL so results are
shareable and reloadable, as anticipated by the example table in `agents/02_REFERENCE_UI_PROTOCOL.md`.

---

## Route table

| # | Reference route / state | Trigger in `refe/` | Production route / state | Notes |
|---|---|---|---|---|
| 1 | `/` — browse | default | `/` → `HomePage` | 5 real Audius shelves |
| 2 | `/` — search results | `query.trim() !== ""` | **`/search?q=<query>`** → `SearchPage` | debounced `navigate(..., {replace:true})` while typing |
| 3 | `/` — search, no matches | filter returns `[]` | `/search?q=…` → `.empty-results` | truthful copy |
| 4 | *(none)* — search loading | mock filter is synchronous | `/search?q=…` → skeleton rows | **added**, required by contract |
| 5 | *(none)* — search error | mock cannot fail | `/search?q=…` → error panel + Retry | **added**, required by contract |
| 6 | `/` — track selected | `currentTrack !== null` | any route — `<GlobalPlayer/>` in the app shell | survives navigation |
| 7 | `/` — no track selected | `currentTrack === null` | any route — `<JoinStrip/>` | truthful copy |
| 8 | `/404` and catch-all | wouter `<Route component={NotFound}/>` | `*` → `NotFoundPage` | |
| 9 | *(none)* — queue panel | reference has no queue UI | overlay panel on any route | **added**, minimal, reference surface language |
| 10 | *(none)* — mobile nav | `.mobile-menu` button has **no handler** | drawer on any route | **added**, carries the hidden sidebar content |

## Navigation entry points in production

| Control | Reference behaviour | Production behaviour |
|---|---|---|
| `.brand` (logo) | `href="#top"` | `<Link to="/">` |
| `.home-button` | none | `<Link to="/">` |
| `.top-search input` | local state | debounced 300 ms → `/search?q=…` (replace); blank → back to `/` |
| `.search-key` (`⌘`) | decorative | real `Ctrl/⌘ + K` shortcut focuses the input |
| `.clear-search` | `setQuery("")` | `navigate("/")` and clears the input |
| `.utility-links` (3) | `#plans` / `#support` / `#download` (dead) | `Trending` / `Artists` / `Stations` — in-page anchors to the real shelves |
| `.section-header button` ("Show all") | toast | scrolls the shelf into view and loads the full shelf queue |
| `.mobile-menu` | **nothing** | opens the mobile navigation drawer |
| `.right-rail` | decorative `aria-hidden` | unchanged — decorative |

## Deep-link behaviour

`/search?q=…` is a real BrowserRouter path, so `vercel.json` ships an SPA rewrite
(`/(.*)` → `/index.html`). Direct load and hard refresh of `/search?q=drake` are covered by a Playwright test
(`tests/e2e/navigation.spec.ts`).
