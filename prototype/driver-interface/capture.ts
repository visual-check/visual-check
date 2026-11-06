// PROTOTYPE, throwaway: one capture run through the driver interface, as Story readiness and page reuse decided:
// goto per capture on Storybook's test path, the no-animation stylesheet at document start, storyFinished, images and
// fonts. Broken stories and crashes as Raw CDP for Chromium decided. Writes <out>/png/*.png and <out>/run.json.
//   node capture.ts --driver raw|pw-chromium|pw-webkit --base http://127.0.0.1:6400 --out dir [--network host|proxy]
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { BrowserExited, type Driver, type Page, PageCrashed, TimeoutError } from './driver.ts'
import { launchPlaywright } from './playwright.ts'
import { launchRawChromium } from './raw-cdp.ts'
import { socksStats, startSocks } from './socks.ts'

const { values: o } = parseArgs({
  options: {
    driver: { type: 'string', default: 'raw' },
    base: { type: 'string', default: 'http://127.0.0.1:6400' },
    out: { type: 'string' },
    label: { type: 'string', default: '' },
    workers: { type: 'string', default: '2' },
    network: { type: 'string', default: process.platform === 'linux' ? 'host' : 'proxy' },
    'proxy-host': { type: 'string', default: '127.0.0.1' },
    'proxy-port': { type: 'string', default: '1080' },
    image: { type: 'string', default: 'mcr.microsoft.com/playwright:v1.64.1-noble' },
    platform: { type: 'string', default: 'linux/amd64' },
    cpus: { type: 'string', default: '2' },
    memory: { type: 'string', default: '7g' },
    timeout: { type: 'string', default: '10000' },
    only: { type: 'string', default: '' }, // comma list of story ids
    skip: { type: 'string', default: '' }, // comma list of story ids
    'side-by-side': { type: 'string', default: 'pages-homepage--default,components-restaurantcard--default,components-header--with-cart-data' },
    'kill-browser-after': { type: 'string', default: '' }, // kills the browser process once, after N records
    'pw-mode': { type: 'string', default: 'detached' },
    offline: { type: 'boolean', default: false }, // external requests fail fast, for every driver
    port: { type: 'string', default: '3333' },
    name: { type: 'string', default: `vc-proto-${process.pid}` },
  },
})
const TIMEOUT = Number(o.timeout)
const VIEWPORT = { width: 1280, height: 720 }
const out = o.out!
mkdirSync(path.join(out, 'png'), { recursive: true })

// ---- the one in-page script, the same for every driver ----
const NOANIM = '*,*::before,*::after{animation:none!important;transition:none!important}'
const INIT = `(() => {
  const add = () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(NOANIM)}; document.documentElement.append(s) }
  document.documentElement ? add() : document.addEventListener('readystatechange', add, { once: true })
  const vc = (window.__vc = {})
  vc.finished = new Promise((resolve) => { vc.resolve = resolve })
  let channel
  Object.defineProperty(globalThis, '__STORYBOOK_ADDONS_CHANNEL__', {
    configurable: true,
    get: () => channel,
    set: (c) => { channel = c; c.on('storyFinished', (e) => vc.resolve({ status: e.status, storyId: e.storyId, reporters: (e.reporters || []).filter((r) => r.status && r.status !== 'success').map((r) => r.type + ':' + r.status) })) },
  })
})()`
// The readiness timeout covers the whole wait. Fonts: each face still loading, not document.fonts.ready, which WebKit
// 27.2 leaves pending for good on this Storybook (status stays 'loading' with every face loaded or failed).
const readyScript = (id: string) => `(async () => {
  const vc = window.__vc
  if (!vc) return { status: 'no hook' }
  const deadline = performance.now() + ${TIMEOUT}
  const left = () => new Promise((r) => setTimeout(() => r('timeout'), Math.max(0, deadline - performance.now())))
  const f = await Promise.race([vc.finished, left().then(() => ({ status: 'timeout', step: 'storyFinished' }))])
  if (f.status !== 'success') return f
  if (f.storyId !== ${JSON.stringify(id)}) return { status: 'wrong story ' + f.storyId }
  if (document.body.classList.contains('sb-show-errordisplay')) return { status: 'error display' }
  const images = Array.from(document.images)
  for (const i of images) i.loading = 'eager'
  const fonts = Array.from(document.fonts).filter((x) => x.status === 'loading')
  const all = Promise.all([...images.map((i) => i.decode().catch(() => undefined)), ...fonts.map((x) => x.loaded.catch(() => undefined))])
  if ((await Promise.race([all.then(() => 'ok'), left()])) === 'timeout') return { status: 'timeout', step: 'images and fonts' }
  return { ...f, fontsStatus: document.fonts.status }
})()`
const FREEZE = `(() => {
  if (!document.getElementById('__vc_caret')) { const s = document.createElement('style'); s.id = '__vc_caret'; s.textContent = '*,*::before,*::after{caret-color:transparent!important}'; document.documentElement.append(s) }
  for (const a of document.getAnimations()) { const t = a.effect && a.effect.getComputedTiming(); if (t && Number.isFinite(t.endTime)) a.finish(); else a.cancel() }
  return true
})()`

