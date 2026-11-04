// Usage: node compare.mjs <runsRoot> <reportJson>
// runsRoot holds one directory per arm (arm64, rosetta, gha-1, gha-2), each with run-1..run-N from capture.mjs.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const [root, reportPath] = process.argv.slice(2)
const REF = 'gha-1'
const PASSES = ['chromium', 'noskia', 'webkit']
const THRESHOLDS = [0, 0.001, 0.005, 0.01, 0.02, 0.05, 0.1]
const arms = readdirSync(root).filter((d) => existsSync(join(root, d, 'run-1')))
const runsOf = (arm) => (existsSync(join(root, arm)) ? readdirSync(join(root, arm)) : []).filter((d) => /^run-\d+$/.test(d)).sort()
const shots = (arm, run, pass) => {
  const f = join(root, arm, run, `${pass}.json`)
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}
const file = (id) => `${id.replace(/[^a-z0-9-]/gi, '_')}.png`
// Later runs keep only PNGs that differ from run 1, so fall back to run 1's file when the hash matches.
const pngPath = (arm, run, pass, id) => {
  const p = join(root, arm, run, pass, file(id))
  return existsSync(p) ? p : join(root, arm, 'run-1', pass, file(id))
}
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
const pm = (a, b) => {
  const out = {}
  for (const includeAA of [true, false]) for (const t of THRESHOLDS) out[`${t}${includeAA ? '' : '-noAA'}`] = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: t, includeAA })
  return out
}
// A story whose external request wasn't recorded renders without it, so it's left out. The avatar fallback URL fails on purpose.
const ok = (row) => row?.status === 'success' && row.sha && !(row.missed ?? []).some((u) => !u.includes('invalid-url-to-show-fallback'))
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

// Content that loads after ready (Iconify icons, mostly) sometimes misses a run. Each story's snapshot for cross-arm
// comparisons is the one most of its runs agree on, so a flake on one arm doesn't count as a platform difference.
const consensus = (arm, pass) => {
  const runs = runsOf(arm).map((run) => [run, shots(arm, run, pass)]).filter(([, s]) => s)
  if (!runs.length) return null
  const out = {}
  for (const id of Object.keys(runs[0][1].shots)) {
    const rows = runs.map(([run, s]) => [run, s.shots[id]]).filter(([, r]) => ok(r))
    if (!rows.length) continue
    const count = {}
    for (const [, r] of rows) count[r.sha] = (count[r.sha] ?? 0) + 1
    const [sha, n] = Object.entries(count).sort((x, y) => y[1] - x[1])[0]
    out[id] = { status: 'success', sha, run: rows.find(([, r]) => r.sha === sha)[0], agree: n, of: rows.length }
  }
  return out
}
const report = { arms: {}, agreement: {}, noise: {}, cross: {}, flagEffect: {}, speed: {}, mutations: {}, broken: {}, missed: {} }
for (const arm of arms) { const f = join(root, arm, 'run-1', 'env.json'); report.arms[arm] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null }

// Same-platform noise floor: every later run against run 1.
for (const arm of arms) for (const pass of PASSES) {
  const r1 = shots(arm, 'run-1', pass)
  if (!r1) continue
  const rows = []
  let compared = 0
  for (const run of runsOf(arm).slice(1)) {
    const rn = shots(arm, run, pass)
    if (!rn) continue
    for (const [id, row] of Object.entries(rn.shots)) {
      if (!ok(row) || !ok(r1.shots[id])) continue
      compared++
      if (row.sha === r1.shots[id].sha) continue
      const x = read(pngPath(arm, 'run-1', pass, id)), y = read(pngPath(arm, run, pass, id))
      rows.push({ id, run, ...exact(x, y), pm: pm(x, y) })
    }
  }
  report.noise[`${arm}/${pass}`] = { compared, differing: rows.length, stories: new Set(rows.map((r) => r.id)).size, maxPx: Math.max(0, ...rows.map((r) => r.px)), maxCh: Math.max(0, ...rows.map((r) => r.maxCh)), rows }
}

// How often the runs of one arm agree on a story.
for (const arm of arms) for (const pass of PASSES) {
  const c = consensus(arm, pass)
  if (!c) continue
  const rows = Object.entries(c)
  report.agreement[`${arm}/${pass}`] = { stories: rows.length, allAgree: rows.filter(([, r]) => r.agree === r.of).length, majority: rows.filter(([, r]) => r.agree < r.of && r.agree > 1).length, none: rows.filter(([, r]) => r.agree === 1 && r.of > 1).map(([id]) => id) }
}

