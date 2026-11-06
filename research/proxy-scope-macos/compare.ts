// PROTOTYPE, throwaway: compares repeated runs per arm. Layout: <root>/<arm>/<run>/{run.json,png/*.png}.
// For each arm: broken stories per run, and per cell the pixels that differ from that cell's most common image.
// Also compares arms with each other on those most common images. Writes <root>/summary.json and prints a table.
//   node compare.ts <root> [<root>...]   several roots are pooled per arm, e.g. the jobs of a runner run
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const roots = process.argv.slice(2)
type Run = { dir: string; record: any; files: Map<string, string> }
const arms = new Map<string, Run[]>()
for (const root of roots)
  for (const arm of readdirSync(root).filter((d) => !d.includes('.') && d !== 'unstable').sort())
    for (const run of readdirSync(path.join(root, arm)).sort()) {
      const dir = path.join(root, arm, run)
      if (!existsSync(path.join(dir, 'run.json'))) continue
      const files = new Map<string, string>()
      for (const f of readdirSync(path.join(dir, 'png'))) files.set(f, path.join(dir, 'png', f))
      ;(arms.get(arm) ?? arms.set(arm, []).get(arm)!).push({ dir, record: JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')), files })
    }

const hashOf = (f: string) => createHash('sha1').update(readFileSync(f)).digest('hex')
function pixelDiff(a: string, b: string) {
  const x = PNG.sync.read(readFileSync(a))
  const y = PNG.sync.read(readFileSync(b))
  if (x.width !== y.width || x.height !== y.height) return { px: x.width * x.height, maxDelta: 255, size: true }
  let px = 0
  let maxDelta = 0
  for (let i = 0; i < x.data.length; i += 4) {
    const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]), Math.abs(x.data[i + 3] - y.data[i + 3]))
    if (d) { px++; if (d > maxDelta) maxDelta = d }
  }
  return { px, maxDelta, size: false }
}

const summary: any = { arms: {}, parity: {} }
const modal = new Map<string, Map<string, string>>() // arm -> file -> path of the most common image
for (const [arm, runs] of arms) {
  const brokenPerRun = runs.map((r) => r.record.broken.map((b: any) => `${b.key}: ${b.reason}`))
  const brokenKeys = new Map<string, number>()
  for (const r of runs) for (const b of r.record.broken) brokenKeys.set(`${b.key}: ${b.reason}`, (brokenKeys.get(`${b.key}: ${b.reason}`) ?? 0) + 1)
  const cells = new Set(runs.flatMap((r) => [...r.files.keys()]))
  const unstable: any[] = []
  const m = new Map<string, string>()
  for (const f of [...cells].sort()) {
    const byHash = new Map<string, string[]>()
    for (const r of runs) { const p = r.files.get(f); if (p) { const h = hashOf(p); (byHash.get(h) ?? byHash.set(h, []).get(h)!).push(p) } }
    const groups = [...byHash.values()].sort((a, b) => b.length - a.length)
    m.set(f, groups[0][0])
    if (groups.length > 1) {
      for (const [k, g] of groups.entries()) for (const p of g) { const d = path.join(roots[0], 'unstable', arm, f.replace(/\.png$/, '')); mkdirSync(d, { recursive: true }); copyFileSync(p, path.join(d, `${k === 0 ? 'common' : `variant${k}`}-${path.basename(path.dirname(path.dirname(p)))}.png`)) }
      const diffs = groups.slice(1).flatMap((g) => g.map((p) => pixelDiff(groups[0][0], p)))
      unstable.push({ cell: f.replace(/\.png$/, ''), variants: groups.length, runsOffModal: groups.slice(1).reduce((n, g) => n + g.length, 0), maxPx: Math.max(...diffs.map((d) => d.px)), maxDelta: Math.max(...diffs.map((d) => d.maxDelta)) })
    }
  }
  modal.set(arm, m)
  const recs = runs.map((r) => r.record)
  summary.arms[arm] = {
    runs: runs.length,
    version: recs[0].version,
    capturesPerRun: recs.map((r) => r.captures),
    brokenPerRun: brokenPerRun.map((b) => b.length),
    brokenStories: Object.fromEntries([...brokenKeys].sort()),
    fatal: recs.filter((r) => r.fatal).map((r) => r.fatal),
    relaunches: recs.reduce((n, r) => n + r.launches - 1, 0),
    retried: recs.flatMap((r) => r.retried),
    hazardsPerRun: recs.map((r) => r.hazards.length),
    capturesPerS: recs.map((r) => r.capturesPerS),
    unstableCells: unstable.length,
    // Sum over cells of the runs whose image isn't that cell's most common one
    deviations: unstable.reduce((n, u) => n + u.runsOffModal, 0),
    unstable,
  }
}
// Parity between arms on the same browser engine family: most common image against most common image
const names = [...arms.keys()]
for (let i = 0; i < names.length; i++)
  for (let j = i + 1; j < names.length; j++) {
    const a = modal.get(names[i])!
    const b = modal.get(names[j])!
    const diffs: any[] = []
    for (const [f, p] of a) {
      const q = b.get(f)
      if (!q || hashOf(p) === hashOf(q)) continue
      const d = pixelDiff(p, q)
      diffs.push({ cell: f.replace(/\.png$/, ''), px: d.px, maxDelta: d.maxDelta })
    }
    summary.parity[`${names[i]} vs ${names[j]}`] = { differing: diffs.length, of: [...a.keys()].filter((f) => b.has(f)).length, cells: diffs.sort((x, y) => y.px - x.px) }
  }

writeFileSync(path.join(roots[0], 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`)
for (const [arm, s] of Object.entries<any>(summary.arms)) {
  console.log(`\n## ${arm} (${s.version}): ${s.runs} runs, captures ${s.capturesPerRun.join('/')}, broken per run ${s.brokenPerRun.join('/')}, relaunches ${s.relaunches}, fatal ${s.fatal.length}`)
  for (const [k, n] of Object.entries(s.brokenStories)) console.log(`  broken ${n}/${s.runs}: ${k}`)
  for (const r of s.retried) console.log(`  retried: ${JSON.stringify(r)}`)
  console.log(`  cells differing between runs: ${s.unstableCells}, run deviations: ${s.deviations}`)
  for (const u of s.unstable) console.log(`    ${u.cell}: ${u.runsOffModal}/${s.runs} runs off the common image, up to ${u.maxPx} px, ${u.maxDelta}/255`)
  console.log(`  captures/s: ${s.capturesPerS.join(' ')}`)
}
for (const [k, p] of Object.entries<any>(summary.parity)) {
  console.log(`\n## parity ${k}: ${p.differing} of ${p.of} cells differ`)
  for (const c of p.cells.slice(0, 15)) console.log(`    ${c.cell}: ${c.px} px, ${c.maxDelta}/255`)
}
