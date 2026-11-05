// Usage: DOCKER="docker --context x" [COLD_ARGS='["--flag"]'] node cold.mjs <imageTag> <reps> <out.json>
// Cold start as v1 would do it, per rep: check the image is local, pull it although it is local, start run-server in a
// fresh amd64 container, connect from the host with the Skia flag, open a page. Then remove the container.
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from './harness/node_modules/playwright-core/index.mjs'

const run = promisify(execFile)
const [tag, repsArg, outPath] = process.argv.slice(2)
const here = dirname(fileURLToPath(import.meta.url))
const [bin, ...pre] = (process.env.DOCKER ?? 'docker').split(' ')
const d = (...a) => run(bin, [...pre, ...a], { maxBuffer: 1 << 26 })
const PORT = 39333
const ms = (t) => Math.round(performance.now() - t)
const reps = []

for (let i = 1; i <= Number(repsArg); i++) {
  const r = { rep: i }
  let t = performance.now()
  await d('image', 'inspect', '--format', '{{.Id}}', tag)
  r.inspectMs = ms(t)
  t = performance.now()
  try { await d('pull', '--platform', 'linux/amd64', tag); r.pullMs = ms(t) } catch (e) { r.pullMs = null; r.pullError = String(e.stderr ?? e.message).slice(0, 300) }
  const t0 = performance.now()
  const { stdout } = await d('run', '-d', '--rm', '--init', '--ipc=host', '--pull=never', '--platform', 'linux/amd64',
    '-p', `127.0.0.1:${PORT}:3000`, '-v', `${join(here, 'harness')}:/harness:ro`, tag,
    'node', '/harness/node_modules/playwright-core/cli.js', 'run-server', '--port', '3000', '--host', '0.0.0.0', '--unsafe')
  const id = stdout.trim()
  r.runMs = ms(t0)
  let browser
  let tries = 0
  for (;;) {
    tries++
    try {
      browser = await chromium.connect(`ws://127.0.0.1:${PORT}/`, {
        timeout: 2000, headers: { 'x-playwright-launch-options': JSON.stringify({ args: ['--disable-skia-runtime-opts', ...JSON.parse(process.env.COLD_ARGS || '[]')] }) },
      })
      break
    } catch (e) {
      if (ms(t0) > 60_000) { r.error = String(e.message).split('\n')[0]; break }
      await new Promise((res) => setTimeout(res, 25))
    }
  }
  r.connectTries = tries
  if (browser) {
    r.connectedMs = ms(t0)
    try {
      const page = await browser.newPage()
      await page.setContent('<p>ready</p>')
      await page.screenshot()
      r.firstScreenshotMs = ms(t0)
      r.browser = browser.version()
    } catch (e) { r.pageError = String(e.message).split('\n')[0].slice(0, 200) }
    await browser.close().catch(() => {})
  }
  // run-server ignores SIGTERM once a client has connected, so docker stop would wait out its timeout.
  t = performance.now()
  await d('rm', '-f', id).catch((e) => { r.stopError = String(e.message).slice(0, 200) })
  r.stopMs = ms(t)
  reps.push(r)
  console.log(JSON.stringify(r))
}
writeFileSync(outPath, JSON.stringify({ docker: process.env.DOCKER ?? 'docker', tag, reps }, null, 2))
