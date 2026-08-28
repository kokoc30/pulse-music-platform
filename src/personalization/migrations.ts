import { PERSONALIZATION_VERSION, createEmptyState } from './types'
import type { PersonalizationState } from './types'

/**
 * Schema migrations for `pulse.personalization.v1`.
 *
 * Two rules, both of which exist so a future schema change cannot corrupt a real
 * listener's history (STEP 20):
 *
 * 1. **Older versions migrate forward, step by step.** Each entry in
 *    `MIGRATIONS` upgrades exactly one version to the next, so adding v2 means
 *    adding one function rather than rewriting a branch.
 * 2. **Newer versions fail safely.** A payload written by a *later* build is not
 *    reinterpreted or partially read — it is reported as incompatible and left
 *    on disk untouched. Silently reading v3 data with v1 rules would be the one
 *    way to turn a rollback into data loss.
 */

type Migration = (state: Record<string, unknown>) => Record<string, unknown>

/** `MIGRATIONS[n]` upgrades a version-`n` payload to version `n + 1`. */
const MIGRATIONS: Record<number, Migration> = {
  // v1 is the first schema; nothing precedes it. Future entries go here.
}

export type MigrationOutcome =
  | { kind: 'ok'; state: Record<string, unknown> }
  | { kind: 'incompatible'; foundVersion: number }
  | { kind: 'unusable' }

export function migrate(raw: unknown): MigrationOutcome {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'unusable' }

  const record = raw as Record<string, unknown>
  const version = record.version

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { kind: 'unusable' }
  }

  if (version > PERSONALIZATION_VERSION) return { kind: 'incompatible', foundVersion: version }

  let state = record
  for (let from = version; from < PERSONALIZATION_VERSION; from += 1) {
    const step = MIGRATIONS[from]
    // A gap in the chain is a programming error, not a data error. Refusing is
    // safer than guessing at the shape.
    if (!step) return { kind: 'incompatible', foundVersion: version }
    state = step(state)
  }

  return { kind: 'ok', state: { ...state, version: PERSONALIZATION_VERSION } }
}

/** The state a fresh browser starts from. */
export function freshState(now = Date.now()): PersonalizationState {
  return createEmptyState(now)
}
