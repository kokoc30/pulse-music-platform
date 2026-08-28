#!/usr/bin/env node
/**
 * Bundle credential gate.
 *
 * Fails the build if a server-only secret — or any marker of one — reached the
 * browser output. Phase 2's whole security argument rests on this: Jamendo's
 * client id is injected inside the Vercel Function and must appear nowhere in
 * `dist/` (agents/16_JAMENDO_SERVERLESS_SECURITY.md → "Bundle Verification").
 *
 *   node scripts/scan-bundle-secrets.mjs
 *
 * Reads `.env` / `.env.local` so it can search for the *actual* configured
 * value, not just the variable name. Exits non-zero on any hit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const DIST = 'dist'
const ROOT = process.cwd()

/** Env files are read directly: this script must not depend on the app's config. */
function readEnvFiles() {
  const values = {}
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    let raw
    try {
      raw = readFileSync(join(ROOT, file), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      const value = match[2].trim().replace(/^["']|["']$/g, '')
      if (value) values[match[1]] = value
    }
  }
  for (const key of ['JAMENDO_CLIENT_ID', 'YOUTUBE_API_KEY']) {
    if (process.env[key]) values[key] = process.env[key].trim()
  }
  return values
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const env = readEnvFiles()
const clientId = env.JAMENDO_CLIENT_ID
const youtubeKey = env.YOUTUBE_API_KEY

/** Literal secret values that must not appear anywhere in the client output. */
const secrets = []
if (clientId && clientId.length >= 6) {
  secrets.push({ label: 'JAMENDO_CLIENT_ID value', needle: clientId })
}
if (youtubeKey && youtubeKey.length >= 6) {
  secrets.push({ label: 'YOUTUBE_API_KEY value', needle: youtubeKey })
}

/**
 * Markers that are forbidden regardless of whether a credential is configured,
 * so the gate is meaningful on a machine that has neither provider key.
 *
 * `AIza` is the prefix every Google API key currently carries, so it catches a
 * key that reached the bundle from somewhere other than this machine's `.env`
 * — a hard-coded literal, a stale build, a fixture pasted into source. A bare
 * `key=` is deliberately *not* a marker: it occurs constantly in minified
 * JavaScript and would make the gate meaningless.
 */
const markers = [
  { label: 'VITE_JAMENDO_CLIENT_ID (forbidden variable)', needle: 'VITE_JAMENDO_CLIENT_ID' },
  { label: 'direct credential-bearing Jamendo API call', needle: 'api.jamendo.com/v3.0' },
  { label: 'Jamendo client_id query parameter', needle: 'client_id=' },
  { label: 'VITE_YOUTUBE_API_KEY (forbidden variable)', needle: 'VITE_YOUTUBE_API_KEY' },
  { label: 'direct credential-bearing YouTube Data API call', needle: 'googleapis.com/youtube/v3' },
  { label: 'Google API key literal (AIza…)', needle: 'AIza' },
]

let files
try {
  files = walk(DIST)
} catch {
  console.error(`[scan-bundle-secrets] ${DIST}/ not found. Run \`pnpm build\` first.`)
  process.exit(1)
}

const findings = []
for (const file of files) {
  if (!/\.(js|mjs|cjs|css|html|json|map|txt)$/i.test(file)) continue
  let contents
  try {
    contents = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const { label, needle } of [...secrets, ...markers]) {
    if (contents.includes(needle)) {
      findings.push({ file: relative(ROOT, file), label })
    }
  }
}

const scanned = files.length
if (findings.length > 0) {
  console.error(`[scan-bundle-secrets] FAIL — ${findings.length} match(es) across ${scanned} files:`)
  for (const finding of findings) console.error(`  ${finding.file}: ${finding.label}`)
  process.exit(1)
}

const configured = [clientId ? 'JAMENDO_CLIENT_ID' : null, youtubeKey ? 'YOUTUBE_API_KEY' : null].filter(
  Boolean,
)
const credentialNote = configured.length
  ? `configured values: ${configured.join(', ')}`
  : 'no provider credential configured (marker-only scan)'
console.log(
  `[scan-bundle-secrets] PASS — 0 matches across ${scanned} files in ${DIST}/ (${credentialNote}).`,
)
