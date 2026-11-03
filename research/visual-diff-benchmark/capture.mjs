// Captures a Storybook with Playwright page.screenshot on Chromium headless shell, one context per worker,
// and saves each PNG exactly as Playwright returned it.
// Usage: node capture.mjs --base URL --out DIR [--workers N] [--stories N] [--mutate text|shift|hue] [--again DIR]
//        [--cache DIR [--record]] [--config workload.json]
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'

const { values: o } = parseArgs({
  options: {
    base: { type: 'string' },
    index: { type: 'string' },
    config: { type: 'string' },
    out: { type: 'string' },
    workers: { type: 'string', default: '2' },
    stories: { type: 'string', default: '150' },
    mutate: { type: 'string', default: '' },
    again: { type: 'string' },
    cache: { type: 'string' },
    record: { type: 'boolean', default: false },
  },
})
const TIMEOUT = 30_000
const DESKTOP = { width: 1440, height: 1024 }
const MOBILE = { width: 393, height: 851 }
const MAX_HEIGHT = 4000
const workers = Number(o.workers)
const index = o.index ? JSON.parse(readFileSync(o.index, 'utf8')) : await (await fetch(`${o.base}/index.json`)).json()
const entries = Object.values(index.entries ?? index.stories).filter((e) => (e.type ?? 'story') === 'story')

// A workload config describes a Storybook's own conventions: which stories to capture, at which size, in which themes,
// which attribute marks a story ready and which element to clip to. Without one, every Storybook is treated alike.
const cfg = o.config ? JSON.parse(readFileSync(o.config, 'utf8')) : null
const rootSelector = cfg?.rootSelector ?? '#storybook-root'

// ---- workload ----
const cells = []
if (cfg) {
  const byFile = Map.groupBy(entries.filter((e) => e.tags.includes(cfg.tags.include)), (e) => e.importPath)
  for (const group of byFile.values()) {
    const rows = group.every((s) => s.tags.includes(cfg.tags.allThemes)) ? cfg.themes : [cfg.defaultTheme]
    for (const theme of rows) for (const s of group) cells.push({ id: s.id, key: `${s.id}@${theme}`, theme, shape: s.tags.includes(cfg.tags.mobile) ? 'mobile' : 'box' })
  }
} else {
  // An even sample of stories, each at a desktop and a mobile size, the viewport grown to fit the document
  const ids = entries.map((e) => e.id).sort()
  const step = Math.max(1, ids.length / Number(o.stories))
  for (let i = 0; i < Number(o.stories) && Math.floor(i * step) < ids.length; i++) {
    const id = ids[Math.floor(i * step)]
    for (const shape of ['desktop', 'mobile']) cells.push({ id, key: `${id}@${shape}`, shape })
  }
}
const url = (c) => `${o.base}/iframe.html?id=${encodeURIComponent(c.id)}&viewMode=story${c.theme ? `&globals=${cfg.themeGlobal}:${c.theme}` : ''}`

// ---- in-page scripts ----
// Ready means the configured attribute holds the story ID, or else Storybook's own storyRendered event.
const hookScript = `(() => {
  let ch
  const mark = (s) => () => document.documentElement.setAttribute('data-vc-state', s)
  Object.defineProperty(window, '__STORYBOOK_ADDONS_CHANNEL__', { configurable: true, get() { return ch }, set(v) {
    ch = v
    v.on('storyRendered', mark('ok'))
    for (const e of ['storyErrored', 'storyThrewException', 'storyMissing', 'playFunctionThrewException']) v.on(e, mark('error'))
  } })
})()`
const readyCheck = (id) => (cfg?.readyAttribute ? `html.getAttribute(${JSON.stringify(cfg.readyAttribute)}) === ${JSON.stringify(id)}` : `html.getAttribute('data-vc-state') === 'ok'`)
const waitScript = (id) => `new Promise((resolve) => {
  const html = document.documentElement
  const check = () => {
    if (${readyCheck(id)}) return finish('ok')
    if (html.getAttribute('data-vc-state') === 'error' || (document.body && document.body.classList.contains('sb-show-errordisplay'))) return finish('error')
  }
  const observer = new MutationObserver(check)
  const timer = setTimeout(() => finish('timeout'), ${TIMEOUT})
  const finish = (v) => { observer.disconnect(); clearTimeout(timer); document.fonts.ready.then(() => resolve(v)) }
  observer.observe(html, { attributes: true })
  if (document.body) observer.observe(document.body, { attributes: true })
  check()
})`
const measureScript = `(() => {
  const d = document.documentElement, b = d.getBoundingClientRect(), r = document.querySelector(${JSON.stringify(rootSelector)})
  let box = null
  if (r) { const q = r.getBoundingClientRect(), x = Math.floor(q.left), y = Math.floor(q.top); box = { x, y, width: Math.ceil(q.right) - x, height: Math.ceil(q.bottom) - y } }
  if (box) { box.width = Math.min(box.width, innerWidth - box.x); box.height = Math.min(box.height, innerHeight - box.y) }
  return { height: Math.ceil(Math.max(d.scrollHeight, b.height)), box }
})()`
// Applied after the viewport is fitted, so the captured area keeps its size
const mutateScript = (kind) => `(() => {
  const root = document.querySelector(${JSON.stringify(rootSelector)}) ?? document.body
  if (${JSON.stringify(kind)} === 'text') {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.textContent.trim() && n.parentElement && n.parentElement.checkVisibility() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP })
    const n = walker.nextNode()
    if (n) n.textContent = n.textContent.replace(/\\S(?=\\s*$)/, (c) => (c === 'x' ? 'y' : 'x'))
    return Boolean(n)
  }
  if (${JSON.stringify(kind)} === 'shift') { root.style.position = 'relative'; root.style.top = '1px'; return true }
  if (${JSON.stringify(kind)} === 'hue') { root.style.filter = 'hue-rotate(30deg)'; return true }
  return false
})()`

