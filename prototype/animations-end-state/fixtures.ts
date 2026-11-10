// PROTOTYPE, throwaway: per fixture and arm, what the snapshot showed. Layout: <root>/<arm>/<run>/{run.json,png,late}.
// For each fixture cell: broken runs, distinct snapshots between runs and the largest difference, the computed state
// at capture (most common, and how many distinct), the events seen at capture and 1 s later, and in how many runs the
// page changed during the second after capture (as update's check would see it).
//   node fixtures.ts <root> [<root>...] > fixtures.md   several roots are pooled per arm
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const roots = process.argv.slice(2)
const hash = (f: string) => createHash('sha1').update(readFileSync(f)).digest('hex')
function px(a: string, b: string) {
  const x = PNG.sync.read(readFileSync(a))
  const y = PNG.sync.read(readFileSync(b))
  if (x.width !== y.width || x.height !== y.height) return x.width * x.height
  let n = 0
  for (let i = 0; i < x.data.length; i += 4) if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2] || x.data[i + 3] !== y.data[i + 3]) n++
  return n
}
const mode = <T,>(xs: T[]) => {
  const m = new Map<string, { v: T; n: number }>()
  for (const v of xs) { const k = JSON.stringify(v); const e = m.get(k) ?? m.set(k, { v, n: 0 }).get(k)!; e.n++ }
  const s = [...m.values()].sort((a, b) => b.n - a.n)
  return { v: s[0]?.v, n: s[0]?.n ?? 0, distinct: s.length }
}
type Row = { arm: string; cell: string; runs: number; broken: string[]; snapshots: number; maxPx: number; state: any; stateN: number; states: number; events: any; eventsAfter: any; lateChanged: number; lateMaxPx: number; swept: number[] }
const rows: Row[] = []
const arms = new Map<string, string[]>()
for (const root of roots)
  for (const arm of readdirSync(root).filter((d) => !d.includes('.') && d !== 'unstable'))
    for (const run of readdirSync(path.join(root, arm))) if (existsSync(path.join(root, arm, run, 'run.json'))) (arms.get(arm) ?? arms.set(arm, []).get(arm)!).push(path.join(root, arm, run))
for (const [arm, runs] of [...arms].sort()) {
  const recs = runs.map((d) => ({ d, r: JSON.parse(readFileSync(path.join(d, 'run.json'), 'utf8')) }))
  const cells = new Set<string>()
  for (const { r } of recs) for (const f of r.fixtures ?? []) cells.add(f.key)
  for (const { r } of recs) for (const b of r.broken) if (b.key.startsWith('vc-animations--')) cells.add(b.key)
  for (const cell of [...cells].sort()) {
    const file = `${cell.replace(/[^a-z0-9@-]/gi, '_')}.png`
    const broken = recs.flatMap(({ r }) => r.broken.filter((b: any) => b.key === cell).map((b: any) => `${b.reason}: ${String(b.detail).slice(0, 80)}`))
    const pngs = recs.map(({ d }) => path.join(d, 'png', file)).filter(existsSync)
    const hs = mode(pngs.map(hash))
    const modal = pngs.find((p) => hash(p) === hs.v)
    const maxPx = modal ? Math.max(0, ...pngs.filter((p) => hash(p) !== hs.v).map((p) => px(modal, p))) : 0
    const fxs = recs.flatMap(({ r }) => (r.fixtures ?? []).filter((f: any) => f.key === cell).map((f: any) => f.fx))
    const st = mode(fxs.map((f) => f.atCapture?.els))
    const ev = mode(fxs.map((f) => f.atCapture?.events))
    const evA = mode(fxs.map((f) => f.after?.events))
    let lateChanged = 0
    let lateMaxPx = 0
    for (const { d } of recs) {
      const a = path.join(d, 'png', file)
      const b = path.join(d, 'late', file)
      if (existsSync(a) && existsSync(b) && hash(a) !== hash(b)) { lateChanged++; lateMaxPx = Math.max(lateMaxPx, px(a, b)) }
    }
    rows.push({ arm, cell: cell.replace('vc-animations--', ''), runs: recs.length, broken, snapshots: hs.distinct, maxPx, state: st.v, stateN: st.n, states: st.distinct, events: ev.v, eventsAfter: evA.v, lateChanged, lateMaxPx, swept: fxs.map((f) => f.swept) })
  }
}
writeFileSync(path.join(roots[0], 'fixtures.json'), `${JSON.stringify(rows, null, 1)}\n`)
const short = (els: any) => els ? Object.entries<any>(els).map(([k, v]) => `${k}: ${[v.connected === false ? 'detached' : '', v.opacity !== '1' ? `op ${v.opacity}` : '', k === 'box' ? `bg ${v.bg}` : '', v.transform !== 'none' ? v.transform.replace(/matrix\(([^)]*)\)/, (_: string, m: string) => `m(${m.split(',').map((x: string) => +(+x).toFixed(2)).join(',')})`) : '', v.x !== undefined ? `x ${v.x}` : '', v.cx !== undefined ? `cx ${v.cx}` : '', v.currentTime !== undefined ? `t ${v.currentTime}${v.paused ? ' paused' : ''} rs ${v.readyState}${v.error ? ` err ${v.error}` : ''}` : ''].filter(Boolean).join(' ') || 'base'}`).join('; ') : '-'
for (const cell of [...new Set(rows.map((r) => r.cell))]) {
  console.log(`\n### ${cell}\n\n| Arm | Broken | Snapshots (max px) | State at capture | Events at capture | Changed 1 s later |\n|---|---|---|---|---|---|`)
  for (const r of rows.filter((x) => x.cell === cell))
    console.log(`| ${r.arm} | ${r.broken.length ? `${r.broken.length}/${r.runs} ${r.broken[0]}` : 0} | ${r.snapshots} (${r.maxPx}) | ${short(r.state)}${r.states > 1 ? ` [${r.stateN}/${r.runs - r.broken.length}, ${r.states} states]` : ''} | ${(r.events ?? []).join(' ') || '-'} | ${r.lateChanged}${r.lateChanged ? ` (${r.lateMaxPx} px)` : ''} |`)
}
