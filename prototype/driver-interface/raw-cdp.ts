// PROTOTYPE, throwaway: visual-check's own raw CDP driver for Chromium headless shell, in the Playwright image.
// The CDP pipe is the container's stdin and stdout: `docker run -i --rm <image> chrome-headless-shell --remote-debugging-pipe`.
// Hazards and crashes are handled as Raw CDP for Chromium decided.
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { BrowserExited, type Driver, type Page, PageCrashed, type PageOptions, type Size, withTimeout } from './driver.ts'

// Data copied from Playwright 1.64.1, packages/playwright-core/src/server/chromium/defaultFontFamilies.ts ("linux").
const FONTS = {
  fontFamilies: { standard: 'Times New Roman', fixed: 'Monospace', serif: 'Times New Roman', sansSerif: 'Arial', cursive: 'Comic Sans MS', fantasy: 'Impact' },
}
// Playwright 1.64.1's 45 headless shell arguments (chromiumSwitches.ts plus its headless ones), read from its process.
const ARGS: string[] = JSON.parse(readFileSync(new URL('./chromium-args.json', import.meta.url), 'utf8'))
const EXE = '/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell'

export interface RawOptions {
  image: string
  platform: string
  /** host: --network host (Linux). proxy: the SOCKS proxy in this process, reached through host.docker.internal. */
  network: 'host' | 'proxy'
  proxyPort?: number
  /** Extra Chromium arguments, e.g. host-resolver rules for an offline run */
  extraArgs?: string[]
  cpus?: string
  memory?: string
  name: string
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; method: string; sessionId?: string }
type Session = { crashed: boolean; waiters: Map<string, Array<{ resolve: (v: any) => void; reject: (e: Error) => void }>>; onEvent: (method: string, params: any) => void }

export function containerCommand(o: RawOptions): string[] {
  const net = o.network === 'host' ? ['--network', 'host'] : process.platform === 'linux' ? ['--add-host=host.docker.internal:host-gateway'] : []
  const proxy = o.network === 'proxy' ? [`--proxy-server=socks5://host.docker.internal:${o.proxyPort}`, '--proxy-bypass-list=<-loopback>'] : []
  const limits = [...(o.cpus ? [`--cpus=${o.cpus}`] : []), ...(o.memory ? [`--memory=${o.memory}`] : [])]
  const chrome = [...ARGS, '--disable-skia-runtime-opts', '--user-data-dir=/tmp/profile', '--remote-debugging-pipe', ...proxy, ...(o.extraArgs ?? [])]
  // fd 3 reads CDP from stdin, fd 4 writes CDP to stdout, and Chromium's own stdout goes to stderr
  const script = `exec $(ls -d ${EXE} | head -1) "$@" 3<&0 4>&1 1>&2`
  return ['docker', 'run', '-i', '--rm', '--init', '--name', o.name, '--platform', o.platform, '--ipc=host', ...limits, ...net, '--entrypoint', 'bash', o.image, '-c', script, 'chrome', ...chrome]
}

