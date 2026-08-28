/**
 * Rasterises the existing Pulse mark into the PNG sizes a manifest needs.
 *
 * Run deliberately, not on every build:
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * Chromium is already a dev dependency for the E2E suite, so this adds no new
 * package just to turn one SVG into two PNGs. The mark itself is unchanged —
 * `public/pulse-mark.svg` remains the single source of the branding.
 *
 * The maskable variant pads the mark into the safe zone Android's adaptive-icon
 * mask crops to, so the disc is not clipped on a circular launcher.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const mark = readFileSync(new URL('../public/pulse-mark.svg', import.meta.url), 'utf8')

/** Background matches `--color-app-bg`, so the icon sits on the app's own black. */
const BACKGROUND = '#000000'

const TARGETS = [
  { file: 'pulse-icon-192.png', size: 192, scale: 1 },
  { file: 'pulse-icon-512.png', size: 512, scale: 1 },
  // ~80% of the canvas: inside Android's documented 4/5 safe zone.
  { file: 'pulse-icon-maskable-512.png', size: 512, scale: 0.8 },
]

const browser = await chromium.launch()
const page = await browser.newPage()

for (const { file, size, scale } of TARGETS) {
  const inner = Math.round(size * scale)
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;
       background:${BACKGROUND};display:grid;place-items:center">
       <div style="width:${inner}px;height:${inner}px">${mark}</div>
     </body></html>`,
  )
  const png = await page.screenshot({ omitBackground: false })
  writeFileSync(new URL(`../public/${file}`, import.meta.url), png)
  console.log(`[pwa-icons] wrote public/${file} (${size}x${size})`)
}

await browser.close()
