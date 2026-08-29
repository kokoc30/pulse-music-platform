import { LIBRARY_VERSION } from './types'

/**
 * Version handling for the persisted library.
 *
 * There is only one schema so far, so there is nothing to upgrade yet. What
 * matters now is the rule for everything that is *not* version 1, because that
 * rule is what a future migration will be written against:
 *
 * · **A newer version is left alone.** A build that does not understand a record
 *   must not reinterpret it and must not delete it — the build that wrote it is
 *   entitled to find its playlists intact when the visitor goes back. The
 *   session runs with an empty in-memory library and, crucially, does not
 *   persist over the top of it.
 * · **An older version is migrated forward**, one step at a time, when one exists.
 * · **Anything unrecognisable is discarded**, not repaired into a guess.
 *
 * Personalization storage is untouched by any of this. The two domains have
 * separate namespaces, separate versions and separate migration paths, so a
 * library change can never disturb listening history (agents/41 → "Migration").
 */

export type MigrationResult =
  | { kind: 'ok'; state: Record<string, unknown> }
  /** Written by a newer build. Left on disk, not reinterpreted. */
  | { kind: 'incompatible' }
  /** Not a library record at all. */
  | { kind: 'unusable' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function migrateLibrary(value: unknown): MigrationResult {
  if (!isRecord(value)) return { kind: 'unusable' }

  const version = value.version
  if (typeof version !== 'number' || !Number.isFinite(version)) return { kind: 'unusable' }
  if (version > LIBRARY_VERSION) return { kind: 'incompatible' }
  if (version < 1) return { kind: 'unusable' }

  // Version 1 is current. Future steps chain here, each raising `version` by one
  // and returning the record the next step expects.
  return { kind: 'ok', state: value }
}
