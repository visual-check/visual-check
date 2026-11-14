import { type Context, createContext, runInContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { pageInitScript, readStoryReadiness, storyReadinessExpression } from './page-script.js'

/**
 * A stand-in for Storybook's channel: it keeps the listeners `on` adds and calls them on `emit`.
 */
class FakeChannel {
  /**
   * The listeners by event name, in the order they were added.
   */
  readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  /**
   * Adds a listener for an event.
   */
  on(eventName: string, listener: (...args: unknown[]) => void): void {
    this.listeners.set(eventName, [...(this.listeners.get(eventName) ?? []), listener])
  }

  /**
   * Calls every listener of an event with these arguments.
   */
  emit(eventName: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(...args)
    }
  }
}

/**
 * The console methods the fake page has, each a mock standing for the browser's own.
 */
interface FakeConsole {
  /**
   * The browser's `console.debug`.
   */
  debug: Mock
  /**
   * The browser's `console.info`.
   */
  info: Mock
  /**
   * The browser's `console.log`.
   */
  log: Mock
  /**
   * The browser's `console.warn`.
   */
  warn: Mock
  /**
   * The browser's `console.error`.
   */
  error: Mock
}

/**
 * A fake page: a `vm` context with the few globals the page script uses, and ways to act in it as the page would.
 */
interface FakePage {
  /**
   * The browser's own console, which the page script wraps.
   */
  console: FakeConsole
  /**
   * The page's `Element` class.
   */
  Element: new () => { attachShadow: (init: { mode: string }) => object }
  /**
   * How many times anything read the page's `document`.
   */
  documentReads: () => number
  /**
   * Runs JavaScript in the page and gives back what it evaluates to.
   */
  run: (code: string) => unknown
  /**
   * Sets a global from inside the page, as the page's own scripts do.
   */
  setGlobal: (name: string, value: unknown) => void
  /**
   * Dispatches an event on the page's window.
   */
  dispatch: (event: Event) => void
  /**
   * Evaluates an expression in the page and gives back its value as the driver does: awaited and passed through JSON.
   */
  evaluate: (expression: string) => Promise<unknown>
}

/**
 * Builds a fake page with these globals already set, without the page script.
 */
function blankPage(globals: Record<string, unknown> = {}): FakePage {
  const window = new EventTarget()
  const browserConsole: FakeConsole = { debug: vi.fn(), info: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() }
  let documentReads = 0
  const Element = class Element {
    attachShadow(init: { mode: string }): object {
      return { mode: init.mode, host: this }
    }
  }
  const sandbox: Record<string, unknown> = {
    ...globals,
    console: { ...browserConsole },
    Element,
    setTimeout,
    clearTimeout,
    addEventListener: window.addEventListener.bind(window),
  }

  Object.defineProperty(sandbox, 'document', {
    get: () => {
      documentReads += 1

      return {}
    },
  })

  const context: Context = createContext(sandbox)
  const run = (code: string): unknown => runInContext(code, context)
  const setGlobal = run('(name, value) => { globalThis[name] = value }') as (name: string, value: unknown) => void

  return {
    console: { ...browserConsole },
    Element,
    documentReads: () => documentReads,
    run,
    setGlobal,
    dispatch: (event) => window.dispatchEvent(event),
    evaluate: async (expression) => JSON.parse(JSON.stringify(await run(expression))),
  }
}

/**
 * Builds a fake page with these globals already set, and runs the page script in it.
 */
function openPage(globals: Record<string, unknown> = {}): FakePage {
  const page = blankPage(globals)

  page.run(pageInitScript)

  return page
}

/**
 * Says whether a promise has settled by the time every pending callback has run.
 */
async function settledYet(promise: Promise<unknown>): Promise<boolean> {
  let settled = false

  promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await vi.advanceTimersByTimeAsync(0)

  return settled
}

/**
 * Reads what the page script recorded of the page's console messages and errors.
 */
