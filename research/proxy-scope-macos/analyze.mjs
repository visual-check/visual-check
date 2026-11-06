// Proxy scope research: run deviations per arm, split by kind of cell, with a permutation test between arms, and
// parity with CI: how many cells of each local run differ in content from what runners capture most often.
//   node analyze.mjs --local <runs root> [--runner <snapshots dir>]... [--json out.json]
// A local runs root is <root>/<arm>/run-N/png/<cell>.png. A runner snapshots dir is dedupe.py's output.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PNG } from 'pngjs'

const { values: o } = parseArgs({ options: { local: { type: 'string', multiple: true, default: [] }, runner: { type: 'string', multiple: true, default: [] }, json: { type: 'string' } } })

// arm -> run -> cell -> { hash, file }
const arms = new Map()
const add = (arm, run, cell, hash, file) => {
  if (!arms.has(arm)) arms.set(arm, new Map())
  const a = arms.get(arm)
  if (!a.has(run)) a.set(run, new Map())
  a.get(run).set(cell, { hash, file })
}
for (const root of o.local)
  for (const arm of readdirSync(root).filter((d) => existsSync(path.join(root, d)) && !d.includes('.')))
    for (const run of readdirSync(path.join(root, arm)).filter((r) => existsSync(path.join(root, arm, r, 'run.json'))))
      for (const f of readdirSync(path.join(root, arm, run, 'png'))) {
        const file = path.join(root, arm, run, 'png', f)
        add(`local:${arm}`, `${root}/${run}`, f.slice(0, -4), createHash('sha1').update(readFileSync(file)).digest('hex'), file)
      }
for (const dir of o.runner) {
  const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  for (const [arm, runs] of Object.entries(m))
    for (const [run, cells] of Object.entries(runs))
      for (const [cell, hash] of Object.entries(cells)) add(`runner:${arm}`, `${dir}/${run}`, cell, hash, path.join(dir, 'png', `${hash}.png`))
}

const kind = (cell) => (cell.startsWith('userflows-') ? 'userflows' : cell.includes('@side-by-side') ? 'side-by-side' : cell.startsWith('vc-hazards') ? 'hazards' : 'stories')
const KINDS = ['stories', 'side-by-side', 'userflows', 'hazards']

function modalOf(runs) {
  const counts = new Map()
  for (const cells of runs.values())
    for (const [cell, { hash, file }] of cells) {
      if (!counts.has(cell)) counts.set(cell, new Map())
      const c = counts.get(cell)
      const e = c.get(hash) ?? { n: 0, file }
      e.n++
      c.set(hash, e)
    }
  const modal = new Map()
  for (const [cell, c] of counts) {
    const [hash, e] = [...c].sort((a, b) => b[1].n - a[1].n)[0]
    modal.set(cell, { hash, file: e.file })
  }
  return modal
}

// Content difference: pixels whose largest channel delta is over 16 of 255. Rosetta's raster differences stay within 3.
const decoded = new Map()
const decode = (f) => {
  if (!decoded.has(f)) { if (decoded.size > 400) decoded.clear(); decoded.set(f, PNG.sync.read(readFileSync(f))) }
  return decoded.get(f)
}
const diffCache = new Map()
function contentPx(a, b) {
  if (a.hash === b.hash) return 0
  const k = a.hash < b.hash ? `${a.hash}${b.hash}` : `${b.hash}${a.hash}`
  if (diffCache.has(k)) return diffCache.get(k)
  const x = decode(a.file)
  const y = decode(b.file)
  let px = 0
  if (x.width !== y.width || x.height !== y.height) px = x.width * x.height
  else
    for (let i = 0; i < x.data.length; i += 4) {
      const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]))
      if (d > 16) px++
    }
  diffCache.set(k, px)
  return px
}
const CONTENT_PX = 20

// Permutation test on the difference of mean per-run counts
function permutation(a, b, iters = 20000) {
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
  const obs = mean(a) - mean(b)
  const all = [...a, ...b]
  let extreme = 0
  for (let k = 0; k < iters; k++) {
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]] }
    const d = mean(all.slice(0, a.length)) - mean(all.slice(a.length))
    if (Math.abs(d) >= Math.abs(obs) - 1e-9) extreme++
  }
  return { diff: +obs.toFixed(2), p: +(extreme / iters).toFixed(4) }
}

