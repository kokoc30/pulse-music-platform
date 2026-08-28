# 13 — Jamendo Phase 2 Entry Point

## Purpose

This document begins Phase 2 of the existing music-platform implementation.

The current production application is already functional and green. It includes:

- React + TypeScript + Vite.
- Audius provider integration.
- A provider abstraction.
- Smart international search.
- Unicode/transliteration-aware ranking.
- A single global audio engine.
- Search, discovery, queue, and playback.
- Full unit/component/E2E/live-smoke coverage.
- Vercel deployment readiness.
- No database and no authentication.

Phase 2 must **extend** that implementation to add Jamendo as a second legal music provider without regressing the Audius implementation, the reference UI, or the test suite.

## Mandatory Read Order

Before changing code, read the original project instructions first:

1. `agents/AGENTS.md`
2. `agents/01_PROJECT_CONTRACT.md`
3. `agents/02_REFERENCE_UI_PROTOCOL.md`
4. `agents/03_ARCHITECTURE.md`
5. `agents/04_TARGET_FILE_STRUCTURE.md`
6. `agents/05_IMPLEMENTATION_PLAN.md`
7. `agents/06_AUDIUS_INTEGRATION.md`
8. `agents/07_PLAYER_BEHAVIOR.md`
9. `agents/08_UI_FIDELITY_RULES.md`
10. `agents/09_TESTING_QA.md`
11. `agents/10_SECURITY_ENV_DEPLOYMENT.md`
12. `agents/11_DEFINITION_OF_DONE.md`
13. `agents/12_AGENT_EXECUTION_RULES.md`

Then read this Phase 2 addendum in order:

14. `agents/13_JAMENDO_PHASE2_ENTRYPOINT.md`
15. `agents/14_JAMENDO_PROVIDER_CONTRACT.md`
16. `agents/15_MULTI_PROVIDER_SEARCH.md`
17. `agents/16_JAMENDO_SERVERLESS_SECURITY.md`
18. `agents/17_ATTRIBUTION_LICENSE_COMPLIANCE.md`
19. `agents/18_PHASE2_TESTING_QA.md`
20. `agents/19_PHASE2_DEFINITION_OF_DONE.md`

Do not code before reading all relevant files.

## Phase 2 Objective

Add Jamendo as provider #2 so the user can search a broader catalog while preserving the existing UX.

The critical flow becomes:

```text
User search
    |
    +--> existing Audius smart search
    |
    +--> Jamendo search
             |
             v
        normalize
             |
             v
     multi-provider merge
             |
             v
        deduplicate
             |
             v
        rerank globally
             |
             v
        current UI
             |
             v
     existing global player
```

The UI should still feel like one music application rather than two separate provider tabs.

## Non-Negotiable Phase 2 Rules

### Preserve

- Existing Audius behavior.
- Existing smart search.
- Existing ranking fixes.
- Existing UI geometry.
- Existing global player.
- Existing routes.
- Existing tests.
- Existing `refe/` reference project.
- Existing `agents/` instructions.

### Add

- Jamendo provider adapter.
- Server-only Jamendo credential handling.
- Unified provider-aware Track model.
- Multi-provider search/merge/rank.
- Direct Jamendo stream playback.
- Jamendo attribution/backlinks.
- Jamendo-specific tests and smoke tests.

### Do not add

- Supabase.
- Database.
- Login/signup.
- Render.
- YouTube.
- SoundCloud.
- Spotify.
- Download functionality.
- OAuth.
- Jamendo write API.
- User library synchronization.
- Commercial monetization assumptions.

## Architecture Change From Phase 1

Audius remains browser-side because the project already uses an API key supported for browser usage.

Jamendo is different.

The Jamendo developer terms describe API credentials as personal credentials that must not be disclosed to third parties. Therefore:

**DO NOT create `VITE_JAMENDO_CLIENT_ID`.**

Use:

```env
JAMENDO_CLIENT_ID=
```

as a server-only environment variable.

The production frontend calls the same-origin endpoint:

```text
/api/jamendo
```

The Vercel function calls Jamendo with the server-only client ID.

The function returns only sanitized metadata needed by the frontend.

The actual audio stream still flows:

```text
Jamendo storage/CDN
       |
       v
     Browser
```

not:

```text
Jamendo
   |
   v
Vercel Function
   |
   v
Browser
```

Do not proxy audio bytes.

## Local Development Requirement

The existing developer experience must remain simple.

`pnpm dev` should continue to provide a working application locally.

The agent must implement a secure local-development path for `/api/jamendo` without embedding `JAMENDO_CLIENT_ID` in the browser bundle.

Acceptable approaches include:

1. shared server-only Jamendo request handler + Vite dev-server middleware, or
2. another equally simple local server arrangement that does not require the user to log into Vercel just to run `pnpm dev`.

Prefer shared logic so local and Vercel paths do not diverge.

Do not require a persistent standalone backend service.

## Configuration Degradation

If `JAMENDO_CLIENT_ID` is absent:

- Audius must continue working normally.
- Search must not crash.
- Jamendo should be treated as unavailable.
- The UI should not show raw configuration errors.
- Tests should cover this behavior.

Phase 2 should be additive, not make Phase 1 dependent on Jamendo.

## Final Phase 2 Result

The expected production architecture:

```text
                         Browser
                            |
                +-----------+-----------+
                |                       |
                v                       v
           Audius SDK              /api/jamendo
                |                       |
                v                       v
             Audius             Vercel Function
                                        |
                                        | server-only
                                        | JAMENDO_CLIENT_ID
                                        v
                                     Jamendo
                                        |
                         metadata ------+
                                        |
                           direct audio URL
                                        |
                                        v
                                     Browser
```

No Render deployment is required.
