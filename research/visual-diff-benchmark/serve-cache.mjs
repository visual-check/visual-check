// Serves a Storybook recorded by capture.mjs --record from memory, so later passes run offline over plain HTTP.
// Usage: node serve-cache.mjs <cacheDir> <origin> [port]
import { readdirSync, readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const [dir, origin, port = '6402'] = process.argv.slice(2)
const files = new Map()
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  const meta = JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
  if (!meta.url.startsWith(`${origin}/`)) continue
  files.set(meta.url.slice(origin.length), { ...meta, body: readFileSync(path.join(dir, name.slice(0, -5))) })
}
let missing = 0
http
  .createServer((req, res) => {
    const file = files.get(req.url)
    if (!file) {
      missing++
      console.log(`404 ${req.url} (${missing})`)
      res.writeHead(404).end()
      return
    }
    res.writeHead(file.status, { ...file.headers, 'content-length': file.body.length, 'cache-control': 'public, max-age=31536000, immutable' })
    res.end(file.body)
  })
  .listen(Number(port), '127.0.0.1', () => console.log(`serving ${files.size} files on ${port}`))
