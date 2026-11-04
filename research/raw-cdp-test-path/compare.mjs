// Compares two folders of PNG snapshots cell by cell: exact per channel, pixels differing and the largest channel delta.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const [a, b] = process.argv.slice(2)
const names = readdirSync(a).filter((n) => n.endsWith('.png'))
const rows = []
let missing = 0
for (const n of names) {
  let y
  try { y = readFileSync(path.join(b, n)) } catch { missing++; continue }
  const x = readFileSync(path.join(a, n))
  if (x.equals(y)) continue
  const p = PNG.sync.read(x), q = PNG.sync.read(y)
  if (p.width !== q.width || p.height !== q.height) { rows.push({ cell: n, px: Infinity, d: 255, size: `${p.width}x${p.height} vs ${q.width}x${q.height}` }); continue }
  let px = 0, d = 0
  for (let i = 0; i < p.data.length; i += 4) {
    const m = Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2]), Math.abs(p.data[i + 3] - q.data[i + 3]))
    if (m) { px++; d = Math.max(d, m) }
  }
  if (px) rows.push({ cell: n, px, d })
}
rows.sort((r, s) => s.px - r.px)
console.log(JSON.stringify({ a: path.basename(a), b: path.basename(b), cells: names.length, missing, differing: rows.length, maxPx: rows[0]?.px ?? 0, maxD: Math.max(0, ...rows.map((r) => r.d)), top: rows.slice(0, 8) }))
