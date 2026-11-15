import { describe, expect, it } from 'vitest'
import { longPathWarningOf } from './update-baselines.js'

/**
 * The warning's first line.
 */
const head =
  "These baselines' paths are longer than 260 characters, which git on Windows checks out only with " +
  'core.longpaths set. Run git config core.longpaths true.'

/**
 * Builds a path under `/work` that is `length` characters long.
 */
function pathOfLength(length: number, name: string): string {
  return `${`/work/${name}`.padEnd(length - 4, 'x')}.png`
}

describe('longPathWarningOf', () => {
  it('lists each path over 260 characters in written order, relative to the folder the CLI runs in, on Windows', () => {
    const first = pathOfLength(261, 'a')
    const second = pathOfLength(300, 'b')

    expect(longPathWarningOf('win32', '/work', [first, '/work/short.png', second])).toBe(
      `${head}\n  ${first.slice('/work/'.length)}\n  ${second.slice('/work/'.length)}\n`,
    )
  })

  it('leaves out a path of exactly 260 characters', () => {
    expect(longPathWarningOf('win32', '/work', [pathOfLength(260, 'a')])).toBe('')
  })

  it('gives nothing on another OS', () => {
    expect(longPathWarningOf('linux', '/work', [pathOfLength(300, 'a')])).toBe('')
  })

  it('gives nothing when nothing was written', () => {
    expect(longPathWarningOf('win32', '/work', [])).toBe('')
  })
})