// ---- optional request cache, so a hosted Storybook is fetched once and replayed offline ----
const cacheFile = (u) => path.join(o.cache, createHash('sha1').update(u).digest('hex'))
async function routeCache(ctx) {
  mkdirSync(o.cache, { recursive: true })
  await ctx.route('**/*', async (route) => {
    const req = route.request()
    const f = cacheFile(`${req.method()} ${req.url()}`)
    if (existsSync(`${f}.json`)) {
      const meta = JSON.parse(readFileSync(`${f}.json`, 'utf8'))
      return route.fulfill({ status: meta.status, headers: meta.headers, body: readFileSync(f) })
    }
    if (!o.record) return route.abort()
    try {
      const res = await route.fetch()
      const body = await res.body()
      const headers = Object.fromEntries(Object.entries(res.headers()).filter(([k]) => !/^(content-encoding|content-length|transfer-encoding|set-cookie)$/i.test(k)))
      writeFileSync(f, body)
      writeFileSync(`${f}.json`, JSON.stringify({ url: req.url(), status: res.status(), headers }))
      return route.fulfill({ status: res.status(), headers, body })
    } catch {
      return route.abort()
    }
  })
}

// ---- run ----
mkdirSync(o.out, { recursive: true })
if (o.again) mkdirSync(o.again, { recursive: true })
const browser = await chromium.launch({ headless: true })
const contextOptions = { deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce', viewport: DESKTOP, ...cfg?.context }
const failures = []
let mutated = 0
let next = 0
const t0 = performance.now()
async function worker() {
  const ctx = await browser.newContext(contextOptions)
  if (!cfg?.readyAttribute) await ctx.addInitScript(hookScript)
  if (o.cache) await routeCache(ctx)
  const page = await ctx.newPage()
  while (next < cells.length) {
    const cell = cells[next++]
    try {
      const base = cell.shape === 'mobile' ? MOBILE : DESKTOP
      await page.setViewportSize(base)
      await page.goto(url(cell), { waitUntil: 'load', timeout: TIMEOUT })
      const status = await page.evaluate(waitScript(cell.id))
      if (status !== 'ok') throw new Error(`story ${status}`)
      let m = await page.evaluate(measureScript)
      if (m.height > base.height) {
        await page.setViewportSize({ width: base.width, height: Math.min(m.height, MAX_HEIGHT) })
        m = await page.evaluate(measureScript)
      }
      const clip = cell.shape === 'box' && m.box ? m.box : undefined
      if (o.mutate && (await page.evaluate(mutateScript(o.mutate)))) mutated++
      const shot = () => page.screenshot({ animations: 'disabled', caret: 'hide', ...(clip ? { clip } : {}) })
      const name = `${cell.key.replace(/[^a-z0-9@-]/gi, '_')}.png`
      writeFileSync(path.join(o.out, name), await shot())
      // The second shot of the open page that `update` takes before writing a baseline
      if (o.again) writeFileSync(path.join(o.again, name), await shot())
    } catch (e) {
      failures.push({ key: cell.key, error: String(e.message ?? e).slice(0, 160) })
    }
  }
  await ctx.close()
}
await Promise.all(Array.from({ length: workers }, () => worker()))
await browser.close()
const seconds = (performance.now() - t0) / 1000
console.log(JSON.stringify({ out: o.out, cells: cells.length, failures: failures.length, mutated, seconds: +seconds.toFixed(1), perS: +((cells.length - failures.length) / seconds).toFixed(1), failureSamples: failures.slice(0, 5) }))
