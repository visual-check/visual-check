// RESEARCH, throwaway: for the Self-navigating stories under raw CDP ticket. The Driver interface prototype's capture
// run, cut down to mealdrop's userflow stories repeated, with up to 5 attempts per story and a probe in the page that
// records each click user-event dispatches (and whether its target is still in the document) and when the "Burgers"
// element changes, i.e. when the router's transition commits. The probe's log lives in sessionStorage, so it survives
// the story's own navigation and is read from whatever document the page ends on. Writes <out>/run.json.
//   node capture.ts --driver raw|pw --base http://127.0.0.1:6400 --out dir [--net] [--pw-setup] [--workers 1] ...
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { BrowserExited, type Driver, type Page, PageCrashed, TimeoutError } from './driver.ts'
import { launchPlaywright } from './playwright.ts'
import { launchRawChromium } from './raw-cdp.ts'

const USERFLOWS = ['demo-mode', 'home', 'to-category-detail-page', 'to-category-list-page', 'to-checkout-page', 'to-restaurant-detail-page', 'to-success-page'].map((s) => `userflows-app--${s}`)
const { values: o } = parseArgs({
  options: {
    driver: { type: 'string', default: 'raw' }, // raw | pw (Playwright Chromium through run-server)
    base: { type: 'string', default: 'http://127.0.0.1:6400' },
    out: { type: 'string' },
    label: { type: 'string', default: '' },
    workers: { type: 'string', default: '2' },
    image: { type: 'string', default: 'mcr.microsoft.com/playwright:v1.64.1-noble' },
    platform: { type: 'string', default: 'linux/amd64' },
    cpus: { type: 'string', default: '2' },
    memory: { type: 'string', default: '7g' },
    timeout: { type: 'string', default: '10000' },
    only: { type: 'string', default: USERFLOWS.join(',') },
    repeat: { type: 'string', default: '3' }, // the story list, this many times, on the same browser and pages
    attempts: { type: 'string', default: '5' }, // lost-document attempts before "navigated away"; analysis also reads 3
    pace: { type: 'string', default: '0' }, // after each story, idle for this fraction of its time
    'retry-wait': { type: 'string', default: '0' }, // ms before each retry
    net: { type: 'boolean', default: false }, // raw: Network.enable on pages (and service workers with --pw-setup)
    'pw-setup': { type: 'boolean', default: false }, // raw: the rest of Playwright's setup
    offline: { type: 'string', default: 'rules' }, // rules: host-resolver rules for both drivers; dns: Playwright's container has no DNS; none: live
    'no-probe': { type: 'boolean', default: false },
    'protocol-log': { type: 'string', default: '' }, // pw: run-server's pw:protocol log
    port: { type: 'string', default: '3333' },
    name: { type: 'string', default: `vc-nav-${process.pid}` },
  },
})
const TIMEOUT = Number(o.timeout)
const VIEWPORT = { width: 1280, height: 720 }
const PROBE = !o['no-probe']
const out = o.out!
mkdirSync(out, { recursive: true })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- the one in-page script, the same for every driver ----
const NOANIM = '*,*::before,*::after{animation:none!important;transition:none!important}'
const PROBE_SCRIPT = `(() => {
  const KEY = '__vcLog'
  const now = () => Math.round((performance.timeOrigin + performance.now()) * 10) / 10
  const log = (e) => { try { const a = JSON.parse(sessionStorage.getItem(KEY) || '[]'); e.t = now(); a.push(e); sessionStorage.setItem(KEY, JSON.stringify(a)) } catch {} }
  log({ k: 'doc', path: location.pathname })
  const dispatch = EventTarget.prototype.dispatchEvent
  EventTarget.prototype.dispatchEvent = function (ev) {
    const el = ev && (ev.type === 'click' || ev.type === 'mousedown') && this instanceof Element ? this : null
    if (el) {
      const a = el.closest('a')
      const tid = el.closest('[data-testid]')
      log({ k: ev.type, tid: tid ? tid.getAttribute('data-testid') : (el.textContent || '').trim().slice(0, 24), con: el.isConnected, href: a ? a.getAttribute('href') : null })
    }
    const r = dispatch.call(this, ev)
    if (el && ev.type === 'click') log({ k: 'clicked', prevented: ev.defaultPrevented })
    return r
  }
  let prev = null
  new MutationObserver(() => {
    const cur = document.querySelector('[data-testid="Burgers"]')
    if (cur === prev) return
    prev = cur
    const h = cur && document.querySelector('h2')
    log({ k: 'burgers', on: cur ? (h ? (h.textContent || '').trim().slice(0, 20) : '?') : null })
  }).observe(document, { childList: true, subtree: true })
  addEventListener('pagehide', () => log({ k: 'pagehide' }))
})();`
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
})();
${PROBE ? PROBE_SCRIPT : ''}`
const READ_LOG = `(() => { const v = sessionStorage.getItem('__vcLog'); sessionStorage.removeItem('__vcLog'); return v ? JSON.parse(v) : [] })()`
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
type Cell = { id: string; cycle: number }
const index = await (await fetch(`${o.base}/index.json`)).json()
const ids = Object.values<any>(index.entries).filter((e) => e.type === 'story' && o.only.split(',').includes(e.id)).map((e) => e.id as string).sort()
if (ids.length !== o.only.split(',').length) throw new Error(`stories missing from index.json: ${o.only}`)
const cells: Cell[] = Array.from({ length: Number(o.repeat) }, (_, cycle) => ids.map((id) => ({ id, cycle }))).flat()
const url = (c: Cell) => `${o.base}/iframe.html?id=${c.id}&viewMode=story`

// ---- driver ----
const RULES = ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']
const launch = (): Promise<Driver> => {
  const common = { image: o.image, platform: o.platform, cpus: o.cpus || undefined, memory: o.memory || undefined, name: o.name }
  if (o.driver === 'raw') return launchRawChromium({ ...common, net: o.net, pwSetup: o['pw-setup'], extraArgs: o.offline === 'none' ? [] : RULES })
  return launchPlaywright({ ...common, browser: 'chromium', port: Number(o.port), mode: 'detached', offline: o.offline === 'dns', extraArgs: o.offline === 'rules' ? RULES : [], protocolLog: o['protocol-log'] || undefined })
}

type Attempt = { key: string; cycle: number; worker: number; attempt: number; lost?: string; reason?: string; detail?: string; ms: number; png?: string; log?: any[] }
type Result = { key: string; cycle: number; ok: boolean; reason?: string; detail?: string; attempts: number; ms: number }
const attempts: Attempt[] = []
const results: Result[] = []
const hazards: Array<{ key: string; kind: string; detail: string }> = []
const current: string[] = []
const t0 = performance.now()
const driver = await launch()
const launchMs = Math.round(performance.now() - t0)
console.error(`launched ${driver.version} in ${launchMs} ms`)

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
const readLog = (page: Page) => (PROBE ? page.evaluate<any[]>(READ_LOG, 5_000).catch((e) => [{ k: 'unread', e: String(e.message ?? e).slice(0, 120) }]) : Promise.resolve(undefined))

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
    if (page.navigations() > 1 || NAVIGATED.test(m)) return { lost: m.replace(/\n[^]*/, '').slice(-200) }
    if (e instanceof TimeoutError) return { reason: 'timeout', detail: m }
    return { reason: 'error', detail: m.slice(0, 300) }
  }
}

const MAX = Number(o.attempts)
let next = 0
const pending: Promise<unknown>[] = []
async function worker(i: number) {
  let page: Page | null = await pageFor(i)
  while (next < cells.length) {
    const cell = cells[next++]
    current[i] = cell.id
    const t = performance.now()
    let r: Once & { attempts: number } = { attempts: 0 }
    try {
      // Lost document: a fresh goto on a fresh page, as Story readiness and page reuse decided
      for (let attempt = 1; ; attempt++) {
        if (!page) page = await pageFor(i)
        const ta = performance.now()
        const once = await captureOnce(page, cell)
        const rec: Attempt = { key: cell.id, cycle: cell.cycle, worker: i, attempt, lost: once.lost, reason: once.reason, detail: once.detail, ms: Math.round(performance.now() - ta), png: once.png && createHash('sha1').update(once.png).digest('hex').slice(0, 12) }
        attempts.push(rec)
        r = { ...once, attempts: attempt }
        if (!once.lost) { rec.log = await readLog(page); break }
        // The old page's log is read from whatever document it ended on, while the retry goes ahead
        const old = page
        pending.push(sleep(300).then(() => readLog(old)).then((log) => { rec.log = log }).finally(() => old.close().catch(() => {})))
        page = null
        console.error(`retry ${cell.id} ${attempt}: ${once.lost}`)
        if (attempt === MAX) { r = { reason: 'navigated away', detail: once.lost, attempts: attempt }; break }
        if (Number(o['retry-wait'])) await sleep(Number(o['retry-wait']))
      }
    } catch (e) {
      if (e instanceof PageCrashed) r = { reason: 'crashed', detail: 'the page crashed', attempts: 1 }
      else if (e instanceof BrowserExited) r = { reason: 'browser exited', detail: (e as Error).message.slice(0, 300), attempts: 1 }
      else r = { reason: 'error', detail: String((e as Error).message ?? e).slice(0, 300), attempts: 1 }
    }
    const ms = Math.round(performance.now() - t)
    results.push({ key: cell.id, cycle: cell.cycle, ok: !!r.png, reason: r.reason, detail: r.detail, attempts: r.attempts, ms })
    if (r.reason) console.error(`broken ${cell.id}: ${r.reason} ${r.detail ?? ''}`.slice(0, 300))
    if (r.reason === 'crashed' || r.reason === 'timeout') { page?.close().catch(() => {}); page = null }
    if (r.reason === 'browser exited') break
    if (Number(o.pace)) await sleep(Number(o.pace) * ms)
  }
  await page?.close().catch(() => {})
}
await Promise.all(Array.from({ length: Number(o.workers) }, (_, i) => worker(i)))
const wallS = (performance.now() - t0) / 1000
await Promise.allSettled(pending)
await driver.close().catch(() => {})

const record = {
  label: o.label, driver: o.driver, version: driver.version, offline: o.offline, net: o.net, pwSetup: o['pw-setup'], pace: Number(o.pace), retryWait: Number(o['retry-wait']), probe: PROBE,
  workers: Number(o.workers), repeat: Number(o.repeat), maxAttempts: MAX, cells: cells.length, captures: results.filter((r) => r.ok).length,
  broken: results.filter((r) => !r.ok).map(({ key, cycle, reason, detail }) => ({ key, cycle, reason, detail })),
  hazards, launchMs, wallS: +wallS.toFixed(1), capturesPerS: +(results.length / wallS).toFixed(3), results, attempts, at: new Date().toISOString(),
}
writeFileSync(path.join(out, 'run.json'), `${JSON.stringify(record)}\n`)
const lost = attempts.filter((a) => a.lost).length
console.log(JSON.stringify({ label: o.label, cells: cells.length, captures: record.captures, lost, navigatedAway: results.filter((r) => r.reason === 'navigated away').length, broken: record.broken.map((b) => `${b.key}:${b.reason}`), wallS: record.wallS }))