const out = { arms: {}, tests: {}, parity: {} }
const perRun = new Map()
for (const [arm, runs] of arms) {
  const modal = modalOf(runs)
  // Run deviations: cells whose snapshot isn't the arm's most common one, and of those, the ones that differ in content
  const rows = [...runs.values()].map((cells) => {
    const r = { all: 0, content: 0 }
    for (const k of KINDS) r[k] = 0
    for (const [cell, s] of cells) {
      const m = modal.get(cell)
      if (s.hash === m.hash) continue
      r.all++
      r[kind(cell)]++
      if (contentPx(s, m) > CONTENT_PX) r.content++
    }
    return r
  })
  perRun.set(arm, rows)
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0)
  out.arms[arm] = { runs: rows.length, perRun: +(sum('all') / rows.length).toFixed(2), byKind: Object.fromEntries(KINDS.map((k) => [k, +(sum(k) / rows.length).toFixed(2)])), contentPerRun: +(sum('content') / rows.length).toFixed(2), series: rows.map((r) => r.all) }
}
const names = [...arms.keys()]
for (let i = 0; i < names.length; i++)
  for (let j = i + 1; j < names.length; j++) {
    if (names[i].split(':')[0] !== names[j].split(':')[0]) continue
    const a = perRun.get(names[i])
    const b = perRun.get(names[j])
    out.tests[`${names[i]} - ${names[j]}`] = { all: permutation(a.map((r) => r.all), b.map((r) => r.all)), stories: permutation(a.map((r) => r.stories), b.map((r) => r.stories)) }
  }

// Parity with CI: each local run against the runners' most common snapshot per cell (raw CDP, host networking)
const ci = arms.get('runner:hostnet')
if (ci) {
  const ciModal = modalOf(ci)
  for (const [arm, runs] of arms) {
    const rows = []
    const cellsOff = new Map()
    for (const cells of runs.values()) {
      const r = { content: 0, raster: 0 }
      for (const k of KINDS) r[k] = 0
      for (const [cell, s] of cells) {
        const m = ciModal.get(cell)
        if (!m || s.hash === m.hash) continue
        if (contentPx(s, m) > CONTENT_PX) { r.content++; r[kind(cell)]++; cellsOff.set(cell, (cellsOff.get(cell) ?? 0) + 1) } else r.raster++
      }
      rows.push(r)
    }
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0)
    out.parity[arm] = { runs: rows.length, contentPerRun: +(sum('content') / rows.length).toFixed(2), byKind: Object.fromEntries(KINDS.map((k) => [k, +(sum(k) / rows.length).toFixed(2)])), rasterPerRun: +(sum('raster') / rows.length).toFixed(2), series: rows.map((r) => r.content), cells: Object.fromEntries([...cellsOff].sort((a, b) => b[1] - a[1])) }
    perRun.set(`parity:${arm}`, rows)
  }
  const pn = names.filter((n) => out.parity[n] && n.startsWith('local:'))
  for (let i = 0; i < pn.length; i++)
    for (let j = i + 1; j < pn.length; j++) {
      const a = perRun.get(`parity:${pn[i]}`)
      const b = perRun.get(`parity:${pn[j]}`)
      out.tests[`parity ${pn[i]} - ${pn[j]}`] = { content: permutation(a.map((r) => r.content), b.map((r) => r.content)), stories: permutation(a.map((r) => r.stories), b.map((r) => r.stories)) }
    }
}

if (o.json) writeFileSync(o.json, `${JSON.stringify(out, null, 1)}\n`)
for (const [arm, s] of Object.entries(out.arms)) console.log(`${arm.padEnd(22)} ${s.runs} runs, deviations/run ${s.perRun} ${JSON.stringify(s.byKind)} content ${s.contentPerRun}  [${s.series.join(' ')}]`)
for (const [k, t] of Object.entries(out.tests)) console.log(`test ${k}: ${JSON.stringify(t)}`)
for (const [arm, s] of Object.entries(out.parity)) console.log(`parity ${arm.padEnd(22)} content cells/run vs CI ${s.contentPerRun} ${JSON.stringify(s.byKind)} raster-only ${s.rasterPerRun}  [${s.series.join(' ')}]`)
