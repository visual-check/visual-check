// Static server for the mealdrop build and the minimal pages. node serve.mjs <root> <port>
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'

const [root, port] = [process.argv[2], Number(process.argv[3] || 6400)]
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.webp': 'image/webp' }
createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  // /slow/<ms>/<file>: delay a local file, to mimic a network font
  let p = decodeURIComponent(u.pathname)
  let delay = 0
  const m = p.match(/^\/slow\/(\d+)(\/.*)$/)
  if (m) { delay = Number(m[1]); p = m[2] }
  let f = path.join(root, p)
  try { if (statSync(f).isDirectory()) f = path.join(f, 'index.html') } catch { res.writeHead(404).end(); return }
  try { statSync(f) } catch { res.writeHead(404).end(); return }
  setTimeout(() => {
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' })
    createReadStream(f).pipe(res)
  }, delay)
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on ${port}`))
