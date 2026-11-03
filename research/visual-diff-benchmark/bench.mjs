// Per-pair timings on one thread: byte compare, decode (pngjs, sharp), diff (pixelmatch 8, @blazediff/core), diff PNG encode.
// Usage: node bench.mjs --out results.json --reps 5 name=baselineDir:snapshotDir ...
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { diff as blazediff } from '@blazediff/core'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import sharp from 'sharp'

const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, reps: { type: 'string', default: '5' } } })
const reps = Number(o.reps)
sharp.cache(false) // repeated decodes of one buffer must not hit libvips' operation cache

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
async function time(fn) {
  const ts = []
  let r
  for (let i = 0; i < reps; i++) { const t = performance.now(); r = await fn(); ts.push(performance.now() - t) }
  return [median(ts), r]
}
const pngjsDecode = (buf) => { const p = PNG.sync.read(buf); return { data: p.data, width: p.width, height: p.height } }
const sharpDecode = async (buf) => { const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, width: info.width, height: info.height } }
const pngjsEncode = (data, width, height) => PNG.sync.write(Object.assign(new PNG({ width, height }), { data }))
const sharpEncode = (data, width, height) => sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
function exact(a, b) {
  let px = 0, max = 0
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]))
    if (d) { px++; if (d > max) max = d }
  }
  return { px, max }
}

// Warm up every code path on a few pairs so JIT and library start-up stay out of the timings
const sets = positionals.map((p) => { const [name, dirs] = p.split('='); const [a, b] = dirs.split(':'); return { name, a, b } })
{
  const { a, b } = sets[0]
  for (const f of readdirSync(a).filter((f) => f.endsWith('.png')).slice(0, 8)) {
    const x = readFileSync(path.join(a, f)), y = readFileSync(path.join(b, f))
    const p = pngjsDecode(x), q = pngjsDecode(y); await sharpDecode(x)
    if (p.width === q.width && p.height === q.height) {
      const out = new Uint8Array(p.data.length)
      pixelmatch(p.data, q.data, out, p.width, p.height); blazediff(p.data, q.data, out, p.width, p.height)
      pngjsEncode(out, p.width, p.height); await sharpEncode(out, p.width, p.height)
    }
  }
}

const rows = []
for (const { name, a, b } of sets) {
  for (const f of readdirSync(a).filter((f) => f.endsWith('.png')).sort()) {
    const fa = path.join(a, f), fb = path.join(b, f)
    const row = { set: name, file: f }
    let x, y
    ;[row.readMs, [x, y]] = await time(() => [readFileSync(fa), readFileSync(fb)])
    row.bytesA = x.length; row.bytesB = y.length
    ;[row.equalsMs, row.bytesEqual] = await time(() => x.equals(y))
    const [tpa, pa] = await time(() => pngjsDecode(x)), [tpb, pb] = await time(() => pngjsDecode(y))
    const [tsa, sa] = await time(() => sharpDecode(x)), [tsb, sb] = await time(() => sharpDecode(y))
    row.pngjsDecodeMs = tpa + tpb; row.sharpDecodeMs = tsa + tsb
    row.decodersAgree = Buffer.from(pa.data.buffer, pa.data.byteOffset, pa.data.length).equals(sa.data) && Buffer.from(pb.data.buffer, pb.data.byteOffset, pb.data.length).equals(sb.data)
    row.width = pa.width; row.height = pa.height; row.mp = (pa.width * pa.height) / 1e6
    if (pa.width !== pb.width || pa.height !== pb.height) { row.sizeDiffers = true; rows.push(row); continue }
    const { width: w, height: h } = pa
    Object.assign(row, exact(pa.data, pb.data))
    const out = new Uint8Array(pa.data.length)
    ;[row.pmMs, row.pm] = await time(() => pixelmatch(pa.data, pb.data, null, w, h))
    ;[row.pmOutMs] = await time(() => pixelmatch(pa.data, pb.data, out, w, h))
    ;[row.pmWinMs, row.pmWin16] = await time(() => pixelmatch(pa.data, pb.data, null, w, h, { windowSize: 16 }))
    ;[row.pm0, row.pmAA0] = [pixelmatch(pa.data, pb.data, null, w, h, { threshold: 0 }), pixelmatch(pa.data, pb.data, null, w, h, { threshold: 0, includeAA: true })]
    ;[row.bdMs, row.bd] = await time(() => blazediff(pa.data, pb.data, undefined, w, h))
    ;[row.bdOutMs] = await time(() => blazediff(pa.data, pb.data, out, w, h))
    ;[row.bd0] = [blazediff(pa.data, pb.data, undefined, w, h, { threshold: 0 })]
    if (row.px) {
      pixelmatch(pa.data, pb.data, out, w, h)
      ;[row.pngjsEncodeMs] = await time(() => pngjsEncode(out, w, h))
      ;[row.sharpEncodeMs] = await time(() => sharpEncode(out, w, h))
    }
    rows.push(row)
  }
  console.error(`${name}: ${rows.filter((r) => r.set === name).length} pairs`)
}
writeFileSync(o.out, JSON.stringify({ env: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model, cpus: os.cpus().length, sharp: sharp.versions, reps }, rows }, null, 1))
