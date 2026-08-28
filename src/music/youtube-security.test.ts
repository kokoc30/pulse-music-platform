import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source-level guards for the rules Phase 3 cannot get wrong.
 *
 * These read the actual source tree rather than asserting on behaviour, because
 * the failures they defend against are somebody *adding a line* — a `VITE_`
 * variable, a direct `googleapis.com` call, a `no-referrer` header, an
 * `<audio>` element pointed at YouTube — that no behavioural test would ever
 * exercise (agents/23_YOUTUBE_SERVERLESS_SECURITY.md).
 */

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
 * Executable source only. Several of these files *document* the forbidden
 * patterns at length, and a guard that matched prose would fire on its own
 * explanation rather than on a real leak.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function offendersFor(needle: string): string[] {
  return clientFiles.filter((file) => codeOf(file).includes(needle)).map((file) => relative(ROOT, file))
}

describe('YouTube credential containment in the client bundle', () => {
  it('finds client source files to check', () => {
    expect(clientFiles.length).toBeGreaterThan(20)
  })

  it('never references VITE_YOUTUBE_API_KEY anywhere in src/', () => {
    // A `VITE_` variable is compiled verbatim into the public bundle. A Google
    // API key there is a key anyone can spend against the daily quota.
    expect(offendersFor('VITE_YOUTUBE_API_KEY')).toEqual([])
  })

  it('never reads any YouTube key from import.meta.env', () => {
    expect(offendersFor('import.meta.env.VITE_YOUTUBE')).toEqual([])
    expect(offendersFor('YOUTUBE_API_KEY')).toEqual([])
  })

  it('declares no YouTube variable on the Vite env type', () => {
    const envTypes = readFileSync(join(SRC, 'vite-env.d.ts'), 'utf8')
    expect(envTypes).not.toContain('YOUTUBE')
  })

  it('never calls the YouTube Data API directly from the browser', () => {
    expect(offendersFor('googleapis.com')).toEqual([])
    expect(offendersFor('youtube/v3')).toEqual([])
  })

  it('never builds a key query parameter in client code', () => {
    // Narrow on purpose: a bare `key` is React's list prop and an object key,
    // so the guard looks for the two shapes that would actually put a
    // credential on a URL.
    const offenders = clientFiles
      .filter((file) => {
        const code = codeOf(file)
        return /\.set\(\s*['"]key['"]/.test(code) || /[?&]key=/.test(code)
      })
      .map((file) => relative(ROOT, file))
    expect(offenders).toEqual([])
  })

  it('never imports the server-only YouTube module from the client', () => {
    const serverImports = clientFiles.filter((file) => {
      const code = codeOf(file)
      return /from\s+['"][^'"]*server\/youtube/.test(code)
    })
    expect(serverImports.map((file) => relative(ROOT, file))).toEqual([])
  })

  it('exposes no download, extraction or media-proxy affordance for YouTube', () => {
    // agents/21 → separating audio, downloading and re-hosting are all
    // prohibited, and the surest way to keep that true is to own no code that
    // could do it.
    for (const needle of ['googlevideo.com', 'ytdl', 'youtube-dl', 'yt-dlp', 'audioUrlFor', 'get_video_info']) {
      expect(offendersFor(needle)).toEqual([])
    }
  })

  it('never points a media element at YouTube', () => {
    // The only `<audio>` in the app is the Audius/Jamendo engine. Nothing in
    // `src/` may construct a YouTube URL for it.
    for (const file of clientFiles) {
      const code = codeOf(file)
      if (!/new Audio\(|HTMLAudioElement|\.src\s*=/.test(code)) continue
      expect(code).not.toMatch(/youtube\.com\/embed/)
      expect(code).not.toMatch(/ytimg|googlevideo/)
    }
  })
})

describe('the environment contract', () => {
  const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8')

  it('documents YOUTUBE_API_KEY as server-only and never declares a VITE_ one', () => {
    expect(envExample).toMatch(/^YOUTUBE_API_KEY=/m)
    // The file *names* the forbidden variable in prose to explain why it does
    // not exist; what must never appear is an actual assignment.
    expect(envExample).not.toMatch(/^\s*VITE_YOUTUBE_API_KEY\s*=/m)
    expect(envExample).toMatch(/SERVER ONLY/)
  })

  it('states the quota constraint that makes the fallback explicit', () => {
    expect(envExample).toMatch(/100 search\.list calls PER DAY/i)
  })

  it('keeps real environment files out of version control', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/^\.env$/m)
    expect(gitignore).toMatch(/^!\.env\.example$/m)
  })

  it('keeps the SPA rewrite from swallowing the YouTube API route', () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
      rewrites: Array<{ source: string; destination: string }>
    }
    const spa = vercel.rewrites.find((rewrite) => rewrite.destination === '/index.html')
    expect(spa?.source).toBe('/((?!api/).*)')
  })
})

describe('the Referer requirement', () => {
  /**
   * "API Clients that use the YouTube embedded player (including the YouTube
   * IFrame Player API) must provide identification through the HTTP Referer
   * request header." … "YouTube recommends using strict-origin-when-cross-origin
   * Referrer-Policy" … "API Clients must not use the noreferrer feature, which
   * suppresses the Referer value." — Required Minimum Functionality.
   */
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
  }
  const allHeaders = vercel.headers.flatMap((entry) => entry.headers)

  it('sends exactly the Referrer-Policy YouTube recommends', () => {
    const referrer = allHeaders.find((header) => header.key.toLowerCase() === 'referrer-policy')
    expect(referrer?.value).toBe('strict-origin-when-cross-origin')
  })

  it('never sends no-referrer or same-origin, which would suppress it', () => {
    for (const header of allHeaders) {
      if (header.key.toLowerCase() !== 'referrer-policy') continue
      expect(header.value).not.toMatch(/^no-referrer/)
      expect(header.value).not.toBe('same-origin')
    }
  })

  it('sets no referrer meta tag in the document that could override it', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
    expect(html).not.toMatch(/<meta[^>]+name=["']referrer["']/i)
  })

  it('never writes rel="noreferrer" on a YouTube link in client source', () => {
    for (const file of clientFiles) {
      const code = codeOf(file)
      if (!/youtube/i.test(code)) continue
      expect(code).not.toContain('noreferrer')
    }
  })
})

describe('the bundle gate covers the YouTube key', () => {
  const scanner = readFileSync(join(ROOT, 'scripts', 'scan-bundle-secrets.mjs'), 'utf8')

  it('reads the configured YOUTUBE_API_KEY value and searches for it', () => {
    expect(scanner).toContain('YOUTUBE_API_KEY')
    expect(scanner).toContain('YOUTUBE_API_KEY value')
  })

  it('also fails on the forbidden variable and on a Google key literal', () => {
    expect(scanner).toContain('VITE_YOUTUBE_API_KEY')
    expect(scanner).toContain('googleapis.com/youtube/v3')
    expect(scanner).toContain('AIza')
  })
})
