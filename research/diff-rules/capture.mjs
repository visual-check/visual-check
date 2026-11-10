// Runs inside the container, with no network. Usage: node capture.mjs <storybookDir> <harDir> <outDir> <run> [refDir] [--mutate|--mutate-only]
// Captures every story on Chromium headless shell, Chromium with --disable-skia-runtime-opts and WebKit.
// Run 1 keeps every PNG; later runs keep only PNGs whose hash differs from run 1. --mutate adds deliberate changes on Chromium.
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, webkit } from 'playwright-core'
import { EXTERNAL, SCALE, iconMisses, newContext, ready, replay, serve, stories } from './lib.mjs'

const args = process.argv.slice(2)
const mutate = args.includes('--mutate') || args.includes('--mutate-only')
const mutateOnly = args.includes('--mutate-only')
const [root, harDir, out, runArg, refDir] = args.filter((a) => !a.startsWith('--'))
const run = Number(runArg)
const WORKERS = 2
mkdirSync(out, { recursive: true })

const PASSES = {
  chromium: { type: chromium, har: 'chromium', args: [] },
  noskia: { type: chromium, har: 'chromium', args: ['--disable-skia-runtime-opts'] },
  webkit: { type: webkit, har: 'webkit', args: [] },
}
// Deliberate small changes, applied after ready and before the screenshot. Each takes one argument and returns its
// target, or null when the story has nothing to change. Targets must be visible in the viewport.
const shown = (el) => {
  const r = el.getBoundingClientRect()
  return r.width > 2 && r.height > 2 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight &&
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
}
const MUTATIONS = {
  shift: [() => { const r = document.getElementById('storybook-root'); r.style.position = 'relative'; r.style.left = '1px'; return 'root' }],
  text: [(shownSrc) => {
    const shown = new Function(`return ${shownSrc}`)()
    const walk = document.createTreeWalker(document.getElementById('storybook-root'), NodeFilter.SHOW_TEXT)
    for (let n; (n = walk.nextNode());) {
      const i = n.data.search(/[a-z]/)
      if (i < 0 || !n.parentElement || !shown(n.parentElement)) continue
      n.data = n.data.slice(0, i) + (n.data[i] === 'o' ? 'a' : 'o') + n.data.slice(i + 1)
      return `${n.parentElement.tagName.toLowerCase()} ${n.data[i]}`
    }
    return null
  }, shown.toString()],
  // The largest opaque background in view that isn't the page's, moved by d per channel, darker on light colours.
  // Tailwind 4 computes colours as lab() and oklch(), so a canvas pixel gives the sRGB value.
  ...Object.fromEntries([4, 8, 16].map((d) => [`color${d}`, [([d, shownSrc]) => {
    const shown = new Function(`return ${shownSrc}`)()
    const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#0000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); return [...cv.getImageData(0, 0, 1, 1).data] }
    const page = rgba(getComputedStyle(document.body).backgroundColor).join()
    let best = null, area = 0
    for (const el of document.getElementById('storybook-root').querySelectorAll('*')) {
      const c = rgba(getComputedStyle(el).backgroundColor)
      if (c[3] < 250 || c.join() === page || !shown(el)) continue
      const r = el.getBoundingClientRect()
      const a = (Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0))
      if (a > area) { area = a; best = [el, c] }
    }
    if (!best) return null
    const [el, [r, g, b]] = best
    const s = r * 0.299 + g * 0.587 + b * 0.114 > 128 ? -d : d
    const v = (x) => Math.max(0, Math.min(255, x + s))
    el.style.setProperty('background-color', `rgb(${v(r)}, ${v(g)}, ${v(b)})`, 'important')
    return `${el.tagName.toLowerCase()} ${Math.round(area)}px rgb(${r},${g},${b})`
  }, [d, shown.toString()]]])),
  icon: [(shownSrc) => {
    const shown = new Function(`return ${shownSrc}`)()
    let best = null, size = Infinity
    for (const el of document.getElementById('storybook-root').querySelectorAll('svg')) {
      const r = el.getBoundingClientRect()
      if (r.width < 8 || r.height < 8 || el.parentElement?.closest('svg') || !shown(el)) continue
      if (r.width * r.height < size) { size = r.width * r.height; best = el }
    }
    if (!best) return null
    best.style.setProperty('visibility', 'hidden', 'important')
    return `${Math.round(size)}px`
  }, shown.toString()],
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }).trim() } catch (e) { return `ERR ${e.message}` } }
const file = (id) => `${id.replace(/[^a-z0-9-]/gi, '_')}.png`
const cpuinfo = readFileSync('/proc/cpuinfo', 'utf8')
const shellRoot = '/ms-playwright/' + readdirSync('/ms-playwright').find((d) => d.startsWith('chromium_headless_shell-'))
const shell = join(shellRoot, readdirSync(shellRoot).find((d) => d.startsWith('chrome')), 'chrome-headless-shell')
const env = {
  run, scale: SCALE, workers: WORKERS, node: process.version, arch: process.arch, uname: sh('uname -srm'), nproc: sh('nproc'),
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
            row.target = await page.evaluate(...MUTATIONS[mutation])
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
if (!mutateOnly) for (const name of order) await pass(name, PASSES[name])
if (mutate) for (const m of Object.keys(MUTATIONS)) await pass('chromium', PASSES.chromium, m)
server.close()
writeFileSync(join(out, 'env.json'), JSON.stringify(env, null, 2))
