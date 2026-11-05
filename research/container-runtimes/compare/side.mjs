// Usage: node side.mjs <a.png> <b.png> <out.png> x y w h scale — the same region of a and b, side by side, scaled up
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [pa, pb, dst, ...n] = process.argv.slice(2)
const [x, y, w, h, s] = n.map(Number)
const imgs = [pa, pb].map((p) => PNG.sync.read(readFileSync(p)))
const out = new PNG({ width: (w * s + 8) * 2, height: h * s })
out.data.fill(255)
imgs.forEach((im, k) => {
  for (let yy = 0; yy < h * s; yy++) for (let xx = 0; xx < w * s; xx++) {
    const si = ((y + Math.floor(yy / s)) * im.width + x + Math.floor(xx / s)) * 4
    const di = (yy * out.width + k * (w * s + 8) + xx) * 4
    for (let c = 0; c < 4; c++) out.data[di + c] = im.data[si + c]
  }
})
writeFileSync(dst, PNG.sync.write(out))
