// PROTOTYPE, throwaway: one capture run through the driver interface, as Story readiness and page reuse decided
// (goto per capture on Storybook's test path, storyFinished, images and fonts), with one way of stopping animations
// per --anim arm. Fixture cells (vc-animations--*) also record their elements' computed state and events at capture,
// and a second screenshot 1 s later. Writes <out>/png/*.png, <out>/late/*.png and <out>/run.json.
//   node capture.ts --driver raw|pw-webkit --anim none|sb|zero-noguard|zero|zero-tiny|finish|zero-finish|zero-finish-media|settle --base URL --out dir
import { createHash } from 'node:crypto'
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
    anim: { type: 'string', default: 'none' },
    workers: { type: 'string', default: '2' },
    network: { type: 'string', default: process.platform === 'linux' ? 'host' : 'proxy' },
    'proxy-host': { type: 'string', default: '127.0.0.1' },
    'proxy-port': { type: 'string', default: '1080' },
    image: { type: 'string', default: 'mcr.microsoft.com/playwright:v1.65.0-noble' },
    platform: { type: 'string', default: 'linux/amd64' },
    cpus: { type: 'string', default: '2' },
    memory: { type: 'string', default: '7g' },
    timeout: { type: 'string', default: '10000' },
    only: { type: 'string', default: '' }, // comma list of story ids
    skip: { type: 'string', default: '' }, // comma list of story ids
    'side-by-side': { type: 'string', default: '' },
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
mkdirSync(path.join(out, 'late'), { recursive: true })

