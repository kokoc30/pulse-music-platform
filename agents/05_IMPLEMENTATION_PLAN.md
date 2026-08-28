# 05 — Implementation Plan

## Principle

Implement vertically and prove each critical path before adding the next layer.

Do not build the entire UI against mock data and postpone real playback until the end.

---

# Phase 0 — Preflight

1. Inspect `C:\music-platform`.
2. Confirm `agents/` and `refe/` exist.
3. Do not delete unknown existing work.
4. Read every agent document.
5. Inspect reference `package.json`, lockfile, source tree.
6. Determine how reference runs.
7. Determine production root state.
8. Record assumptions.

Exit gate:
- no production changes before reference inventory is understood.

---

# Phase 1 — Reference Audit

Create:
- `docs/reference-audit.md`
- `docs/reference-route-map.md`
- `docs/reference-component-map.md`

Run reference if possible.

Capture screenshots at target viewports.

Inventory:
- fonts,
- colors,
- CSS variables,
- layout dimensions,
- icons,
- animation,
- player behavior,
- route/state transitions,
- responsive changes.

Exit gate:
- agent can explain reference structure and main screen hierarchy accurately.

---

# Phase 2 — Production Scaffold

Create/repair production Vite + React + TypeScript app in project root without touching `refe/` or `agents/`.

Install only justified dependencies.

Set up:
- strict TypeScript,
- lint,
- format,
- test,
- build scripts,
- path aliases if beneficial,
- base global styles.

Create `.env.example`.

Exit gate:

```powershell
pnpm install
pnpm typecheck
pnpm lint
pnpm test --run
pnpm build
```

must execute or have only clearly documented expected failures because features do not yet exist.

---

# Phase 3 — Visual Shell

Implement reference shell:
- root background,
- app frame,
- desktop sidebar/nav,
- top area/header,
- content container,
- mobile navigation,
- player reserved area,
- responsive breakpoints.

Use exact tokens/assets from audit.

No real API needed yet.

Exit gate:
- shell screenshot closely matches reference at desktop and mobile sizes.

---

# Phase 4 — Music Domain + Audius Adapter

Implement:
- normalized `Track`,
- provider interface,
- Audius client initialization,
- search mapping,
- trending/discovery mapping,
- provider errors,
- duration/artwork helpers.

Unit test normalization.

Do not spread raw Audius response types into UI.

Exit gate:
- a small integration/dev page or test can retrieve and normalize real search/trending results.

---

# Phase 5 — Search Vertical Slice

Implement actual reference search UI connected to Audius.

Requirements:
- input behavior,
- debounce,
- loading,
- stale request protection,
- results,
- empty,
- error,
- keyboard submission if reference supports it,
- responsive list/card rendering.

Exit gate:
- searching a real query yields real Audius results.

---

# Phase 6 — Playback Vertical Slice

Implement one global audio engine.

Click a search result and prove:
- real stream starts,
- title/artwork/artist update,
- play/pause works,
- progress updates,
- seek works,
- volume works,
- media error is handled.

Do this before queue complexity.

Exit gate:
- critical product flow works end-to-end.

---

# Phase 7 — Full Reference Player + Queue

Implement reference player fidelity:
- previous,
- next,
- queue,
- end-of-track advancement,
- optional repeat/shuffle only if reference contains them,
- expanded now-playing if reference contains it,
- mobile mini-player/full-player if reference contains it.

Exit gate:
- playback survives normal in-app navigation and state changes.

---

# Phase 8 — Discovery / Genre States

Replace reference mock discovery data with real Audius:
- trending,
- supported genre queries/filters,
- sections present in reference.

Do not invent "For You" personalization without a user model.

If reference says "For You," preserve visual design but rename to a truthful non-personalized label unless copy is part of a strict visual requirement.

Exit gate:
- homepage content is real or fails gracefully.

---

# Phase 9 — Fidelity Pass

Perform screenshot comparison.

Fix in this order:
1. page geometry,
2. player geometry,
3. typography,
4. color,
5. artwork sizing,
6. spacing,
7. border/radius/shadow,
8. icons,
9. states,
10. motion.

Update `docs/reference-deviations.md`.

Exit gate:
- no unexplained major visual deviations.

---

# Phase 10 — Automated QA

Add/finish:
- unit tests,
- component tests,
- provider MSW tests,
- player store tests,
- Playwright e2e.

Run full quality gate.

Fix failures before continuing.

Do not comment out failing tests.

---

# Phase 11 — Production Hardening

Check:
- no secrets in source,
- no console spam,
- no mock production data accidentally used,
- no broken asset URLs,
- no dead navigation,
- no impossible buttons,
- no unhandled promise rejection,
- direct-route reload behavior,
- mobile viewport,
- accessibility basics,
- build warnings.

---

# Phase 12 — Deployment Readiness

Prepare:
- `.env.example`,
- README local steps,
- Vercel deployment steps,
- optional `vercel.json`,
- final production build.

No Render service should be required for V1 unless a documented technical blocker forced it.

---

# Phase 13 — Final Audit

Use `11_DEFINITION_OF_DONE.md`.

If any mandatory item fails:
- fix,
- retest,
- rebuild,
- re-audit.

Only then produce final summary.
