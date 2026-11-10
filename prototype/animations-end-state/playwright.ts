// PROTOTYPE, throwaway: the Playwright driver behind the same interface. WebKit for real; Chromium only for the
// throwaway comparison arm. The browser runs in a run-server container, reached with exposeNetwork, as Docker's role decided.
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as pw from 'playwright-core'
import { type BrowserName, BrowserExited, type Driver, type Page, PageCrashed, type PageOptions, withTimeout } from './driver.ts'

export interface PlaywrightOptions {
  browser: BrowserName
  image: string
  platform: string
  cpus?: string
  memory?: string
  name: string
  port: number
  /**
   * detached: `docker run -d`, as decided, removed by close().
   * attached: `docker run -i` as a child, with a watchdog that kills run-server when stdin closes, so the container
   * also goes when visual-check is killed. SIGKILL, because run-server ignores SIGTERM once a client has connected.
   */
  mode: 'detached' | 'attached'
  /** External names don't resolve in the container; the Storybook still comes through exposeNetwork */
  offline?: boolean
}

const BROWSER_GONE = /Browser closed|browser has been closed|Browser has been closed|Target closed/
const PW_DIR = fileURLToPath(new URL('./node_modules/playwright-core', import.meta.url))
const sh = (args: string[]) => new Promise<string>((r) => execFile('docker', args, (_e, out) => r(String(out ?? ''))))

async function startServer(o: PlaywrightOptions): Promise<ChildProcess | null> {
  const limits = [...(o.cpus ? [`--cpus=${o.cpus}`] : []), ...(o.memory ? [`--memory=${o.memory}`] : [])]
  // page.screenshot awaits document.fonts.ready, which WebKit can leave pending for good; the engine waits for fonts itself
  const common = ['--rm', '--init', '--name', o.name, '--platform', o.platform, '--ipc=host', ...limits, '-p', `127.0.0.1:${o.port}:3333`, '-v', `${PW_DIR}:/pw:ro`, '-e', 'PW_TEST_SCREENSHOT_NO_FONTS_READY=1', ...(o.offline ? ['--dns', '127.0.0.1'] : [])]
  const server = 'node /pw/cli.js run-server --port 3333 --host 0.0.0.0 --unsafe'
  let child: ChildProcess | null = null
  if (o.mode === 'detached') {
    await sh(['run', '-d', ...common, o.image, 'bash', '-c', server])
  } else {
    child = spawn('docker', ['run', '-i', ...common, o.image, 'bash', '-c', `${server} & cat > /dev/null; kill -9 $!; wait`], { stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout!.resume()
    child.stderr!.resume()
    child.stdin!.on('error', () => {})
  }
  for (let k = 0; k < 600; k++) {
    if ((await sh(['logs', o.name]).catch(() => '')).includes('Listening')) return child
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('run-server did not start')
}

export async function launchPlaywright(o: PlaywrightOptions): Promise<Driver> {
  const child = await startServer(o)
  let closing = false
  let resolveExited: (r: string) => void
  const exited = new Promise<string>((r) => { resolveExited = r })
  let disconnected = false
  const args = o.browser === 'chromium' ? ['--disable-skia-runtime-opts'] : []
  const browser = await pw[o.browser].connect(`ws://127.0.0.1:${o.port}/`, {
    exposeNetwork: '<loopback>',
    headers: { 'x-playwright-launch-options': JSON.stringify({ args }) },
    timeout: 60_000,
  })
  browser.on('disconnected', () => { disconnected = true; if (!closing) resolveExited('browser disconnected') })
  const alive = () => withTimeout(browser.newContext().then((c) => c.close()), 3_000, 'probe').then(() => true, () => false)
  const probe = await browser.newPage()
  const ua = await probe.evaluate(() => navigator.userAgent)
  await probe.context().close()

  return {
    browser: o.browser,
    version: `${o.browser} ${browser.version()}`,
    exited,
    async newPage(po: PageOptions): Promise<Page> {
      if (disconnected || !(await alive())) throw new BrowserExited('browser closed')
      const ctx = await browser.newContext({
        viewport: po.viewport,
        deviceScaleFactor: 1,
        userAgent: `${ua}${po.userAgentSuffix}`,
        locale: po.locale,
        timezoneId: po.timezoneId,
        colorScheme: po.colorScheme,
        reducedMotion: po.reducedMotion,
        acceptDownloads: false,
      })
      await ctx.addInitScript(po.initScript)
      const page = await ctx.newPage()
      let crashed = false
      let navs = 0
      page.on('crash', () => { crashed = true })
      // framenavigated also fires on history.replaceState, which Storybook calls, so count new documents instead
      page.on('domcontentloaded', () => { navs++ })
      if (process.env.VC_TRACE) {
        const t0 = performance.now()
        page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.error(`TRACE ${((performance.now() - t0) / 1000).toFixed(2)} framenavigated ${f.url().slice(0, 110)}`) })
        page.on('domcontentloaded', () => console.error(`TRACE ${((performance.now() - t0) / 1000).toFixed(2)} domcontentloaded ${page.url().slice(0, 110)}`))
      }
      page.on('dialog', (d) => {
        const accept = d.type() === 'alert' || d.type() === 'beforeunload'
        po.onHazard?.('dialog', `${d.type()} ${accept ? 'accepted' : 'dismissed'}`)
        ;(accept ? d.accept() : d.dismiss()).catch(() => {})
      })
      ctx.on('page', (p) => po.onHazard?.('popup', p.url()))
      page.on('download', (d) => po.onHazard?.('download', `${d.suggestedFilename()} denied`))
      const crashedP = new Promise<never>((_, reject) => page.once('crash', () => reject(new PageCrashed('page crashed'))))
      crashedP.catch(() => {})
      const wrap = async <T>(p: Promise<T>): Promise<T> => {
        try {
          return await Promise.race([p, crashedP])
        } catch (e) {
          if (crashed) throw new PageCrashed('page crashed')
          if (disconnected || BROWSER_GONE.test(String((e as Error).message))) {
            // A crash can surface as "closed" before the crash event: wait for it, then probe the browser itself
            await new Promise((r) => setTimeout(r, 300))
            if (crashed) throw new PageCrashed('page crashed')
            if (!(await alive())) {
              if (!closing) resolveExited('browser closed')
              throw new BrowserExited('browser closed')
            }
          }
          throw e
        }
      }
      return {
        setViewport: (v) => wrap(page.setViewportSize(v)),
        async goto(url, timeoutMs) {
          navs = 0
          await wrap(page.goto(url, { waitUntil: 'load', timeout: timeoutMs }))
        },
        evaluate: (expression, timeoutMs) => wrap(withTimeout(page.evaluate(expression), timeoutMs, 'evaluate')),
        // The engine's in-page script already froze animations and hid the caret, as for every driver
        screenshot: () => wrap(page.screenshot({ animations: 'allow', caret: 'initial', timeout: 30_000 })),
        navigations: () => navs,
        close: () => withTimeout(ctx.close(), 10_000, 'context close').catch(() => {}),
      }
    },
    async killBrowser() {
      await sh(['exec', o.name, 'pkill', '-9', '-f', o.browser === 'webkit' ? 'ms-playwright/webkit' : 'chrome-headless-shell'])
    },
    async close() {
      closing = true
      await withTimeout(browser.close(), 10_000, 'browser close').catch(() => {})
      // run-server ignores SIGTERM once a client has connected, so the container is removed by force
      child?.stdin!.end()
      await sh(['rm', '-f', o.name])
    },
  }
}
