// Runs inside the container. Usage: node capture.mjs <outDir>
import { execSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const out = process.argv[2]
mkdirSync(out, { recursive: true })
const FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
const FIXTURES = ['mixed', 'webfont', 'stress']
const BASE_FLAGS = ['--hide-scrollbars', '--window-size=1000,760', '--force-color-profile=srgb', '--enable-unsafe-swiftshader', '--no-sandbox']

const server = createServer((req, res) => {
  const name = req.url.split('?')[0]
  if (name === '/font/LiberationSans-Regular.ttf') {
    res.setHeader('content-type', 'font/ttf')
    return res.end(readFileSync(FONT))
  }
  const file = join(here, 'fixtures', name.slice(1))
  if (!existsSync(file)) { res.statusCode = 404; return res.end() }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const shellRoot = '/ms-playwright/' + readdirSync('/ms-playwright').find((d) => d.startsWith('chromium_headless_shell-'))
const shellDir = readdirSync(shellRoot).find((d) => d.startsWith('chrome'))
const shell = join(shellRoot, shellDir, 'chrome-headless-shell')

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }).trim() } catch (e) { return `ERR ${e.message}` } }
const cpuinfo = readFileSync('/proc/cpuinfo', 'utf8')
const flags = (cpuinfo.match(/^(flags|Features)\s*:\s*(.*)$/m)?.[2] ?? '').split(/\s+/)
writeFileSync(join(out, 'env.json'), JSON.stringify({
  node: process.version,
  arch: process.arch,
  uname: sh('uname -srm'),
  cpuModel: cpuinfo.match(/^model name\s*:\s*(.*)$/m)?.[1] ?? null,
  simdFlags: flags.filter((f) => /^(sse4_2|avx|avx2|fma|f16c|bmi2|avx512f|asimd|asimddp|sve|sve2)$/.test(f)),
  nproc: sh('nproc'),
  chrome: sh(`${shell} --version`),
  shellPath: shell,
  shellSha256: sha(shell),
  fontSha256: sha(FONT),
  fcSans: sh('fc-match sans-serif'),
  fcSerif: sh('fc-match serif'),
  fcMono: sh('fc-match monospace'),
  fcArial: sh('fc-match Arial'),
  fontconfigListSha256: createHash('sha256').update(sh('fc-list | sort')).digest('hex'),
  dpkgFontsAndGfx: sh("dpkg-query -W -f='${Package}=${Version}\\n' 'fonts-*' 'libfreetype*' 'libfontconfig*' 'libharfbuzz*' 2>/dev/null | sort"),
}, null, 2))

for (const fixture of FIXTURES) {
  for (const [name, extra] of [['cli', []], ['cli-noskiaopts', ['--disable-skia-runtime-opts']]]) {
    await cli(fixture, name, extra)
  }
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 })).newPage()
  await page.goto(`http://127.0.0.1:${port}/${fixture}.html`, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => !document.documentElement.dataset.pending)
  await page.screenshot({ path: join(out, `${fixture}.pw.png`), animations: 'disabled', caret: 'hide' })
  await browser.close()
}
server.close()

async function cli(fixture, name, extra) {
  const png = join(out, `${fixture}.${name}.png`)
  await new Promise((resolve, reject) => {
    const p = spawn(shell, [...BASE_FLAGS, ...extra, '--virtual-time-budget=3000', `--screenshot=${png}`, `http://127.0.0.1:${port}/${fixture}.html`], { stdio: 'ignore' })
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`timeout ${fixture}.${name}`)) }, 60000)
    p.on('exit', () => { clearTimeout(t); existsSync(png) ? resolve() : reject(new Error(`no screenshot ${fixture}.${name}`)) })
  })
}
