# 19 — Phase 2 Definition of Done

## Preservation

- [ ] `refe/` unchanged.
- [ ] Audius behavior still works.
- [ ] Existing smart search still works.
- [ ] UI fidelity preserved.
- [ ] Existing tests remain green.
- [ ] No database/auth/Render/YouTube/SoundCloud added.

## Jamendo Provider

- [ ] Jamendo v3 read API used.
- [ ] `JAMENDO_CLIENT_ID` server-only.
- [ ] No `VITE_JAMENDO_CLIENT_ID`.
- [ ] Tracks normalize into shared model.
- [ ] IDs are namespaced.
- [ ] Audio plays through existing global engine.
- [ ] `audiodownload` not exposed.
- [ ] Missing stream handled safely.

## Serverless

- [ ] Same-origin `/api/jamendo`.
- [ ] Narrow allowlisted API.
- [ ] Validates method/action/query/limit.
- [ ] Injects client ID server-side.
- [ ] Sanitizes output.
- [ ] Redacts credentials.
- [ ] Does not proxy audio.
- [ ] SPA rewrite does not swallow API route.
- [ ] `pnpm dev` supports secure local route.
- [ ] Missing Jamendo config degrades to Audius-only.

## Multi-Provider Search

- [ ] Audius + Jamendo search together.
- [ ] IDs cannot collide.
- [ ] One unified UI.
- [ ] Text relevance dominates.
- [ ] Strong-match filtering preserved.
- [ ] Query expansion bounded.
- [ ] Cross-provider dedupe conservative.
- [ ] One-provider outage does not break the other.

## Player

- [ ] One global audio engine.
- [ ] Audius -> Jamendo works.
- [ ] Jamendo -> Audius works.
- [ ] Jamendo -> Jamendo works.
- [ ] Seek/volume/ended work.
- [ ] Rapid switching race-safe.
- [ ] Error recovery works.

## Attribution / Compliance

- [ ] Jamendo artist credited.
- [ ] Jamendo credited as provider.
- [ ] Direct Jamendo backlink per content context.
- [ ] Safe external links.
- [ ] License URL retained.
- [ ] No download feature.
- [ ] README non-commercial/commercial-use caveat.
- [ ] No endorsement implication.

## Environment

- [ ] `.env.example` includes `JAMENDO_CLIENT_ID=`.
- [ ] Real env ignored.
- [ ] Vercel docs updated.
- [ ] Actual Jamendo client ID absent from browser `dist/`.

## Tests

- [ ] Jamendo normalization.
- [ ] Server handler.
- [ ] Security/redaction.
- [ ] Merge.
- [ ] Dedupe.
- [ ] Ranking.
- [ ] Mixed-provider player.
- [ ] Attribution.
- [ ] E2E unified search.
- [ ] Provider failure degradation.
- [ ] Jamendo live smoke.
- [ ] Audius live smoke remains.

## Full Quality Gate

- [ ] `pnpm typecheck` PASS.
- [ ] `pnpm lint` PASS.
- [ ] `pnpm test:run` PASS.
- [ ] `pnpm build` PASS.
- [ ] `pnpm test:e2e` PASS.
- [ ] Audius smoke PASS.
- [ ] Jamendo smoke PASS.
- [ ] Bundle credential scan PASS.
- [ ] Desktop manual check PASS.
- [ ] Mobile manual check PASS.

## Final Report

Report:

- [ ] PASS/PARTIAL/FAIL.
- [ ] Architecture changes.
- [ ] Files changed.
- [ ] Environment variables.
- [ ] Test counts.
- [ ] Full gate results.
- [ ] Audius smoke.
- [ ] Jamendo smoke.
- [ ] Bundle-secret scan.
- [ ] Search request budget.
- [ ] Known catalog limitations.
- [ ] UI deviations.
- [ ] Vercel deployment steps.
