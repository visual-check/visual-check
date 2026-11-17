import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunReporter } from '../reporter/run-event.js'
import { startLiveView } from './live-view.js'
import { advanceTimers, fakeStdout, plainFrameOf } from './terminal.fixture.js'

vi.hoisted(() => {
  // Ink's chalk picks its colour level when it loads, and the test's stdout is no terminal.
  vi.stubEnv('FORCE_COLOR', '3')
})

/**
 * Which of Ink's waits a test makes reject.
 */
const faults = vi.hoisted(() => ({ rejects: false }))

vi.mock('ink', async (importOriginal) => {
  const ink: typeof import('ink') = await importOriginal()

  return {
    ...ink,
    render: (...parameters: Parameters<typeof ink.render>) => {
      const instance = ink.render(...parameters)
      /**
       * Gives `wait`'s promise, or a rejected one when the test makes Ink's waits reject.
       */
      const faulty = (wait: () => Promise<unknown>) => (): Promise<unknown> =>
        faults.rejects ? Promise.reject(new Error('Ink failed.')) : wait()

      return {
        ...instance,
        waitUntilRenderFlush: faulty(instance.waitUntilRenderFlush),
        waitUntilExit: faulty(instance.waitUntilExit),
      }
    },
  }
})

/**
 * The header of the tests' run.
 */
const header = 'visual-check 1.0.0 · test · 3 snapshots · 2 workers'

/**
 * What a terminal is sent to show the cursor again.
 */
const showCursor = '\u001b[?25h'

/**
 * What a terminal is sent to erase the line the cursor is on and go to its start.
 */
const eraseLineToStart = '\u001b[2K\u001b[G'

/**
 * The views a test started and didn't finish, which `afterEach` finishes.
 */
const running: RunReporter[] = []

