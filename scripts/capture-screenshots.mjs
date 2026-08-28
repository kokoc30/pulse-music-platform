/**
 * Screenshot capture used by the reference-fidelity loop (agents/08_UI_FIDELITY_RULES.md).
 *
 *   node scripts/capture-screenshots.mjs --base http://localhost:3000 --out docs/reference-screenshots --mode reference
 *   node scripts/capture-screenshots.mjs --base http://localhost:4173 --out test-results/production --mode production
 */
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith('--')) acc.push([arg.slice(2), all[i + 1]])
    return acc
  }, []),
)

const BASE = args.base ?? 'http://localhost:3000'
const OUT = args.out ?? 'test-results/screenshots'
const MODE = args.mode ?? 'production'
const QUERY = args.query ?? 'night'

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
]

const GEOMETRY_SELECTORS = [
  '.site-header', '.brand', '.home-button', '.top-search', '.login-button',
  '.app-frame', '.shell-sidebar', '.browse-surface', '.right-rail',
  '.browse-content', '.music-section', '.section-header h2', '.music-grid',
  '.media-card', '.art-wrap', '.media-card h3', '.side-card', '.site-footer',
  '.join-strip', '.music-player', '.player-track', '.player-track img',
  '.player-controls', '.round-play', '.progress', '.player-volume',
  '.search-results', '.top-result-card', '.song-row', '.song-row img',
]

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const consoleErrors = []
const failedRequests = []
const geometry = {}

const measure = (page) =>
  page.evaluate((selectors) => {
    const read = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        sel,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        bg: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        radius: cs.borderRadius,
      }
    }
    return selectors.map(read).filter(Boolean)
  }, GEOMETRY_SELECTORS)

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    hasTouch: vp.name === 'mobile',
  })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${vp.name}] ${m.text()}`)
  })
  page.on('requestfailed', (r) => failedRequests.push(`[${vp.name}] FAILED ${r.url()} :: ${r.failure()?.errorText}`))
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`[${vp.name}] ${r.status()} ${r.url()}`)
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await page.screenshot({ path: `${OUT}/home-${vp.name}.png` })
  await page.screenshot({ path: `${OUT}/home-${vp.name}-full.png`, fullPage: true })
  geometry[`home-${vp.name}`] = await measure(page)

  const searchInput = page.locator('.top-search input')
  await searchInput.fill(QUERY)
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/search-${vp.name}.png` })
  geometry[`search-${vp.name}`] = await measure(page)

  await searchInput.fill('zzqqxxnomatchhere')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${OUT}/search-empty-${vp.name}.png` })

  await searchInput.fill(QUERY)
  await page.waitForTimeout(3000)
  const firstRow = page.locator('.song-row').first()
  if (await firstRow.count()) {
    await firstRow.click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}/playing-${vp.name}.png` })
    geometry[`playing-${vp.name}`] = await measure(page)
  }
  await ctx.close()
}

await browser.close()
console.log(`MODE=${MODE} BASE=${BASE} OUT=${OUT}`)
console.log('GEOMETRY=' + JSON.stringify(geometry))
console.log('CONSOLE_ERRORS=' + JSON.stringify([...new Set(consoleErrors)].slice(0, 15), null, 1))
console.log('FAILED_REQUESTS=' + JSON.stringify([...new Set(failedRequests)].slice(0, 15), null, 1))