// ---- workload ----
type Cell = { id: string; globals?: string; key: string }
const index = await (await fetch(`${o.base}/index.json`)).json()
const only = new Set(o.only.split(',').filter(Boolean))
const skip = new Set(o.skip.split(',').filter(Boolean))
let cells: Cell[] = Object.values<any>(index.entries)
  .filter((e) => e.type === 'story' && (!only.size || only.has(e.id)) && !skip.has(e.id))
  .map((e) => e.id as string)
  .sort()
  .map((id) => ({ id, key: id }))
for (const id of o['side-by-side'].split(',').filter(Boolean)) if (!only.size || only.has(id)) cells.push({ id, globals: 'theme:side-by-side', key: `${id}@side-by-side` })
const url = (c: Cell) => `${o.base}/iframe.html?id=${c.id}&viewMode=story${c.globals ? `&globals=${c.globals}` : ''}`

// ---- driver ----
const socks = o.driver === 'raw' && o.network === 'proxy' ? await startSocks(o['proxy-host'], Number(o['proxy-port']), o.offline) : null
const OFFLINE_ARGS = o.offline && o.network === 'host' ? ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'] : []
let launches = 0
const launch = (): Promise<Driver> => {
  launches++
  const name = `${o.name}-${launches}`
  const common = { image: o.image, platform: o.platform, cpus: o.cpus || undefined, memory: o.memory || undefined, name }
  if (o.driver === 'raw') return launchRawChromium({ ...common, network: o.network as 'host' | 'proxy', proxyPort: Number(o['proxy-port']), extraArgs: OFFLINE_ARGS })
  return launchPlaywright({ ...common, browser: o.driver === 'pw-webkit' ? 'webkit' : 'chromium', port: Number(o.port), mode: o['pw-mode'] as 'detached' | 'attached', offline: o.offline })
}

type Result = { key: string; ok: boolean; reason?: string; detail?: string; attempts: number; ms: number }
const results: Result[] = []
const hazards: Array<{ key: string; kind: string; detail: string }> = []
const current: string[] = []
let fatal: string | null = null
const t0 = performance.now()
let driver = await launch()
const launchMs = Math.round(performance.now() - t0)
console.error(`launched ${driver.version} in ${launchMs} ms`)
let relaunching: Promise<void> | null = null
let generation = 0
// Browser process exit: relaunch once; a second exit or a failed relaunch exits 2
const relaunch = (gen: number): Promise<void> => {
  if (gen !== generation) return relaunching ?? Promise.resolve()
  generation++
  relaunching = (async () => {
    if (launches >= 2) { fatal = 'browser exited twice'; return }
    await driver.close().catch(() => {})
    try { driver = await launch() } catch (e) { fatal = `relaunch failed: ${(e as Error).message}` }
  })()
  return relaunching
}

const pageFor = (i: number) =>
  driver.newPage({
    viewport: VIEWPORT,
    userAgentSuffix: ' StorybookTestRunner',
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    initScript: INIT,
    onHazard: (kind, detail) => hazards.push({ key: current[i], kind, detail }),
  })

const NAVIGATED = /navigated or closed|Execution context was destroyed|interrupted by another navigation|Cannot find context|frame was detached/i
type Once = { png?: Buffer; reason?: string; detail?: string; lost?: string }
async function captureOnce(page: Page, cell: Cell): Promise<Once> {
  try {
    await page.setViewport(VIEWPORT)
    await page.goto(url(cell), 30_000)
    const status = await page.evaluate<any>(readyScript(cell.id), TIMEOUT + 5_000)
    if (page.navigations() > 1) return { lost: `${page.navigations()} documents after ready` }
    if (status?.status === 'timeout') return { reason: 'timeout', detail: `not ready within ${TIMEOUT} ms, at ${status.step}` }
    if (status?.status !== 'success') return { reason: 'error', detail: JSON.stringify(status) }
    await page.evaluate(FREEZE, 5_000)
    const png = await page.screenshot()
    if (page.navigations() > 1) return { lost: `${page.navigations()} documents after screenshot` }
    return { png }
  } catch (e) {
    if (e instanceof PageCrashed || e instanceof BrowserExited) throw e
    const m = String((e as Error).message ?? e)
    // The document went away under the call: the main frame navigated
    if (page.navigations() > 1 || NAVIGATED.test(m)) return { lost: m.replace(/\n[^]*/, '').slice(-200) }
    if (e instanceof TimeoutError) return { reason: 'timeout', detail: m }
    return { reason: 'error', detail: m.slice(0, 300) }
  }
}

