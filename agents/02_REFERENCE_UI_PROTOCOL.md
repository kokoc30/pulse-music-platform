# 02 — Reference UI Protocol

## Source of Truth

Reference root:

`C:\music-platform\refe`

Observed top-level reference structure from the supplied project view includes items such as:

- `client/`
- `patches/`
- `server/`
- `shared/`
- `.gitignore`
- `.prettierignore`
- `.prettierrc`
- `components.json`
- `ideas.md`
- `package.json`
- `pnpm-lock.yaml`
- `template.json`
- `tsconfig.json`
- `tsconfig.node.json`
- `vite.config.ts`

This strongly suggests a generated Vite/React-style prototype, but **do not assume details beyond what the actual files prove**.

The implementation agent has local filesystem access and must inspect the real contents.

---

## Absolute Rule: `refe/` Is Read-Only

Never:
- move it,
- rename it,
- format it,
- run codemods against it,
- upgrade dependencies inside it,
- delete "unused" assets,
- merge its source directly into production without understanding it.

Running dependency installation inside the reference is allowed if necessary to view it, but avoid changing tracked files. If installation would mutate the lockfile, restore it after inspection.

---

## Mandatory Reference Audit

Before production implementation, create:

`docs/reference-audit.md`

It must record:

### Framework/runtime
- package manager,
- framework,
- React version,
- build tool,
- route library,
- styling system,
- component library,
- animation libraries,
- icons,
- fonts.

### Routes/views
Inventory every meaningful route or page state.

Example table:

| Reference route/state | Purpose | Production route/state | Fidelity status |
|---|---|---|---|
| `/` | Home/discover | `/` | pending |
| search active | Search results | `/search?q=` | pending |
| expanded player | Now playing | overlay/route | pending |

Use actual discovered routes; do not fabricate them.

### Components
Identify:
- navigation,
- search bar,
- cards,
- track rows,
- player,
- queue,
- modal/sheet,
- mobile nav,
- skeletons,
- error/empty states.

### Tokens
Record exact:
- colors,
- CSS variables,
- spacing,
- border radii,
- shadows,
- typography,
- font weights,
- breakpoints,
- transition durations,
- z-index layers.

### Assets
Catalog:
- logo,
- icons,
- images,
- artwork mocks,
- backgrounds,
- local font files,
- SVGs.

Production may reuse assets from the user's reference project where appropriate, but do not retain mock album artwork as real track artwork when the real Audius response supplies artwork.

---

## Mandatory Runtime Inspection

Attempt to run the reference using the package manager indicated by its lockfile/package metadata.

Likely workflow only after confirming scripts:

```powershell
cd C:\music-platform\refe
pnpm install
pnpm dev
```

Do not blindly assume those scripts exist. Read `package.json` first.

Inspect at minimum:

- 1440x900 desktop
- 1280x800 laptop
- 768x1024 tablet
- 390x844 mobile

Capture screenshots into:

`docs/reference-screenshots/`

Suggested names:

- `home-desktop.png`
- `search-desktop.png`
- `playing-desktop.png`
- `queue-desktop.png`
- `home-mobile.png`
- `search-mobile.png`
- `playing-mobile.png`

Only capture states that actually exist or can be reached in the reference.

---

## Fidelity Method

For each production screen:

1. Render at same viewport as reference.
2. Compare screenshot side-by-side.
3. Fix macro layout:
   - widths,
   - heights,
   - alignment,
   - sidebar,
   - player,
   - major spacing.
4. Fix typography.
5. Fix colors/surfaces.
6. Fix component spacing/radius/shadows.
7. Fix icons.
8. Fix hover/focus/active states.
9. Fix responsive behavior.
10. Re-run screenshot.

Do not start by tuning tiny details while macro geometry is wrong.

---

## Reference vs Production Behavior

The visual reference wins for appearance.

The production specification wins for behavior.

Examples:

- If reference shows a fake search response, keep appearance but use real Audius data.
- If reference player is static, implement real playback while preserving layout.
- If reference includes a fake login button that contradicts V1 scope, remove or neutralize it only when required by the product contract.
- If reference includes backend mock code, do not automatically reproduce the backend.

---

## No "Creative Improvement" Without Need

The agent is not hired to redesign the interface.

Do not:
- change the palette because another one is "cleaner,"
- replace the font because it is more trendy,
- restructure the navbar,
- create new cards,
- change spacing globally,
- add glassmorphism,
- add gradients,
- simplify the player,
unless the reference itself does so or a functional/accessibility requirement forces a narrowly scoped change.

When a deviation is necessary, record it in:

`docs/reference-deviations.md`

with:
- reference behavior,
- production behavior,
- reason,
- impact.
