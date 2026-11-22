import { describe, expect, it } from 'vitest'
import type { CheckOutcome, StoryCheck } from '../commands/check-story.js'
import type { LaunchBrowser } from '../commands/launch-browser.js'
import { type AddonChild, type AddonChildOptions, createAddonChild } from './addon-child.js'
import type { AddonMessage, CheckRequest, FinishedMessage } from './protocol.js'

/**
 * The launch the fake checks make.
 */
const launch: Parameters<LaunchBrowser>[0] = { in: 'image', executable: '/opt/chromium/chrome-headless-shell' }

/**
 * How a fake check that finishes ends.
 */
const checked: CheckOutcome = {
  result: 'checked',
  storybook: 'web',
  imagesFolder: '/project/.visual-check',
  snapshots: [],
  disabled: false,
  notices: [],
}

/**
 * How a fake check that stops ends.
 */
const stopped: CheckOutcome = { result: 'stopped', cause: 'config', message: 'No config.', notices: [] }

/**
 * Gives a request for a check of story `a`, with the click's ID.
 */
function checkRequestOf(id: string): CheckRequest {
  return { kind: 'check', id, storyId: 'a', configDir: '/project/.storybook', url: 'http://127.0.0.1:6006' }
}

/**
 * One fake check in flight.
 */
interface FakeCheck {
  /**
   * What the child gave it.
   */
  check: StoryCheck
  /**
   * Ends it.
   */
  end: (outcome: CheckOutcome) => void
}

/**
 * A child whose checks the test ends, and what it did.
 */
interface ChildSetup {
  /**
   * The child.
   */
  child: AddonChild
  /**
   * Every check started, in order.
   */
  checks: FakeCheck[]
  /**
   * Every message sent, in order.
   */
  messages: AddonMessage[]
  /**
   * Gives the started check at the index.
   */
  checkAt: (index: number) => FakeCheck
  /**
   * Resolves with the finished message at the index, once it's sent.
   */
  finished: (index: number) => Promise<FinishedMessage>
}

/**
 * Makes a child with fake checks, each of which ends when the test says, and cancelled once its signal aborts.
 */
function setUp(options: Partial<AddonChildOptions> = {}): ChildSetup {
  const checks: FakeCheck[] = []
  const messages: AddonMessage[] = []
  const finishes: FinishedMessage[] = []
  const waiting: { index: number; resolve: (message: FinishedMessage) => void }[] = []
  const child = createAddonChild({
    send: (message) => {
      messages.push(message)

      if (message.kind !== 'finished') {
        return
      }

      finishes.push(message)

      for (const { resolve } of waiting.filter(({ index }) => index === finishes.length - 1)) {
        resolve(message)
      }
    },
    version: '1.2.3',
    cwd: '/project',
    environment: { CI: 'true' },
    launchBrowser: () => Promise.reject(new Error('The child launched a browser.')),
    check: (check) =>
      new Promise((end) => {
        checks.push({ check, end })
        check.signal.addEventListener('abort', () => end({ result: 'cancelled' }))
      }),
    ...options,
  })

  return {
    child,
    checks,
    messages,
    checkAt: (index) => {
      const check = checks[index]

      if (check === undefined) {
        throw new Error(`No check ${index} was started.`)
      }

      return check
    },
    finished: async (index) => finishes[index] ?? (await new Promise((resolve) => waiting.push({ index, resolve }))),
  }
}

/**
 * Makes a fake launcher whose browsers never exit, with how many it launched and how many were closed.
 */
function fakeLauncher(): { launchBrowser: LaunchBrowser; count: { launched: number; closed: number } } {
  const count = { launched: 0, closed: 0 }

  return {
    count,
    launchBrowser: async () => {
      count.launched += 1

      return {
        version: '157.0.8103.78',
        exited: new Promise(() => undefined),
        newPage: () => Promise.resolve({ close: () => Promise.resolve() } as never),
        close: async () => {
          count.closed += 1
        },
      }
    },
  }
}

/**
 * Launches a check's browser, opens a page in it and closes it, as a check does.
 */
async function openPageAndClose({ launchBrowser }: StoryCheck): Promise<void> {
  const driver = await launchBrowser(launch)

  await driver.newPage({} as never)
  await driver.close()
}

