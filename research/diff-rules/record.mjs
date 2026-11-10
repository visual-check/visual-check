// Runs inside the container, with network. Usage: node record.mjs <storybookDir> <outDir>
// Opens every story once per browser and saves every external response, so captures replay the same bytes offline.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, webkit } from 'playwright-core'
import { EXTERNAL, newContext, ready, serve, stories } from './lib.mjs'

const [root, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const { server, base } = await serve(root)
const ids = stories(root)
const log = {}

for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch()
  const ctx = await newContext(browser, { recordHar: { path: join(out, `${name}.har.zip`), content: 'attach', urlFilter: EXTERNAL } })
  const page = await ctx.newPage()
  log[name] = {}
  for (const id of ids) {
    const t0 = Date.now()
    try {
      const status = await ready(page, base, id)
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
      log[name][id] = { status, ms: Date.now() - t0 }
    } catch (e) {
      log[name][id] = { error: String(e.message ?? e).split('\n')[0].slice(0, 200) }
    }
  }
  await ctx.close()
  await browser.close()
}
server.close()
writeFileSync(join(out, 'record.json'), JSON.stringify({ stories: ids.length, log }, null, 1))
