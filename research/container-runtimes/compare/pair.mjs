// Usage: node pair.mjs <pngA> <pngB> — exact differing pixels, max channel, bounding box
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [a, b] = process.argv.slice(2).map((p) => PNG.sync.read(readFileSync(p)))
let px = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
for (let i = 0; i < a.data.length; i += 4) {
  let d = 0
  for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]))
  if (d) { px++; max = Math.max(max, d); const x = (i / 4) % a.width, y = Math.floor(i / 4 / a.width); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
}
console.log(JSON.stringify({ px, max, box: px ? [x0, y0, x1, y1] : null }))