function messages(page: FakePage): unknown {
  return JSON.parse(JSON.stringify(page.run('globalThis.__visualCheck.messages')))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the readiness wait', () => {
  it("resolves once Storybook's channel reports the story finished", async () => {
    const page = openPage()
    const channel = new FakeChannel()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)

    const readiness = page.evaluate(storyReadinessExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await readiness).toEqual({ outcome: 'finished', status: 'success' })
  })

  it('gives the status Storybook reported', async () => {
    const page = openPage()
    const channel = new FakeChannel()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)

    const readiness = page.evaluate(storyReadinessExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'error' })
    expect(await readiness).toEqual({ outcome: 'finished', status: 'error' })
  })

  it('ignores storyFinished for another story', async () => {
    const page = openPage()
    const channel = new FakeChannel()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)

    const readiness = page.evaluate(storyReadinessExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--secondary', status: 'success' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await readiness).toEqual({ outcome: 'timed-out', channel: true })
  })

  it('counts a storyFinished that came before the wait started', async () => {
    const page = openPage()
    const channel = new FakeChannel()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })

    expect(await page.evaluate(storyReadinessExpression('button--primary', 1000))).toEqual({
      outcome: 'finished',
      status: 'success',
    })
  })

  it('hooks a channel the page set before the script ran', async () => {
    const channel = new FakeChannel()
    const page = openPage({ __STORYBOOK_ADDONS_CHANNEL__: channel })
    const readiness = page.evaluate(storyReadinessExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await readiness).toEqual({ outcome: 'finished', status: 'success' })
  })

  it('hooks a channel that replaces the first one', async () => {
    const page = openPage()
    const channel = new FakeChannel()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', new FakeChannel())
    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)

    const readiness = page.evaluate(storyReadinessExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await readiness).toEqual({ outcome: 'finished', status: 'success' })
  })

  it('subscribes once to a channel set twice', () => {
    const page = openPage()
    const channel = new FakeChannel()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)
    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)
    expect(channel.listeners.get('storyFinished')).toHaveLength(1)
  })

  it("never throws into the page's assignment of a channel it can't use, and hooks a usable one after it", async () => {
    const page = openPage()
    const channel = new FakeChannel()

    page.run(`
      globalThis.__STORYBOOK_ADDONS_CHANNEL__ = { get on() { throw new Error('hostile') } }
      const { proxy, revoke } = Proxy.revocable({}, {})
      revoke()
      globalThis.__STORYBOOK_ADDONS_CHANNEL__ = proxy
    `)
    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)

    const readiness = page.evaluate(storyReadinessExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await readiness).toEqual({ outcome: 'finished', status: 'success' })
  })

  it('leaves the channel readable where Storybook set it', () => {
    const page = openPage()
    const channel = new FakeChannel()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)
    expect(page.run('globalThis.__STORYBOOK_ADDONS_CHANNEL__')).toBe(channel)
  })

  it('times out when the story never finishes, saying Storybook never set its channel', async () => {
    const page = openPage()
    const readiness = page.evaluate(storyReadinessExpression('button--primary', 1000))

    await vi.advanceTimersByTimeAsync(999)
    await vi.advanceTimersByTimeAsync(1)
    expect(await readiness).toEqual({ outcome: 'timed-out', channel: false })
  })

  it("times out on time with the browser's own timer when the story replaces setTimeout and clearTimeout", async () => {
    const page = openPage()

    page.run('globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => undefined')

    const readiness = page.evaluate(storyReadinessExpression('button--primary', 1000))

    await vi.advanceTimersByTimeAsync(999)
    expect(await settledYet(readiness)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await readiness).toEqual({ outcome: 'timed-out', channel: false })
  })

  it("clears its timer with the browser's own clearTimeout when the story replaced it", async () => {
    const page = openPage()
    const channel = new FakeChannel()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)
    page.run('globalThis.clearTimeout = () => undefined')

    const readiness = page.evaluate(storyReadinessExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    await readiness
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps waiting until the time limit has passed', async () => {
    const page = openPage()
    const channel = new FakeChannel()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)

    const readiness = page.evaluate(storyReadinessExpression('button--primary', 1000))

    await vi.advanceTimersByTimeAsync(999)
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await readiness).toEqual({ outcome: 'finished', status: 'success' })
  })

  it("says when the page script didn't run in the page", async () => {
    const page = blankPage()

    expect(await page.evaluate(storyReadinessExpression('button--primary', 1000))).toEqual({
      outcome: 'script-missing',
    })
  })
})