// ---- the one in-page script, the same for every driver; what it does about animations depends on the arm ----
// none:         ADR 0002 today. animation:none and transition:none at document start; at capture, document-level
//               finish() of finite and cancel() of infinite animations, as the driver-interface prototype did.
// sb:           nothing from visual-check: only Storybook's own pause, which the test path applies after play.
// zero-noguard: zero durations and delays at document start, in the document and in every shadow root.
// zero:         the same, with Storybook's after-play pause neutralised (its reverse direction flips fill-mode ends).
// zero-tiny:    zero, but transitions last 0.01 ms instead of 0s, so they start and fire transitionend.
// finish:       no stylesheet; Storybook's pause neutralised; at capture, finish() finite and pause() infinite at 0,
//               CSS and script animations alike, in the document and every shadow root, open or closed.
// zero-finish:  zero and finish together.
// zero-finish-media: zero-finish, and at capture also video paused at frame 0, inline SVG SMIL paused at 0 and GIFs
//               swapped for their first frame drawn on a canvas.
// settle:       nothing changes styles at document start; Storybook's pause neutralised so the story runs as in plain
//               Storybook. At capture: finish() every running finite animation, let a frame pass so end events run
//               page logic, repeat until none is left (at most 20 rounds); then the rest to their first keyframe, media
//               frozen as zero-finish-media does, and images and fonts checked again.
const ARM = o.anim
if (!['none', 'sb', 'zero-noguard', 'zero', 'zero-tiny', 'finish', 'zero-finish', 'zero-finish-media', 'settle'].includes(ARM)) throw new Error(`unknown --anim ${ARM}`)
const NOANIM = '*,*::before,*::after{animation:none!important;transition:none!important}'
const zero = (t: string) => ['*', '*::before', '*::after', '*::backdrop', '*::marker'].map((sel) => `${sel}{animation-duration:0s!important;animation-delay:0s!important;transition-duration:${t}!important;transition-delay:0s!important}`).join('\n')
const ZERO = zero(ARM === 'zero-tiny' ? '0.01ms' : '0s')
const SHEET = ARM === 'none' ? NOANIM : ARM.startsWith('zero') ? ZERO : ''
const GUARD = ['zero', 'zero-tiny', 'finish', 'zero-finish', 'zero-finish-media', 'settle'].includes(ARM)
const SWEEP = ARM === 'finish' || ARM.startsWith('zero-finish')
const MEDIA = ARM === 'zero-finish-media' || ARM === 'settle'
const SETTLE = ARM === 'settle'
const ADOPT = ARM.startsWith('zero')
const INIT = `(() => {
  const SHEET = ${JSON.stringify(SHEET)}
  if (SHEET) {
    const add = () => { const s = document.createElement('style'); s.textContent = SHEET; document.documentElement.append(s) }
    document.documentElement ? add() : document.addEventListener('readystatechange', add, { once: true })
  }
  // Every shadow root, open or closed, is recorded for the capture sweep and, with a sheet, gets it adopted
  const roots = (window.__vcRoots = [])
  const attach = Element.prototype.attachShadow
  Element.prototype.attachShadow = function (init) {
    const root = attach.call(this, init)
    roots.push(root)
    if (${ADOPT}) { const css = new CSSStyleSheet(); css.replaceSync(SHEET); root.adoptedStyleSheets = [...root.adoptedStyleSheets, css] }
    return root
  }
  if (${GUARD}) {
    // Storybook 9 and 10 on the test path append two <style> elements to head after play: animation:none, a reflow,
    // then delay 0, direction reverse, play-state paused, transition none. Their text is emptied on the way in.
    const append = Node.prototype.appendChild
    Node.prototype.appendChild = function (node) {
      if (this === document.head && node instanceof HTMLStyleElement && /\\*, \\*:before, \\*:after \\{\\s*animation(: none|-delay: 0s) !important/.test(node.textContent || '')) {
        node.textContent = ''
        ;(window.__vcGuarded = (window.__vcGuarded || 0) + 1)
      }
      return append.call(this, node)
    }
  }
  const vc = (window.__vc = {})
  vc.finished = new Promise((resolve) => { vc.resolve = resolve })
  vc.errors = []
  let channel
  Object.defineProperty(globalThis, '__STORYBOOK_ADDONS_CHANNEL__', {
    configurable: true,
    get: () => channel,
    set: (c) => { channel = c; for (const ev of ['playFunctionThrewException', 'storyThrewException', 'storyErrored', 'unhandledErrorsWhilePlaying']) c.on(ev, (e) => vc.errors.push(ev + ': ' + String((e && (e.message || e.title || (e[0] && e[0].message))) || e).slice(0, 160))); c.on('storyFinished', (e) => vc.resolve({ status: e.status, storyId: e.storyId, reporters: (e.reporters || []).filter((r) => r.status && r.status !== 'success').map((r) => r.type + ':' + r.status) })) },
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
  if (vc.errors.length) return { status: 'play threw', errors: vc.errors }
  if (f.storyId !== ${JSON.stringify(id)}) return { status: 'wrong story ' + f.storyId }
  if (document.body.classList.contains('sb-show-errordisplay')) return { status: 'error display' }
  const images = Array.from(document.images)
  for (const i of images) i.loading = 'eager'
  const fonts = Array.from(document.fonts).filter((x) => x.status === 'loading')
  const all = Promise.all([...images.map((i) => i.decode().catch(() => undefined)), ...fonts.map((x) => x.loaded.catch(() => undefined))])
  if ((await Promise.race([all.then(() => 'ok'), left()])) === 'timeout') return { status: 'timeout', step: 'images and fonts' }
  return { ...f, fontsStatus: document.fonts.status }
})()`
const MEDIA_JS = MEDIA ? `{
    const all = (sel) => [...roots].flatMap((r) => [...r.querySelectorAll(sel)])
    const cap = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 2000))])
    // Video: paused on its first frame; seeking hides the poster
    await Promise.all(all('video').map((v) => { v.pause(); v.autoplay = false; if (v.readyState === 0) return; const seeked = new Promise((r) => v.addEventListener('seeked', r, { once: true })); v.currentTime = 0; return cap(seeked) }))
    // Inline SVG SMIL: every outermost svg paused at time 0
    for (const svg of all('svg')) if (!svg.ownerSVGElement && svg.pauseAnimations) { svg.pauseAnimations(); svg.setCurrentTime(0) }
    // GIFs: the first frame, drawn from a fresh copy onto a canvas, replaces the source (Argos does the same)
    await Promise.all(all('img').filter((i) => /\\.gif(\\?|#|$)|^data:image\\/gif/i.test(i.currentSrc || i.src)).map((img) => cap(new Promise((resolve) => {
      const copy = new Image(); copy.crossOrigin = img.crossOrigin
      copy.onload = () => { try { const c = document.createElement('canvas'); c.width = copy.naturalWidth; c.height = copy.naturalHeight; c.getContext('2d').drawImage(copy, 0, 0); img.srcset = ''; img.src = c.toDataURL(); img.decode().then(resolve, resolve) } catch { resolve() } }
      copy.onerror = resolve; copy.src = img.currentSrc || img.src
    }))))
    }` : ''
