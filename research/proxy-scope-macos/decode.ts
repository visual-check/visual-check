// Proxy scope research: fetches each URL with Chromium's image Accept header, records its bytes' sha1 and the CDN's
// edge headers, then renders each fetched image alone in headless shell and saves a PNG. Run on the Mac and on a
// runner, it tells a CDN that serves different bytes by location from an image that decodes differently.
//   node decode.ts <urls.txt> <out dir> [host|proxy]
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { launchRawChromium } from './raw-cdp.ts'
import { startSocks } from './socks.ts'

const [list, out, network = process.platform === 'linux' ? 'host' : 'proxy'] = process.argv.slice(2)
mkdirSync(path.join(out, 'png'), { recursive: true })
const ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
const EDGE = /^(content-type|content-length|age|server|x-served-by|x-cache|cf-ray|cf-cache-status|x-amz-cf-pop|x-cache|via|etag|last-modified)$/i
const urls = readFileSync(list, 'utf8').split('\n').filter((u) => u.startsWith('http'))
const files = new Map<string, { body: Buffer; type: string }>()
const report: any[] = []
for (const [i, u] of urls.entries()) {
  const r = await fetch(u, { headers: { accept: ACCEPT } })
  const body = Buffer.from(await r.arrayBuffer())
  const sha1 = createHash('sha1').update(body).digest('hex')
  report.push({ url: u, status: r.status, sha1, bytes: body.length, headers: Object.fromEntries([...r.headers].filter(([k]) => EDGE.test(k))) })
  if (r.headers.get('content-type')?.startsWith('image/')) files.set(`/img${i}`, { body, type: r.headers.get('content-type')! })
}
writeFileSync(path.join(out, 'fetch.json'), `${JSON.stringify(report, null, 1)}\n`)
for (const r of report) console.log(`${r.sha1.slice(0, 12)} ${r.bytes} ${r.headers['content-type']} ${r.url.slice(0, 80)}`)

const server = http
  .createServer((req, res) => {
    const p = new URL(req.url!, 'http://x').pathname
    if (p.endsWith('.html')) return res.writeHead(200, { 'content-type': 'text/html' }).end(`<body style="margin:0"><img src="${p.slice(0, -5)}">`)
    const f = files.get(p)
    if (!f) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': f.type }).end(f.body)
  })
  .listen(6500, '127.0.0.1')
const socks = network === 'proxy' ? await startSocks('127.0.0.1', 1081) : null
const d = await launchRawChromium({ image: 'mcr.microsoft.com/playwright:v1.64.1-noble', platform: 'linux/amd64', network: network as any, proxyPort: 1081, name: `vc-decode-${process.pid}`, cpus: '2', memory: '7g' })
const page = await d.newPage({ viewport: { width: 1280, height: 720 }, userAgentSuffix: '', locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce', initScript: '' })
for (const [p] of files) {
  await page.goto(`http://127.0.0.1:6500${p}.html`, 30_000)
  await page.evaluate(`document.images[0].decode()`, 10_000)
  writeFileSync(path.join(out, 'png', `${p.slice(1)}.png`), await page.screenshot())
}
await page.close()
await d.close()
socks?.close()
server.close()
