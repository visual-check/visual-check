// M2: noise and catch rates at device scale factor 2, counting every pixel (includeAA: true).
// Usage: node m2.mjs <runsRoot> <out.json>
// runsRoot holds arm dirs, each with run-1..run-N from capture.mjs: gha-1..3 (runners), arm64, rosetta.
// Pairs are compared in a worker_threads pool.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const T = [0.005, 0.01, 0.02]
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

if (!isMainThread) {
  parentPort.on('message', ({ i, a, b }) => {
    const x = PNG.sync.read(readFileSync(a)), y = PNG.sync.read(readFileSync(b))
    const e = exact(x, y)
    const pm = e.px < 0 ? null : Object.fromEntries(T.map((t) => [t, pixelmatch(x.data, y.data, null, x.width, x.height, { threshold: t, includeAA: true })]))
    parentPort.postMessage({ i, ...e, pm, size: `${x.width}x${x.height}` })
  })
} else {
  const [root, outPath] = process.argv.slice(2)
  const RASTER = 10
  const arms = readdirSync(root).filter((d) => existsSync(join(root, d, 'run-1')))
  const GHA = ['gha-1', 'gha-2', 'gha-3'].filter((a) => arms.includes(a))
  const file = (id) => `${id.replace(/[^a-z0-9-]/gi, '_')}.png`
  const runsOf = (arm) => readdirSync(join(root, arm)).filter((d) => /^run-\d+$/.test(d) && existsSync(join(root, arm, d, 'env.json'))).sort()
  const shots = (arm, run, pass) => { const f = join(root, arm, run, `${pass}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null }
  const pngPath = (arm, run, pass, id) => { const p = join(root, arm, run, pass, file(id)); return existsSync(p) ? p : join(root, arm, 'run-1', pass, file(id)) }
  const ok = (row) => row?.status === 'success' && row.sha && !(row.missed ?? []).some((u) => !u.includes('invalid-url-to-show-fallback'))
  const consCache = new Map()
  const cons = (arm, pass) => {
    const k = `${arm}/${pass}`
    if (consCache.has(k)) return consCache.get(k)
    const runs = runsOf(arm).map((run) => [run, shots(arm, run, pass)]).filter(([, s]) => s)
    let out = null
    if (runs.length) {
      out = {}
      for (const id of Object.keys(runs[0][1].shots)) {
        const rows = runs.map(([run, s]) => [run, s.shots[id]]).filter(([, r]) => ok(r))
        if (!rows.length) continue
        const count = {}
        for (const [, r] of rows) count[r.sha] = (count[r.sha] ?? 0) + 1
        const [sha] = Object.entries(count).sort((x, y) => y[1] - x[1])[0]
        out[id] = { sha, run: rows.find(([, r]) => r.sha === sha)[0] }
      }
    }
    consCache.set(k, out)
    return out
  }

  // Collect jobs: [group, key, id, extra, pathA, pathB].
  const jobs = []
  const report = { arms: {}, noise: {}, cross: {}, mutations: {} }
  for (const arm of arms) report.arms[arm] = JSON.parse(readFileSync(join(root, arm, 'run-1', 'env.json'), 'utf8'))
  for (const arm of arms) for (const pass of ['chromium', 'noskia', 'webkit']) {
    const r1 = shots(arm, 'run-1', pass)
    if (!r1) continue
    report.noise[`${arm}/${pass}`] = []
    for (const run of runsOf(arm).slice(1)) {
      const rn = shots(arm, run, pass)
      if (!rn) continue
      for (const [id, row] of Object.entries(rn.shots)) {
        if (!ok(row) || !ok(r1.shots[id]) || row.sha === r1.shots[id].sha) continue
        jobs.push(['noise', `${arm}/${pass}`, id, { run }, pngPath(arm, 'run-1', pass, id), pngPath(arm, run, pass, id)])
      }
    }
  }
  const pairs = [['gha-2', 'gha-1'], ['gha-3', 'gha-1'], ['gha-3', 'gha-2'], ...['arm64', 'rosetta'].flatMap((a) => GHA.map((g) => [a, g]))]
  for (const pass of ['chromium', 'noskia', 'webkit']) for (const [a, b] of pairs) {
    if (!arms.includes(a) || !arms.includes(b)) continue
    const sa = cons(a, pass), sb = cons(b, pass)
    if (!sa || !sb) continue
    report.cross[`${a}~${b}/${pass}`] = []
    for (const [id, ra] of Object.entries(sa)) {
      const rb = sb[id]
      if (!rb || ra.sha === rb.sha) continue
      jobs.push(['cross', `${a}~${b}/${pass}`, id, {}, pngPath(a, ra.run, pass, id), pngPath(b, rb.run, pass, id)])
    }
  }
  for (const arm of arms) {
    const muts = readdirSync(join(root, arm, 'run-1')).filter((f) => /^mut-.*\.json$/.test(f)).map((f) => f.slice(0, -5))
    for (const baseArm of [...new Set([arm, GHA[0]])]) {
      const base = cons(baseArm, 'chromium')
      for (const m of muts) {
        const key = `${arm}/${m}~${baseArm}`
        report.mutations[key] = {}
        for (const [id, row] of Object.entries(shots(arm, 'run-1', m).shots)) {
          if (!ok(row) || !row.target || !base?.[id]) continue
          jobs.push(['mutations', key, id, { target: row.target }, pngPath(baseArm, base[id].run, 'chromium', id), pngPath(arm, 'run-1', m, id)])
        }
      }
    }
  }
  console.error(`${jobs.length} pairs`)

  // Pool.
  const N = Math.max(1, availableParallelism() - 2)
  const results = new Array(jobs.length)
  let next = 0, done = 0
  await new Promise((resolve, reject) => {
    if (!jobs.length) return resolve()
    for (let w = 0; w < N; w++) {
      const worker = new Worker(new URL(import.meta.url))
      const feed = () => { if (next < jobs.length) { const i = next++; worker.postMessage({ i, a: jobs[i][4], b: jobs[i][5] }) } else worker.terminate() }
      worker.on('message', (r) => { results[r.i] = r; if (++done === jobs.length) resolve(); else if (done % 500 === 0) console.error(`${done}/${jobs.length}`); feed() })
      worker.on('error', reject)
      feed()
    }
  })
  jobs.forEach(([group, key, id, extra], i) => {
    const { px, maxCh, pm, size } = results[i]
    const row = { id, ...extra, px, maxCh, pm, size }
    if (group === 'mutations') report.mutations[key][id] = row
    else report[group][key].push(row)
  })
  writeFileSync(outPath, JSON.stringify(report))

  // Summary.
  const raster = (rows) => rows.filter((x) => x.px > 0 && x.maxCh <= RASTER)
  const content = (rows) => rows.filter((x) => x.px !== 0 && x.maxCh > RASTER)
  const budgetOf = (rows) => Object.fromEntries(T.map((t) => [t, Math.max(0, ...raster(rows).map((x) => x.pm[t]))]))
  const noiseOf = (pred, pass) => Object.entries(report.noise).filter(([k]) => k.endsWith(`/${pass}`) && pred(k.split('/')[0])).flatMap(([, v]) => v)
  const crossOf = (keys, pass) => keys.flatMap((k) => report.cross[`${k}/${pass}`] ?? [])
  const runnerPairs = ['gha-2~gha-1', 'gha-3~gha-1', 'gha-3~gha-2']
  const groups = {
    'runners only': (pass) => [...noiseOf((a) => a.startsWith('gha'), pass), ...crossOf(runnerPairs, pass)],
    'Rosetta + runners': (pass) => [...noiseOf((a) => a.startsWith('gha') || a === 'rosetta', pass), ...crossOf([...runnerPairs, ...GHA.map((g) => `rosetta~${g}`)], pass)],
    'arm64 + runners': (pass) => [...noiseOf((a) => a.startsWith('gha') || a === 'arm64', pass), ...crossOf([...runnerPairs, ...GHA.map((g) => `arm64~${g}`)], pass)],
  }
  const sizes = [...new Set(Object.values(report.cross).flat().map((r) => r.size))]
  console.log(`scale ${[...new Set(Object.values(report.arms).map((e) => e.scale))].join(',')}; arms ${arms.join(' ')}; sizes ${sizes.join(',')}; size mismatches ${Object.values(report.cross).flat().filter((r) => r.px < 0).length}`)
  for (const pass of ['chromium', 'noskia', 'webkit']) {
    for (const [label, rowsFn] of Object.entries(groups)) {
      const rows = rowsFn(pass)
      const b = budgetOf(rows)
      const top = raster(rows).sort((x, y) => y.pm[0.01] - x.pm[0.01]).slice(0, 3).map((x) => `${x.id}:${x.pm[0.01]}`)
      console.log(`${pass.padEnd(8)} ${label.padEnd(18)} raster ${String(raster(rows).length).padStart(4)} content ${String(content(rows).length).padStart(3)} maxCh ${Math.max(0, ...raster(rows).map((x) => x.maxCh))} maxPx ${Math.max(0, ...raster(rows).map((x) => x.px))} | budget ${T.map((t) => `${t}:${b[t]}`).join('  ')} | top@0.01 ${top.join(' ')}`)
    }
  }
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
  console.log('\nDeliberate changes (includeAA: true), visible = differs from own baseline. caught = counted at 0.01 > budget')
  for (const [k, per] of Object.entries(report.mutations)) {
    const [arm, rest] = k.split('/')
    const [m, baseArm] = rest.split('~')
    const self = report.mutations[`${arm}/${m}~${arm}`]
    const ids = Object.keys(per).filter((id) => self?.[id] && self[id].px > 0)
    if (!ids.length) continue
    const at = (b) => ids.filter((id) => per[id].pm[0.01] > b).length
    console.log(`  ${k.padEnd(26)} n=${String(ids.length).padStart(3)} exact median ${String(q(ids.map((i) => per[i].px), 0.5)).padStart(6)} counted@0.01 median ${String(q(ids.map((i) => per[i].pm[0.01]), 0.5)).padStart(6)} | caught >8 ${String(at(8)).padStart(3)} >20 ${String(at(20)).padStart(3)} >80 ${String(at(80)).padStart(3)}`)
  }
}