const CARET = `if (!document.getElementById('__vc_caret')) { const s = document.createElement('style'); s.id = '__vc_caret'; s.textContent = '*,*::before,*::after{caret-color:transparent!important}'; document.documentElement.append(s) }`
const FREEZE = ARM === 'none'
  ? `(() => { ${CARET}
  for (const a of document.getAnimations()) { const t = a.effect && a.effect.getComputedTiming(); if (t && Number.isFinite(t.endTime)) a.finish(); else a.cancel() }
  return 0 })()`
  : SETTLE
    ? `(async () => { ${CARET}
  const collect = () => {
    const roots = new Set([document, ...(window.__vcRoots || [])])
    const walk = (n) => { for (const el of n.querySelectorAll('*')) if (el.shadowRoot && !roots.has(el.shadowRoot)) { roots.add(el.shadowRoot); walk(el.shadowRoot) } }
    walk(document)
    const seen = new Set()
    for (const r of roots) for (const a of r.getAnimations()) if (!(a.timeline && !(a.timeline instanceof DocumentTimeline))) seen.add(a)
    return { roots, anims: [...seen] }
  }
  const finite = (a) => { const t = a.effect && a.effect.getComputedTiming(); return !!t && Number.isFinite(t.endTime) }
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))))
  let rounds = 0, finished = 0
  // Once anything was finished, stop only after two checks a frame apart find nothing running: page logic reacting to
  // the end events (a React commit, say) can land after one frame on a busy machine. Nothing running at the first
  // check costs nothing.
  let quiet = 0
  for (;;) {
    const running = collect().anims.filter((a) => a.playState === 'running' && finite(a))
    if (!running.length) { if (!finished || ++quiet >= 2) break; await frame(); continue }
    quiet = 0
    for (const a of running) { try { a.finish() } catch {} }
    finished += running.length
    rounds++
    await frame()
    if (rounds >= 20) break
  }
  // Finished animations that still hold their end through fill-mode: the end is written into the inline style and the
  // animation removed, for the same reason as infinite ones below (Chromium kept painting a composited transform's
  // earlier frame after finish() on busy runners)
  let pinned = 0
  for (const a of collect().anims) if (a.playState === 'finished' && a.effect && a.effect.getComputedTiming().progress !== null) { try { a.commitStyles(); a.cancel(); pinned++ } catch {} }
  let paused = 0
  const { roots } = collect()
  // Infinite, and finite ones still starting after 20 rounds: the first keyframe. Chromium can paint a paused compositor animation from a stale frame, so the first
  // keyframe is written into the element's inline style and the animation removed. A pseudo-element can't take an
  // inline style, so its animation stays paused at 0.
  const infinite = collect().anims.filter((a) => a.playState === 'running')
  for (const a of infinite) {
    a.pause()
    a.currentTime = 0
    try { a.commitStyles(); a.cancel() } catch {}
    paused++
  }
  ${MEDIA_JS}
  // The same as readiness: images that settling revealed are made eager, then decoded
  const imgs = [...roots].flatMap((r) => [...r.querySelectorAll('img')])
  for (const i of imgs) i.loading = 'eager'
  await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)))
  await Promise.all([...document.fonts].filter((x) => x.status === 'loading').map((x) => x.loaded.catch(() => undefined)))
  // A change made just before capture can still be rastering when the screenshot is taken on a busy machine: after
  // settling changed anything, let two more frames through
  if (finished || paused || pinned) { await frame(); await frame() }
  return { rounds, finished, paused, pinned } })()`
  : SWEEP
    ? `(async () => { ${CARET}
  const roots = new Set([document, ...(window.__vcRoots || [])])
  const walk = (n) => { for (const el of n.querySelectorAll('*')) if (el.shadowRoot && !roots.has(el.shadowRoot)) { roots.add(el.shadowRoot); walk(el.shadowRoot) } }
  walk(document)
  const seen = new Set()
  for (const r of roots) for (const a of r.getAnimations()) {
    if (seen.has(a)) continue
    seen.add(a)
    if (a.timeline && !(a.timeline instanceof DocumentTimeline)) continue
    const t = a.effect && a.effect.getComputedTiming()
    if (t && Number.isFinite(t.endTime)) { try { a.finish() } catch { a.pause(); a.currentTime = 0 } }
    else { a.pause(); a.currentTime = 0 }
  }
  ${MEDIA_JS}
  return seen.size })()`
    : `(() => { ${CARET} return 0 })()`
