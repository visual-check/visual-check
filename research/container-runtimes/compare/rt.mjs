// Usage: node rt.mjs <runsRoot> <reportJson>
// runsRoot holds one directory per arm, each with run-N directories from capture.mjs. Runner arms are named gha-*.
// Every other arm is compared against each runner job's consensus and against the OrbStack Rosetta reference (orb-ref).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const [root, reportPath] = process.argv.slice(2)
const PASSES = ['noskia', 'webkit']
const arms = readdirSync(root).filter((d) => readdirSync(join(root, d)).some((r) => existsSync(join(root, d, r, 'env.json')) || existsSync(join(root, d, r, 'noskia.json'))))
const runners = arms.filter((a) => a.startsWith('gha-'))
const runsOf = (arm) => readdirSync(join(root, arm)).filter((d) => /^run-\d+$/.test(d)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
const shots = (arm, run, pass) => { const f = join(root, arm, run, `${pass}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null }
const file = (id) => `${id.replace(/[^a-z0-9-]/gi, '_')}.png`
// Later runs keep only PNGs that differ from their run 1, so fall back to the arm's run-1 file when the hash matches.
const pngPath = (arm, run, pass, id) => { const p = join(root, arm, run, pass, file(id)); return existsSync(p) ? p : join(root, arm, runsOf(arm)[0], pass, file(id)) }
const read = (p) => PNG.sync.read(readFileSync(p))
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
const pm01 = (a, b) => pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.01, includeAA: true })
const ok = (row) => row?.status === 'success' && row.sha && !(row.missed ?? []).some((u) => !u.includes('invalid-url-to-show-fallback'))
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const consensus = (arm, pass) => {
  const runs = runsOf(arm).map((run) => [run, shots(arm, run, pass)]).filter(([, s]) => s)
  if (!runs.length) return null
  const out = {}
  const ids = new Set(runs.flatMap(([, s]) => Object.keys(s.shots)))
  for (const id of ids) {
    const rows = runs.map(([run, s]) => [run, s.shots[id]]).filter(([, r]) => ok(r))
    if (!rows.length) continue
    const count = {}
    for (const [, r] of rows) count[r.sha] = (count[r.sha] ?? 0) + 1
    const [sha, n] = Object.entries(count).sort((x, y) => y[1] - x[1])[0]
    out[id] = { sha, run: rows.find(([, r]) => r.sha === sha)[0], agree: n, of: rows.length }
  }
  return out
}
const memo = new Map()
const cons = (arm, pass) => { const k = `${arm}/${pass}`; if (!memo.has(k)) memo.set(k, consensus(arm, pass)); return memo.get(k) }
// Raster noise and late content are split at a channel difference of 10, as in Render parity on real stories.
function cross(a, b, pass) {
  const sa = cons(a, pass), sb = cons(b, pass)
  if (!sa || !sb) return null
  const diff = []
  let compared = 0
  for (const [id, row] of Object.entries(sa)) {
    const other = sb[id]
    if (!other) continue
    compared++
    if (row.sha === other.sha) continue
    const x = read(pngPath(a, row.run, pass, id)), y = read(pngPath(b, other.run, pass, id))
    diff.push({ id, ...exact(x, y), pm01: pm01(x, y) })
  }
  const raster = diff.filter((r) => r.maxCh <= 10), content = diff.filter((r) => r.maxCh > 10)
  return {
    compared, differing: diff.length, raster: raster.length, content: content.length,
    rasterMaxPx: Math.max(0, ...raster.map((r) => r.px)), rasterMaxCh: Math.max(0, ...raster.map((r) => r.maxCh)),
    pm01Max: Math.max(0, ...diff.map((r) => r.pm01)),
    top: diff.sort((x, y) => y.px - x.px).slice(0, 8).map(({ id, px, maxCh, pm01 }) => ({ id, px, maxCh, pm01 })),
  }
}
// Same-arm noise: each later run against the arm's first run.
function noise(arm, pass) {
  const runs = runsOf(arm)
  const r1 = shots(arm, runs[0], pass)
  if (!r1 || runs.length < 2) return null
  const rows = []
  for (const run of runs.slice(1)) {
    const rn = shots(arm, run, pass)
    if (!rn) continue
    for (const [id, row] of Object.entries(rn.shots)) {
      if (!ok(row) || !ok(r1.shots[id]) || row.sha === r1.shots[id].sha) continue
      const x = read(pngPath(arm, runs[0], pass, id)), y = read(pngPath(arm, run, pass, id))
      rows.push({ id, run, ...exact(x, y) })
    }
  }
  return { runs: runs.length, differing: rows.length, stories: new Set(rows.map((r) => r.id)).size, maxPx: Math.max(0, ...rows.map((r) => r.px)), maxCh: Math.max(0, ...rows.map((r) => r.maxCh)), rows: rows.slice(0, 10) }
}
const report = { env: {}, speed: {}, broken: {}, noise: {}, vsRunners: {}, vsOrbRef: {}, runnerPairs: {} }
for (const arm of arms) {
  const run = runsOf(arm)[0]
  const f = join(root, arm, run, 'env.json')
  report.env[arm] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}
for (const arm of arms) for (const pass of PASSES) {
  const key = `${arm}/${pass}`
  const ms = [], wall = [], broken = {}
  let n = 0
  for (const run of runsOf(arm)) {
    const s = shots(arm, run, pass)
    if (!s) continue
    wall.push(s.wallMs)
    n = Object.keys(s.shots).length
    for (const [id, r] of Object.entries(s.shots)) {
      if (r.ms) ms.push(r.ms)
      if (r.status !== 'success') { const why = `${r.status} ${r.error ?? ''}`.slice(0, 90); (broken[why] ??= []).push(`${run}:${id}`) }
    }
  }
  if (!wall.length) continue
  report.speed[key] = { stories: n, captures: ms.length, medianMs: q(ms, 0.5), p90Ms: q(ms, 0.9), wallS: wall.map((w) => +(w / 1000).toFixed(1)), perS: wall.map((w) => +(n / (w / 1000)).toFixed(2)) }
  report.broken[key] = Object.fromEntries(Object.entries(broken).map(([k, v]) => [k, { count: v.length, sample: v.slice(0, 4) }]))
  report.noise[key] = noise(arm, pass)
  if (!arm.startsWith('gha-')) {
    report.vsRunners[key] = Object.fromEntries(runners.map((g) => [g, cross(arm, g, pass)]))
    if (arm !== 'orb-ref' && arms.includes('orb-ref')) report.vsOrbRef[key] = cross(arm, 'orb-ref', pass)
  }
}
for (const pass of PASSES) for (let i = 0; i < runners.length; i++) for (let j = i + 1; j < runners.length; j++) report.runnerPairs[`${runners[i]}~${runners[j]}/${pass}`] = cross(runners[i], runners[j], pass)
writeFileSync(reportPath, JSON.stringify(report, null, 1))
console.log(JSON.stringify({ speed: report.speed, broken: report.broken }, null, 1))
