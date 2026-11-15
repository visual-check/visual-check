import { type Context, createContext, runInContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { optionsReadAnswer } from './options-read.fixture.js'
import { optionsReadExpression, type StoriesFile } from './options-read.js'
import {
  type AnimationKind,
  animationClasses,
  type FakeAnimation,
  type FakeAnimationOptions,
  FakeScrollTimeline,
  fakeAnimation,
  finishedAnswer,
  timedOutAnswer,
} from './preview-script.fixture.js'
import { parkedByStorybookSource, readStoryWait, storybookPageScript, storyWaitExpression } from './preview-script.js'
import { waitHookExpression } from './wait-hook.js'

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

  /**
   * How many listeners each event has.
   */
  listenerCounts(): Record<string, number> {
    return Object.fromEntries([...this.listeners].map(([eventName, listeners]) => [eventName, listeners.length]))
  }
}

/**
 * A fake page: a `vm` context with the few globals the adapter's script uses, and ways to act in it as the page would.
 */
interface FakePage {
  /**
   * The classes on the page's body. A test changes them as Storybook would.
   */
  bodyClasses: Set<string>
  /**
   * How many times anything read the page's `document`.
   */
  documentReads: () => number
  /**
   * What the page's original `appendChild` saw on each call: `this`, the node and the node's text at that moment.
   */
  appended: () => { target: unknown; node: unknown; text: unknown }[]
  /**
   * Runs JavaScript in the page and gives back what it evaluates to.
   */
  run: (code: string) => unknown
  /**
   * Sets a global from inside the page, as the page's own scripts do.
   */
  setGlobal: (name: string, value: unknown) => void
  /**
   * Evaluates an expression in the page and gives back its value as the driver does: awaited and passed through JSON.
   */
  evaluate: (expression: string) => Promise<unknown>
}

/**
 * What a fake page has before any script runs.
 */
interface FakePageOptions {
  /**
   * Globals the page already set.
   */
  globals?: Record<string, unknown>
  /**
   * Whether the page's document has a body. It has one by default.
   */
  body?: boolean
  /**
   * Whether the page has `Node` and `HTMLStyleElement`. It has them by default.
   */
  nodes?: boolean
}

/**
 * Builds a fake page without the adapter's script. Its timers and clock are the test's fake ones.
 */
function blankPage({ globals = {}, body = true, nodes = true }: FakePageOptions = {}): FakePage {
  const bodyClasses = new Set<string>()
  const pageBody = { classList: { contains: (name: string) => bodyClasses.has(name) } }
  let documentReads = 0
  const sandbox: Record<string, unknown> = { ...globals, setTimeout, clearTimeout, performance }

  Object.defineProperty(sandbox, 'document', {
    get: () => {
      documentReads += 1

      return { body: body ? pageBody : null }
    },
  })

  const context: Context = createContext(sandbox)
  const appended: { target: unknown; node: unknown; text: unknown }[] = []

  if (nodes) {
    sandbox.recordAppend = (target: unknown, node: unknown, text: unknown) => {
      appended.push({ target, node, text })
    }

    runInContext(
      `globalThis.Node = class Node {
        appendChild(node) {
          let text
          try {
            text = node.textContent
          } catch {
            text = 'unreadable'
          }
          recordAppend(this, node, text)
          if (node.fails) {
            throw new Error('append failed')
          }
          return node
        }
      }
      globalThis.HTMLStyleElement = class HTMLStyleElement extends Node {
        constructor(text) {
          super()
          this.textContent = text
        }
      }`,
      context,
    )
  }

  const run = (code: string): unknown => runInContext(code, context)
  const setGlobal = run('(name, value) => { globalThis[name] = value }') as (name: string, value: unknown) => void

  return {
    bodyClasses,
    documentReads: () => documentReads,
    appended: () => appended,
    run,
    setGlobal,
    evaluate: async (expression) => JSON.parse(JSON.stringify(await run(expression))),
  }
}

/**
 * Builds a fake page and runs the adapter's script in it.
 */
function openPage(options: FakePageOptions = {}): FakePage {
  const page = blankPage(options)

  page.run(storybookPageScript)

  return page
}

/**
 * Builds a fake page, runs the adapter's script in it and sets Storybook's channel, as the preview does.
 */
function openStorybookPage(options: FakePageOptions = {}): { page: FakePage; channel: FakeChannel } {
  const page = openPage(options)
  const channel = new FakeChannel()

  page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)

  return { page, channel }
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
 * Lets the story wait for `button--primary` run out its time limit of 1000 ms and gives its answer.
 */
async function timedOutWait(page: FakePage): Promise<unknown> {
  const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

  await vi.advanceTimersByTimeAsync(1000)

  return await wait
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the story wait', () => {
  it("resolves once Storybook's channel reports the story finished", async () => {
    const { page, channel } = openStorybookPage()
    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await wait).toEqual(finishedAnswer())
  })

  it('gives the status Storybook reported', async () => {
    const { page, channel } = openStorybookPage()
    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'error' })
    expect(await wait).toEqual(finishedAnswer({ status: 'error' }))
  })

  it("gives the status as unknown when it isn't text", async () => {
    const { page, channel } = openStorybookPage()
    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 42 })
    expect(await wait).toEqual(finishedAnswer({ status: 'unknown' }))
  })

  it('ignores storyFinished for another story', async () => {
    const { page, channel } = openStorybookPage()
    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--secondary', status: 'success' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await wait).toEqual(timedOutAnswer('preview-start'))
  })

  it('counts a storyFinished that came before the wait started', async () => {
    const { page, channel } = openStorybookPage()

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await page.evaluate(storyWaitExpression('button--primary', 1000))).toEqual(finishedAnswer())
  })

  it('hooks a channel the page set before the script ran', async () => {
    const channel = new FakeChannel()
    const page = openPage({ globals: { __STORYBOOK_ADDONS_CHANNEL__: channel } })
    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await wait).toEqual(finishedAnswer())
  })

  it('hooks a channel that replaces the first one', async () => {
    const page = openPage()
    const channel = new FakeChannel()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', new FakeChannel())
    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)

    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await wait).toEqual(finishedAnswer())
  })

  it('subscribes once to each event of a channel set twice', () => {
    const { page, channel } = openStorybookPage()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)
    expect(channel.listenerCounts()).toEqual({
      storyFinished: 1,
      storyRenderPhaseChanged: 1,
      playFunctionThrewException: 1,
      unhandledErrorsWhilePlaying: 1,
      storyThrewException: 1,
      storyErrored: 1,
    })
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

    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await wait).toEqual(finishedAnswer())
  })

  it('leaves the channel readable where Storybook set it', () => {
    const { page, channel } = openStorybookPage()

    expect(page.run('globalThis.__STORYBOOK_ADDONS_CHANNEL__')).toBe(channel)
  })

  it('keeps waiting until the time limit has passed', async () => {
    const { page, channel } = openStorybookPage()
    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    await vi.advanceTimersByTimeAsync(999)
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await wait).toEqual(finishedAnswer())
  })

  it('waits the time limit rounded up to whole ms', async () => {
    const page = openPage()
    const wait = page.evaluate(storyWaitExpression('button--primary', 999.2))

    await vi.advanceTimersByTimeAsync(999)
    expect(await settledYet(wait)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await wait).toHaveProperty('outcome', 'timed-out')
  })

  it("times out on time with the browser's own timer when the story replaces setTimeout and clearTimeout", async () => {
    const page = openPage()

    page.run('globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => undefined')

    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    await vi.advanceTimersByTimeAsync(999)
    expect(await settledYet(wait)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await wait).toEqual(timedOutAnswer('preview-start'))
  })

  it("clears its timer with the browser's own clearTimeout when the story replaced it", async () => {
    const { page, channel } = openStorybookPage()

    page.run('globalThis.clearTimeout = () => undefined')

    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    await wait
    expect(vi.getTimerCount()).toBe(0)
  })

  it('embeds a story ID with quotes and a backslash as it is', async () => {
    const storyId = 'quotes--a"b\'c\\d'
    const { page, channel } = openStorybookPage()
    const wait = page.evaluate(storyWaitExpression(storyId, 1000))

    channel.emit('storyFinished', { storyId, status: 'success' })
    expect(await wait).toEqual(finishedAnswer())
  })

  it("says when the adapter's script didn't run in the page", async () => {
    const page = blankPage()

    expect(await page.evaluate(storyWaitExpression('button--primary', 1000))).toEqual({ outcome: 'script-missing' })
  })
})