// Fixture state: computed style of each registered element, SMIL and video values, and the events seen so far
const PROBE = `(() => {
  const f = window.__vcFx
  if (!f) return null
  const els = {}
  for (const [k, el] of Object.entries(f.els)) {
    const cs = getComputedStyle(el)
    const v = { connected: el.isConnected, opacity: cs.opacity, transform: cs.transform, bg: cs.backgroundColor }
    if (el.x && el.x.animVal) v.x = el.x.animVal.value
    if (el.cx && el.cx.animVal) v.cx = el.cx.animVal.value
    if (el instanceof HTMLMediaElement) Object.assign(v, { currentTime: +el.currentTime.toFixed(3), paused: el.paused, readyState: el.readyState, error: el.error && el.error.code })
    els[k] = v
  }
  const anims = document.getAnimations().length + (window.__vcRoots || []).reduce((n, r) => n + r.getAnimations().length, 0)
  return { els, events: [...f.events], guarded: window.__vcGuarded || 0, anims }
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

type Result = { key: string; ok: boolean; reason?: string; detail?: string; attempts: number; ms: number; fx?: any; swept?: any; sha1?: string }
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
type Once = { png?: Buffer; late?: Buffer; fx?: any; swept?: any; reason?: string; detail?: string; lost?: string }
async function captureOnce(page: Page, cell: Cell): Promise<Once> {
  try {
    await page.setViewport(VIEWPORT)
    await page.goto(url(cell), 30_000)
    const status = await page.evaluate<any>(readyScript(cell.id), TIMEOUT + 5_000)
    if (page.navigations() > 1) return { lost: `${page.navigations()} documents after ready` }
    if (status?.status === 'timeout') return { reason: 'timeout', detail: `not ready within ${TIMEOUT} ms, at ${status.step}` }
    if (status?.status !== 'success') return { reason: 'error', detail: JSON.stringify(status) }
    const swept = await page.evaluate<any>(FREEZE, 5_000)
    const png = await page.screenshot()
    if (page.navigations() > 1) return { lost: `${page.navigations()} documents after screenshot` }
    if (!cell.id.startsWith('vc-animations--')) return { png, swept }
    // Fixtures: state at capture, then whether the page still looks the same 1 s later
    const atCapture = await page.evaluate<any>(PROBE, 5_000)
    await new Promise((r) => setTimeout(r, 1000))
    const late = await page.screenshot()
    const after = await page.evaluate<any>(PROBE, 5_000)
    return { png, late, fx: { swept, atCapture, after } }
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
    const file = `${cell.key.replace(/[^a-z0-9@-]/gi, '_')}.png`
    if (r.png) writeFileSync(path.join(out, 'png', file), r.png)
    if (r.late) writeFileSync(path.join(out, 'late', file), r.late)
    results.push({ key: cell.key, ok: !!r.png, reason: r.reason, detail: r.detail, attempts: r.attempts, ms, fx: r.fx, swept: r.fx ? r.fx.swept : r.swept, sha1: r.png && createHash('sha1').update(r.png).digest('hex').slice(0, 12) })
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
  label: o.label, anim: ARM, driver: o.driver, version: driver.version, base: o.base, offline: o.offline, network: o.driver === 'raw' ? o.network : 'exposeNetwork', platform: process.platform,
  workers: Number(o.workers), cells: cells.length, captures: results.filter((r) => r.ok).length, broken: broken.map(({ key, reason, detail }) => ({ key, reason, detail })),
  retried: results.filter((r) => r.attempts > 1).map((r) => ({ key: r.key, attempts: r.attempts })),
  hazards, launches, launchMs, fatal, exitCode: fatal ? 2 : broken.length ? 1 : 0, socks: socks ? { ...socksStats } : null,
  wallS: +wallS.toFixed(1), capturesPerS: +(results.length / wallS).toFixed(2), msPerCapture: results.map((r) => [r.key, r.ms]), fixtures: results.filter((r) => r.fx).map(({ key, fx }) => ({ key, fx })), swept: results.filter((r) => r.swept && r.swept.rounds).map((r) => [r.key, r.swept]), hashes: Object.fromEntries(results.filter((r) => r.sha1).map((r) => [r.key, r.sha1])), at: new Date().toISOString(),
}
writeFileSync(path.join(out, 'run.json'), `${JSON.stringify(record, null, 1)}\n`)
console.log(JSON.stringify({ label: o.label, anim: ARM, driver: o.driver, version: driver.version, cells: cells.length, captures: record.captures, broken: broken.map((b) => `${b.key}:${b.reason}`), hazards: hazards.length, launches, fatal, wallS: record.wallS }))
process.exit(record.exitCode)
