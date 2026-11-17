import { Readable, Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { type Instance, render as inkRender, type Key } from 'ink'
import { cleanup, render } from 'ink-testing-library'
import { act, type ReactElement } from 'react'
import { vi } from 'vitest'

// React's `act` flushes renders and effects before it returns, but only where the environment says it is a test.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * A tree rendered into a fake terminal.
 */
type TestInstance = ReturnType<typeof render>

/**
 * What a terminal sends for the keys the questions read.
 */
export const keys = {
  /**
   * Enter.
   */
  enter: '\r',
  /**
   * Esc on its own.
   */
  escape: '\u001b',
  /**
   * The up arrow.
   */
  up: '\u001b[A',
  /**
   * The down arrow.
   */
  down: '\u001b[B',
  /**
   * The right arrow.
   */
  right: '\u001b[C',
  /**
   * The left arrow.
   */
  left: '\u001b[D',
  /**
   * Backspace.
   */
  backspace: '\u007f',
  /**
   * Forward delete.
   */
  delete: '\u001b[3~',
  /**
   * Tab.
   */
  tab: '\t',
  /**
   * Ctrl+C.
   */
  ctrlC: '\u0003',
  /**
   * Ctrl+D.
   */
  ctrlD: '\u0004',
  /**
   * Ctrl+U.
   */
  ctrlU: '\u0015',
  /**
   * Ctrl+K.
   */
  ctrlK: '\u000b',
  /**
   * Ctrl+Y.
   */
  ctrlY: '\u0019',
  /**
   * Meta+J, as a terminal sends it: Esc, then the letter.
   */
  metaJ: '\u001bj',
  /**
   * Meta+Y, as a terminal sends it: Esc, then the letter.
   */
  metaY: '\u001by',
}

/**
 * How long Ink waits for more bytes before it takes a lone Esc as the Esc key, plus a margin.
 */
const escapeDelayMilliseconds = 30

/**
 * Renders a tree into a fake terminal and waits until its effects have run, so it reads input and runs its timers.
 */
export function renderSettled(tree: ReactElement): Promise<TestInstance> {
  return act(async () => render(tree))
}

/**
 * The trees `renderSettledAt` rendered and `cleanupSettled` hasn't unmounted yet.
 */
const sizedInstances: Instance[] = []

/**
 * Renders a tree into a fake terminal `columns` wide and waits until its effects have run. Gives the last frame Ink
 * wrote.
 */
export async function renderSettledAt(
  tree: ReactElement,
  columns: number,
): Promise<{ lastFrame: () => string | undefined }> {
  const stdout = fakeStdout(columns)
  const instance = await act(async () =>
    inkRender(tree, { stdout, stdin: fakeStdin(), debug: true, exitOnCtrlC: false, patchConsole: false }),
  )

  sizedInstances.push(instance)

  return { lastFrame: stdout.lastFrame }
}

/**
 * Unmounts every tree the tests rendered and waits for React to finish, so no update lands outside `act`.
 */
export function cleanupSettled(): Promise<void> {
  return act(async () => {
    cleanup()

    for (const instance of sizedInstances.splice(0)) {
      instance.unmount()
    }
  })
}

/**
 * Types each chunk into the fake stdin in turn, as separate key presses, and waits for Ink to draw after each one.
 */
export async function press(stdin: TestInstance['stdin'], ...chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    await act(async () => {
      stdin.write(chunk)

      if (chunk === keys.escape) {
        await new Promise((resolve) => {
          setTimeout(resolve, escapeDelayMilliseconds)
        })
      }
    })
  }
}

/**
 * Moves the fake timers on and waits for Ink to draw what they changed.
 */
export async function advanceTimers(milliseconds: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds)
  })
}

/**
 * Ink's description of a key press, with only the given keys pressed.
 */
export function keyOf(pressed: Partial<Key>): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...pressed,
  }
}

/**
 * Gives a frame without its colours and styles, for tests where only the text matters.
 */
export function plainFrameOf(frame: string | undefined): string {
  return stripVTControlCharacters(frame ?? '')
}

/**
 * A fake terminal's input, for a view that renders itself: a TTY whose raw mode a test can read back, and which a test
 * types into with `typeInto`.
 */
export interface FakeStdin extends Readable {
  /**
   * Says the input is a terminal, so Ink reads keys from it.
   */
  isTTY: true
  /**
   * Each raw mode Ink set, in order.
   */
  rawModes: boolean[]
  /**
   * Records the raw mode Ink sets.
   */
  setRawMode: (mode: boolean) => FakeStdin
}

/**
 * A fake terminal's output, that keeps every frame Ink writes.
 */
export interface FakeStdout extends Writable {
  /**
   * How wide the terminal is.
   */
  columns: number
  /**
   * How tall the terminal is. Ink asks the system for a size the output doesn't give, so the fake gives both.
   */
  rows: number
  /**
   * Each frame written, in order. Ink's empty writes, which only wait for the ones before, are left out.
   */
  frames: string[]
  /**
   * Gives the last frame written.
   */
  lastFrame: () => string | undefined
}

/**
 * Makes a fake terminal's input. It reads nothing on its own: `typeInto` pushes what the person types.
 */
export function fakeStdin(): FakeStdin {
  const rawModes: boolean[] = []
  const stdin: FakeStdin = Object.assign(new Readable({ read: () => undefined }), {
    isTTY: true as const,
    rawModes,
    setRawMode: (mode: boolean) => {
      rawModes.push(mode)

      return stdin
    },
  })

  return stdin
}

/**
 * Makes a fake terminal's output, `columns` wide, which keeps each frame as it is written.
 */
export function fakeStdout(columns = 100): FakeStdout {
  const frames: string[] = []
  const writable = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const frame = chunk.toString()

      if (frame !== '') {
        frames.push(frame)
      }

      callback()
    },
  })

  return Object.assign(writable, { columns, rows: 24, frames, lastFrame: () => frames.at(-1) })
}

/**
 * Types each chunk into a fake input in turn, as separate key presses, and waits for Ink to read it and draw.
 */
export async function typeInto(stdin: FakeStdin, ...chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    await act(async () => {
      stdin.push(chunk)
      // The stream tells Ink there's input on a later tick, so wait past it.
      await new Promise((resolve) => {
        setTimeout(resolve, chunk === keys.escape ? escapeDelayMilliseconds : 0)
      })
    })
  }
}