describe("Storybook's preview", () => {
  it("says the preview never started when Storybook didn't set it", async () => {
    const { page } = openStorybookPage()

    expect(await timedOutWait(page)).toEqual(timedOutAnswer('preview-start'))
  })

  it('says the preview started but never became ready when its ready() never resolves', async () => {
    const { page } = openStorybookPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', { ready: () => new Promise(() => undefined) })
    expect(await timedOutWait(page)).toEqual(timedOutAnswer('preview-ready'))
  })

  it.each([
    ['rejects', async () => Promise.reject(new Error('The index failed.'))],
    [
      'throws',
      () => {
        throw new Error('The index failed.')
      },
    ],
  ])('says the preview never became ready when its ready() %s', async (_how, ready) => {
    const { page } = openStorybookPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', { ready })
    expect(await timedOutWait(page)).toEqual(timedOutAnswer('preview-ready'))
  })

  it('says the story never finished once the preview is ready', async () => {
    const { page } = openStorybookPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', { ready: async () => undefined })
    expect(await timedOutWait(page)).toEqual(timedOutAnswer('story'))
  })

  it('counts a preview the page set before the script ran', async () => {
    const page = openPage({ globals: { __STORYBOOK_PREVIEW__: { ready: async () => undefined } } })

    expect(await timedOutWait(page)).toEqual(timedOutAnswer('story'))
  })

  it('counts a preview the page set before the script ran that never becomes ready', async () => {
    const page = openPage({ globals: { __STORYBOOK_PREVIEW__: { ready: () => new Promise(() => undefined) } } })

    expect(await timedOutWait(page)).toEqual(timedOutAnswer('preview-ready'))
  })

  it.each([
    ['an object without ready()', {}],
    ['a function', () => undefined],
  ])('counts %s as a preview that started, with nothing to wait for', async (_what, preview) => {
    const { page } = openStorybookPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', preview)
    expect(await timedOutWait(page)).toEqual(timedOutAnswer('story'))
  })

  /**
   * A preview whose `ready()` never resolves.
   */
  const neverReady = { ready: () => new Promise(() => undefined) }

  it.each([
    ['one without ready() replaces one that never becomes ready', neverReady, {}, 'story'],
    ['one that never becomes ready replaces one without ready()', {}, neverReady, 'preview-ready'],
  ])('waits only for the latest preview when %s', async (_what, first, replacement, step) => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', first)
    page.setGlobal('__STORYBOOK_PREVIEW__', replacement)
    expect(await timedOutWait(page)).toEqual(timedOutAnswer(step))
  })

  it('goes back to the state of a preview set again', async () => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', neverReady)
    page.setGlobal('__STORYBOOK_PREVIEW__', {})
    page.setGlobal('__STORYBOOK_PREVIEW__', neverReady)
    expect(await timedOutWait(page)).toEqual(timedOutAnswer('preview-ready'))
  })

  it("calls ready() once, after the page's assignment rather than during it", async () => {
    const page = openPage()
    const ready = vi.fn(async () => undefined)
    const preview = { ready }

    page.setGlobal('__STORYBOOK_PREVIEW__', preview)
    page.setGlobal('__STORYBOOK_PREVIEW__', preview)
    expect(ready).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('leaves the preview readable where Storybook set it, so Storybook keeps the first one it made', () => {
    const page = openPage()

    page.run(`
      globalThis.first = { ready: async () => undefined }
      globalThis.__STORYBOOK_PREVIEW__ = globalThis.__STORYBOOK_PREVIEW__ || first
      globalThis.__STORYBOOK_PREVIEW__ = globalThis.__STORYBOOK_PREVIEW__ || {}
    `)
    expect(page.run('globalThis.__STORYBOOK_PREVIEW__ === first')).toBe(true)
  })

  it("never throws into the page's assignment of a preview it can't use", () => {
    const page = openPage()

    expect(() =>
      page.run(`
        globalThis.__STORYBOOK_PREVIEW__ = { get ready() { throw new Error('hostile') } }
        const { proxy, revoke } = Proxy.revocable({}, {})
        revoke()
        globalThis.__STORYBOOK_PREVIEW__ = proxy
      `),
    ).not.toThrow()
  })
})

describe('the render steps', () => {
  it('give the time between the completing and completed steps of the story', async () => {
    const { page, channel } = openStorybookPage()
    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyRenderPhaseChanged', { newPhase: 'completing', renderId: 1, storyId: 'button--primary' })
    vi.advanceTimersByTime(80)
    channel.emit('storyRenderPhaseChanged', { newPhase: 'completed', renderId: 1, storyId: 'button--primary' })
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await wait).toEqual(finishedAnswer({ completingMs: 80 }))
  })

  it('give no time when only one of those steps came', async () => {
    const { page, channel } = openStorybookPage()
    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyRenderPhaseChanged', { newPhase: 'completing', renderId: 1, storyId: 'button--primary' })
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await wait).toEqual(finishedAnswer())
  })

  it('give no time while a render that started again has yet to complete', async () => {
    const { page, channel } = openStorybookPage()

    for (const newPhase of ['completing', 'completed', 'completing']) {
      channel.emit('storyRenderPhaseChanged', { newPhase, renderId: 1, storyId: 'button--primary' })
    }

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await page.evaluate(storyWaitExpression('button--primary', 1000))).toEqual(finishedAnswer())
  })

  it("keep the browser's own clock when the story replaces performance", async () => {
    const { page, channel } = openStorybookPage()

    page.run('globalThis.performance = { now: () => 0 }')

    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyRenderPhaseChanged', { newPhase: 'completing', renderId: 1, storyId: 'button--primary' })
    vi.advanceTimersByTime(80)
    channel.emit('storyRenderPhaseChanged', { newPhase: 'completed', renderId: 1, storyId: 'button--primary' })
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await wait).toEqual(finishedAnswer({ completingMs: 80 }))
  })

  it("of another story don't count", async () => {
    const { page, channel } = openStorybookPage()
    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyRenderPhaseChanged', { newPhase: 'completing', renderId: 1, storyId: 'button--secondary' })
    vi.advanceTimersByTime(80)
    channel.emit('storyRenderPhaseChanged', { newPhase: 'completed', renderId: 1, storyId: 'button--secondary' })
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await wait).toEqual(finishedAnswer())
  })

  it("name the story's last step when it times out", async () => {
    const { page, channel } = openStorybookPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', { ready: async () => undefined })
    for (const newPhase of ['preparing', 'loading', 'rendering', 'playing']) {
      channel.emit('storyRenderPhaseChanged', { newPhase, renderId: 1, storyId: 'button--primary' })
    }

    channel.emit('storyRenderPhaseChanged', { newPhase: 'loading', renderId: 2, storyId: 'button--secondary' })
    expect(await timedOutWait(page)).toEqual(timedOutAnswer('story', 'playing'))
  })
})

