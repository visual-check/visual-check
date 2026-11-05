// Usage: node stoptest.mjs — how long docker stop takes on run-server after a client session.
import { execFileSync } from 'node:child_process'
import { chromium } from './harness/node_modules/playwright-core/index.mjs'

const T = 'mcr.microsoft.com/playwright:v1.64.1-noble'
const id = execFileSync('docker', ['run', '-d', '--rm', '--init', '--ipc=host', '--pull=never', '--platform', 'linux/amd64', '-p', '127.0.0.1:39334:3000', '-v', `${process.cwd()}/harness:/harness:ro`, T, 'node', '/harness/node_modules/playwright-core/cli.js', 'run-server', '--port', '3000', '--host', '0.0.0.0', '--unsafe'], { encoding: 'utf8' }).trim()
let b
for (;;) { try { b = await chromium.connect('ws://127.0.0.1:39334/', { timeout: 2000 }); break } catch { await new Promise((r) => setTimeout(r, 50)) } }
const p = await b.newPage(); await p.setContent('x'); await b.close()
for (const [label, args] of [['stop -t 20 after close', ['stop', '-t', '20', id]]]) {
  const t = performance.now(); execFileSync('docker', args); console.log(label, Math.round(performance.now() - t), 'ms')
}