beforeEach(() => {
  // Only the spinner's and the progress line's timers are faked: React and Ink keep their real ones to draw.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

afterEach(async () => {
  for (const view of running.splice(0)) {
    await act(() => view.finish())
  }

  faults.rejects = false
  vi.useRealTimers()
})

/**
 * How a test starts a view.
 */
interface ViewSetup {
  /**
   * The environment.
   */
  environment?: NodeJS.ProcessEnv
  /**
   * Whether every frame is written in full: `true` when not given. When `false`, the fake terminal says it is a TTY,
   * and Ink draws over the frame before, as in a person's terminal.
   */
  debug?: boolean
  /**
   * Gives how long the run has taken: always 14,200 ms when not given.
   */
  elapsedMs?: () => number
}

/**
 * Starts a view on a fake terminal, drawing every frame in full unless the setup says otherwise. Gives the view, the
 * terminal, and the last frame without colours.
 */
function startView(setup: ViewSetup = {}) {
  const debug = setup.debug ?? true
  const stdout = Object.assign(fakeStdout(), { isTTY: !debug })
  const view = startLiveView({
    environment: setup.environment ?? {},
    stdout,
    debug,
    elapsedMs: setup.elapsedMs ?? (() => 14_200),
  })

  running.push(view)

  return { view, stdout, frame: () => plainFrameOf(stdout.lastFrame()) }
}

/**
 * Gives the view the run's planned event, with a shard's note, and waits for it to draw.
 */
async function plan(view: RunReporter): Promise<void> {
  await act(async () => {
    view.event({ kind: 'planned', header, notes: ['Shard 1/2 takes 1 stories file.'], total: 3, workers: 2 })
  })
}

/**
 * Finishes a view, and takes it off the list `afterEach` finishes.
 */
async function finish(view: RunReporter): Promise<void> {
  running.splice(running.indexOf(view), 1)
  await act(() => view.finish())
}

describe('startLiveView', () => {
  it('draws nothing until the run is planned', async () => {
    const { view, stdout } = startView()

    await act(async () => {
      view.event({ kind: 'started', index: 0 })
    })

    expect(stdout.frames).toEqual([])
  })

  it('draws the header and the notes above the progress line once the run is planned', async () => {
    const { view, frame } = startView()

    await plan(view)

    expect(frame()).toBe(`${header}\nShard 1/2 takes 1 stories file.\n⠋ 0/3 snapshots · 2 workers · 14.2s`)
  })

  it('counts a pass and prints nothing for it', async () => {
    const { view, frame } = startView()

    await plan(view)
    await act(async () => {
      view.event({ kind: 'started', index: 0 })
      view.event({ kind: 'finished', index: 0, mark: '✓', line: '✓ web  a  142 ms' })
    })

    expect(frame()).toBe(`${header}\nShard 1/2 takes 1 stories file.\n⠋ 1/3 snapshots · 2 workers · 14.2s`)
  })

  it('prints each ✗ and ! line above the progress line as its snapshot finishes', async () => {
    const { view, frame } = startView()

    await plan(view)
    await act(async () => {
      view.event({ kind: 'finished', index: 1, mark: '✗', line: '✗ web  b  missing: no baseline yet' })
      view.event({ kind: 'finished', index: 2, mark: '!', line: '! web  c  broken: The story threw.' })
    })

    expect(frame()).toBe(
      `${header}\nShard 1/2 takes 1 stories file.\n✗ web  b  missing: no baseline yet\n` +
        '! web  c  broken: The story threw.\n⠋ 2/3 snapshots · 2 workers · 14.2s',
    )
  })

  it('draws the ✗ mark in red and the ! mark in yellow', async () => {
    const { view, stdout } = startView()

    await plan(view)
    await act(async () => {
      view.event({ kind: 'finished', index: 1, mark: '✗', line: '✗ web  b  missing' })
      view.event({ kind: 'finished', index: 2, mark: '!', line: '! web  c  broken' })
    })

    expect(stdout.lastFrame()).toContain('\u001b[31m✗\u001b[39m web  b  missing\n')
    expect(stdout.lastFrame()).toContain('\u001b[33m!\u001b[39m web  c  broken\n')
  })

  it('draws no colour with NO_COLOR set', async () => {
    const { view, stdout } = startView({ environment: { NO_COLOR: '1' } })

    await plan(view)
    await act(async () => {
      view.event({ kind: 'finished', index: 1, mark: '✗', line: '✗ web  b  missing' })
    })

    expect(stdout.lastFrame()).toBe(plainFrameOf(stdout.lastFrame()))
  })

  it('redraws the time taken every second', async () => {
    let elapsed = 0
    const { view, frame } = startView({ elapsedMs: () => elapsed })

    await plan(view)
    expect(frame()).toContain('0/3 snapshots · 2 workers · 0 ms')

    elapsed = 1000
    await advanceTimers(999)
    expect(frame()).toContain('0/3 snapshots · 2 workers · 0 ms')

    await advanceTimers(1)
    expect(frame()).toContain('0/3 snapshots · 2 workers · 1.0s')
  })

  it('removes the progress line at finish, keeps the printed lines, and stops its timers', async () => {
    const { view, frame } = startView()

    await plan(view)
    await act(async () => {
      view.event({ kind: 'finished', index: 1, mark: '✗', line: '✗ web  b  missing' })
    })
    await finish(view)

    expect(frame()).toBe(`${header}\nShard 1/2 takes 1 stories file.\n✗ web  b  missing\n`)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resolves at finish and writes nothing when the run was never planned', async () => {
    const { view, stdout } = startView()

    await finish(view)

    expect(stdout.frames).toEqual([])
  })

  it('leaves the cursor on the cleared progress line at finish in a terminal, so no blank line is left', async () => {
    const { view, stdout } = startView({ debug: false })

    await plan(view)
    await act(async () => {
      view.event({ kind: 'finished', index: 1, mark: '✗', line: '✗ web  b  missing' })
    })
    await finish(view)

    const written = stdout.frames.join('')

    expect(plainFrameOf(written)).toContain('✗ web  b  missing\n')
    // The last thing written erases the progress line's row and goes to its start: no newline follows, so what the
    // run prints next takes that row. Only showing the cursor again may come after it.
    expect(written.replaceAll(showCursor, '').endsWith(eraseLineToStart)).toBe(true)
  })

  it('still hands the terminal back and resolves at finish when Ink fails to flush or exit', async () => {
    const { view, frame } = startView()

    await plan(view)
    faults.rejects = true

    await expect(finish(view)).resolves.toBeUndefined()
    // Unmounted: the spinner's and the progress line's timers are stopped.
    expect(vi.getTimerCount()).toBe(0)
    expect(frame()).toBe(`${header}\nShard 1/2 takes 1 stories file.\n`)
  })
})