describe('the error events', () => {
  it('are each recorded in the order they came, and given with the finished story', async () => {
    const { page, channel } = openStorybookPage()

    channel.emit('storyErrored', { title: 'No component', description: 'The story has no component.' })
    channel.emit('playFunctionThrewException', { name: 'Error', message: 'boom', stack: 'Error: boom\n    at play' })

    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyThrewException', { name: 'TypeError', message: 'x is undefined', stack: 'TypeError: x' })
    channel.emit('unhandledErrorsWhilePlaying', [
      { name: 'Error', message: 'one' },
      { name: 'RangeError', message: 'two' },
    ])
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'error' })
    expect(await wait).toEqual(
      finishedAnswer({
        status: 'error',
        errors: [
          { event: 'storyErrored', text: 'No component: The story has no component.' },
          { event: 'playFunctionThrewException', text: 'Error: boom' },
          { event: 'storyThrewException', text: 'TypeError: x is undefined' },
          { event: 'unhandledErrorsWhilePlaying', text: 'Error: one; RangeError: two' },
        ],
      }),
    )
  })

  it('describe an error without a name by its message, and a payload of another shape as text', async () => {
    const { page, channel } = openStorybookPage()

    channel.emit('playFunctionThrewException', { message: 'boom' })
    channel.emit('storyThrewException', 'a thrown string')
    channel.emit('storyErrored', 42)
    channel.emit('unhandledErrorsWhilePlaying', [{ message: 'one' }, 'two'])
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await page.evaluate(storyWaitExpression('button--primary', 1000))).toHaveProperty('errors', [
      { event: 'playFunctionThrewException', text: 'boom' },
      { event: 'storyThrewException', text: 'a thrown string' },
      { event: 'storyErrored', text: '42' },
      { event: 'unhandledErrorsWhilePlaying', text: 'one; two' },
    ])
  })

  it('describe a payload with an empty field by the other one, and one with both empty as no text', async () => {
    const { page, channel } = openStorybookPage()

    channel.emit('playFunctionThrewException', { name: 'Error', message: '' })
    channel.emit('storyThrewException', { name: '', message: '  ' })
    channel.emit('storyErrored', { title: '', description: 'The story has no component.' })
    channel.emit('unhandledErrorsWhilePlaying', [{ message: '' }, { name: 'RangeError', message: '' }])
    channel.emit('unhandledErrorsWhilePlaying', [{ message: '' }])
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await page.evaluate(storyWaitExpression('button--primary', 1000))).toHaveProperty('errors', [
      { event: 'playFunctionThrewException', text: 'Error' },
      { event: 'storyThrewException', text: '' },
      { event: 'storyErrored', text: 'The story has no component.' },
      { event: 'unhandledErrorsWhilePlaying', text: 'RangeError' },
      { event: 'unhandledErrorsWhilePlaying', text: '' },
    ])
  })

  it('describe each payload on one line', async () => {
    const { page, channel } = openStorybookPage()

    channel.emit('playFunctionThrewException', {
      name: 'TestingLibraryElementError',
      message: 'Unable to find a button\n\n  <div>\n    <p>Hi</p>\n  </div>',
    })
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await page.evaluate(storyWaitExpression('button--primary', 1000))).toHaveProperty('errors', [
      {
        event: 'playFunctionThrewException',
        text: 'TestingLibraryElementError: Unable to find a button <div> <p>Hi</p> </div>',
      },
    ])
  })

  it('are kept up to the first 10', async () => {
    const { page, channel } = openStorybookPage()

    for (let index = 1; index <= 12; index += 1) {
      channel.emit('storyThrewException', { name: 'Error', message: `error ${index}` })
    }

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })

    const answer = (await page.evaluate(storyWaitExpression('button--primary', 1000))) as { errors: { text: string }[] }

    expect(answer.errors).toHaveLength(10)
    expect(answer.errors[0]?.text).toBe('Error: error 1')
    expect(answer.errors[9]?.text).toBe('Error: error 10')
  })

  it('are each described in up to 500 characters', async () => {
    const { page, channel } = openStorybookPage()

    channel.emit('storyThrewException', { message: 'x'.repeat(600) })
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await page.evaluate(storyWaitExpression('button--primary', 1000))).toHaveProperty('errors', [
      { event: 'storyThrewException', text: 'x'.repeat(500) },
    ])
  })

  it("never throw into Storybook's channel for a payload that can't be read", async () => {
    const { page, channel } = openStorybookPage()
    const payloads = page.run(`
      const { proxy, revoke } = Proxy.revocable({}, {})
      revoke()
      ;[{ get message() { throw new Error('hostile') } }, proxy, Object.create(null)]
    `) as unknown[]

    for (const payload of payloads) {
      expect(() => channel.emit('storyThrewException', payload)).not.toThrow()
    }

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await page.evaluate(storyWaitExpression('button--primary', 1000))).toHaveProperty('errors', [
      { event: 'storyThrewException', text: '[object Object]' },
      { event: 'storyThrewException', text: '[unprintable]' },
      { event: 'storyThrewException', text: '[unprintable]' },
    ])
  })
})

describe('the error display', () => {
  it("is read from the body's class as the story finishes", async () => {
    const { page, channel } = openStorybookPage()
    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    page.bodyClasses.add('sb-show-errordisplay')
    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    page.bodyClasses.delete('sb-show-errordisplay')
    expect(await wait).toEqual(finishedAnswer({ errorDisplay: true }))
  })

  it('is read when the wait starts, for a story that finished before it', async () => {
    const { page, channel } = openStorybookPage()

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    page.bodyClasses.add('sb-show-errordisplay')
    expect(await page.evaluate(storyWaitExpression('button--primary', 1000))).toEqual(
      finishedAnswer({ errorDisplay: true }),
    )
  })

  it("isn't shown on a page without a body", async () => {
    const { page, channel } = openStorybookPage({ body: false })

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await page.evaluate(storyWaitExpression('button--primary', 1000))).toEqual(finishedAnswer())
  })
})

/**
 * A stand-in for Storybook's preview that is ready at once. Its `loadStory` notes each story it's asked for and loads
 * it as `loads` says, or else at once, with the story's ID as its options.
 */
class FakePreview {
  /**
   * The IDs of the stories `loadStory` was asked for, in order.
   */
  readonly requested: string[] = []

  /**
   * How each story loads, by its ID.
   */
  readonly loads: Record<string, () => Promise<unknown>>

  /**
   * Builds a preview that loads the stories in `loads` as it says.
   */
  constructor(loads: Record<string, () => Promise<unknown>> = {}) {
    this.loads = loads
  }

  /**
   * Resolves at once, as a preview that has started does.
   */
  ready(): Promise<void> {
    return Promise.resolve()
  }

  /**
   * Notes the story and loads it as `loads` says.
   */
  loadStory({ storyId }: { storyId: string }): Promise<unknown> {
    this.requested.push(storyId)

    const load = this.loads[storyId]

    return load === undefined ? Promise.resolve({ id: storyId, parameters: { visualCheck: storyId } }) : load()
  }
}

/**
 * A stories file with one story.
 */
const buttonFile: StoriesFile = { importPath: './button.stories.tsx', storyIds: ['button--primary'] }

/**
 * A stories file with two stories.
 */
const cardFile: StoriesFile = { importPath: './card.stories.tsx', storyIds: ['card--default', 'card--wide'] }

/**
 * Reads the options of these stories files in the page with a time limit of 1000 ms, as the driver does, and gives
 * the page's answer.
 */
function readOptions(page: FakePage, files: readonly StoriesFile[]): Promise<unknown> {
  return page.evaluate(optionsReadExpression(files, 1000))
}

/**
 * What the page answers for stories files whose stories loaded as `FakePreview` loads them by default: each with its
 * own ID as its options.
 */
function loadedAnswer(...files: StoriesFile[]): Record<string, unknown> {
  return optionsReadAnswer(
    files.map(({ importPath, storyIds }) => ({
      importPath,
      stories: storyIds.map((id) => ({ id, options: id })),
    })),
  )
}

/**
 * A promise that resolves with `value` after `ms` ms of the test's fake timers.
 */
function later(ms: number, value: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms)
  })
}

/**
 * A promise that rejects with `error` after `ms` ms of the test's fake timers.
 */
function laterRejection(ms: number, error: unknown): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(error), ms)
  })
}

/**
 * A promise that never settles.
 */
function never(): Promise<never> {
  return new Promise(() => undefined)
}