let next = 0
// Kills the browser process after each listed number of records, e.g. 20,60 for a second exit
const killAt = o['kill-browser-after'].split(',').filter(Boolean).map(Number)
async function worker(i: number) {
  let gen = generation
  let page: Page | null = await pageFor(i)
  while (next < cells.length && !fatal) {
    const cell = cells[next++]
    current[i] = cell.key
    const t = performance.now()
    let r: Once & { attempts: number }
    try {
      // Lost document: any main-frame navigation after goto means a fresh goto, on a fresh page, because the old page
      // can be stuck mid-navigation. After 2 retries, "navigated away".
      for (let attempt = 1; ; attempt++) {
        if (!page) { gen = generation; page = await pageFor(i) }
        const once = await captureOnce(page, cell)
        r = { ...once, attempts: attempt }
        if (!once.lost) break
        console.error(`retry ${cell.key} ${attempt}: ${once.lost}`)
        page.close().catch(() => {})
        page = null
        if (attempt === 3) { r = { reason: 'navigated away', detail: once.lost, attempts: attempt }; break }
      }
    } catch (e) {
      if (e instanceof PageCrashed) r = { reason: 'crashed', detail: 'the page crashed; often memory or too many workers', attempts: 1 }
      else if (e instanceof BrowserExited) r = { reason: 'browser exited', detail: (e as Error).message.slice(0, 300), attempts: 1 }
      else r = { reason: 'error', detail: String((e as Error).message ?? e).slice(0, 300), attempts: 1 }
    }
    const ms = Math.round(performance.now() - t)
    if (r.png) writeFileSync(path.join(out, 'png', `${cell.key.replace(/[^a-z0-9@-]/gi, '_')}.png`), r.png)
    results.push({ key: cell.key, ok: !!r.png, reason: r.reason, detail: r.detail, attempts: r.attempts, ms })
    if (r.reason) console.error(`broken ${cell.key}: ${r.reason} ${r.detail ?? ''}`.slice(0, 300))
    // A crashed page stays crashed, and a timed-out page may still be stuck: the worker opens a fresh page
    if (r.reason === 'crashed' || r.reason === 'timeout') { page?.close().catch(() => {}); page = null }
    if (r.reason === 'browser exited') { await relaunch(gen); page = null }
    if (killAt.length && results.length >= killAt[0]) { killAt.shift(); console.error(`killing the browser after ${results.length} records`); driver.killBrowser() }
  }
  await page?.close().catch(() => {})
}
// A browser exit while every worker is idle still counts
driver.exited.then(() => {})
await Promise.all(Array.from({ length: Number(o.workers) }, (_, i) => worker(i)))
const wallS = (performance.now() - t0) / 1000
await driver.close().catch(() => {})
socks?.close()

const broken = results.filter((r) => !r.ok)
const record = {
  label: o.label, driver: o.driver, version: driver.version, base: o.base, offline: o.offline, network: o.driver === 'raw' ? o.network : 'exposeNetwork', platform: process.platform,
  workers: Number(o.workers), cells: cells.length, captures: results.filter((r) => r.ok).length, broken: broken.map(({ key, reason, detail }) => ({ key, reason, detail })),
  retried: results.filter((r) => r.attempts > 1).map((r) => ({ key: r.key, attempts: r.attempts })),
  hazards, launches, launchMs, fatal, exitCode: fatal ? 2 : broken.length ? 1 : 0, socks: socks ? { ...socksStats } : null,
  wallS: +wallS.toFixed(1), capturesPerS: +(results.length / wallS).toFixed(2), msPerCapture: results.map((r) => [r.key, r.ms]), at: new Date().toISOString(),
}
writeFileSync(path.join(out, 'run.json'), `${JSON.stringify(record, null, 1)}\n`)
console.log(JSON.stringify({ label: o.label, driver: o.driver, version: driver.version, cells: cells.length, captures: record.captures, broken: broken.map((b) => `${b.key}:${b.reason}`), hazards: hazards.length, launches, fatal, wallS: record.wallS }))
process.exit(record.exitCode)
