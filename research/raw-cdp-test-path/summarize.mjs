// Medians per config over every pass in one or more timed.jsonl files, and each engine's gain over Playwright launch.
import { readFileSync } from 'node:fs'

const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)))
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const groups = new Map()
for (const r of rows) if (!r.aborted && !r.label.includes('save-')) (groups.get(r.label) ?? groups.set(r.label, []).get(r.label)).push(r)
const out = []
for (const [label, rs] of groups) {
  const shape = label.replace(/-(pw|raw|rawfast|rawws|connect|hostconnect|hostraw)-w(\d+)$/, '-w$2')
  const engine = label.match(/-(pw|raw|rawfast|rawws|connect|hostconnect|hostraw)-w\d+$/)?.[1]
  out.push({
    shape, engine, n: rs.length, cps: median(rs.map((r) => r.capturesPerS)), min: Math.min(...rs.map((r) => r.capturesPerS)), max: Math.max(...rs.map((r) => r.capturesPerS)),
    launch: median(rs.map((r) => r.launchMs)), first: median(rs.map((r) => r.firstCaptureMs)),
    nav: median(rs.map((r) => r.phaseMsPerCapture.nav)), ready: median(rs.map((r) => r.phaseMsPerCapture.ready)), capture: median(rs.map((r) => r.phaseMsPerCapture.capture)),
    cpu: median(rs.map((r) => r.driverCpuS)), failures: rs.reduce((a, r) => a + r.failures, 0), mb: median(rs.map((r) => r.bytesMb)),
  })
}
out.sort((a, b) => a.shape.localeCompare(b.shape) || a.engine.localeCompare(b.engine))
console.log('shape | engine | n | captures/s (min-max) | vs pw | launch ms | first ms | nav/ready/capture ms | driver CPU s | failures | MB')
for (const r of out) {
  const pw = out.find((x) => x.shape === r.shape && x.engine === 'pw')
  const gain = pw && r.engine !== 'pw' ? `${r.cps >= pw.cps ? '+' : ''}${(((r.cps / pw.cps) - 1) * 100).toFixed(1)}%` : ''
  console.log([r.shape, r.engine, r.n, `${r.cps.toFixed(2)} (${r.min.toFixed(2)}-${r.max.toFixed(2)})`, gain, r.launch, r.first, `${r.nav}/${r.ready}/${r.capture}`, r.cpu, r.failures, r.mb].join(' | '))
}
