// M1: anti-aliasing detection on vs off, on #23's amd64 runner captures (Chromium, 1280x720, scale 1).
// Usage: node m1.mjs <runsRoot> <out.json>   runsRoot holds gha-1, gha-2, gha-3, each with run-1..run-3.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const [root, outPath] = process.argv.slice(2)
const T = [0, 0.005, 0.01, 0.02]
const MODES = { count: true, detect: false } // includeAA
const RASTER = 10
const ARMS = ['gha-1', 'gha-2', 'gha-3']
const file = (id) => `${id.replace(/[^a-z0-9-]/gi, '_')}.png`
const runsOf = (arm) => readdirSync(join(root, arm)).filter((d) => /^run-\d+$/.test(d)).sort()
const shots = (arm, run, pass) => { const f = join(root, arm, run, `${pass}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null }
const pngPath = (arm, run, pass, id) => { const p = join(root, arm, run, pass, file(id)); return existsSync(p) ? p : join(root, arm, 'run-1', pass, file(id)) }
const cache = new Map()
const read = (p) => { if (!cache.has(p)) { if (cache.size > 64) cache.clear(); cache.set(p, PNG.sync.read(readFileSync(p))) } return cache.get(p) }
const ok = (row) => row?.status === 'success' && row.sha && !(row.missed ?? []).some((u) => !u.includes('invalid-url-to-show-fallback'))
const exact = (a, b) => {
  if (a.width !== b.width || a.height !== b.height) return { px: -1, maxCh: 255 }
  let px = 0, maxCh = 0
  for (let i = 0; i < a.data.length; i += 4) {
    let d = 0
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]))
    if (d) { px++; if (d > maxCh) maxCh = d }
  }
  return { px, maxCh }
}
const pm = (a, b) => {
  const out = {}
  for (const [mode, includeAA] of Object.entries(MODES)) for (const t of T) out[`${mode}@${t}`] = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: t, includeAA })
  return out
}
const consensus = (arm, pass) => {
  const runs = runsOf(arm).map((run) => [run, shots(arm, run, pass)]).filter(([, s]) => s)
  const out = {}
  for (const id of Object.keys(runs[0][1].shots)) {
    const rows = runs.map(([run, s]) => [run, s.shots[id]]).filter(([, r]) => ok(r))
    if (!rows.length) continue
    const count = {}
    for (const [, r] of rows) count[r.sha] = (count[r.sha] ?? 0) + 1
    const [sha] = Object.entries(count).sort((x, y) => y[1] - x[1])[0]
    out[id] = { sha, run: rows.find(([, r]) => r.sha === sha)[0] }
  }
  return out
}

const report = { noise: {}, budget: {}, mutations: {} }
for (const pass of ['chromium', 'noskia']) {
  const rows = []
  // Same-arm noise: later runs against run 1.
  for (const arm of ARMS) {
    const r1 = shots(arm, 'run-1', pass)
    for (const run of runsOf(arm).slice(1)) {
      for (const [id, row] of Object.entries(shots(arm, run, pass).shots)) {
        if (!ok(row) || !ok(r1.shots[id]) || row.sha === r1.shots[id].sha) continue
        const x = read(pngPath(arm, 'run-1', pass, id)), y = read(pngPath(arm, run, pass, id))
        rows.push({ kind: `${arm} ${run}`, id, ...exact(x, y), pm: pm(x, y) })
      }
    }
  }
  // Runner against runner, consensus snapshots.
  const cons = Object.fromEntries(ARMS.map((a) => [a, consensus(a, pass)]))
  for (const [a, b] of [['gha-2', 'gha-1'], ['gha-3', 'gha-1'], ['gha-3', 'gha-2']]) {
    for (const [id, ra] of Object.entries(cons[a])) {
      const rb = cons[b][id]
      if (!rb || ra.sha === rb.sha) continue
      const x = read(pngPath(a, ra.run, pass, id)), y = read(pngPath(b, rb.run, pass, id))
      rows.push({ kind: `${a}~${b}`, id, ...exact(x, y), pm: pm(x, y) })
    }
  }
  report.noise[pass] = rows
  const raster = rows.filter((r) => r.px > 0 && r.maxCh <= RASTER)
  report.budget[pass] = Object.fromEntries(Object.keys(raster[0]?.pm ?? pm(read(pngPath('gha-1', 'run-1', pass, Object.keys(cons['gha-1'])[0])), read(pngPath('gha-1', 'run-1', pass, Object.keys(cons['gha-1'])[0])))).map((k) => [k, Math.max(0, ...raster.map((r) => r.pm[k]))]))
}

// Deliberate changes on runner job 1, against its own consensus baseline (Chromium, no flag).
const base = consensus('gha-1', 'chromium')
for (const m of ['shift', 'text', 'icon']) {
  const s = shots('gha-1', 'run-1', `mut-${m}`)
  const per = {}
  for (const [id, row] of Object.entries(s.shots)) {
    if (!ok(row) || !row.target || !base[id]) continue
    const x = read(pngPath('gha-1', base[id].run, 'chromium', id)), y = read(pngPath('gha-1', 'run-1', `mut-${m}`, id))
    const e = exact(x, y)
    if (e.px <= 0) continue
    per[id] = { target: row.target, ...e, pm: pm(x, y) }
  }
  report.mutations[m] = per
}
writeFileSync(outPath, JSON.stringify(report))

// Summary.
const keys = Object.keys(report.budget.chromium)
console.log('Budget that absorbs runner raster noise (max channel <= 10), by pass:')
for (const pass of ['chromium', 'noskia']) console.log(`  ${pass.padEnd(8)} ${keys.map((k) => `${k}:${report.budget[pass][k]}`).join('  ')}`)
console.log('Noise rows (raster/content):', Object.fromEntries(Object.entries(report.noise).map(([p, r]) => [p, `${r.filter((x) => x.px > 0 && x.maxCh <= RASTER).length}/${r.filter((x) => x.maxCh > RASTER).length}`])))
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
for (const [m, per] of Object.entries(report.mutations)) {
  const ids = Object.keys(per)
  console.log(`\n${m}: n=${ids.length}, exact px median ${q(ids.map((i) => per[i].px), 0.5)}`)
  for (const k of keys) {
    const c = ids.map((i) => per[i].pm[k])
    console.log(`  ${k.padEnd(13)} counted median ${String(q(c, 0.5)).padStart(5)} p10 ${String(q(c, 0.1)).padStart(5)} | zero ${String(c.filter((x) => x === 0).length).padStart(3)} | >budget(own) ${String(c.filter((x) => x > report.budget.chromium[k]).length).padStart(3)} | >2 ${String(c.filter((x) => x > 2).length).padStart(3)} | >20 ${String(c.filter((x) => x > 20).length).padStart(3)}`)
  }
}
