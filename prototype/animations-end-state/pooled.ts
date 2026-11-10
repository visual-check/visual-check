// PROTOTYPE, throwaway: pools runner jobs. Per arm: runs, broken stories, stories whose snapshot differs between runs
// (by hash, so across jobs too), runs off each story's most common snapshot, the largest difference any one job saw,
// median ms per capture for non-fixture stories, and how many stories still had animations at capture.
//   node pooled.ts <job root> [<job root>...]   each <job root>/runs/<arm>/run-*/run.json, <job root>/runs/summary.json
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const jobs = process.argv.slice(2)
const arms = new Map<string, any[]>()
const maxPx = new Map<string, Map<string, number>>()
for (const j of jobs) {
  const root = path.join(j, 'runs')
  for (const arm of readdirSync(root).filter((d) => !d.includes('.') && d !== 'unstable'))
    for (const run of readdirSync(path.join(root, arm))) {
      const f = path.join(root, arm, run, 'run.json')
      if (existsSync(f)) (arms.get(arm) ?? arms.set(arm, []).get(arm)!).push({ job: j, ...JSON.parse(readFileSync(f, 'utf8')) })
    }
  const sf = path.join(root, 'summary.json')
  if (existsSync(sf)) for (const [arm, s] of Object.entries<any>(JSON.parse(readFileSync(sf, 'utf8')).arms)) for (const u of s.unstable) {
    const m = maxPx.get(arm) ?? maxPx.set(arm, new Map()).get(arm)!
    m.set(u.cell, Math.max(m.get(u.cell) ?? 0, u.maxPx))
  }
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }
console.log('| Arm | Runs | Broken (non-fixture) | Stories differing | Runs off | Largest within a job | ms per capture | Stories animating at capture |')
console.log('|---|---:|---|---:|---:|---:|---:|---:|')
const detail: string[] = []
for (const [arm, runs] of [...arms].sort()) {
  const keys = new Set(runs.flatMap((r) => Object.keys(r.hashes ?? {})).filter((k) => !k.startsWith('vc-animations--')))
  let differing = 0
  let off = 0
  const cells: string[] = []
  for (const k of keys) {
    const counts = new Map<string, number>()
    for (const r of runs) { const h = r.hashes?.[k]; if (h) counts.set(h, (counts.get(h) ?? 0) + 1) }
    const n = [...counts.values()].sort((a, b) => b - a)
    if (n.length > 1) { differing++; off += n.slice(1).reduce((a, b) => a + b, 0); cells.push(`${k} ${n.slice(1).reduce((a, b) => a + b, 0)}/${runs.length} (${maxPx.get(arm)?.get(k) ?? '?'} px in a job)`) }
  }
  const broken = new Map<string, number>()
  for (const r of runs) for (const b of r.broken) if (!b.key.startsWith('vc-animations--')) broken.set(`${b.key}: ${b.reason}`, (broken.get(`${b.key}: ${b.reason}`) ?? 0) + 1)
  const ms = runs.flatMap((r) => r.msPerCapture.filter(([k]: [string]) => !k.startsWith('vc-animations--')).map(([, v]: [string, number]) => v))
  const animating = new Set(runs.flatMap((r) => (r.swept ?? []).map(([k]: [string]) => k).filter((k: string) => !k.startsWith('vc-animations--'))))
  const jm = Math.max(0, ...[...(maxPx.get(arm)?.entries() ?? [])].filter(([k]) => !k.startsWith('vc-animations--')).map(([, v]) => v))
  console.log(`| ${arm} | ${runs.length} | ${[...broken].map(([k, n]) => `${k.replace(/^userflows-app--/, '')} ×${n}`).join(', ') || 0} | ${differing} | ${off} | ${jm} | ${median(ms)} | ${animating.size || '-'} |`)
  detail.push(`\n${arm}:\n  ${cells.sort().join('\n  ')}${animating.size ? `\n  animating: ${[...animating].join(' ')}` : ''}`)
}
console.log(detail.join('\n'))
