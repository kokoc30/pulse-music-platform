# 09 — Testing and QA

## Rule

Tests are part of implementation, not a final optional phase.

A visually attractive app with fragile player/search behavior is not done.

---

## Test Pyramid

### Unit

Use Vitest.

Test pure/domain logic such as:
- Audius -> Track normalization,
- duration formatting,
- artwork fallback,
- queue indexing,
- search query normalization,
- player reducer/store actions,
- error mapping.

### Component

Use React Testing Library + user-event.

Test:
- search input,
- loading state,
- results rendering,
- no-results,
- error state,
- play button semantics,
- player controls,
- volume,
- queue panel.

### API/provider mocking

Use MSW.

Provider tests should not depend on live internet.

Create representative fixtures for:
- normal track,
- missing artwork,
- non-streamable track,
- empty search,
- provider 429,
- provider 500/network error.

### E2E

Use Playwright.

Critical flows:

1. Home loads.
2. Search UI usable.
3. Search returns mocked/stable results in e2e environment.
4. Clicking track activates player.
5. Play/pause state changes.
6. Next/previous works.
7. Queue changes.
8. Navigation does not lose player state.
9. No-results state.
10. Provider error state.
11. Mobile mini-player.
12. Mobile expanded player if present.
13. Direct route reload if routes exist.

Do not depend on a live copyrighted/full audio stream for deterministic CI.

Mock/stub media behavior in E2E where needed.

Maintain one optional real-provider smoke check separately.

---

## Audio Test Strategy

JSDOM does not provide real browser audio playback.

Abstract audio operations behind an `AudioEngine` interface so tests can inject a fake.

Example conceptual interface:

```ts
interface AudioEngine {
  load(src: string): void
  play(): Promise<void>
  pause(): void
  seek(seconds: number): void
  setVolume(value: number): void
}
```

Production uses HTMLAudioElement.

Tests use a deterministic fake.

Do not weaken production architecture just to satisfy JSDOM.

---

## Visual Regression

At minimum:
- reference screenshots,
- production screenshots at matching viewport,
- manual comparison.

If practical, add Playwright screenshot assertions for stable structural states using mocked artwork/data.

Avoid brittle pixel-perfect assertions against remote Audius artwork.

---

## Accessibility QA

At minimum verify:
- tab order,
- focus-visible,
- buttons have names,
- search has label/aria-label,
- player sliders have accessible value,
- contrast remains usable,
- modals/sheets trap/return focus if reference uses them,
- Escape closes dismissible overlays where appropriate.

Axe integration is welcome but not a substitute for manual keyboard testing.

---

## Quality Commands

The production package must provide scripts equivalent to:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --pretty false",
    "lint": "...",
    "test": "vitest",
    "test:run": "vitest run",
    "test:e2e": "playwright test"
  }
}
```

Exact lint command depends on chosen ESLint configuration.

---

## Required Final Gate

Run from project root:

```powershell
pnpm install
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm test:e2e
```

If any command fails:
1. diagnose,
2. fix,
3. rerun the failed command,
4. rerun related commands,
5. rerun full gate before finalizing.

Do not declare success with red tests.

---

## Browser QA

At minimum Playwright Chromium.

Also manually reason/test for:
- Safari/mobile media constraints,
- Firefox layout where feasible.

Do not promise broad compatibility you did not test.

---

## Console QA

In final browser run:
- no repeated React key warnings,
- no unhandled promise rejections,
- no missing asset spam,
- no infinite API loops,
- no leaked credentials,
- no unexpected hydration warnings (if architecture changes to SSR).
