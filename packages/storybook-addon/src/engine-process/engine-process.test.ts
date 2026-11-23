import { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import type { AddonOutcome, AddonProgress } from '@visual-check/cli/internal/addon-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEngineProcess, type EngineListener, type EngineProcess } from './engine-process.js'

/**
 * The script of the fake child. Node runs it through its default type stripping.
 */
const fakeEntry = fileURLToPath(new URL('./fake-engine.fixture.ts', import.meta.url))

/**
 * How long a test may take, in milliseconds. Each waits for what it expects, so it takes this long only when that never
 * comes.
 */
const testTimeout = 30_000

/**
 * A check's or an update's listener, and what it heard.
 */
interface HeardRun extends EngineListener {
  /**
   * Its progress, in order.
   */
  steps: AddonProgress[]
  /**
   * How it ended, once for each time.
   */
  outcomes: AddonOutcome[]
  /**
   * Resolves at the first progress.
   */
  started: Promise<void>
  /**
   * Resolves with the first end.
   */
  end: Promise<AddonOutcome>
}

/**
 * Makes a listener that keeps what it hears.
 */
function listen(): HeardRun {
  const steps: AddonProgress[] = []
  const outcomes: AddonOutcome[] = []
  let resolveStart: () => void = () => undefined
  const started = new Promise<void>((resolve) => {
    resolveStart = resolve
  })
  let resolveEnd: (outcome: AddonOutcome) => void = () => undefined
  const end = new Promise<AddonOutcome>((resolve) => {
    resolveEnd = resolve
  })

  return {
    steps,
    outcomes,
    started,
    end,
    progress: (progress) => {
      steps.push(progress)
      resolveStart()
    },
    finished: (outcome) => {
      outcomes.push(outcome)
      resolveEnd(outcome)
    },
  }
}

/**
 * Asks for a check of a story, whose ID says what the fake child does, and gives what its listener heard.
 */
function check(engine: EngineProcess, storyId: string, id = 'click-1'): HeardRun {
  return runOf(engine, 'check', storyId, id)
}

/**
 * Asks for a check or an update of a story, whose ID says what the fake child does, and gives what its listener heard.
 */
function runOf(engine: EngineProcess, kind: 'check' | 'update', storyId: string, id = 'click-1'): HeardRun {
  const heard = listen()

  engine.run({ kind, id, storyId, configDir: '/project/.storybook', url: 'http://127.0.0.1:6006' }, heard)

  return heard
}

/**
 * Makes an engine process with the fake child.
 */
function createFake(cancelTimeoutMs?: number): EngineProcess {
  return createEngineProcess({
    version: '1.2.3',
    entry: () => fakeEntry,
    ...(cancelTimeoutMs === undefined ? {} : { cancelTimeoutMs }),
  })
}

/**
 * Watches every start of a child process, which still starts. Every way to start one ends in this method of Node's.
 */
const spawned = vi.spyOn(ChildProcess.prototype as ChildProcess & { spawn: () => void }, 'spawn')

/**
 * Gives every child process that was started.
 */
function children(): ChildProcess[] {
  return spawned.mock.contexts as ChildProcess[]
}

/**
 * Resolves once a child has exited.
 */
async function exitOf(child: ChildProcess): Promise<void> {
  if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    await once(child, 'exit')
  }
}

/**
 * The processes that the fake children started, which a test leaves running.
 */
const leftProcesses: number[] = []

afterEach(async () => {
  vi.useRealTimers()

  for (const pid of leftProcesses.splice(0)) {
    process.kill(pid, 'SIGKILL')
  }

  for (const child of children()) {
    child.kill('SIGKILL')
    await exitOf(child)
  }

  spawned.mockClear()
})

