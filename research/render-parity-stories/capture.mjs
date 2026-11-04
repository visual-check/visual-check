// Runs inside the container, with no network. Usage: node capture.mjs <storybookDir> <harDir> <outDir> <run> [refDir] [--mutate]
// Captures every story on Chromium headless shell, Chromium with --disable-skia-runtime-opts and WebKit.
// Run 1 keeps every PNG; later runs keep only PNGs whose hash differs from run 1. --mutate adds deliberate changes on Chromium.
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, webkit } from 'playwright-core'
import { EXTERNAL, iconMisses, newContext, ready, replay, serve, stories } from './lib.mjs'

const args = process.argv.slice(2)
const mutate = args.includes('--mutate')
const [root, harDir, out, runArg, refDir] = args.filter((a) => !a.startsWith('--'))
const run = Number(runArg)
const WORKERS = 2
mkdirSync(out, { recursive: true })

const PASSES = {
  chromium: { type: chromium, har: 'chromium', args: [] },
  noskia: { type: chromium, har: 'chromium', args: ['--disable-skia-runtime-opts'] },
  webkit: { type: webkit, har: 'webkit', args: [] },
}
// Deliberate small changes, applied after ready and before the screenshot.
const MUTATIONS = {
  shift: () => { const r = document.getElementById('storybook-root'); r.style.position = 'relative'; r.style.left = '1px'; return 'root' },
  text: () => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n; (n = walk.nextNode());) {
      const i = n.data.search(/[a-z]/)
      const el = n.parentElement
      if (i < 0 || !el || el.closest('script,style') || !el.getClientRects().length || getComputedStyle(el).visibility !== 'visible') continue
      const c = n.data[i] === 'o' ? 'a' : 'o'
      n.data = n.data.slice(0, i) + c + n.data.slice(i + 1)
      return `${el.tagName.toLowerCase()} ${n.data[i]}`
    }
    return null
  },
  ...Object.fromEntries([4, 8, 16].map((d) => [`color${d}`, new Function(`
    const page = getComputedStyle(document.body).backgroundColor
    let best = null, area = 0
    for (const el of document.body.querySelectorAll('*')) {
      if (el.id === 'storybook-root') continue
      const bg = getComputedStyle(el).backgroundColor
      const m = bg.match(/^rgba?\\(([\\d.]+), ([\\d.]+), ([\\d.]+)(?:, ([\\d.]+))?\\)$/)
      if (!m || m[4] === '0' || bg === page) continue
      const r = el.getBoundingClientRect()
      const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0))
      if (a > area) { area = a; best = [el, m.slice(1, 5)] }
    }
    if (!best) return null
    const [el, [r, g, b, a]] = best
    const s = (r * 0.299 + g * 0.587 + b * 0.114) > 128 ? -${d} : ${d}
    const c = (v) => Math.max(0, Math.min(255, Math.round(Number(v) + s)))
    el.style.setProperty('background-color', 'rgba(' + c(r) + ', ' + c(g) + ', ' + c(b) + ', ' + (a ?? 1) + ')', 'important')
    return el.tagName.toLowerCase() + ' ' + Math.round(area) + 'px'
  `)])),
  icon: () => {
    let best = null, size = Infinity
    for (const el of document.body.querySelectorAll('svg')) {
      const r = el.getBoundingClientRect()
      if (r.width < 8 || r.height < 8 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue
      if (getComputedStyle(el).visibility !== 'visible' || el.parentElement?.closest('svg')) continue
      if (r.width * r.height < size) { size = r.width * r.height; best = el }
    }
    if (!best) return null
    best.style.setProperty('visibility', 'hidden', 'important')
    return `${Math.round(size)}px`
  },
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }).trim() } catch (e) { return `ERR ${e.message}` } }
const file = (id) => `${id.replace(/[^a-z0-9-]/gi, '_')}.png`
const cpuinfo = readFileSync('/proc/cpuinfo', 'utf8')
const shellRoot = '/ms-playwright/' + readdirSync('/ms-playwright').find((d) => d.startsWith('chromium_headless_shell-'))
const shell = join(shellRoot, readdirSync(shellRoot).find((d) => d.startsWith('chrome')), 'chrome-headless-shell')
const env = {
  run, workers: WORKERS, node: process.version, arch: process.arch, uname: sh('uname -srm'), nproc: sh('nproc'),
  cpuModel: cpuinfo.match(/^model name\s*:\s*(.*)$/m)?.[1] ?? null,
  simdFlags: (cpuinfo.match(/^(flags|Features)\s*:\s*(.*)$/m)?.[2] ?? '').split(/\s+/).filter((f) => /^(sse4_2|avx|avx2|fma|avx512f|asimd|asimddp|sve|sve2)$/.test(f)),
  chrome: sh(`${shell} --version`), shellSha256: sha(readFileSync(shell)),
  fontconfigListSha256: sha(sh('fc-list | sort')),
  storybookSha256: process.env.SB_SHA ?? null, harSha256: process.env.HAR_SHA ?? null,
}

