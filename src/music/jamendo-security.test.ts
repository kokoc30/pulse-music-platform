import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source-level guards for the one rule Phase 2 cannot get wrong: the Jamendo
 * credential must never be reachable from the browser
 * (agents/16_JAMENDO_SERVERLESS_SECURITY.md).
 *
 * These read the actual source tree rather than asserting on behaviour, because
 * the failure they defend against is somebody adding a line — a `VITE_` variable,
 * a direct `api.jamendo.com` call — that no behavioural test would exercise.
 */

// Vitest runs from the repository root, which is also where the config files
// these assertions read live.
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}

const clientFiles = walk(SRC).filter((file) => !/[\\/]test[\\/]/.test(file) && !/\.test\.tsx?$/.test(file))

/**
 * Executable source only. These files *document* the forbidden patterns at
 * length, and a guard that matched prose would fire on its own explanation
 * rather than on a real leak.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * The one file allowed to name the forbidden fields, because naming them *is*
 * its job: it holds the deny-list the wire parser rejects responses against.
 */
const DENYLIST_FILE = join(SRC, 'music', 'jamendo', 'wire.ts')

function offendersFor(needle: string, options: { allowDenylist?: boolean } = {}): string[] {
  return clientFiles
    .filter((file) => !(options.allowDenylist && file === DENYLIST_FILE))
    .filter((file) => codeOf(file).includes(needle))
    .map((file) => relative(ROOT, file))
}

describe('Jamendo credential containment in the client bundle', () => {
  it('finds client source files to check', () => {
    expect(clientFiles.length).toBeGreaterThan(20)
  })

  it('never references VITE_JAMENDO_CLIENT_ID anywhere in src/', () => {
    // The forbidden variable: anything VITE_-prefixed is inlined verbatim into
    // the public bundle.
    expect(offendersFor('VITE_JAMENDO_CLIENT_ID')).toEqual([])
    expect(offendersFor('import.meta.env.VITE_JAMENDO')).toEqual([])
  })

  it('declares no Jamendo variable on the Vite env type', () => {
    const envTypes = readFileSync(join(SRC, 'vite-env.d.ts'), 'utf8')
    expect(envTypes).not.toContain('JAMENDO')
  })

  it('never calls the Jamendo API directly from the browser', () => {
    // Metadata requests must go through the same-origin function, which is the
    // only place the credential exists.
    expect(offendersFor('api.jamendo.com')).toEqual([])
  })

  it('never builds a client_id query parameter in client code', () => {
    expect(offendersFor('client_id', { allowDenylist: true })).toEqual([])
  })

  it('never imports the server-only Jamendo module from the client', () => {
    // A single such import would pull the credential-handling code — and its
    // `process.env` read — into the browser graph.
    const offenders = clientFiles.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return /from\s+['"][^'"]*(\.\.\/)+server\//.test(source) || source.includes("from 'server/")
    })
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([])
  })

  it('exposes no download affordance for Jamendo content', () => {
    // Phase 2 has no download feature and `audiodownload` is stripped upstream.
    expect(offendersFor('audiodownload', { allowDenylist: true })).toEqual([])
  })

  it('confines the forbidden field names to the deny-list constant itself', () => {
    const code = codeOf(DENYLIST_FILE)
    const denylist = /FORBIDDEN_WIRE_KEYS\s*=\s*\[[\s\S]*?\]/.exec(code)?.[0] ?? ''
    expect(denylist).toContain('audiodownload')
    expect(denylist).toContain('client_id')
    // Outside that array the file must not mention them at all.
    const rest = code.replace(denylist, '')
    expect(rest).not.toContain('audiodownload')
    expect(rest).not.toContain('client_id')
  })
})

describe('the environment contract', () => {
  it('documents JAMENDO_CLIENT_ID as server-only and never as a VITE_ variable', () => {
    const example = readFileSync(join(ROOT, '.env.example'), 'utf8')
    expect(example).toMatch(/^JAMENDO_CLIENT_ID=/m)
    expect(example).not.toMatch(/^VITE_JAMENDO_CLIENT_ID=/m)
    expect(example).toContain('VITE_AUDIUS_API_KEY=')
    expect(example).toContain('VITE_AUDIUS_APP_NAME=Pulse Music Platform')
  })

  it('keeps real environment files out of version control', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/^\.env$/m)
    expect(gitignore).toMatch(/^\.env\.\*$/m)
    expect(gitignore).toMatch(/^!\.env\.example$/m)
  })

  it('keeps the SPA rewrite from swallowing the API route', () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
      rewrites?: Array<{ source: string; destination: string }>
    }
    const rewrites = vercel.rewrites ?? []
    expect(rewrites.length).toBeGreaterThan(0)
    for (const rewrite of rewrites) {
      if (rewrite.destination !== '/index.html') continue
      // `/(.*)` would capture /api/jamendo and serve index.html instead of the
      // function. The pattern must exclude the API namespace.
      const pattern = new RegExp(`^${rewrite.source}$`)
      expect(pattern.test('/api/jamendo')).toBe(false)
      // …while still catching every real SPA route.
      expect(pattern.test('/search')).toBe(true)
      expect(pattern.test('/')).toBe(true)
    }
  })
})
