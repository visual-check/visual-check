// Shared by record.mjs and capture.mjs: serves a static Storybook on loopback and brings a story to ready
// the way Story readiness and page reuse decided: goto on the test path, no-animation stylesheet,
// storyFinished, then images and fonts.
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

export const VIEWPORT = { width: 1280, height: 720 }
// Device scale factor for every context: 1 as in #23, 2 for the scale-2 measurement of Visual diff rules (#43).
export const SCALE = Number(process.env.SCALE ?? 1)
// Calendars and date pickers default to today, so every arm renders the same fixed day.
export const FIXED_TIME = new Date('2026-06-15T12:00:00Z')
// Everything that isn't the loopback server: recorded once with network, replayed offline.
export const EXTERNAL = /^https?:\/\/(?!127\.0\.0\.1[:/])/
// Iconify batches icon names into request URLs by timing, so those are answered from every recorded icon instead.
const ICONIFY = /^https:\/\/api\.(iconify\.design|simplesvg\.com|unisvg\.com)\/([^/?]+)\.json/
// Iconify fetches icons after storyFinished, so ready also waits until no external request has moved for this long.
const QUIET_MS = 150
export const iconMisses = new Set()
const NOANIM = '*,*::before,*::after{animation:none!important;transition:none!important}'
// HeroUI's Storybook mounts react-scan's toolbar and render-outline canvas on <html> in every story, in a random corner.
// That's a dev overlay, not the story, so it's hidden the way a user would mask it.
const MASK = 'html>:not(head):not(body){display:none!important}'
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain',
}

// Runs before any page script: adds the stylesheet and catches storyFinished from the moment the channel exists.
const INIT = `(() => {
  const add = () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(NOANIM + MASK)}; document.documentElement.append(s) }
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
    // Like any static host: modules stay cached across a worker's captures, documents and the index don't.
    res.setHeader('cache-control', /\.(html|json)$/.test(file) ? 'no-cache' : 'max-age=3600')
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
    viewport: VIEWPORT, deviceScaleFactor: SCALE, userAgent: `${ua} StorybookTestRunner`,
    reducedMotion: 'reduce', colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC', ...extra,
  })
  await ctx.clock.setFixedTime(FIXED_TIME)
  await ctx.addInitScript(INIT)
  return ctx
}

// Merges every Iconify API response in the HAR zips into one pool per icon set. The image has python3 but no unzip.
const POOL_PY = `
import base64, json, re, sys, zipfile
pool = {}
for path in sys.argv[1:]:
    with zipfile.ZipFile(path) as z:
        har = json.loads(z.read(next(n for n in z.namelist() if n.endswith('.har'))))
        for e in har['log']['entries']:
            if not re.match(r'https://api\\.(iconify\\.design|simplesvg\\.com|unisvg\\.com)/', e['request']['url']) or e['response']['status'] != 200:
                continue
            c = e['response']['content']
            text = z.read(c['_file']).decode() if '_file' in c else base64.b64decode(c['text']).decode() if c.get('encoding') == 'base64' else c['text']
            data = json.loads(text)
            p = pool.setdefault(data['prefix'], {'icons': {}, 'aliases': {}})
            for k in ('width', 'height', 'left', 'top', 'lastModified'):
                if k in data: p[k] = data[k]
            p['icons'].update(data.get('icons', {}))
            p['aliases'].update(data.get('aliases', {}))
print(json.dumps(pool))
`
let pool
const iconPool = (harDir) => (pool ??= JSON.parse(execFileSync('python3', ['-c', POOL_PY, join(harDir, 'chromium.har.zip'), join(harDir, 'webkit.har.zip')], { encoding: 'utf8' })))

// External requests come from the browser's own HAR; anything not in it is aborted.
export async function replay(ctx, harDir, har) {
  await ctx.routeFromHAR(join(harDir, `${har}.har.zip`), { url: EXTERNAL, notFound: 'abort' })
  const icons = iconPool(harDir)
  await ctx.route(ICONIFY, (route) => {
    const url = new URL(route.request().url())
    const prefix = url.pathname.slice(1, -'.json'.length)
    const set = icons[prefix]
    const body = { prefix, icons: {}, aliases: {} }
    for (const k of ['width', 'height', 'left', 'top', 'lastModified']) if (set?.[k] !== undefined) body[k] = set[k]
    const missing = []
    for (const name of (url.searchParams.get('icons') ?? '').split(',').filter(Boolean)) {
      const alias = set?.aliases[name]
      if (set?.icons[name]) body.icons[name] = set.icons[name]
      else if (alias && set.icons[alias.parent]) { body.aliases[name] = alias; body.icons[alias.parent] = set.icons[alias.parent] }
      else { missing.push(name); iconMisses.add(`${prefix}:${name}`) }
    }
    if (missing.length) body.not_found = missing
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  })
}

const traffic = new WeakMap()
function track(page) {
  const t = { inflight: 0, last: 0 }
  const move = (d) => (r) => { if (EXTERNAL.test(r.url())) { t.inflight += d; t.last = performance.now() } }
  page.on('request', move(1))
  page.on('requestfinished', move(-1))
  page.on('requestfailed', move(-1))
  traffic.set(page, t)
  return t
}

// Resolves to 'success' or a broken-story reason. Throws on timeout.
export async function ready(page, base, id) {
  const t = traffic.get(page) ?? track(page)
  await page.goto(`${base}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`)
  const status = await (await page.waitForFunction(
    () => window.__vc?.finished?.status ?? (document.body?.classList.contains('sb-show-errordisplay') && 'errordisplay'),
    null, { timeout: 10_000 },
  )).jsonValue()
  if (status !== 'success') return status
  const settle = () => page.evaluate(async () => {
    for (const img of document.images) img.loading = 'eager'
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})))
    await document.fonts.ready
  })
  await settle()
  const since = performance.now()
  const deadline = since + 5000
  while (performance.now() < deadline && (t.inflight > 0 || performance.now() - Math.max(t.last, since) < QUIET_MS)) await new Promise((r) => setTimeout(r, 10))
  await settle()
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  return status
}
