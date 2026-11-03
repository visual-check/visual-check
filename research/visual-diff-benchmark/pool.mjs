// End-to-end throughput of a worker_threads pool over every pair in two directories:
// read both files, optionally skip on equal bytes, decode, diff with an output buffer, and encode and write the diff PNG when pixels differ.
// Usage: node pool.mjs --a DIR --b DIR --decoder pngjs|sharp --diff pm|bd --skip 1|0 --workers N --label L --out results.jsonl
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

if (isMainThread) {
  const { values: o } = parseArgs({ options: {
    a: { type: 'string' }, b: { type: 'string' }, decoder: { type: 'string', default: 'pngjs' }, diff: { type: 'string', default: 'pm' },
    skip: { type: 'string', default: '1' }, workers: { type: 'string', default: '2' }, label: { type: 'string', default: '' }, out: { type: 'string' },
  } })
  const files = readdirSync(o.a).filter((f) => f.endsWith('.png')).sort()
  const diffDir = mkdtempSync(path.join(os.tmpdir(), 'vc-diff-'))
  let peakRss = 0
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage.rss()) }, 20)
  const cpu0 = process.cpuUsage()
  const tStart = performance.now()
  const pool = await Promise.all(Array.from({ length: Number(o.workers) }, () => new Promise((resolve) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { ...o, diffDir } })
    w.once('message', () => resolve(w))
  })))
  const tReady = performance.now()
  const results = []
  let next = 0
  await Promise.all(pool.map((w) => new Promise((resolve) => {
    const feed = () => { if (next >= files.length) return resolve(); w.postMessage(files[next++]) }
    w.on('message', (r) => { results.push(r); feed() })
    feed()
  })))
  const tDone = performance.now()
  await Promise.all(pool.map((w) => w.terminate()))
  clearInterval(sampler)
  const cpu = process.cpuUsage(cpu0)
  rmSync(diffDir, { recursive: true, force: true })
  const count = (k) => results.filter((r) => r.kind === k).length
  const record = {
    label: o.label, decoder: o.decoder, diff: o.diff, skip: o.skip === '1', workers: Number(o.workers), pairs: results.length,
    startupMs: Math.round(tReady - tStart), workMs: Math.round(tDone - tReady), pairsPerS: +(results.length / ((tDone - tReady) / 1000)).toFixed(1),
    cpuMs: Math.round((cpu.user + cpu.system) / 1000), peakRssMb: Math.round(peakRss / 1048576),
    skipped: count('equal'), sizeDiffers: count('size'), passed: count('pass'), differs: count('diff'),
  }
  appendFileSync(o.out, `${JSON.stringify(record)}\n`)
  console.log(JSON.stringify(record))
} else {
  const { a, b, decoder, diff, skip, diffDir } = workerData
  const sharp = decoder === 'sharp' ? (await import('sharp')).default : null
  const { PNG } = decoder === 'pngjs' ? await import('pngjs') : {}
  const compare = diff === 'pm' ? (await import('pixelmatch')).default : (await import('@blazediff/core')).diff
  const decode = sharp
    ? async (buf) => { const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, width: info.width, height: info.height } }
    : (buf) => PNG.sync.read(buf)
  const encode = sharp
    ? (data, width, height) => sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
    : (data, width, height) => PNG.sync.write(Object.assign(new PNG({ width, height }), { data }))
  parentPort.on('message', async (file) => {
    const x = readFileSync(path.join(a, file)), y = readFileSync(path.join(b, file))
    if (skip === '1' && x.equals(y)) return parentPort.postMessage({ kind: 'equal' })
    const [p, q] = await Promise.all([decode(x), decode(y)])
    if (p.width !== q.width || p.height !== q.height) return parentPort.postMessage({ kind: 'size' })
    const out = new Uint8Array(p.data.length)
    const n = compare(p.data, q.data, out, p.width, p.height)
    if (n > 0) writeFileSync(path.join(diffDir, file), await encode(out, p.width, p.height))
    parentPort.postMessage({ kind: n > 0 ? 'diff' : 'pass', n })
  })
  parentPort.postMessage('ready')
}