describe('createAddonChild', () => {
  it('says first, at once, that it is ready', () => {
    expect(setUp().messages).toEqual([{ kind: 'ready', protocol: 1, version: '1.2.3' }])
  })

  it("runs a check with the request's fields and sends its progress and end under the request's ID", async () => {
    const { child, checkAt, messages, finished } = setUp()

    child.receive(checkRequestOf('click-1'))

    const { check, end } = checkAt(0)

    expect(check).toMatchObject({
      storyId: 'a',
      configDir: '/project/.storybook',
      url: 'http://127.0.0.1:6006',
      cwd: '/project',
      environment: { CI: 'true' },
    })
    expect(check.images.folderOf({ dir: '/project' } as never)).toMatch(/\.visual-check$/)

    check.progress({ step: 'preparing' })
    check.progress({ step: 'capturing', finished: 0, total: 1 })
    end(checked)
    await finished(0)

    expect(messages.slice(1)).toEqual([
      { kind: 'progress', id: 'click-1', progress: { step: 'preparing' } },
      { kind: 'progress', id: 'click-1', progress: { step: 'capturing', finished: 0, total: 1 } },
      { kind: 'finished', id: 'click-1', outcome: checked },
    ])
  })

  it('refuses a check while one runs, which goes on', async () => {
    const { child, checks, checkAt, finished } = setUp()

    child.receive(checkRequestOf('click-1'))
    child.receive(checkRequestOf('click-2'))

    expect(await finished(0)).toEqual({
      kind: 'finished',
      id: 'click-2',
      outcome: {
        result: 'stopped',
        cause: 'run',
        message: 'visual-check is already checking a story.',
        notices: [],
      },
    })
    expect(checks).toHaveLength(1)
    expect(checkAt(0).check.signal.aborted).toBe(false)

    checkAt(0).end(checked)

    expect(await finished(1)).toMatchObject({ id: 'click-1', outcome: checked })
  })

  it('cancels the running check by its ID alone', async () => {
    const { child, checkAt, finished } = setUp()

    child.receive({ kind: 'cancel', id: 'click-1' })
    child.receive(checkRequestOf('click-1'))
    child.receive({ kind: 'cancel', id: 'click-0' })

    expect(checkAt(0).check.signal.aborted).toBe(false)

    child.receive({ kind: 'cancel', id: 'click-1' })

    expect(checkAt(0).check.signal.aborted).toBe(true)
    expect(await finished(0)).toEqual({ kind: 'finished', id: 'click-1', outcome: { result: 'cancelled' } })
  })

  it('ignores a message that is no request', () => {
    const { child, checks, messages } = setUp()

    for (const message of [undefined, null, 'check', {}, { kind: 'update', id: 'click-1' }, { kind: 'check' }]) {
      child.receive(message)
    }

    expect(checks).toEqual([])
    expect(messages).toHaveLength(1)
  })

  it('takes the next check once one stopped, was cancelled or finished', async () => {
    const { child, checkAt, finished } = setUp()

    child.receive(checkRequestOf('click-1'))
    checkAt(0).end(stopped)
    expect(await finished(0)).toMatchObject({ id: 'click-1', outcome: stopped })

    child.receive(checkRequestOf('click-2'))
    child.receive({ kind: 'cancel', id: 'click-2' })
    expect(await finished(1)).toMatchObject({ id: 'click-2', outcome: { result: 'cancelled' } })

    child.receive(checkRequestOf('click-3'))
    expect(checkAt(2).check.signal.aborted).toBe(false)
    checkAt(2).end(checked)
    expect(await finished(2)).toMatchObject({ id: 'click-3', outcome: checked })
  })

  it('keeps one browser for its checks and closes it when it closes', async () => {
    const { launchBrowser, count } = fakeLauncher()
    const { child, checkAt, finished } = setUp({ launchBrowser })

    for (const index of [0, 1]) {
      child.receive(checkRequestOf(`click-${index}`))
      await openPageAndClose(checkAt(index).check)
      checkAt(index).end(checked)
      await finished(index)
    }

    expect(count).toEqual({ launched: 1, closed: 0 })

    await child.close()

    expect(count).toEqual({ launched: 1, closed: 1 })
  })

  it('keeps one set of image files for its checks', async () => {
    const { child, checkAt, finished } = setUp()

    child.receive(checkRequestOf('click-1'))
    checkAt(0).end(checked)
    await finished(0)
    child.receive(checkRequestOf('click-2'))

    expect(checkAt(1).check.images).toBe(checkAt(0).check.images)
  })

  it('aborts the running check and closes the browser when it closes, once', async () => {
    const { launchBrowser, count } = fakeLauncher()
    const { child, checkAt, messages } = setUp({ launchBrowser })

    child.receive(checkRequestOf('click-1'))
    await openPageAndClose(checkAt(0).check)

    const closing = child.close()

    expect(checkAt(0).check.signal.aborted).toBe(true)
    expect(child.close()).toBe(closing)

    await closing

    expect(messages.at(-1)).toEqual({ kind: 'finished', id: 'click-1', outcome: { result: 'cancelled' } })
    expect(count).toEqual({ launched: 1, closed: 1 })
  })

  it('waits for the running check to end when it closes', async () => {
    const started: FakeCheck[] = []
    const { child } = setUp({ check: (check) => new Promise((end) => started.push({ check, end })) })
    let closed = false

    child.receive(checkRequestOf('click-1'))

    const closing = child.close().then(() => {
      closed = true
    })

    await new Promise(setImmediate)

    expect(closed).toBe(false)

    started[0]?.end(checked)
    await closing
  })

  it('answers a check as cancelled once it closes', async () => {
    const { child, checks, finished } = setUp()

    await child.close()
    child.receive(checkRequestOf('click-1'))

    expect(await finished(0)).toEqual({ kind: 'finished', id: 'click-1', outcome: { result: 'cancelled' } })
    expect(checks).toEqual([])
  })
})
