// Runs inside the container: does Chromium headless shell start, render and screenshot with these extra args?
// Usage: node probe.mjs <storybookDir> '<json array of arg lists>'
import { chromium } from 'playwright-core'
import { newContext, ready, serve } from './lib.mjs'

const [root, sets] = process.argv.slice(2)
const { server, base } = await serve(root)
for (const extra of JSON.parse(sets)) {
  const t = performance.now()
  const r = { args: extra }
  try {
    const browser = await chromium.launch({ args: ['--disable-skia-runtime-opts', ...extra], timeout: 120_000 })
    r.launchMs = Math.round(performance.now() - t)
    const ctx = await newContext(browser)
    const page = await ctx.newPage()
    const t1 = performance.now()
    r.status = await ready(page, base, 'components-buttons-button--default')
    await page.screenshot({ animations: 'disabled', caret: 'hide' })
    r.captureMs = Math.round(performance.now() - t1)
    await browser.close()
  } catch (e) {
    r.error = String(e.message ?? e).split('\n').filter((l) => /qemu|FATAL|Error|closed/.test(l)).slice(0, 3).join(' | ').slice(0, 300)
  }
  console.log(JSON.stringify(r))
}
server.close()
