import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Vercel Function import graph, asserted at the specifier level.
 *
 * `package.json` declares `"type": "module"`, so the deployed Functions run
 * under Node's real ESM loader. That loader does no extension guessing: a
 * relative specifier without an extension is not resolved, it throws
 * `ERR_MODULE_NOT_FOUND` — and it throws at *invocation*, long after a build
 * that never had to resolve those specifiers reported success.
 *
 * That is the exact failure this file exists to prevent: `GET /api/youtube` and
 * `GET /api/jamendo` deployed, built green, and answered every request with
 * `500 FUNCTION_INVOCATION_FAILED` because `api/youtube.ts` said
 * `from '../server/youtube/handler'` instead of `'../server/youtube/handler.js'`.
 *
 * No test that runs the handlers can catch this. Vitest resolves through Vite,
 * which does guess extensions, so the whole suite stays green while production
 * cannot start. So the specifiers themselves are read off disk and checked.
 *
 * Cross-platform by construction: paths are compared in POSIX form and every
 * filesystem access goes through `node:path`, so the assertions read the same
 * on Windows, macOS and Linux (and in CI, which is where they matter).
 */

const ROOT = process.cwd()

/** The two files Vercel turns into Functions — the roots of the runtime graph. */
const ENTRYPOINTS = ['api/youtube.ts', 'api/jamendo.ts']

/** Directories that ship to Vercel and therefore have to obey Node ESM rules. */
const RUNTIME_DIRS = ['api', 'server']

/** Repo-relative, forward-slashed, so assertion messages are stable everywhere. */
const idOf = (absolute: string) => relative(ROOT, absolute).split(sep).join(posix.sep)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

const isTestFile = (id: string) => /\.(test|spec)\.ts$/.test(id)

/**
 * Every static specifier in a module: `from '…'` covers import- and
 * export-from in both their single-line and multi-line forms, and the second
 * pattern covers a side-effect `import '…'`, which has no `from` at all.
 */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) found.push(match[1])
  for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) found.push(match[1])
  return found
}

const isRelative = (specifier: string) => specifier.startsWith('./') || specifier.startsWith('../')

/** `./foo.js` is what Node loads; `./foo.ts` is what TypeScript compiles. */
function sourceFileFor(importer: string, specifier: string): string | null {
  const target = resolve(dirname(importer), specifier)
  const asTypeScript = target.replace(/\.js$/, '.ts')
  if (existsSync(asTypeScript) && statSync(asTypeScript).isFile()) return asTypeScript
  if (existsSync(target) && statSync(target).isFile()) return target
  return null
}

const runtimeFiles = RUNTIME_DIRS.flatMap((dir) => walk(join(ROOT, dir)))
const shippedFiles = runtimeFiles.filter((file) => !isTestFile(idOf(file)))

describe('the deployed graph is reachable under Node ESM', () => {
  /**
   * A real traversal from the entrypoints rather than a scan of the directory:
   * this is the set of modules an invocation actually pulls in, so a break
   * anywhere along a chain is reported against the chain that carries it.
   */
  function traceFrom(entry: string): { chains: Map<string, string[]>; broken: string[] } {
    const chains = new Map<string, string[]>()
    const broken: string[] = []
    const queue: { file: string; chain: string[] }[] = [{ file: resolve(ROOT, entry), chain: [entry] }]

    while (queue.length > 0) {
      const { file, chain } = queue.shift()!
      const id = idOf(file)
      if (chains.has(id)) continue
      chains.set(id, chain)

      for (const specifier of specifiersOf(file)) {
        if (!isRelative(specifier)) continue
        const resolved = sourceFileFor(file, specifier)
        if (!resolved) {
          broken.push(`${id} -> ${specifier}`)
          continue
        }
        queue.push({ file: resolved, chain: [...chain, idOf(resolved)] })
      }
    }
    return { chains, broken }
  }

  const traces = ENTRYPOINTS.map((entry) => ({ entry, ...traceFrom(entry) }))

  it.each(ENTRYPOINTS)('%s reaches every module it imports', (entry) => {
    const trace = traces.find((candidate) => candidate.entry === entry)!
    expect(trace.broken).toEqual([])
    // A graph of one means the entrypoint's own import failed to resolve.
    expect(trace.chains.size).toBeGreaterThan(1)
  })

  it.each(ENTRYPOINTS)('%s imports nothing from outside api/ and server/', (entry) => {
    const trace = traces.find((candidate) => candidate.entry === entry)!
    const strays = [...trace.chains.keys()].filter(
      (id) => !RUNTIME_DIRS.some((dir) => id.startsWith(`${dir}/`)),
    )
    expect(strays).toEqual([])
  })

  it('never drags test or smoke-harness modules into a Function', () => {
    const harness = traces.flatMap(({ chains }) =>
      [...chains.keys()].filter((id) => isTestFile(id) || id.includes('smoke')),
    )
    expect(harness).toEqual([])
  })
})

describe('relative specifiers carry the extension Node requires', () => {
  const offenders = shippedFiles.flatMap((file) =>
    specifiersOf(file)
      .filter(isRelative)
      .filter((specifier) => !/\.(js|json|mjs|cjs)$/.test(specifier))
      .map((specifier) => `${idOf(file)} -> ${specifier}`),
  )

  it('leaves none extensionless anywhere under api/ or server/', () => {
    expect(offenders).toEqual([])
  })

  it('points every one of them at a file that exists', () => {
    const dangling = shippedFiles.flatMap((file) =>
      specifiersOf(file)
        .filter(isRelative)
        .filter((specifier) => sourceFileFor(file, specifier) === null)
        .map((specifier) => `${idOf(file)} -> ${specifier}`),
    )
    expect(dangling).toEqual([])
  })

  /**
   * The opposite mistake, and an easy one to make while fixing the first: Node
   * resolves bare specifiers through `node_modules` and package exports, where
   * an invented `.js` suffix breaks a package that previously worked.
   */
  it('adds no extension to a bare package import', () => {
    const mangled = runtimeFiles.flatMap((file) =>
      specifiersOf(file)
        .filter((specifier) => !isRelative(specifier) && specifier.endsWith('.js'))
        .map((specifier) => `${idOf(file)} -> ${specifier}`),
    )
    expect(mangled).toEqual([])
  })
})
