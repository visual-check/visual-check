// Font probe: loads each URL in a fresh context, waits like Story readiness decided (storyFinished, images), then
// watches document.fonts for up to --watch ms. Records font set events, @font-face CSSOM churn, and network events.
//   node probe.mjs --browser webkit --base http://127.0.0.1:6400 --out run.json [--only id,id] [--pages url,url] [--reps n]
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import pw from 'playwright-core'

const { values: o } = parseArgs({
  options: {
    browser: { type: 'string', default: 'webkit' },
    base: { type: 'string', default: 'http://127.0.0.1:6400' },
    out: { type: 'string', default: 'run.json' },
    only: { type: 'string', default: '' },
    pages: { type: 'string', default: '' }, // explicit URLs instead of Storybook stories
    reps: { type: 'string', default: '1' },
    workers: { type: 'string', default: '2' },
    watch: { type: 'string', default: '10000' },
    timeout: { type: 'string', default: '10000' },
    ws: { type: 'string', default: '' }, // connect to a run-server instead of launching
    noanim: { type: 'boolean', default: true },
    'skip-insert-fonts': { type: 'boolean', default: false },
    sw: { type: 'string', default: 'allow' },
    kick: { type: 'boolean', default: false },
  },
})
const NOANIM = '*,*::before,*::after{animation:none!important;transition:none!important}'
const INIT = `(() => {
  ${o.noanim ? `const add = () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(NOANIM)}; document.documentElement.append(s) }
  document.documentElement ? add() : document.addEventListener('readystatechange', add, { once: true })` : ''}
  const vc = (window.__vc = {})
  vc.finished = new Promise((resolve) => { vc.resolve = resolve })
  let channel
  Object.defineProperty(globalThis, '__STORYBOOK_ADDONS_CHANNEL__', {
    configurable: true, get: () => channel,
    set: (c) => { channel = c; c.on('storyFinished', (e) => vc.resolve({ status: e.status, storyId: e.storyId })) },
  })
  const log = (vc.log = [])
  const now = () => Math.round(performance.now())
  const d = (f) => f.family.replace(/["']/g, '') + ' ' + f.weight
  const hook = () => {
    for (const ev of ['loading', 'loadingdone', 'loadingerror']) document.fonts.addEventListener(ev, (e) => log.push([now(), 'set:' + ev, e.fontfaces.map(d).join(',')]))
  }
  try { hook() } catch (e) { log.push([now(), 'hook failed', String(e)]) }
  const fw = (t) => { const fam = (t.match(/font-family:\\s*([^;]+)/) || [])[1]; const w = (t.match(/font-weight:\\s*(\\d+)/) || [])[1]; return (fam || '?').replace(/["']/g, '').trim() + ' ' + (w || '?') }
  const ins = CSSStyleSheet.prototype.insertRule
  CSSStyleSheet.prototype.insertRule = function (rule, i) { if (/^\\s*@font-face/.test(rule)) { log.push([now(), 'insertRule', fw(rule)]); if (${o['skip-insert-fonts']}) return 0 } return ins.apply(this, arguments) }
  const del = CSSStyleSheet.prototype.deleteRule
  CSSStyleSheet.prototype.deleteRule = function (i) { const r = this.cssRules[i]; if (r && r.constructor.name === 'CSSFontFaceRule') log.push([now(), 'deleteRule', fw(r.cssText)]); return del.apply(this, arguments) }
  let lastSize = -1
  setInterval(() => { try { if (document.fonts.size !== lastSize) { log.push([now(), 'size', document.fonts.size]); lastSize = document.fonts.size } } catch {} }, 5)
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeName === 'STYLE' || n.nodeName === 'LINK') log.push([now(), 'node+', n.nodeName, (n.getAttribute('rel') || '') + (n.dataset ? Object.keys(n.dataset).join('.') : ''), (n.textContent || '').length, (n.getAttribute('href') || '').split('/').pop()]) }).observe(document, { childList: true, subtree: true })
  let ir = 0; const ins2 = CSSStyleSheet.prototype.insertRule
  CSSStyleSheet.prototype.insertRule = function (rule, i) { ir++; if (ir <= 400) log.push([now(), 'IR', ir, i, this.cssRules.length, (this.ownerNode && this.ownerNode.dataset && 'styled' in this.ownerNode.dataset) ? 'sc' : 'other', rule]); return ins2.apply(this, arguments) }
  const ff = (n) => n.nodeName === 'STYLE' && /@font-face/.test(n.textContent)
  new MutationObserver((ms) => { for (const m of ms) {
    for (const n of m.addedNodes) { if (ff(n)) log.push([now(), 'style+', (n.textContent.match(/@font-face/g) || []).length]); else if (n.nodeType === 3 && m.target.nodeName === 'STYLE' && /@font-face/.test(n.textContent)) log.push([now(), 'styletext+', (n.textContent.match(/@font-face/g) || []).length]) }
    for (const n of m.removedNodes) { if (ff(n)) log.push([now(), 'style-', (n.textContent.match(/@font-face/g) || []).length]); else if (n.nodeType === 3 && m.target.nodeName === 'STYLE' && /@font-face/.test(n.textContent)) log.push([now(), 'styletext-', (n.textContent.match(/@font-face/g) || []).length]) }
  } }).observe(document, { childList: true, subtree: true })
  const seen = new Map()
  const ids = new WeakMap(); let nextId = 0
  const poll = () => { try { let i = 0; for (const f of document.fonts) { const k = i++; if (!ids.has(f)) { ids.set(f, nextId++); const id = ids.get(f); f.loaded.then(() => log.push([now(), 'promise', 'obj' + id, 'resolved']), () => log.push([now(), 'promise', 'obj' + id, 'rejected'])) } const st = f.status; if (seen.get(f) !== st) { log.push([now(), 'face#' + k, 'obj' + ids.get(f), d(f), st]); seen.set(f, st) } } } catch {} }
  setInterval(poll, 20)
  vc.state = () => ({ t: now(), status: document.fonts.status, faces: Array.from(document.fonts).map((f) => d(f) + ' ' + f.status) })
})()`

