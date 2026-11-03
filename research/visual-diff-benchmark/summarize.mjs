// Markdown tables from bench.mjs and pool.mjs output. Usage: node summarize.mjs bench.json [pool.jsonl]
import { existsSync, readFileSync } from 'node:fs'

const [benchFile, poolFile] = process.argv.slice(2)
const { env, rows } = JSON.parse(readFileSync(benchFile, 'utf8'))
const q = (xs, p) => { const s = xs.filter((x) => x !== undefined).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN }
const sum = (xs) => xs.filter((x) => x !== undefined).reduce((a, b) => a + b, 0)
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-')
const table = (head, body) => [`| ${head.join(' | ')} |`, `|${head.map((_, i) => (i ? '---:' : '---')).join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n')
const sets = [...new Set(rows.map((r) => r.set))]
console.log(`env: ${JSON.stringify(env)}\n`)

console.log('### Pairs by outcome\n')
console.log(table(['Set', 'Pairs', 'Bytes equal', 'Pixels equal, bytes differ', 'Pixels differ', 'Size differs', 'Max px', 'Max channel', 'pm > 0', 'bd > 0', 'pm win16 > 0', 'Decoders agree'], sets.map((s) => {
  const r = rows.filter((x) => x.set === s)
  const differ = r.filter((x) => x.px > 0)
  return [s, r.length, r.filter((x) => x.bytesEqual).length, r.filter((x) => !x.bytesEqual && x.px === 0).length, differ.length, r.filter((x) => x.sizeDiffers).length,
    differ.length ? Math.max(...differ.map((x) => x.px)) : 0, differ.length ? Math.max(...differ.map((x) => x.max)) : 0,
    r.filter((x) => x.pm > 0).length, r.filter((x) => x.bd > 0).length, r.filter((x) => x.pmWin16 > 0).length, r.every((x) => x.decodersAgree) ? 'yes' : 'NO']
})))

console.log('\n### Image sizes\n')
const all = rows.filter((r) => r.set === sets[0])
console.log(`MP per image: median ${f(q(all.map((r) => r.mp), 0.5), 2)}, p95 ${f(q(all.map((r) => r.mp), 0.95), 2)}, max ${f(Math.max(...all.map((r) => r.mp)), 2)}; PNG KB median ${f(q(all.map((r) => r.bytesA / 1024), 0.5), 0)}, total MB ${f(sum(all.map((r) => r.bytesA)) / 1048576, 1)}`)

const ops = [['readMs', 'Read both files'], ['equalsMs', 'Byte compare'], ['pngjsDecodeMs', 'pngjs decode both'], ['sharpDecodeMs', 'sharp decode both'], ['pmMs', 'pixelmatch, no output'], ['pmOutMs', 'pixelmatch, diff output'], ['pmWinMs', 'pixelmatch windowSize 16'], ['bdMs', 'blazediff, no output'], ['bdOutMs', 'blazediff, diff output'], ['pngjsEncodeMs', 'pngjs encode diff'], ['sharpEncodeMs', 'sharp encode diff']]
console.log('\n### Single-thread ms per pair: median / p95 / total over the set\n')
console.log(table(['Op', ...sets], ops.map(([k, label]) => [label, ...sets.map((s) => {
  const xs = rows.filter((r) => r.set === s).map((r) => r[k]).filter((x) => x !== undefined)
  return xs.length ? `${f(q(xs, 0.5), 2)} / ${f(q(xs, 0.95), 2)} / ${f(sum(xs), 0)}` : '-'
})])))

console.log('\n### Per MP (median ms per megapixel, pairs whose pixels differ vs equal)\n')
const perMp = (k, pred) => q(rows.filter((r) => r[k] !== undefined && pred(r)).map((r) => r[k] / r.mp), 0.5)
console.log(table(['Op', 'Pixels equal', 'Pixels differ'], ops.slice(2).map(([k, label]) => [label, f(perMp(k, (r) => r.px === 0), 2), f(perMp(k, (r) => r.px > 0), 2)])))

if (poolFile && existsSync(poolFile)) {
  const runs = readFileSync(poolFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const groups = Map.groupBy(runs, (r) => `${r.label}|${r.decoder}|${r.diff}|${r.skip}|${r.workers}`)
  console.log('\n### Pool throughput (median of runs)\n')
  console.log(table(['Set', 'Decoder', 'Diff', 'Skip', 'Workers', 'Runs', 'Pairs/s', 'Work ms', 'CPU ms', 'Startup ms', 'Peak RSS MB', 'Skipped', 'Failing'], [...groups.values()].map((g) => {
    const m = (k) => q(g.map((r) => r[k]), 0.5)
    const r0 = g[0]
    return [r0.label, r0.decoder, r0.diff, r0.skip ? 'yes' : 'no', r0.workers, g.length, f(m('pairsPerS')), f(m('workMs'), 0), f(m('cpuMs'), 0), f(m('startupMs'), 0), f(m('peakRssMb'), 0), r0.skipped, r0.differs + r0.sizeDiffers]
  })))
}