export async function launchRawChromium(o: RawOptions): Promise<Driver> {
  const cmd = containerCommand(o)
  const proc: ChildProcess = spawn(cmd[0], cmd.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  // Chromium freezes once its stderr pipe fills, so it's always drained
  proc.stderr!.on('data', (d) => { stderr = (stderr + d).slice(-8192) })
  proc.stdin!.on('error', () => {})

  const pending = new Map<number, Pending>()
  const sessions = new Map<string, Session>()
  const browserListeners: Array<(method: string, params: any) => void> = []
  let nextId = 1
  let dead: Error | null = null
  let closing = false

  const fail = (match: (p: Pending) => boolean, err: Error) => {
    for (const [id, p] of pending) if (match(p)) { pending.delete(id); p.reject(err) }
  }
  const onMessage = (text: string) => {
    const m = JSON.parse(text)
    if (m.id) {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`))
      else p.resolve(m.result)
      return
    }
    if (m.sessionId) {
      const s = sessions.get(m.sessionId)
      if (!s) return
      s.onEvent(m.method, m.params)
      const q = s.waiters.get(m.method)
      if (q?.length) q.shift()!.resolve(m.params)
    } else for (const l of browserListeners) l(m.method, m.params)
  }
  let tail: Buffer[] = []
  proc.stdout!.on('data', (chunk: Buffer) => {
    let start = 0
    let i: number
    while ((i = chunk.indexOf(0, start)) !== -1) {
      tail.push(chunk.subarray(start, i))
      onMessage(Buffer.concat(tail).toString('utf8'))
      tail = []
      start = i + 1
    }
    if (start < chunk.length) tail.push(chunk.subarray(start))
  })

  const send = (method: string, params: object = {}, sessionId?: string): Promise<any> => {
    if (dead) return Promise.reject(dead)
    if (sessionId && sessions.get(sessionId)?.crashed) return Promise.reject(new PageCrashed('page crashed'))
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject, method, sessionId })
      proc.stdin!.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      proc.stdin!.write('\0')
    })
  }

  let resolveExited: (reason: string) => void
  const exited = new Promise<string>((r) => { resolveExited = r })
  proc.on('exit', (code, signal) => {
    const reason = `browser exited (code ${code}, signal ${signal}): ${stderr.trim().split('\n').slice(-3).join(' | ')}`
    dead = new BrowserExited(reason)
    fail(() => true, dead)
    for (const s of sessions.values()) for (const q of s.waiters.values()) for (const w of q.splice(0)) w.reject(dead)
    if (!closing) resolveExited(reason)
  })

  const { product } = await withTimeout(send('Browser.getVersion'), 60_000, 'launch')
  const { userAgent } = await send('Browser.getVersion')
  // Popups and crashes are reported at the browser level too
  await send('Target.setDiscoverTargets', { discover: true })
  const byTarget = new Map<string, { sessionId: string; hazard?: PageOptions['onHazard'] }>()
  browserListeners.push((method, params) => {
    if (method === 'Target.targetCreated' && params.targetInfo.openerId) {
      // Popups are ignored, then closed with their context
      byTarget.get(params.targetInfo.openerId)?.hazard?.('popup', params.targetInfo.url)
    } else if (method === 'Browser.downloadWillBegin') {
      byTarget.get(params.frameId)?.hazard?.('download', `${params.suggestedFilename} denied`)
    } else if (method === 'Target.targetCrashed') {
      const t = byTarget.get(params.targetId)
      if (t) crash(t.sessionId)
    }
  })
  const crash = (sessionId: string) => {
    const s = sessions.get(sessionId)
    if (!s || s.crashed) return
    s.crashed = true
    const err = new PageCrashed('page crashed')
    fail((p) => p.sessionId === sessionId, err)
    for (const q of s.waiters.values()) for (const w of q.splice(0)) w.reject(err)
  }

  return {
    browser: 'chromium',
    version: product,
    exited,
    async newPage(po: PageOptions): Promise<Page> {
      const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true })
      await send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId, eventsEnabled: true })
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
      let navs = 0
      // Page.navigate never replies when another main-frame navigation supersedes it, so goto watches for one
      let navWatch: ((url: string) => void) | null = null
      const session: Session = {
        crashed: false,
        waiters: new Map(),
        onEvent(method, params) {
          if (process.env.VC_TRACE && /^Page\.(frameNavigated|frameRequestedNavigation|frameStartedNavigating|navigatedWithinDocument|loadEventFired)$/.test(method)) console.error(`TRACE ${(performance.now() / 1000).toFixed(2)} ${method} ${params.frame?.parentId ? 'child' : ''} ${(params.url ?? params.frame?.url ?? '').slice(0, 110)} ${params.reason ?? params.navigationType ?? ''} ${params.disposition ?? ''}`)
          if (method === 'Page.frameNavigated' && !params.frame.parentId) { navs++; navWatch?.(params.frame.url) }
          else if (method === 'Inspector.targetCrashed') crash(sessionId)
          else if (method === 'Page.javascriptDialogOpening') {
            // alert and beforeunload are accepted, confirm and prompt dismissed, as Playwright does with no listener
            const accept = params.type === 'alert' || params.type === 'beforeunload'
            po.onHazard?.('dialog', `${params.type} ${accept ? 'accepted' : 'dismissed'}`)
            send('Page.handleJavaScriptDialog', { accept }, sessionId).catch(() => {})
          }
        },
      }
      sessions.set(sessionId, session)
      byTarget.set(targetId, { sessionId, hazard: po.onHazard })
      const once = (method: string) =>
        new Promise<any>((resolve, reject) => {
          if (dead) return reject(dead)
          if (session.crashed) return reject(new PageCrashed('page crashed'))
          const q = session.waiters.get(method) ?? []
          session.waiters.set(method, q)
          q.push({ resolve, reject })
        })
      const metrics = (v: Size) => ({ ...v, deviceScaleFactor: 1, mobile: false, screenWidth: v.width, screenHeight: v.height })
      await Promise.all([
        send('Page.enable', {}, sessionId),
        send('Inspector.enable', {}, sessionId),
        send('Page.setFontFamilies', FONTS, sessionId),
        send('Emulation.setUserAgentOverride', { userAgent: `${userAgent}${po.userAgentSuffix}`, acceptLanguage: po.locale }, sessionId),
        send('Page.addScriptToEvaluateOnNewDocument', { source: po.initScript }, sessionId),
        send('Emulation.setTimezoneOverride', { timezoneId: po.timezoneId }, sessionId),
        send('Emulation.setLocaleOverride', { locale: po.locale }, sessionId),
        send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: po.reducedMotion }, { name: 'prefers-color-scheme', value: po.colorScheme }] }, sessionId),
        send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId),
        send('Emulation.setDeviceMetricsOverride', metrics(po.viewport), sessionId),
      ])
      return {
        setViewport: async (v) => { await send('Emulation.setDeviceMetricsOverride', metrics(v), sessionId) },
        async goto(url, timeoutMs) {
          navs = 0
          const loaded = once('Page.loadEventFired')
          loaded.catch(() => {})
          const interrupted = new Promise<never>((_, reject) => {
            navWatch = (u) => { if (new URL(u).href !== new URL(url).href) reject(new Error(`navigate: interrupted by another navigation to ${u}`)) }
          })
          interrupted.catch(() => {})
          try {
            const r = await withTimeout(Promise.race([send('Page.navigate', { url }, sessionId), interrupted]), timeoutMs, 'navigate')
            if (r.errorText) throw new Error(`navigate: ${r.errorText}`)
            await withTimeout(Promise.race([loaded, interrupted]), timeoutMs, 'load')
          } finally {
            navWatch = null
          }
        },
        async evaluate(expression, timeoutMs) {
          // userGesture as Playwright's evaluate sends it, so pages behave the same under both drivers
          const r = await withTimeout(send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId), timeoutMs, 'evaluate')
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
          return r.result.value
        },
        async screenshot() {
          const { data } = await withTimeout(send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId), 30_000, 'screenshot')
          return Buffer.from(data, 'base64')
        },
        navigations: () => navs,
        async close() {
          sessions.delete(sessionId)
          byTarget.delete(targetId)
          await withTimeout(send('Target.disposeBrowserContext', { browserContextId }), 10_000, 'dispose').catch(() => {})
        },
      }
    },
    async killBrowser() {
      await new Promise((r) => execFile('docker', ['exec', o.name, 'pkill', '-9', '-f', 'chrome-headless-shell'], r))
    },
    async close() {
      closing = true
      const gone = new Promise((r) => proc.once('exit', r))
      if (!dead) send('Browser.close').catch(() => {})
      await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))])
      proc.stdin!.end()
      await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))])
      if (proc.exitCode === null) proc.kill('SIGKILL')
      await new Promise((r) => execFile('docker', ['rm', '-f', o.name], r))
    },
  }
}