const READY = (timeout, watch, storybook, kick = false) => `(async () => {
  const vc = window.__vc
  const t0 = performance.now()
  const left = (ms) => new Promise((r) => setTimeout(() => r('timeout'), ms))
  let f = { status: 'n/a' }
  if (${storybook}) {
    f = await Promise.race([vc.finished, left(${timeout}).then(() => ({ status: 'timeout' }))])
  } else {
    f = { status: await Promise.race([new Promise((r) => (document.readyState === 'complete' ? r('load') : addEventListener('load', () => r('load'), { once: true }))), left(${timeout})]) }
    if (window.__pageReady) await window.__pageReady
  }
  const images = Array.from(document.images)
  for (const i of images) i.loading = 'eager'
  await Promise.race([Promise.all(images.map((i) => i.decode().catch(() => undefined))), left(${timeout})])
  const atReady = vc.state()
  if (${kick}) for (const x of document.fonts) if (x.status === 'loading' || x.status === 'error') x.load().catch(() => {})
  // the prototype's wait: each face loading at ready, within the timeout
  const pending = Array.from(document.fonts).filter((x) => x.status === 'loading')
  const perFace = await Promise.race([Promise.all(pending.map((x) => x.loaded.then(() => 'ok', () => 'err'))).then(() => 'settled'), left(${timeout})])
  const afterPerFace = vc.state()
  // document.fonts.ready, watched up to ${watch} ms after ready
  let readyAt = null
  const rp = document.fonts.ready.then(() => { readyAt = Math.round(performance.now()) })
  await Promise.race([rp, left(${watch})])
  return { story: f, atReady, perFace, afterPerFace, readyAt, end: vc.state(), log: vc.log,
    res: performance.getEntriesByType('resource').filter((e) => /gstatic|woff/.test(e.name)).map((e) => ({ n: e.name.split('/').pop(), s: Math.round(e.startTime), e: Math.round(e.responseEnd), p: e.nextHopProtocol, sz: e.transferSize })) }
})()`

const index = o.pages ? null : await (await fetch(`${o.base}/index.json`)).json()
const only = new Set(o.only.split(',').filter(Boolean))
let urls = o.pages
  ? o.pages.split(',').map((u) => ({ key: u, url: u.startsWith('http') ? u : `${o.base}/${u}` }))
  : Object.values(index.entries).filter((e) => e.type === 'story' && (!only.size || only.has(e.id))).map((e) => e.id).sort().map((id) => ({ key: id, url: `${o.base}/iframe.html?id=${id}&viewMode=story` }))
const jobs = []
for (let r = 0; r < Number(o.reps); r++) for (const u of urls) jobs.push({ ...u, rep: r })

const bt = pw[o.browser]
const browser = o.ws ? await bt.connect(o.ws, { exposeNetwork: '<loopback>' }) : await bt.launch()
const probe = await browser.newPage()
const ua = await probe.evaluate(() => navigator.userAgent)
await probe.context().close()
console.error(`${o.browser} ${browser.version()} jobs=${jobs.length}`)

const results = []
let next = 0
const t0 = Date.now()
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++]
    const ctx = await browser.newContext({ serviceWorkers: o.sw, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, userAgent: `${ua} StorybookTestRunner`, reducedMotion: 'reduce' })
    await ctx.addInitScript(INIT)
    const page = await ctx.newPage()
    const net = []
    const tg = Date.now()
    page.on('request', (r) => { if (/gstatic|woff/.test(r.url())) net.push([Date.now() - tg, 'req', r.url().split('/').pop()]) })
    page.on('requestfinished', (r) => { if (/gstatic|woff/.test(r.url())) net.push([Date.now() - tg, 'fin', r.url().split('/').pop()]) })
    page.on('requestfailed', (r) => { if (/gstatic|woff/.test(r.url())) net.push([Date.now() - tg, 'fail', r.url().split('/').pop(), r.failure()?.errorText]) })
    let rec
    try {
      await page.goto(j.url, { waitUntil: 'commit', timeout: 30_000 })
      rec = await Promise.race([page.evaluate(READY(Number(o.timeout), Number(o.watch), !o.pages, o.kick)), new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate timeout')), 3 * Number(o.timeout) + Number(o.watch)))])
    } catch (e) { rec = { error: String(e).slice(0, 300) } }
    results.push({ key: j.key, rep: j.rep, ms: Date.now() - tg, net, ...rec })
    const stuck = rec.end ? rec.end.faces.filter((x) => x.endsWith('loading')) : []
    if (rec.readyAt === null || stuck.length || rec.error) console.error(`${j.key}#${j.rep} readyAt=${rec.readyAt} status=${rec.end?.status} perFace=${rec.perFace} stuck=${stuck.join('|')} ${rec.error || ''}`)
    await ctx.close().catch(() => {})
  }
}
await Promise.all(Array.from({ length: Number(o.workers) }, worker))
await browser.close()
writeFileSync(o.out, JSON.stringify({ browser: `${o.browser} ${browser.version()}`, secs: (Date.now() - t0) / 1000, results }, null, 1))
const bad = results.filter((r) => r.readyAt === null)
console.error(`done ${results.length} in ${(Date.now() - t0) / 1000}s; fonts.ready never: ${bad.length}; perFace timeout: ${results.filter((r) => r.perFace === 'timeout').length}`)