describe('createEngineProcess', { timeout: testTimeout }, () => {
  it('starts no child before the first check, and one for all of them', async () => {
    const engine = createFake()

    engine.cancel('click-1')
    expect(children()).toHaveLength(0)

    const first = await check(engine, 'ends', 'click-1').end
    const second = await check(engine, 'ends', 'click-2').end

    expect(children()).toHaveLength(1)
    expect(first).toEqual({ result: 'stopped', cause: 'run', message: String(children()[0]?.pid), notices: [] })
    expect(second).toEqual(first)
  })

  it("passes on a check's progress, then its end", async () => {
    const heard = check(createFake(), 'ends')

    await heard.end

    expect(heard.steps).toEqual([{ step: 'preparing' }, { step: 'capturing', finished: 0, total: 1 }])
    expect(heard.outcomes).toHaveLength(1)
  })

  it("passes on an update's progress, then its end", async () => {
    const engine = createFake()
    const heard = runOf(engine, 'update', 'ends')

    await heard.end

    expect(heard.steps).toEqual([{ step: 'preparing' }, { step: 'capturing', finished: 0, total: 1 }])
    expect(heard.outcomes).toEqual([
      { result: 'stopped', cause: 'run', message: String(children()[0]?.pid), notices: [] },
    ])
  })

  it('ignores junk, other checks and a second end', async () => {
    const engine = createFake()
    const heard = check(engine, 'says junk')

    await heard.end
    // The child has said all of that by the end of another check.
    await check(engine, 'ends', 'click-2').end

    expect(heard.steps).toEqual([])
    expect(heard.outcomes).toHaveLength(1)
  })

  it('cancels a check, after which the child takes the next one', async () => {
    const engine = createFake()
    const heard = check(engine, 'hangs')

    engine.cancel('another')
    engine.cancel('click-1')
    engine.cancel('click-1')

    expect(await heard.end).toEqual({ result: 'cancelled' })
    expect(await check(engine, 'ends', 'click-2').end).toMatchObject({ result: 'stopped' })
    expect(children()).toHaveLength(1)
    expect(heard.outcomes).toHaveLength(1)
  })

  it('kills a child that does not answer a cancel, and starts another one for the next check', async () => {
    const engine = createFake(50)
    const heard = check(engine, 'ignores a cancel')

    await heard.started
    engine.cancel('click-1')

    expect(await heard.end).toEqual({ result: 'cancelled' })

    const next = check(engine, 'ends', 'click-2')
    const [killed] = children()

    if (killed === undefined) {
      throw new Error('No child was started.')
    }

    await exitOf(killed)

    expect(killed.signalCode).toBe('SIGKILL')
    expect(await next.end).toMatchObject({ message: String(children()[1]?.pid) })
    expect(children()).toHaveLength(2)
    expect(heard.outcomes).toHaveLength(1)
  })

  it('kills no child whose cancelled check ended', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const engine = createFake()
    const heard = check(engine, 'hangs')

    engine.cancel('click-1')
    expect(vi.getTimerCount()).toBe(1)
    await heard.end

    expect(vi.getTimerCount()).toBe(0)
    expect(children()[0]?.killed).toBe(false)
  })

  it('stops a check whose child exits, with the end of what it wrote, and starts another one', async () => {
    const engine = createFake()
    const heard = check(engine, 'crashes with output')
    const lines = Array.from({ length: 50 }, (_, index) => `line ${index + 11}`)

    expect(await heard.end).toEqual({
      result: 'stopped',
      cause: 'run',
      message: [
        "visual-check's process exited with code 7 while it checked the story.",
        'Its last output:',
        ...lines,
      ].join('\n'),
      notices: [],
    })
    expect(await check(engine, 'ends', 'click-2').end).toMatchObject({ message: String(children()[1]?.pid) })
    expect(heard.outcomes).toHaveLength(1)
  })

  it("stops an update whose child exits, saying it updated the story's baselines", async () => {
    expect(await runOf(createFake(), 'update', 'crashes').end).toMatchObject({
      message: "visual-check's process exited with code 7 while it updated the story's baselines.",
    })
  })

  it('keeps the last 16000 characters of what the child wrote', async () => {
    const outcome = await check(createFake(), 'crashes with a long line').end

    expect(outcome).toMatchObject({ message: expect.stringMatching(/\na{15999}b$/) })
  })

  it('stops a check whose child exits while a process it started holds its output open', async () => {
    const outcome = await check(createFake(), 'crashes and leaves a process').end
    const message = outcome.result === 'stopped' ? outcome.message : ''
    const pid = Number(message.split('\n').at(-1))

    expect(message).toMatch(/^visual-check's process exited with code 7 .+\nIts last output:\n[1-9]\d*$/)
    leftProcesses.push(pid)
    // It's still there.
    expect(process.kill(pid, 0)).toBe(true)
  })

  it('drops a read error of what the child writes', async () => {
    const engine = createFake()
    const heard = check(engine, 'ignores a cancel')

    await heard.started

    const [child] = children()

    expect(child?.stderr?.emit('error', new Error('read ECONNRESET'))).toBe(true)

    child?.kill('SIGKILL')

    expect(await heard.end).toMatchObject({
      message: "visual-check's process was killed by signal SIGKILL while it checked the story.",
    })
  })

  it('ignores progress it can not read, and stops a check whose end it can not read', async () => {
    const heard = check(createFake(), 'says what cannot be read')

    expect(await heard.end).toMatchObject({
      result: 'stopped',
      message: expect.stringMatching(/^The Storybook addon can't read the result/),
    })
    expect(heard.steps).toEqual([])
  })

  it('stops a check whose child exits without a word', async () => {
    expect(await check(createFake(), 'crashes').end).toMatchObject({
      message: "visual-check's process exited with code 7 while it checked the story.",
    })
  })

  it.skipIf(process.platform === 'win32')('stops a check whose child is killed', async () => {
    expect(await check(createFake(), 'is killed').end).toMatchObject({
      message: "visual-check's process was killed by signal SIGKILL while it checked the story.",
    })
  })

  it('starts another child when the last one exited between checks', async () => {
    const engine = createFake()

    await check(engine, 'ends').end

    const [child] = children()

    if (child === undefined) {
      throw new Error('No child was started.')
    }

    const closed = once(child, 'close')

    child.kill('SIGKILL')
    await closed

    expect(await check(engine, 'ends', 'click-2').end).toMatchObject({ message: String(children()[1]?.pid) })
  })

  it.each([
    { version: '1.3.0', upgrade: '@visual-check/cli to 1.3.0' },
    { version: '1.2.0', upgrade: '@visual-check/storybook-addon to 1.2.3' },
  ])('stops a run when the CLI is not at version $version, naming $upgrade', async ({ version, upgrade }) => {
    const engine = createEngineProcess({ version, entry: () => fakeEntry })
    const heard = check(engine, 'hangs')

    expect(await heard.end).toEqual({
      result: 'stopped',
      cause: 'run',
      message: expect.stringContaining(`Upgrade ${upgrade}, then restart Storybook.`),
      notices: [],
    })

    const [child] = children()

    if (child === undefined) {
      throw new Error('No child was started.')
    }

    await exitOf(child)

    expect(child.exitCode).toBe(0)
    expect(await check(engine, 'hangs', 'click-2').end).toMatchObject({ result: 'stopped' })
    expect(children()).toHaveLength(2)
    expect(heard.outcomes).toHaveLength(1)
  })

  it('stops a check when the CLI is not there, and looks for it again at the next one', async () => {
    const missing = new Error(
      "Cannot find module '@visual-check/cli/internal/addon-child'\nRequire stack:\n- /addon.js",
    )
    const entry = vi
      .fn(() => fakeEntry)
      .mockImplementationOnce(() => {
        throw missing
      })
    const engine = createEngineProcess({ version: '1.2.3', entry })
    const heard = check(engine, 'ends')

    expect(heard.outcomes).toEqual([
      {
        result: 'stopped',
        cause: 'run',
        message:
          "The Storybook addon couldn't find the @visual-check/cli 1.2.3 it runs: Cannot find module " +
          "'@visual-check/cli/internal/addon-child'. Install it, then restart Storybook.",
        notices: [],
      },
    ])
    expect(children()).toHaveLength(0)
    expect(await check(engine, 'ends', 'click-2').end).toMatchObject({ message: String(children()[0]?.pid) })
  })

  it.each([
    { refused: 'at once', executable: `${fakeEntry}/missing` },
    { refused: 'a moment later', executable: `${fakeEntry}-missing` },
  ])('stops every check when the process is refused $refused', async ({ executable }) => {
    const { execPath } = process

    process.execPath = executable

    try {
      const engine = createFake()
      const first = listen()
      const second = new Promise<HeardRun>((resolve) => {
        engine.run(
          {
            kind: 'check',
            id: 'click-1',
            storyId: 'ends',
            configDir: '/project/.storybook',
            url: 'http://127.0.0.1:6006',
          },
          {
            progress: first.progress,
            finished: (outcome) => {
              first.finished(outcome)
              // The system may not have said yet that the first one closed.
              resolve(check(engine, 'ends', 'click-2'))
            },
          },
        )
      })

      for (const heard of [first, await second]) {
        expect(await heard.end).toMatchObject({
          result: 'stopped',
          cause: 'run',
          message: expect.stringMatching(/^visual-check's process couldn't start: spawn .+$/),
        })
        expect(heard.outcomes).toHaveLength(1)
      }
    } finally {
      process.execPath = execPath
    }
  })
})
