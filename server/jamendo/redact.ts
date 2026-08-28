/**
 * Jamendo's view of the shared credential redaction.
 *
 * The implementation moved to `server/shared/redact.ts` in Phase 3 so the
 * YouTube module could reuse it verbatim (agents/23_YOUTUBE_SERVERLESS_SECURITY.md
 * → "Sanitization" requires the same redaction extended to `key=`). Nothing
 * about Jamendo's behaviour changed: every existing import path and every
 * existing test still resolves through this file.
 */
export { REDACTED, redactSecrets, redactLiteral, containsSecret, describeError } from '../shared/redact'