describe('the shadow root record', () => {
  it('records every shadow root attachShadow creates, closed ones included', () => {
    const page = openPage()
    const open = new page.Element().attachShadow({ mode: 'open' })
    const closed = new page.Element().attachShadow({ mode: 'closed' })
    const recorded = page.run('globalThis.__visualCheck.shadowRoots') as unknown[]

    expect(recorded).toHaveLength(2)
    expect(recorded[0]).toBe(open)
    expect(recorded[1]).toBe(closed)
  })

  it('returns the shadow root the browser created', () => {
    const page = openPage()
    const host = new page.Element()

    expect(host.attachShadow({ mode: 'closed' })).toEqual({ mode: 'closed', host })
  })
})

describe('the message record', () => {
  it('records console messages of every level, in order', () => {
    const page = openPage()

    page.run(`
      console.debug('a debug line')
      console.info('an info line')
      console.log('a log line', 42, { a: 1 })
      console.warn('a warning')
      console.error('an error')
    `)
    expect(messages(page)).toEqual([
      { kind: 'console.debug', text: 'a debug line' },
      { kind: 'console.info', text: 'an info line' },
      { kind: 'console.log', text: 'a log line 42 {"a":1}' },
      { kind: 'console.warn', text: 'a warning' },
      { kind: 'console.error', text: 'an error' },
    ])
  })

  it("passes console messages on to the browser's console", () => {
    const page = openPage()

    page.run("console.warn('a warning', 42)")
    expect(page.console.warn).toHaveBeenCalledWith('a warning', 42)
  })

  it('records an error by its stack', () => {
    const page = openPage()

    page.run("console.error(new Error('boom'))")
    expect(messages(page)).toEqual([{ kind: 'console.error', text: expect.stringMatching(/^Error: boom\n\s+at /) }])
  })

  it('records a value it cannot look into by its kind', () => {
    const page = openPage()

    page.run(`
      const value = new Proxy({}, { ownKeys: () => { throw new Error('no keys') } })
      console.log(value, 1n, Symbol('s'))
    `)
    expect(messages(page)).toEqual([{ kind: 'console.log', text: '[object Object] 1 Symbol(s)' }])
  })

  it("sketches an object from its own data fields, three levels deep, without running the page's getters or toJSON", () => {
    const page = openPage()

    page.run(`
      globalThis.ran = []
      console.log({
        a: 1,
        get b() { ran.push('b') },
        toJSON() { ran.push('toJSON') },
        nested: { deep: { deeper: { deepest: 1 } } },
        list: [1, 'two', null, undefined],
      })
    `)
    expect(messages(page)).toEqual([
      {
        kind: 'console.log',
        text: '{"a":1,"b":[getter],"toJSON":[function],"nested":{"deep":{"deeper":{…}}},"list":[1,"two",null,undefined]}',
      },
    ])
    expect(page.run('ran.length')).toBe(0)
  })

  it('names an object with no fields of its own by its kind', () => {
    const page = openPage()

    page.run('console.log(new Date(0), new Map(), new DataView(new ArrayBuffer(8)), {}, [])')
    expect(messages(page)).toEqual([
      { kind: 'console.log', text: '[object Date] [object Map] [object DataView] {} []' },
    ])
  })

  it('sketches a typed array by index, without listing all its keys', () => {
    const page = openPage()

    page.run(`
      const ownKeys = Reflect.ownKeys
      globalThis.listings = 0
      Reflect.ownKeys = (target) => {
        listings += 1
        return ownKeys(target)
      }
      console.log(new Uint8ClampedArray(1280 * 720 * 4))
    `)
    expect(messages(page)).toEqual([{ kind: 'console.log', text: `[${'0,'.repeat(249)}0` }])
    expect(page.run('listings')).toBe(0)
  })

  it('cuts a long string inside an object', () => {
    const page = openPage()

    page.run("console.log({ text: 'x'.repeat(10000) })")
    expect(messages(page)).toEqual([{ kind: 'console.log', text: `{"text":"${'x'.repeat(491)}` }])
  })

  it('stops looking into a large object once it has 500 characters', () => {
    const page = openPage()

    page.run(`
      globalThis.looks = 0
      const looking = { getOwnPropertyDescriptor: (target, key) => { looks += 1; return Reflect.getOwnPropertyDescriptor(target, key) } }
      console.log(new Proxy(new Array(100000).fill(1), looking))
    `)
    expect(messages(page)).toEqual([{ kind: 'console.log', text: `[${'1,'.repeat(249)}1` }])
    expect(page.run('looks')).toBeLessThan(300)
  })

  it('keeps only the last 50 messages', () => {
    const page = openPage()

    page.run("for (let index = 1; index <= 60; index += 1) { console.log('line ' + index) }")

    const kept = messages(page) as { text: string }[]

    expect(kept).toHaveLength(50)
    expect(kept[0]?.text).toBe('line 11')
    expect(kept[49]?.text).toBe('line 60')
  })

  it('cuts each message to 500 characters', () => {
    const page = openPage()

    page.run("console.log('x'.repeat(600))")
    expect(messages(page)).toEqual([{ kind: 'console.log', text: 'x'.repeat(500) }])
  })

  it('records uncaught errors', () => {
    const page = openPage()
    const error = page.run("Object.assign(new Error('boom'), { stack: 'Error: boom\\n    at story.js:1:1' })")

    page.dispatch(Object.assign(new Event('error'), { error, message: 'Uncaught Error: boom' }))
    expect(messages(page)).toEqual([{ kind: 'error', text: 'Error: boom\n    at story.js:1:1' }])
  })

  it('records an uncaught error by its message when it carries no error', () => {
    const page = openPage()

    page.dispatch(Object.assign(new Event('error'), { error: null, message: 'Script error.' }))
    expect(messages(page)).toEqual([{ kind: 'error', text: 'Script error.' }])
  })

  it('records unhandled rejections', () => {
    const page = openPage()

    page.dispatch(Object.assign(new Event('unhandledrejection'), { reason: 'nope' }))
    expect(messages(page)).toEqual([{ kind: 'unhandledrejection', text: 'nope' }])
  })
})

