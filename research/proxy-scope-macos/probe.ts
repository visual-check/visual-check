// Proxy scope research: one page through one network mode. Prints which hosts went through the SOCKS proxy and each
// resource's protocol and timing, as the page saw them.
//   node probe.ts <mode: proxy|pac|bypass|host> <url> [bypass list]
import { launchRawChromium } from './raw-cdp.ts'
import { maxOpen, socksLog, startSocks } from './socks.ts'

const [mode, url, bypass = ''] = process.argv.slice(2)
const u = new URL(url)
const socks = mode === 'host' ? null : await startSocks('127.0.0.1', 1080)
const d = await launchRawChromium({
  image: 'mcr.microsoft.com/playwright:v1.64.1-noble', platform: 'linux/amd64', network: mode as any, proxyPort: 1080,
  proxyHosts: [u.hostname], bypass, name: `vc-probe-${process.pid}`, cpus: '2', memory: '7g',
})
const p = await d.newPage({ viewport: { width: 1280, height: 720 }, userAgentSuffix: '', locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce', initScript: '' })
let err = ''
try { await p.goto(url, 30_000) } catch (e) { err = String(e) }
await new Promise((r) => setTimeout(r, 4000))
const res = await p.evaluate<any>(`performance.getEntriesByType('navigation').concat(performance.getEntriesByType('resource')).map(e => [new URL(e.name).host, e.nextHopProtocol, Math.round(e.connectEnd - e.connectStart), Math.round(e.responseStart - e.requestStart), Math.round(e.responseEnd), e.initiatorType])`, 5000).catch((e) => String(e))
console.log(JSON.stringify({ mode, err, proxied: [...new Set(socksLog.map((l) => `${l.host}:${l.port}`))], maxOpen }))
const by = new Map<string, any[]>()
if (Array.isArray(res)) for (const r of res) (by.get(`${r[0]} ${r[1]}`) ?? by.set(`${r[0]} ${r[1]}`, []).get(`${r[0]} ${r[1]}`)!).push(r)
for (const [k, v] of by) console.log(`  ${k}: ${v.length} resources, connect ms ${v.map((x) => x[2]).filter((x) => x > 0).join(',') || '-'}`)
await p.close()
await d.close()
socks?.close()