// Broken stories and HAR misses, run 1.
for (const arm of arms) for (const pass of PASSES) {
  const r1 = shots(arm, 'run-1', pass)
  if (!r1) continue
  report.broken[`${arm}/${pass}`] = Object.entries(r1.shots).filter(([, r]) => r.status !== 'success').map(([id, r]) => `${id}: ${r.status}${r.error ? ' ' + r.error : ''}`)
  report.missed[`${arm}/${pass}`] = Object.entries(r1.shots).filter(([, r]) => r.missed).map(([id, r]) => `${id}: ${r.missed.join(' ')}`)
}

// Cross-arm, run 1 against run 1.
function cross(a, pa, b, pb, withPm) {
  const sa = consensus(a, pa), sb = consensus(b, pb)
  if (!sa || !sb) return null
  const per = {}
  for (const [id, row] of Object.entries(sa)) {
    const other = sb[id]
    if (!other) continue
    if (row.sha === other.sha) { per[id] = { px: 0, maxCh: 0 }; continue }
    const x = read(pngPath(a, row.run, pa, id)), y = read(pngPath(b, other.run, pb, id))
    per[id] = { ...exact(x, y), ...(withPm ? { pm: pm(x, y) } : {}) }
  }
  const diff = Object.entries(per).filter(([, r]) => r.px)
  const pct = diff.map(([, r]) => (100 * r.px) / 921600)
  return {
    compared: Object.keys(per).length, differing: diff.length,
    pctMedian: q(pct, 0.5), pctP90: q(pct, 0.9), pctMax: Math.max(0, ...pct), maxCh: Math.max(0, ...diff.map(([, r]) => r.maxCh)),
    maxChHist: diff.reduce((h, [, r]) => ({ ...h, [r.maxCh]: (h[r.maxCh] ?? 0) + 1 }), {}),
    top: diff.sort((x, y) => y[1].px - x[1].px).slice(0, 15).map(([id, r]) => ({ id, px: r.px, maxCh: r.maxCh })),
    per,
  }
}
const pairs = [['arm64', 'gha-1'], ['rosetta', 'gha-1'], ['arm64', 'rosetta'], ['gha-2', 'gha-1'], ['gha-3', 'gha-1'], ['gha-3', 'gha-2'], ['arm64', 'gha-3'], ['rosetta', 'gha-3'], ['arm64', 'gha-2'], ['rosetta', 'gha-2']]
for (const pass of PASSES) for (const [a, b] of pairs) {
  if (!arms.includes(a) || !arms.includes(b)) continue
  const r = cross(a, pass, b, pass, true)
  if (r) report.cross[`${a}~${b}/${pass}`] = r
}
// Does the flag change pixels on the same arm?
for (const arm of arms) { const r = cross(arm, 'chromium', arm, 'noskia', false); if (r) { delete r.per; report.flagEffect[arm] = r } }

// Speed: per-capture time and pass wall time for every run.
for (const arm of arms) for (const pass of PASSES) {
  const ms = [], wall = []
  for (const run of runsOf(arm)) {
    const s = shots(arm, run, pass)
    if (!s) continue
    wall.push(s.wallMs)
    for (const r of Object.values(s.shots)) if (r.ms) ms.push(r.ms)
  }
  report.speed[`${arm}/${pass}`] = { captures: ms.length, median: q(ms, 0.5), p90: q(ms, 0.9), wallS: wall.map((w) => +(w / 1000).toFixed(1)) }
}

// Deliberate changes: each mutated capture against the real amd64 baseline (run 1, Chromium) and against its own arm's baseline.
for (const arm of arms) {
  const muts = readdirSync(join(root, arm, 'run-1')).filter((f) => /^mut-.*\.json$/.test(f)).map((f) => f.slice(0, -5))
  for (const baseArm of [...new Set([REF, arm])]) {
    const base = consensus(baseArm, 'chromium')
    for (const m of muts) {
      const s = shots(arm, 'run-1', m)
      const per = {}
      for (const [id, row] of Object.entries(s.shots)) {
        if (!ok(row) || !base?.[id]) continue
        const x = read(pngPath(baseArm, base[id].run, 'chromium', id)), y = read(pngPath(arm, 'run-1', m, id))
        per[id] = { target: row.target, ...exact(x, y), pm: pm(x, y) }
      }
      report.mutations[`${arm}/${m}~${baseArm}`] = per
    }
  }
}

writeFileSync(reportPath, JSON.stringify(report))
const strip = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== 'per' && kk !== 'rows')) : v]))
console.log(JSON.stringify({ noise: strip(report.noise), cross: strip(report.cross), flagEffect: report.flagEffect, speed: report.speed }, null, 1))