describe('the page script', () => {
  it("never reads the page's document, so it changes no styles", async () => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', new FakeChannel())
    page.run("console.log('a line')")
    new page.Element().attachShadow({ mode: 'open' })

    const readiness = page.evaluate(storyReadinessExpression('button--primary', 1000))

    await vi.advanceTimersByTimeAsync(1000)
    await readiness
    expect(page.documentReads()).toBe(0)
  })

  it('keeps its state out of enumeration', () => {
    const page = openPage()

    expect(page.run("Object.keys(globalThis).includes('__visualCheck')")).toBe(false)
  })

  it('does nothing when it runs again in the same page', () => {
    const page = openPage()

    page.run(pageInitScript)
    page.run("console.log('a line')")
    expect(messages(page)).toEqual([{ kind: 'console.log', text: 'a line' }])
    expect(page.console.log).toHaveBeenCalledTimes(1)
  })
})

describe('readStoryReadiness', () => {
  it('reads a finished story with its status', () => {
    expect(readStoryReadiness({ outcome: 'finished', status: 'error' })).toEqual({
      outcome: 'finished',
      status: 'error',
    })
  })

  it('reads a timeout, with whether the channel was set', () => {
    expect(readStoryReadiness({ outcome: 'timed-out', channel: false })).toEqual({
      outcome: 'timed-out',
      channel: false,
    })
  })

  it('reads a missing page script', () => {
    expect(readStoryReadiness({ outcome: 'script-missing' })).toEqual({ outcome: 'script-missing' })
  })

  it('throws on any other answer, quoting it', () => {
    expect(() => readStoryReadiness({ outcome: 'finished' })).toThrow(
      'The readiness wait in the page gave an answer visual-check doesn\'t know: {"outcome":"finished"}.',
    )
  })
})