const { server, base } = await serve(root)
const ids = stories(root)
const refOf = (pass) => (refDir && existsSync(join(refDir, `${pass}.json`)) ? JSON.parse(readFileSync(join(refDir, `${pass}.json`), 'utf8')).shots : {})

async function pass(name, { type, har, args }, mutation) {
  const label = mutation ? `mut-${mutation}` : name
  const dir = join(out, label)
  mkdirSync(dir, { recursive: true })
  const ref = refOf(label)
  const browser = await type.launch({ args })
  env[`${name}Version`] = browser.version()
  const shots = {}
  const queue = [...ids]
  const t0 = performance.now()
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    const ctx = await newContext(browser)
    await replay(ctx, harDir, har)
    const page = await ctx.newPage()
    let missed = []
    let late = null
    page.on('requestfailed', (r) => { if (EXTERNAL.test(r.url())) missed.push(r.url()) })
    // An external request that starts during the screenshot means ready came too early for this story.
    page.on('request', (r) => { if (late !== null && EXTERNAL.test(r.url())) late++ })
    for (let id; (id = queue.shift());) {
      missed = []
      late = null
      const t = performance.now()
      const row = (shots[id] = {})
      try {
        row.status = await ready(page, base, id)
        if (row.status === 'success') {
          if (mutation) {
            row.target = await page.evaluate(MUTATIONS[mutation])
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
          }
          if (!mutation || row.target) {
            late = 0
            const png = await page.screenshot({ animations: 'disabled', caret: 'hide' })
            if (late) row.late = late
            late = null
            row.ms = Math.round(performance.now() - t)
            row.sha = sha(png)
            if (run === 1 || ref[id]?.sha !== row.sha) writeFileSync(join(dir, file(id)), png)
          }
        }
      } catch (e) {
        row.status = 'error'
        row.error = String(e.message ?? e).split('\n')[0].slice(0, 200)
      }
      if (missed.length) row.missed = [...new Set(missed)]
      await ctx.clearCookies()
      await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch {} }).catch(() => {})
    }
    await ctx.close()
  }))
  const wallMs = Math.round(performance.now() - t0)
  await browser.close()
  writeFileSync(join(out, `${label}.json`), JSON.stringify({ pass: label, wallMs, iconMisses: [...iconMisses], shots }))
  console.log(`run ${run} ${label}: ${ids.length} stories in ${(wallMs / 1000).toFixed(1)} s`)
}

// Alternate which Chromium pass goes first, so warm-up doesn't favour one in the speed comparison.
const order = run % 2 ? ['chromium', 'noskia', 'webkit'] : ['noskia', 'chromium', 'webkit']
for (const name of order) await pass(name, PASSES[name])
if (mutate) for (const m of Object.keys(MUTATIONS)) await pass('chromium', PASSES.chromium, m)
server.close()
writeFileSync(join(out, 'env.json'), JSON.stringify(env, null, 2))
