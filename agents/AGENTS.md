# AGENTS.md — Music Platform Master Instructions

## Purpose

This folder is the authoritative implementation contract for the production music platform located at:

`C:\music-platform`

The UI/UX reference project is located at:

`C:\music-platform\refe`

The reference project is design truth. It is **read-only**. Do not rewrite, clean up, migrate, delete, or use it as the production source tree.

The production application must be built outside `refe/` while matching the reference UI as closely as practical and replacing its mock behavior/data with real Audius search, discovery, and playback.

---

## Read Order — Mandatory

Before modifying production code, read these files in this exact order:

1. `agents/01_PROJECT_CONTRACT.md`
2. `agents/02_REFERENCE_UI_PROTOCOL.md`
3. `agents/03_ARCHITECTURE.md`
4. `agents/04_TARGET_FILE_STRUCTURE.md`
5. `agents/05_IMPLEMENTATION_PLAN.md`
6. `agents/06_AUDIUS_INTEGRATION.md`
7. `agents/07_PLAYER_BEHAVIOR.md`
8. `agents/08_UI_FIDELITY_RULES.md`
9. `agents/09_TESTING_QA.md`
10. `agents/10_SECURITY_ENV_DEPLOYMENT.md`
11. `agents/11_DEFINITION_OF_DONE.md`
12. `agents/12_AGENT_EXECUTION_RULES.md`

Do not skip directly to coding.

---

## Product in One Sentence

Build a polished public music-discovery web app where a visitor can open the site, search for a track/artist/genre, click a result, and immediately listen through a persistent, Spotify-quality web player—without registration, a database, payments, or unnecessary backend infrastructure.

---

## Non-Negotiable Product Scope

### Required

- Exact/high-fidelity implementation of the provided `refe/` design.
- Public homepage/discovery experience.
- Search.
- Real Audius track data.
- Real stream playback for publicly streamable Audius tracks.
- Persistent global player.
- Play/pause.
- Seek.
- Previous/next.
- Volume/mute.
- Queue.
- Loading, empty, and error states.
- Responsive desktop/tablet/mobile behavior.
- Keyboard and accessibility basics.
- Automated tests.
- Production build.
- `.env.example`.
- Deployment-ready Vercel configuration/documentation.

### Explicitly not required for V1

- Supabase.
- Any database.
- Login/signup.
- User profiles.
- Liked songs saved to a server.
- Social features.
- Payments.
- Uploading music.
- Creator/admin dashboard.
- Render backend.
- Audio-file storage.
- Proxying entire audio files through our infrastructure.
- Scraping Spotify/YouTube.
- Download/ripping features.

Do not introduce out-of-scope systems because they appear in the reference prototype.

---

## Architectural Default

Default production architecture:

`React + TypeScript + Vite + Audius JS SDK + Zustand + React Router + Vercel`

Use:
- `pnpm`
- strict TypeScript
- ESLint
- Prettier
- Vitest
- React Testing Library
- MSW
- Playwright

A standalone backend is not part of V1 unless a hard technical requirement is discovered and documented with evidence.

---

## Reference First Rule

No visual implementation begins until the agent has:

1. Inventoried `refe/`.
2. Read its `package.json`.
3. Located routes/pages/components/styles/assets.
4. Run the reference project if possible.
5. Identified all meaningful UI states.
6. Recorded desktop and mobile behavior.
7. Written `docs/reference-audit.md`.
8. Written `docs/reference-route-map.md`.
9. Written `docs/reference-component-map.md`.

Only then should production UI work begin.

---

## Stop Conditions

Do not silently guess when:

- `refe/` cannot be run.
- critical reference assets are missing.
- the Audius API behavior materially differs from these documents.
- playback is impossible for a specific track because it is gated/non-streamable.
- a design element cannot be reproduced because the reference implementation/assets are incomplete.

Instead:
1. inspect the code and logs,
2. use a documented fallback if available,
3. record the limitation,
4. continue on everything else that can be completed.

---

## Final Agent Output

At the end, report:

- architecture implemented,
- exact commands used,
- files created/changed,
- tests and their results,
- build result,
- reference fidelity audit,
- environment variables required,
- how to run locally,
- how to deploy on Vercel,
- known limitations,
- whether any Render backend is actually needed.

A task is not complete because the UI "looks close." It is complete only when `11_DEFINITION_OF_DONE.md` is satisfied.