describe('the options read', () => {
  it('reads the options of every story of each stories file, in the order given', async () => {
    const page = openPage()
    const preview = new FakePreview()

    page.setGlobal('__STORYBOOK_PREVIEW__', preview)
    expect(await readOptions(page, [cardFile, buttonFile])).toEqual(loadedAnswer(cardFile, buttonFile))
    expect(preview.requested).toEqual(['card--default', 'card--wide', 'button--primary'])
  })

  it('reads no files when given none', async () => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', new FakePreview())
    expect(await readOptions(page, [])).toEqual(optionsReadAnswer([]))
  })

  it('gives a file without story IDs as loaded, with no stories', async () => {
    const page = openPage()
    const file = { importPath: './empty.stories.tsx', storyIds: [] }

    page.setGlobal('__STORYBOOK_PREVIEW__', new FakePreview())
    expect(await readOptions(page, [file])).toEqual(optionsReadAnswer([{ importPath: file.importPath, stories: [] }]))
  })

  it('waits for a preview Storybook sets after the read started', async () => {
    const page = openPage()
    const read = readOptions(page, [buttonFile])

    await vi.advanceTimersByTimeAsync(500)
    expect(await settledYet(read)).toBe(false)
    page.setGlobal('__STORYBOOK_PREVIEW__', new FakePreview())
    await vi.advanceTimersByTimeAsync(100)
    expect(await read).toEqual(loadedAnswer(buttonFile))
  })

  it('waits for the preview to become ready before it loads a story', async () => {
    const page = openPage()
    const preview = new FakePreview()

    preview.ready = () => later(500, undefined).then(() => undefined)
    page.setGlobal('__STORYBOOK_PREVIEW__', preview)

    const read = readOptions(page, [buttonFile])

    await vi.advanceTimersByTimeAsync(400)
    expect(preview.requested).toEqual([])
    await vi.advanceTimersByTimeAsync(200)
    expect(await read).toEqual(loadedAnswer(buttonFile))
  })

  it('times out in the preview-start step on time when Storybook never set the preview', async () => {
    const page = openPage()
    const read = readOptions(page, [buttonFile])

    await vi.advanceTimersByTimeAsync(999)
    expect(await settledYet(read)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await read).toEqual({ outcome: 'timed-out', step: 'preview-start' })
  })

  it('times out in the preview-ready step when the preview never becomes ready', async () => {
    const page = openPage()
    const read = readOptions(page, [buttonFile])

    page.setGlobal('__STORYBOOK_PREVIEW__', { ready: never, loadStory: never })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await read).toEqual({ outcome: 'timed-out', step: 'preview-ready' })
  })

  it.each([
    ['rejects', async () => Promise.reject(new Error('The index failed.'))],
    [
      'throws',
      () => {
        throw new Error('The index failed.')
      },
    ],
  ])('says the preview failed when its ready() %s', async (_how, ready) => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', { ready, loadStory: never })
    expect(await readOptions(page, [buttonFile])).toEqual({
      outcome: 'preview-failed',
      message: 'Error: The index failed.',
    })
  })

  it('says the preview failed as soon as its ready() rejects, without waiting out the time limit', async () => {
    const page = openPage()
    const read = readOptions(page, [buttonFile])

    page.setGlobal('__STORYBOOK_PREVIEW__', { ready: () => laterRejection(300, new Error('late')), loadStory: never })
    await vi.advanceTimersByTimeAsync(400)
    expect(await settledYet(read)).toBe(true)
    expect(await read).toEqual({ outcome: 'preview-failed', message: 'Error: late' })
  })

  it.each([
    [
      'an error on several lines, on one line',
      new SyntaxError('Unexpected token\n  in ./button.stories.tsx'),
      'SyntaxError: Unexpected token in ./button.stories.tsx',
    ],
    ['a long error, in 500 characters', new Error('x'.repeat(600)), `Error: ${'x'.repeat(493)}`],
    ['a value that is not an error, as text', 'no index', 'no index'],
  ])("describes the preview's failure as %s", async (_what, error, message) => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', { ready: async () => Promise.reject(error), loadStory: never })
    expect(await readOptions(page, [buttonFile])).toEqual({ outcome: 'preview-failed', message })
  })

  it("describes a preview's failure it can't read as unprintable", async () => {
    const page = openPage()

    page.run(`
      const { proxy, revoke } = Proxy.revocable({}, {})
      revoke()
      globalThis.__STORYBOOK_PREVIEW__ = { ready: async () => Promise.reject(proxy), loadStory: async () => ({}) }
    `)
    expect(await readOptions(page, [buttonFile])).toEqual({ outcome: 'preview-failed', message: '[unprintable]' })
  })

  it('reads the latest preview, not one it replaced', async () => {
    const page = openPage()
    const first = new FakePreview()
    const latest = new FakePreview()

    page.setGlobal('__STORYBOOK_PREVIEW__', first)
    page.setGlobal('__STORYBOOK_PREVIEW__', latest)
    expect(await readOptions(page, [buttonFile])).toEqual(loadedAnswer(buttonFile))
    expect(first.requested).toEqual([])
    expect(latest.requested).toEqual(['button--primary'])
  })

  it('says the latest preview failed even when one it replaced is ready', async () => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', new FakePreview())
    page.setGlobal('__STORYBOOK_PREVIEW__', {
      ready: async () => Promise.reject(new Error('The index failed.')),
      loadStory: never,
    })
    expect(await readOptions(page, [buttonFile])).toEqual({
      outcome: 'preview-failed',
      message: 'Error: The index failed.',
    })
  })

  it('reads a preview that replaces another while the read waits', async () => {
    const page = openPage()
    const first = { ready: never, loadStory: vi.fn(never) }
    const read = readOptions(page, [buttonFile])

    page.setGlobal('__STORYBOOK_PREVIEW__', first)
    await vi.advanceTimersByTimeAsync(300)
    page.setGlobal('__STORYBOOK_PREVIEW__', new FakePreview())
    expect(await read).toEqual(loadedAnswer(buttonFile))
    expect(first.loadStory).not.toHaveBeenCalled()
  })

  it('reads the options once the preview becomes ready after a read that timed out', async () => {
    const page = openPage()
    const preview = new FakePreview()

    preview.ready = () => later(1500, undefined).then(() => undefined)
    page.setGlobal('__STORYBOOK_PREVIEW__', preview)

    const timedOut = readOptions(page, [buttonFile])

    await vi.advanceTimersByTimeAsync(1000)
    expect(await timedOut).toEqual({ outcome: 'timed-out', step: 'preview-ready' })
    await vi.advanceTimersByTimeAsync(500)
    expect(await readOptions(page, [buttonFile])).toEqual(loadedAnswer(buttonFile))
  })

  it('loads a story ID given twice twice, and gives it twice, in order', async () => {
    const page = openPage()
    const preview = new FakePreview()
    const file = { importPath: buttonFile.importPath, storyIds: ['button--primary', 'button--primary'] }

    page.setGlobal('__STORYBOOK_PREVIEW__', preview)
    expect(await readOptions(page, [file])).toEqual(loadedAnswer(file))
    expect(preview.requested).toEqual(['button--primary', 'button--primary'])
  })

  it.each<[string, object]>([
    ['an object without ready() or loadStory()', {}],
    ['a preview without loadStory()', { ready: async () => undefined }],
    [
      'a preview whose loadStory() cannot be read',
      {
        ready: async () => undefined,
        get loadStory() {
          throw new Error('hostile')
        },
      },
    ],
  ])('says the preview is unsupported for %s', async (_what, preview) => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', preview)
    expect(await readOptions(page, [buttonFile])).toEqual({ outcome: 'unsupported' })
  })

  it('loads every stories file at once, so a slow file delays no other', async () => {
    const page = openPage()
    const preview = new FakePreview({
      'card--default': () => later(500, { parameters: { visualCheck: 'card--default' } }),
    })

    page.setGlobal('__STORYBOOK_PREVIEW__', preview)

    const read = readOptions(page, [cardFile, buttonFile])

    await vi.advanceTimersByTimeAsync(0)
    expect(preview.requested).toEqual(['card--default', 'card--wide', 'button--primary'])
    await vi.advanceTimersByTimeAsync(500)
    expect(await read).toEqual(loadedAnswer(cardFile, buttonFile))
  })

  it('makes a file failed with its first rejection on one line, and leaves the other files loaded', async () => {
    const page = openPage()

    page.setGlobal(
      '__STORYBOOK_PREVIEW__',
      new FakePreview({
        'card--default': () => laterRejection(100, new Error('later')),
        'card--wide': async () => Promise.reject(new SyntaxError('Unexpected token\n  in ./card.stories.tsx')),
      }),
    )

    const read = readOptions(page, [cardFile, buttonFile])

    await vi.advanceTimersByTimeAsync(100)
    expect(await read).toEqual(
      optionsReadAnswer([
        {
          importPath: cardFile.importPath,
          outcome: 'failed',
          message: 'SyntaxError: Unexpected token in ./card.stories.tsx',
        },
        { importPath: buttonFile.importPath, stories: [{ id: 'button--primary', options: 'button--primary' }] },
      ]),
    )
  })

  it('makes a file failed when loadStory() throws', async () => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', {
      ready: async () => undefined,
      loadStory: () => {
        throw new TypeError('Cannot read the index')
      },
    })
    expect(await readOptions(page, [buttonFile])).toEqual(
      optionsReadAnswer([
        { importPath: buttonFile.importPath, outcome: 'failed', message: 'TypeError: Cannot read the index' },
      ]),
    )
  })

  it('makes a file timed-out when one of its stories never loads, and leaves the other files loaded', async () => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', new FakePreview({ 'card--wide': never }))

    const read = readOptions(page, [cardFile, buttonFile])

    await vi.advanceTimersByTimeAsync(999)
    expect(await settledYet(read)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await read).toEqual(
      optionsReadAnswer([
        { importPath: cardFile.importPath, outcome: 'timed-out' },
        { importPath: buttonFile.importPath, stories: [{ id: 'button--primary', options: 'button--primary' }] },
      ]),
    )
  })

  it("counts each file's time limit from when its stories start loading", async () => {
    const page = openPage()
    const read = readOptions(page, [buttonFile])

    await vi.advanceTimersByTimeAsync(400)
    page.setGlobal('__STORYBOOK_PREVIEW__', new FakePreview({ 'button--primary': never }))
    await vi.advanceTimersByTimeAsync(900)
    expect(await settledYet(read)).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(await read).toEqual(optionsReadAnswer([{ importPath: buttonFile.importPath, outcome: 'timed-out' }]))
  })

  it('clears the time limits of files that loaded', async () => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', new FakePreview())
    await readOptions(page, [cardFile, buttonFile])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps the browser's own timers when the page replaces setTimeout and clearTimeout", async () => {
    const page = openPage()

    page.run('globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => undefined')

    const read = readOptions(page, [buttonFile])

    await vi.advanceTimersByTimeAsync(300)
    page.setGlobal('__STORYBOOK_PREVIEW__', new FakePreview({ 'button--primary': never }))
    await vi.advanceTimersByTimeAsync(1100)
    expect(await read).toEqual(optionsReadAnswer([{ importPath: buttonFile.importPath, outcome: 'timed-out' }]))
  })

  it('loads the stories again on each read, caching nothing', async () => {
    const page = openPage()
    const preview = new FakePreview()

    page.setGlobal('__STORYBOOK_PREVIEW__', preview)
    await readOptions(page, [buttonFile])
    await readOptions(page, [buttonFile])
    expect(preview.requested).toEqual(['button--primary', 'button--primary'])
  })

  it('touches nothing on the preview but ready() and loadStory(), so extract() never runs', async () => {
    const page = openPage()
    const touched = new Set<PropertyKey>()
    const extract = vi.fn()
    const preview = new Proxy(
      { ready: async () => undefined, loadStory: async () => ({ parameters: {} }), extract },
      {
        get: (target, key) => {
          touched.add(key)

          return Reflect.get(target, key)
        },
      },
    )

    page.setGlobal('__STORYBOOK_PREVIEW__', preview)
    await readOptions(page, [cardFile])
    expect([...touched]).toEqual(['ready', 'loadStory'])
    expect(extract).not.toHaveBeenCalled()
  })

  it("says when the adapter's script didn't run in the page", async () => {
    const page = blankPage()

    expect(await readOptions(page, [buttonFile])).toEqual({ outcome: 'script-missing' })
  })
})

