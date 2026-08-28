# 12 — Agent Execution Rules

## Operating Mode

Act as the lead engineer responsible for delivering a working repository, not as a consultant producing suggestions.

Inspect -> plan -> implement -> run -> test -> compare -> fix -> rerun.

Do not stop after writing code if you can execute the relevant commands.

---

## Rule 1 — Evidence Before Assumption

Read files before claiming what they contain.

Examples:
- read `refe/package.json` before choosing run command,
- inspect routes before describing screens,
- inspect SDK types before choosing a streaming method,
- inspect existing production files before overwriting them.

---

## Rule 2 — Preserve User Material

Never delete:
- `refe/`,
- `agents/`,
- unrelated user files.

Do not initialize a new project by wiping the root.

If existing production work conflicts, inspect and migrate carefully.

---

## Rule 3 — Reference Is Design Truth

Do not redesign.

If implementation is visually wrong:
- compare against reference,
- fix production.

Do not "fix" the reference.

---

## Rule 4 — Keep V1 Simple

No database.
No auth.
No payments.
No backend unless proven necessary.
No multiple music providers.

Complexity requires a concrete requirement, not preference.

---

## Rule 5 — Finish Vertical Slices

Do not leave:
- search visually complete but fake,
- player visually complete but nonfunctional,
- queue buttons with no behavior,
- loading UI that never appears,
- mobile UI until "later."

Implement and validate each core flow.

---

## Rule 6 — Fix Failures

If:
- typecheck fails,
- lint fails,
- test fails,
- build fails,
- e2e fails,
- reference comparison shows major mismatch,

debug and fix it.

Do not delete a test merely because it fails.

Do not weaken TypeScript to silence errors.

---

## Rule 7 — No Broad `any`

Use provider types and normalized domain types.

A narrow compatibility cast at an external SDK boundary may be acceptable if documented, but broad `any` across feature code is not.

---

## Rule 8 — No Silent API Fabrication

If an Audius method name differs from expectations:
- inspect installed SDK,
- inspect official API schema/docs,
- adapt.

Do not invent endpoints/options because they sound plausible.

---

## Rule 9 — Secure Credentials

Never expose bearer tokens.

Never print secrets.

Never commit real environment values.

---

## Rule 10 — Test Without Depending on Live Provider

Unit/component/e2e should be deterministic.

Use MSW/fakes.

Run a separate real-provider smoke test for confidence.

---

## Rule 11 — Keep Documentation Current

When architecture changes, update:
- README,
- env example,
- reference deviations if relevant,
- this project's generated docs where appropriate.

Do not leave instructions that no longer run.

---

## Rule 12 — Do Not Claim "Pixel Perfect" Without Comparison

Use "high-fidelity" unless actual screenshot comparison supports stronger language.

Report unresolved mismatches.

---

## Rule 13 — No Premature Backend

If a server becomes necessary:
1. prove the need,
2. document the blocker,
3. create the smallest server surface,
4. keep audio byte flow direct to Audius when possible,
5. add server tests,
6. add deployment docs.

---

## Rule 14 — Final Verification Happens From Clean State

Before final output, ideally:
- remove transient caches if safe,
- install from lockfile,
- run quality gate,
- build from scratch.

Do not rely solely on a hot dev server that has been running for hours.

---

## Final Communication Style

Be precise.

Report:
- PASS,
- FAIL,
- PARTIAL,
not vague phrases like "should work."

A known limitation is better than a false success claim.
