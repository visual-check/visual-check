import { stripVTControlCharacters } from 'node:util'
import type { Key } from 'ink'
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
 * Unmounts every tree the tests rendered and waits for React to finish, so no update lands outside `act`.
 */
export function cleanupSettled(): Promise<void> {
  return act(async () => {
    cleanup()
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