/**
 * Reads the options of one story whose `loadStory` resolves with what `story` evaluates to in the page, and gives them
 * as the page encoded them. The value is built in the page, so its objects have the page's own prototypes.
 */
async function encodedStoryInPage(story: string): Promise<unknown> {
  const page = openPage()

  page.run(`globalThis.__STORYBOOK_PREVIEW__ = { loadStory: async () => (${story}) }`)

  const answer = (await readOptions(page, [buttonFile])) as { files: { stories: { options: unknown }[] }[] }

  return answer.files[0]?.stories[0]?.options
}

describe("each story's options", () => {
  it("are the story's parameters.visualCheck, encoded, with the page's own plain objects as plain", async () => {
    expect(
      await encodedStoryInPage(
        '{ parameters: { visualCheck: { viewport: { width: 320 }, wait: async () => undefined } } }',
      ),
    ).toEqual({
      kind: 'object',
      entries: [
        ['viewport', { kind: 'object', entries: [['width', { kind: 'number', value: 320 }]] }],
        ['wait', { kind: 'function' }],
      ],
    })
  })

  it.each([
    ['a story without parameters', '{}'],
    ['a story that is not an object', 'undefined'],
    ['parameters without visualCheck', '{ parameters: {} }'],
  ])('are encoded as undefined for %s', async (_what, story) => {
    expect(await encodedStoryInPage(story)).toEqual({ kind: 'undefined' })
  })

  it('are encoded as Unreadable for a story whose parameters cannot be read', async () => {
    expect(await encodedStoryInPage("{ get parameters() { throw new Error('hostile') } }")).toEqual({
      kind: 'instance',
      name: 'Unreadable',
    })
  })

  it('are each encoded within a limit of values of their own', async () => {
    const page = openPage()

    page.run(
      'globalThis.__STORYBOOK_PREVIEW__ = { loadStory: async () => ({ parameters: { visualCheck: new Array(9999).fill(0) } }) }',
    )

    const answer = (await readOptions(page, [cardFile])) as {
      files: { stories: { options: { kind: string; items: unknown[] } }[] }[]
    }

    expect(answer.files[0]?.stories.map(({ options }) => [options.kind, options.items.length])).toEqual([
      ['array', 9999],
      ['array', 9999],
    ])
  })
})

/**
 * The element a fake render draws its story in.
 */
const canvas = { tagName: 'DIV', id: 'storybook-root' }

/**
 * Builds a stand-in for the render of `button--primary` in the `story` view mode that Storybook's preview keeps as
 * `currentRender`. Its story's merged `parameters.visualCheck` is `options`, and its `storyContext()` gives the story's
 * ID, parameters and args. `fields` replaces any of its fields, getters included.
 */
function storyRender(options: unknown, fields: Record<string, unknown> = {}): Record<string, unknown> {
  const parameters = { visualCheck: options }
  const render = {
    id: 'button--primary',
    viewMode: 'story',
    story: { id: 'button--primary', parameters },
    canvasElement: canvas,
    storyContext: () => ({ id: 'button--primary', parameters, args: { label: 'Primary' } }),
  }

  // Copied by descriptor, so a getter in `fields` stays a getter.
  return Object.defineProperties(render, Object.getOwnPropertyDescriptors(fields))
}

/**
 * Gives the page a navigator with `clipboard`, as a browser has in a secure context, and gives the navigator back.
 */
function withClipboard(page: FakePage, clipboard: unknown = { readText: async () => '' }): { clipboard: unknown } {
  const pageNavigator = { clipboard }

  page.setGlobal('navigator', pageNavigator)

  return pageNavigator
}

/**
 * Replaces the navigator's clipboard with a stub, as `userEvent.setup()` does, and gives a user that names the
 * clipboard it saw.
 */
function stubClipboard(pageNavigator: { clipboard: unknown }): { clipboard: string } {
  Object.defineProperty(pageNavigator, 'clipboard', { configurable: true, get: () => 'stub' })

  return { clipboard: String(pageNavigator.clipboard) }
}

/**
 * Builds a fake page with the adapter's script, whose Storybook preview shows `render`.
 */
function pageShowing(render: unknown): FakePage {
  const page = openPage()

  page.setGlobal('__STORYBOOK_PREVIEW__', { currentRender: render })

  return page
}

/**
 * Runs the wait hook of `button--primary` in the page with a time limit of 1000 ms, as the driver does, and gives the
 * page's answer.
 */
function runWaitHook(page: FakePage): Promise<unknown> {
  return page.evaluate(waitHookExpression('button--primary', 1000))
}

