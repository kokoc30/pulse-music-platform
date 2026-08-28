# 11 — Definition of Done

The project is done only when every mandatory item below is satisfied or a specific unavoidable limitation is documented.

---

## Reference

- [ ] `refe/` was inspected before production coding.
- [ ] `refe/` remains intact/read-only.
- [ ] `docs/reference-audit.md` exists.
- [ ] `docs/reference-route-map.md` exists.
- [ ] `docs/reference-component-map.md` exists.
- [ ] Main reference desktop state was captured/reviewed.
- [ ] Main reference mobile state was captured/reviewed.
- [ ] Significant production deviations are documented.

---

## Architecture

- [ ] Production does not runtime-import from `refe/`.
- [ ] No Supabase/database exists in V1.
- [ ] No authentication exists in V1.
- [ ] No unnecessary Render backend exists.
- [ ] Provider calls are centralized.
- [ ] Raw Audius SDK types do not leak across the UI.
- [ ] One global audio engine exists.
- [ ] Full audio is not proxied/rehosted by the app.

---

## Search

- [ ] Empty query does not fire pointless requests.
- [ ] Search is debounced.
- [ ] Stale requests cannot overwrite newer query results.
- [ ] Loading state matches reference.
- [ ] Results state matches reference.
- [ ] No-results state matches reference.
- [ ] Error state matches reference.
- [ ] Real Audius metadata is used in production.

---

## Playback

- [ ] Clicking a playable result starts/attempts real Audius playback.
- [ ] Play/pause works.
- [ ] Current track metadata is correct.
- [ ] Progress updates from real audio engine.
- [ ] Seeking works.
- [ ] Volume works.
- [ ] Mute works if reference includes it.
- [ ] Next works.
- [ ] Previous works.
- [ ] Queue works where reference includes it.
- [ ] `ended` behavior is correct.
- [ ] Playback error exits loading state.
- [ ] Rapid track switching is race-safe.
- [ ] SPA navigation does not destroy the player.
- [ ] No autoplay occurs on initial page load.

---

## UI Fidelity

- [ ] Desktop shell matches reference.
- [ ] Search UI matches reference.
- [ ] Track card/list density matches reference.
- [ ] Player dimensions/layout match reference.
- [ ] Typography closely matches.
- [ ] Colors/tokens closely match.
- [ ] Hover/active/focus states implemented.
- [ ] Mobile navigation matches reference.
- [ ] Mobile player matches reference.
- [ ] No obvious generic template substitutions remain.

---

## Accessibility

- [ ] Search has accessible name.
- [ ] Player controls are buttons.
- [ ] Focus-visible exists.
- [ ] Keyboard interaction is usable.
- [ ] Sliders are accessible.
- [ ] Images have sensible alt behavior.
- [ ] Reduced motion is respected where relevant.

---

## Security

- [ ] `.env.example` exists.
- [ ] Real `.env` is ignored.
- [ ] `VITE_AUDIUS_API_KEY` is the only expected Audius frontend credential.
- [ ] No bearer token is client-side.
- [ ] No private key exists in repo.
- [ ] No dangerous HTML rendering of provider text.
- [ ] No MP3 storage/download workaround exists.

---

## Tests

- [ ] Unit tests exist.
- [ ] Component tests exist.
- [ ] Provider behavior is mocked deterministically.
- [ ] Player state/engine behavior is tested.
- [ ] Playwright critical flow exists.
- [ ] Mobile e2e coverage exists for critical UI.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test:run` passes.
- [ ] `pnpm build` passes.
- [ ] `pnpm test:e2e` passes.

---

## Production

- [ ] README is accurate.
- [ ] No mock-only app state is used in production critical path.
- [ ] Production build loads without console errors.
- [ ] Vercel configuration is present if needed.
- [ ] Deployment env variable is documented.
- [ ] Direct-route behavior verified if routes exist.
- [ ] Real deployed search works.
- [ ] Real deployed playback works for a public Audius track.
- [ ] Stream traffic is not being relayed through Vercel/Render.

---

## Final Report

Agent final message includes:

- [ ] summary,
- [ ] architecture,
- [ ] major files,
- [ ] environment setup,
- [ ] test counts/results,
- [ ] build result,
- [ ] run command,
- [ ] Vercel deployment steps,
- [ ] known limitations,
- [ ] reference deviations,
- [ ] confirmation whether a backend was needed.

No unchecked critical item may be silently ignored.
