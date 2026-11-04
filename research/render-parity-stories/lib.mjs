// Shared by record.mjs and capture.mjs: serves a static Storybook on loopback and brings a story to ready
// the way Story readiness and page reuse decided: goto on the test path, no-animation stylesheet,
// storyFinished, then images and fonts.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

export const VIEWPORT = { width: 1280, height: 720 }
// Calendars and date pickers default to today, so every arm renders the same fixed day.
export const FIXED_TIME = new Date('2026-06-15T12:00:00Z')
// Everything that isn't the loopback server: recorded once with network, replayed offline.
export const EXTERNAL = /^https?:\/\/(?!127\.0\.0\.1[:/])/
const NOANIM = '*,*::before,*::after{animation:none!important;transition:none!important}'
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain',
}

// Runs before any page script: adds the stylesheet and catches storyFinished from the moment the channel exists.
const INIT = `(() => {
  const add = () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(NOANIM)}; document.documentElement.append(s) }
  document.documentElement ? add() : document.addEventListener('readystatechange', add, { once: true })
  const vc = (window.__vc = { finished: null })
  let channel
  Object.defineProperty(globalThis, '__STORYBOOK_ADDONS_CHANNEL__', {
    configurable: true,
    get: () => channel,
    set: (c) => { channel = c; c.on('storyFinished', (e) => { vc.finished = { status: e.status, storyId: e.storyId } }) },
  })
})()`

export async function serve(root) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (p.endsWith('/')) p += 'index.html'
    const file = normalize(join(root, p))
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; return res.end() }
    res.setHeader('content-type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
    createReadStream(file).pipe(res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { server, base: `http://127.0.0.1:${server.address().port}` }
}

export const stories = (root) =>
  Object.values(JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')).entries)
    .filter((e) => e.type === 'story')
    .map((e) => e.id)
    .sort()

export async function newContext(browser, extra = {}) {
  const probe = await browser.newPage()
  const ua = await probe.evaluate(() => navigator.userAgent)
  await probe.context().close()
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1, userAgent: `${ua} StorybookTestRunner`,
    reducedMotion: 'reduce', colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC', ...extra,
  })
  await ctx.clock.setFixedTime(FIXED_TIME)
  await ctx.addInitScript(INIT)
  return ctx
}

// Resolves to 'success' or a broken-story reason. Throws on timeout.
export async function ready(page, base, id) {
  await page.goto(`${base}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`)
  const status = await (await page.waitForFunction(
    () => window.__vc?.finished?.status ?? (document.body?.classList.contains('sb-show-errordisplay') && 'errordisplay'),
    null, { timeout: 10_000 },
  )).jsonValue()
  if (status !== 'success') return status
  await page.evaluate(async () => {
    for (const img of document.images) img.loading = 'eager'
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})))
    await document.fonts.ready
  })
  return status
}