describe("the story's wait hook", () => {
  it.each([
    ['a story without options', undefined],
    ['options without a wait hook', {}],
    ['a wait hook turned off with null', { wait: null }],
    ['a wait hook that is not a function', { wait: 'soon' }],
  ])('answers none for %s, without building its context', async (_what, options) => {
    const storyContext = vi.fn(() => ({}))

    expect(await runWaitHook(pageShowing(storyRender(options, { storyContext })))).toEqual({ outcome: 'none' })
    expect(storyContext).not.toHaveBeenCalled()
  })

  it("runs the current render's story's wait hook once, with the story's context, view mode and canvas element", async () => {
    const wait = vi.fn()

    expect(await runWaitHook(pageShowing(storyRender({ wait })))).toEqual({ outcome: 'done' })
    expect(wait.mock.calls).toEqual([
      [
        {
          id: 'button--primary',
          parameters: { visualCheck: { wait } },
          args: { label: 'Primary' },
          viewMode: 'story',
          canvasElement: canvas,
        },
      ],
    ])
    expect(Object.keys(wait.mock.calls[0]?.[0])).toEqual(['id', 'parameters', 'args', 'viewMode', 'canvasElement'])
    expect(wait.mock.calls[0]?.[0].canvasElement).toBe(canvas)
  })

  it("gives the wait hook canvas queries and a userEvent instance from Storybook's test module", async () => {
    const queries = { getByRole: () => undefined }
    const user = { click: async () => undefined }
    const within = vi.fn(() => queries)
    const wait = vi.fn()
    const page = pageShowing(storyRender({ wait }))

    withClipboard(page)
    page.setGlobal('__STORYBOOK_MODULE_TEST__', { within, userEvent: { setup: () => user } })
    expect(await runWaitHook(page)).toEqual({ outcome: 'done' })

    const context = wait.mock.calls[0]?.[0]

    expect(Object.keys(context)).toEqual([
      'id',
      'parameters',
      'args',
      'viewMode',
      'canvasElement',
      'canvas',
      'userEvent',
    ])
    expect(context.canvas).toBe(queries)
    expect(within.mock.calls).toEqual([[canvas]])
    expect(context.userEvent).toBe(user)
  })

  it('sets userEvent up only when it is first read, and only once', async () => {
    const setup = vi.fn(() => ({ click: async () => undefined }))
    const wait = vi.fn()
    const page = pageShowing(storyRender({ wait }))

    withClipboard(page)
    page.setGlobal('__STORYBOOK_MODULE_TEST__', { userEvent: { setup } })
    expect(await runWaitHook(page)).toEqual({ outcome: 'done' })
    expect(setup).not.toHaveBeenCalled()

    const context = wait.mock.calls[0]?.[0]

    expect(context.userEvent).toBe(context.userEvent)
    expect(setup).toHaveBeenCalledOnce()
  })

  it("puts the page's own clipboard back once userEvent.setup() stubbed it", async () => {
    const clipboard = { readText: async () => 'real' }
    const users: unknown[] = []
    const page = pageShowing(storyRender({ wait: (context: Record<string, unknown>) => users.push(context.userEvent) }))
    const pageNavigator = withClipboard(page, clipboard)

    page.setGlobal('__STORYBOOK_MODULE_TEST__', { userEvent: { setup: () => stubClipboard(pageNavigator) } })
    expect(await runWaitHook(page)).toEqual({ outcome: 'done' })
    expect(users).toEqual([{ clipboard: 'stub' }])
    expect(pageNavigator.clipboard).toBe(clipboard)
  })

  it('lets a userEvent.setup() that throws throw inside the hook that reads userEvent, and puts the clipboard back', async () => {
    const clipboard = { readText: async () => 'real' }
    const wait = (context: Record<string, unknown>): unknown => context.userEvent
    const page = pageShowing(storyRender({ wait }))
    const pageNavigator = withClipboard(page, clipboard)
    const setup = (): never => {
      stubClipboard(pageNavigator)

      throw new Error('No user.')
    }

    page.setGlobal('__STORYBOOK_MODULE_TEST__', { userEvent: { setup } })
    expect(await runWaitHook(page)).toEqual({ outcome: 'threw', text: 'Error: No user.' })
    expect(pageNavigator.clipboard).toBe(clipboard)
  })

  it.each([
    ['without a navigator', undefined],
    ['whose navigator has no clipboard', {}],
  ])('leaves userEvent out on a page %s, as Storybook does', async (_what, pageNavigator) => {
    const setup = vi.fn()
    const wait = vi.fn()
    const page = pageShowing(storyRender({ wait }))

    page.setGlobal('navigator', pageNavigator)
    page.setGlobal('__STORYBOOK_MODULE_TEST__', { within: () => ({}), userEvent: { setup } })
    expect(await runWaitHook(page)).toEqual({ outcome: 'done' })
    expect(Object.keys(wait.mock.calls[0]?.[0])).toEqual([
      'id',
      'parameters',
      'args',
      'viewMode',
      'canvasElement',
      'canvas',
    ])
    expect(setup).not.toHaveBeenCalled()
  })

  it.each([
    ['without within or userEvent', '{}'],
    ['whose within and userEvent.setup are not functions', '{ within: 1, userEvent: { setup: 1 } }'],
    ['without userEvent.setup', '{ userEvent: {} }'],
    [
      "whose helpers can't be read",
      "{ get within() { throw new Error('hostile') }, get userEvent() { throw new Error('hostile') } }",
    ],
    ['that is not an object', "'storybook/test'"],
  ])('leaves canvas and userEvent out with a test module %s', async (_what, testModule) => {
    const wait = vi.fn()
    const page = pageShowing(storyRender({ wait }))

    withClipboard(page)
    page.run(`globalThis.__STORYBOOK_MODULE_TEST__ = ${testModule}`)
    expect(await runWaitHook(page)).toEqual({ outcome: 'done' })
    expect(Object.keys(wait.mock.calls[0]?.[0])).toEqual(['id', 'parameters', 'args', 'viewMode', 'canvasElement'])
  })

  it("leaves canvas and userEvent out when the page can't read Storybook's test module", async () => {
    const wait = vi.fn()
    const page = pageShowing(storyRender({ wait }))

    withClipboard(page)
    page.run("Object.defineProperty(globalThis, '__STORYBOOK_MODULE_TEST__', { get() { throw new Error('hostile') } })")
    expect(await runWaitHook(page)).toEqual({ outcome: 'done' })
    expect(Object.keys(wait.mock.calls[0]?.[0])).toEqual(['id', 'parameters', 'args', 'viewMode', 'canvasElement'])
  })

  it("runs the wait hook of the latest preview's render", async () => {
    const first = vi.fn()
    const latest = vi.fn()
    const page = pageShowing(storyRender({ wait: first }))

    page.setGlobal('__STORYBOOK_PREVIEW__', { currentRender: storyRender({ wait: latest }) })
    expect(await runWaitHook(page)).toEqual({ outcome: 'done' })
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledOnce()
  })

  it('waits for a wait hook that returns a promise', async () => {
    const wait = runWaitHook(pageShowing(storyRender({ wait: () => later(500, undefined) })))

    await vi.advanceTimersByTimeAsync(400)
    expect(await settledYet(wait)).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(await wait).toEqual({ outcome: 'done' })
  })

  it.each([
    [
      'throws',
      () => {
        throw new Error('The data never came.')
      },
    ],
    ['rejects', async () => Promise.reject(new Error('The data never came.'))],
  ])('says what a wait hook that %s threw', async (_how, wait) => {
    expect(await runWaitHook(pageShowing(storyRender({ wait })))).toEqual({
      outcome: 'threw',
      text: 'Error: The data never came.',
    })
  })

  it.each([
    [
      'an error on several lines, on one line',
      new TypeError('x is undefined\n  at story'),
      'TypeError: x is undefined at story',
    ],
    ['a long error, in 500 characters', new Error('x'.repeat(600)), `Error: ${'x'.repeat(493)}`],
    ['a value that is not an error, as text', 'no data', 'no data'],
  ])('describes what the wait hook threw: %s', async (_what, error, text) => {
    const wait = async (): Promise<never> => Promise.reject(error)

    expect(await runWaitHook(pageShowing(storyRender({ wait })))).toEqual({ outcome: 'threw', text })
  })

  it.each([
    [
      "the story's context",
      {
        storyContext: () => {
          throw new Error('No context.')
        },
      },
      'Error: No context.',
    ],
    [
      "the story's parameters",
      {
        story: {
          get parameters() {
            throw new Error('No parameters.')
          },
        },
      },
      'Error: No parameters.',
    ],
    [
      "the story's view mode",
      {
        get viewMode() {
          throw new Error('No view mode.')
        },
      },
      'Error: No view mode.',
    ],
  ])("says the wait hook's context failed, without running it, when %s can't be read", async (_what, fields, text) => {
    const wait = vi.fn()

    expect(await runWaitHook(pageShowing(storyRender({ wait }, fields)))).toEqual({ outcome: 'context-failed', text })
    expect(wait).not.toHaveBeenCalled()
  })

  it("says the wait hook's context failed, without running it, when the test module's within throws", async () => {
    const wait = vi.fn()
    const page = pageShowing(storyRender({ wait }))

    page.run("globalThis.__STORYBOOK_MODULE_TEST__ = { within: () => { throw new Error('No canvas.') } }")
    expect(await runWaitHook(page)).toEqual({ outcome: 'context-failed', text: 'Error: No canvas.' })
    expect(wait).not.toHaveBeenCalled()
  })

  it.each([
    [
      'whose then() throws, as threw',
      "() => ({ then() { throw new Error('Bad thenable.') } })",
      { outcome: 'threw', text: 'Error: Bad thenable.' },
    ],
    [
      "whose then can't be read, as threw",
      "() => ({ get then() { throw new Error('No then.') } })",
      { outcome: 'threw', text: 'Error: No then.' },
    ],
    ['whose then() never calls back, as timed-out', '() => ({ then() {} })', { outcome: 'timed-out' }],
  ])('reads a wait hook that gives a thenable %s', async (_what, hookSource, answer) => {
    const page = openPage()

    // The page builds the hook, so its thenable is the page's own.
    page.setGlobal('__STORYBOOK_PREVIEW__', { currentRender: storyRender({ wait: page.run(hookSource) }) })

    const run = runWaitHook(page)

    await vi.advanceTimersByTimeAsync(1000)
    expect(await run).toEqual(answer)
  })

  it("times out on time with the browser's own timer when the page replaced setTimeout and clearTimeout", async () => {
    const page = pageShowing(storyRender({ wait: never }))

    page.run('globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => undefined')

    const wait = runWaitHook(page)

    await vi.advanceTimersByTimeAsync(999)
    expect(await settledYet(wait)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await wait).toEqual({ outcome: 'timed-out' })
  })

  it("clears its time limit with the browser's own clearTimeout once the wait hook settles", async () => {
    const page = pageShowing(storyRender({ wait: async () => undefined }))

    page.run('globalThis.clearTimeout = () => undefined')
    await runWaitHook(page)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no unhandled rejection when the wait hook rejects after the time limit', async () => {
    const unhandled = vi.fn()

    process.on('unhandledRejection', unhandled)

    try {
      const wait = runWaitHook(pageShowing(storyRender({ wait: () => laterRejection(1500, new Error('late')) })))

      await vi.advanceTimersByTimeAsync(1000)
      expect(await wait).toEqual({ outcome: 'timed-out' })
      await vi.advanceTimersByTimeAsync(500)
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it.each([
    ['Storybook never set the preview', undefined],
    ['the preview has no current render', {}],
    ['the current render is of another story', { currentRender: storyRender({}, { id: 'button--secondary' }) }],
    ['the current render has no story yet', { currentRender: storyRender({}, { story: undefined }) }],
    ['the current render has no storyContext()', { currentRender: storyRender({}, { storyContext: undefined }) }],
  ])('answers no-render when %s', async (_what, preview) => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', preview)
    expect(await runWaitHook(page)).toEqual({ outcome: 'no-render' })
  })

  it("answers no-render when the preview's current render can't be read", async () => {
    const page = openPage()

    page.run("globalThis.__STORYBOOK_PREVIEW__ = { get currentRender() { throw new Error('hostile') } }")
    expect(await runWaitHook(page)).toEqual({ outcome: 'no-render' })
  })
})

describe("the adapter's script", () => {
  it("never reads the page's document until the story finished", async () => {
    const { page, channel } = openStorybookPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', { ready: async () => undefined })
    channel.emit('storyRenderPhaseChanged', { newPhase: 'rendering', renderId: 1, storyId: 'button--primary' })
    channel.emit('storyThrewException', { name: 'Error', message: 'boom' })
    appendStyle(page, disableSheet)
    appendStyle(page, 'a { color: red }')
    await timedOutWait(page)
    expect(page.documentReads()).toBe(0)
  })

  it("never reads the page's document while it reads options", async () => {
    const page = openPage()

    page.setGlobal('__STORYBOOK_PREVIEW__', new FakePreview())
    await readOptions(page, [buttonFile])
    expect(page.documentReads()).toBe(0)
  })

  it('keeps its state out of enumeration, frozen', () => {
    const page = openPage()

    expect(page.run("Object.keys(globalThis).includes('__visualCheckStorybook')")).toBe(false)
    expect(page.run('Object.isFrozen(globalThis.__visualCheckStorybook)')).toBe(true)
  })

  it('does nothing when it runs again in the same page', () => {
    const channel = new FakeChannel()
    const page = openPage({ globals: { __STORYBOOK_ADDONS_CHANNEL__: channel } })

    page.run(storybookPageScript)
    expect(channel.listenerCounts()).toHaveProperty('storyFinished', 1)
  })
})

/**
 * The pause stylesheet Storybook 9.1 and 10 add on the test path, with the direction of its animations.
 */
function pauseSheet(direction: 'reverse' | 'normal'): string {
  return `*, *:before, *:after {
    animation-delay: 0s !important;
    animation-direction: ${direction} !important;
    animation-play-state: paused !important;
    transition: none !important;
  }`
}

/**
 * The stylesheet Storybook 9.1 and 10 add and remove again to disable animations on the test path.
 */
const disableSheet = `*, *:before, *:after {
    animation: none !important;
  }`

/**
 * Appends a new `<style>` element with this text to a fake page's `<head>`-like node and gives back what the original
 * `appendChild` saw of its text.
 */
function appendStyle(page: FakePage, text: string): unknown {
  page.setGlobal('__text', text)
  page.run('new Node().appendChild(new HTMLStyleElement(globalThis.__text))')

  return page.appended().at(-1)?.text
}

describe("the test path's pause stylesheets", () => {
  it.each([
    ['the pause stylesheet, reversed', pauseSheet('reverse')],
    ['the pause stylesheet, forward', pauseSheet('normal')],
    ['the disable stylesheet', disableSheet],
  ])('empties %s before it is appended', (_name, text) => {
    expect(appendStyle(openPage(), text)).toBe('')
  })

  it.each([
    ['one that runs an animation', '*, *:before, *:after {\n    animation: spin 1s infinite;\n  }'],
    ['one with another selector', 'body {\n    animation: none !important;\n  }'],
    [
      'one that sets another property first',
      '*, *:before, *:after {\n    color: red;\n    animation: none !important;\n  }',
    ],
  ])('keeps the text of %s', (_name, text) => {
    expect(appendStyle(openPage(), text)).toBe(text)
  })

  it('lets a node that is not a style element through untouched', () => {
    const page = openPage()

    page.run(
      `globalThis.__plain = { textContent: ${JSON.stringify(disableSheet)} }; new Node().appendChild(globalThis.__plain)`,
    )
    expect(page.appended().at(-1)?.text).toBe(disableSheet)
    expect(page.run('globalThis.__plain.textContent')).toBe(disableSheet)
  })

  it('calls the original with the same this and node, and gives back its result', () => {
    const page = openPage()

    expect(
      page.run(`(() => {
        globalThis.__parent = new Node()
        globalThis.__style = new HTMLStyleElement('a { color: red }')

        return globalThis.__parent.appendChild(globalThis.__style) === globalThis.__style
      })()`),
    ).toBe(true)
    expect(page.run('globalThis.__parent')).toBe(page.appended()[0]?.target)
    expect(page.run('globalThis.__style')).toBe(page.appended()[0]?.node)
  })

  it('lets what the original throws through', () => {
    const page = openPage()

    expect(() =>
      page.run(
        '(() => { const style = new HTMLStyleElement(""); style.fails = true; new Node().appendChild(style) })()',
      ),
    ).toThrow('append failed')
  })

  it('wraps appendChild once when it runs twice', () => {
    const page = openPage()
    const wrapped = page.run('Node.prototype.appendChild')

    page.run(storybookPageScript)
    expect(page.run('Node.prototype.appendChild')).toBe(wrapped)
  })

  it('keeps the text of a stylesheet of the page that starts like the disable stylesheet', () => {
    const text = `${disableSheet}\n.card { color: red }`

    expect(appendStyle(openPage(), text)).toBe(text)
  })

  it('still appends a node whose text cannot be read', () => {
    const page = openPage()

    page.run(`(() => {
      const style = new HTMLStyleElement('')

      Object.defineProperty(style, 'textContent', { get: () => { throw new Error('unreadable') } })
      new Node().appendChild(style)
    })()`)
    expect(page.appended()).toHaveLength(1)
  })

  it('leaves the script and the wait working when appendChild cannot be replaced', async () => {
    const page = blankPage()

    page.run(
      "Object.defineProperty(Node.prototype, 'appendChild', { value: Node.prototype.appendChild, writable: false })",
    )
    page.run(storybookPageScript)

    const channel = new FakeChannel()

    page.setGlobal('__STORYBOOK_ADDONS_CHANNEL__', channel)

    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await wait).toEqual(finishedAnswer())
  })

  it('leaves the wait working in a page without Node or HTMLStyleElement', async () => {
    const { page, channel } = openStorybookPage({ nodes: false })
    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    channel.emit('storyFinished', { storyId: 'button--primary', status: 'success' })
    expect(await wait).toEqual(finishedAnswer())
  })
})

/**
 * Evaluates the predicate's source in a fake page with these globals, and gives back the predicate.
 */
function parkedByStorybookIn(globals: Record<string, unknown> = animationClasses): (animation: object) => unknown {
  return runInContext(parkedByStorybookSource, createContext({ ...globals })) as (animation: object) => unknown
}

/**
 * Builds an animation of this kind, paused at 0 on the document's timeline unless `options` says otherwise.
 */
function pausedAnimation(kind: AnimationKind, options: FakeAnimationOptions = {}): FakeAnimation {
  return fakeAnimation({ kind, playState: 'paused', ...options })
}

describe('the predicate for animations Storybook 11 parked', () => {
  it.each([
    ['a CSS animation', 'css-animation'],
    ['a CSS transition', 'css-transition'],
  ] as const)('is true for %s paused at 0 on the document timeline', (_kind, kind) => {
    expect(parkedByStorybookIn()(pausedAnimation(kind))).toBe(true)
  })

  it.each([
    ['a CSS animation running at 0', fakeAnimation({ kind: 'css-animation' })],
    ['a finished CSS animation', fakeAnimation({ kind: 'css-animation', playState: 'finished', currentTime: 1000 })],
    ['a CSS animation paused at another time', pausedAnimation('css-animation', { currentTime: 500 })],
    ['a script animation paused at 0', pausedAnimation('script')],
    ['a CSS animation on a scroll timeline', pausedAnimation('css-animation', { timeline: new FakeScrollTimeline() })],
    ['a CSS transition without a timeline', pausedAnimation('css-transition', { timeline: null })],
  ])('is false for %s', (_what, animation) => {
    expect(parkedByStorybookIn()(animation)).toBe(false)
  })

  it('checks each kind only where the page has its class', () => {
    const { CSSTransition, DocumentTimeline } = animationClasses

    expect(parkedByStorybookIn({ CSSTransition, DocumentTimeline })(pausedAnimation('css-transition'))).toBe(true)
  })

  it.each([
    ['CSSAnimation and CSSTransition', { DocumentTimeline: animationClasses.DocumentTimeline }],
    [
      'DocumentTimeline',
      { CSSAnimation: animationClasses.CSSAnimation, CSSTransition: animationClasses.CSSTransition },
    ],
  ])('is false in a page without %s', (_classes, globals) => {
    expect(parkedByStorybookIn(globals)(pausedAnimation('css-animation'))).toBe(false)
  })

  it('is false for an animation it cannot read, without throwing', () => {
    const animation = pausedAnimation('css-animation')

    Object.defineProperty(animation, 'playState', {
      get: () => {
        throw new Error('unreadable')
      },
    })
    expect(parkedByStorybookIn()(animation)).toBe(false)
  })
})

describe('readStoryWait', () => {
  /**
   * An error event as the page records it.
   */
  const recorded = (event: string, text: string): { event: string; text: string } => ({ event, text })

  it('reads a story that finished well, with the time between its completing and completed steps', () => {
    expect(readStoryWait(finishedAnswer({ completingMs: 80 }))).toEqual({ outcome: 'finished', completingMs: 80 })
  })

  it('reads a story that finished well without that time', () => {
    expect(readStoryWait(finishedAnswer())).toEqual({ outcome: 'finished', completingMs: undefined })
  })

  it.each([
    [
      'play threw',
      { errors: [recorded('playFunctionThrewException', 'Error: boom')] },
      { outcome: 'play-threw', message: "The story's play function threw Error: boom." },
    ],
    [
      'play left unhandled errors',
      { errors: [recorded('unhandledErrorsWhilePlaying', 'Error: one; Error: two')] },
      { outcome: 'play-threw', message: "The story's play function left unhandled errors: Error: one; Error: two." },
    ],
    [
      'the story threw',
      { errors: [recorded('storyThrewException', 'TypeError: x is undefined')] },
      { outcome: 'errored', message: 'The story threw TypeError: x is undefined.' },
    ],
    [
      'Storybook sent storyErrored',
      { errors: [recorded('storyErrored', 'No component: The story has no component')] },
      { outcome: 'errored', message: 'Storybook showed its error display: No component: The story has no component.' },
    ],
    [
      'Storybook showed its error display',
      { errorDisplay: true },
      { outcome: 'errored', message: 'Storybook showed its error display.' },
    ],
    [
      'Storybook reported a status other than success',
      { status: 'error' },
      {
        outcome: 'errored',
        message:
          'Storybook reported the story finished with status "error", as it does when a loader, beforeEach or the render throws, or when a check such as accessibility fails.',
      },
    ],
  ])('reads a finished story where %s', (_what, answer, wait) => {
    expect(readStoryWait(finishedAnswer(answer))).toEqual(wait)
  })

  it.each([
    [
      'a play function that threw, over everything else',
      {
        status: 'error',
        errorDisplay: true,
        errors: [
          recorded('storyErrored', 'No component'),
          recorded('storyThrewException', 'Error: render'),
          recorded('unhandledErrorsWhilePlaying', 'Error: unhandled'),
          recorded('playFunctionThrewException', 'Error: play'),
        ],
      },
      { outcome: 'play-threw', message: "The story's play function threw Error: play." },
    ],
    [
      'unhandled errors, over the story throwing, storyErrored, the error display and the status',
      {
        status: 'error',
        errorDisplay: true,
        errors: [
          recorded('storyErrored', 'No component'),
          recorded('storyThrewException', 'Error: render'),
          recorded('unhandledErrorsWhilePlaying', 'Error: unhandled'),
        ],
      },
      { outcome: 'play-threw', message: "The story's play function left unhandled errors: Error: unhandled." },
    ],
    [
      'the story throwing, over storyErrored, the error display and the status',
      {
        status: 'error',
        errorDisplay: true,
        errors: [recorded('storyErrored', 'No component'), recorded('storyThrewException', 'Error: render')],
      },
      { outcome: 'errored', message: 'The story threw Error: render.' },
    ],
    [
      'storyErrored, over the error display and the status',
      { status: 'error', errorDisplay: true, errors: [recorded('storyErrored', 'No component')] },
      { outcome: 'errored', message: 'Storybook showed its error display: No component.' },
    ],
    [
      'the error display, over the status',
      { status: 'error', errorDisplay: true },
      { outcome: 'errored', message: 'Storybook showed its error display.' },
    ],
    [
      'the first of two events of a kind',
      {
        errors: [
          recorded('playFunctionThrewException', 'Error: first'),
          recorded('playFunctionThrewException', 'Error: second'),
        ],
      },
      { outcome: 'play-threw', message: "The story's play function threw Error: first." },
    ],
  ])('reads %s', (_what, answer, wait) => {
    expect(readStoryWait(finishedAnswer(answer))).toEqual(wait)
  })

  it("doesn't end a message with two periods", () => {
    expect(readStoryWait(finishedAnswer({ errors: [recorded('storyThrewException', 'Error: boom.')] }))).toEqual({
      outcome: 'errored',
      message: 'The story threw Error: boom.',
    })
  })

  it.each([
    ['playFunctionThrewException', "The story's play function threw an error."],
    ['unhandledErrorsWhilePlaying', "The story's play function left unhandled errors."],
    ['storyThrewException', 'The story threw an error.'],
    ['storyErrored', 'Storybook showed its error display.'],
  ])('says what went wrong without the detail when %s came with no text', (event, message) => {
    expect(readStoryWait(finishedAnswer({ errors: [recorded(event, '')] }))).toHaveProperty('message', message)
  })

  it.each(['preview-start', 'preview-ready', 'story'])('reads a timeout in the %s step', (step) => {
    expect(readStoryWait(timedOutAnswer(step))).toEqual({
      outcome: 'timed-out',
      step,
      lastRenderStep: undefined,
    })
  })

  it("reads a timeout with the story's last render step", () => {
    expect(readStoryWait(timedOutAnswer('story', 'playing'))).toEqual({
      outcome: 'timed-out',
      step: 'story',
      lastRenderStep: 'playing',
    })
  })

  it("reads a missing adapter's script", () => {
    expect(readStoryWait({ outcome: 'script-missing' })).toEqual({ outcome: 'script-missing' })
  })

  it.each([
    ['a number', 42],
    ['null', null],
    ['a finished story without the rest', { outcome: 'finished' }],
    ['a status other than text', finishedAnswer({ status: 42 })],
    ['an error display other than true or false', finishedAnswer({ errorDisplay: 'yes' })],
    ['errors other than a list', finishedAnswer({ errors: 'none' })],
    ['an error event of another name', finishedAnswer({ errors: [recorded('storyBroke', 'Error: boom')] })],
    ['an error event without text', finishedAnswer({ errors: [{ event: 'storyErrored' }] })],
    ['a time other than a number', finishedAnswer({ completingMs: '80' })],
    ['a timeout in another step', timedOutAnswer('somewhere')],
    ['a timeout without a last render step', { outcome: 'timed-out', step: 'story' }],
  ])('throws on %s, quoting it', (_what, value) => {
    expect(() => readStoryWait(value)).toThrow(
      `The Storybook wait in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`,
    )
  })
})
