import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cliArgvOf, exitCodeOf, setupOf, windowsCommandLineOf } from '../skill/scripts/run.mjs'

/**
 * The folder the cases' `setup.json` sits in.
 */
const setupDir = resolve('/project/.agents/skills/visual-check')

describe('setupOf', () => {
  it('resolves relative folders against the setup folder and keeps absolute ones', () => {
    const absolute = resolve('/elsewhere/apps/web')
    const text = JSON.stringify({
      cli: { command: ['pnpm', 'exec', 'visual-check'], cwd: '../../..' },
      storybooks: { web: { command: ['pnpm', 'run', 'storybook'], cwd: absolute } },
    })

    expect(setupOf(text, setupDir)).toEqual({
      cli: { argv: ['pnpm', 'exec', 'visual-check'], cwd: resolve('/project') },
      storybooks: { web: { argv: ['pnpm', 'run', 'storybook'], cwd: absolute } },
    })
  })

  it('reads a setup with no Storybooks', () => {
    const text = JSON.stringify({ cli: { command: ['visual-check'], cwd: '.' }, storybooks: {} })

    expect(setupOf(text, setupDir)).toEqual({ cli: { argv: ['visual-check'], cwd: setupDir }, storybooks: {} })
  })

  it('names the parser error when the text is not JSON', () => {
    expect(() => setupOf('{ cli', setupDir)).toThrow(/^it isn't valid JSON \(.+\)$/)
  })

  it.each([
    ['cli is missing', { storybooks: {} }, 'cli.command must be a list of words, starting with the program'],
    [
      'the command is empty',
      { cli: { command: [], cwd: '.' }, storybooks: {} },
      'cli.command must be a list of words, starting with the program',
    ],
    [
      'the command holds a number',
      { cli: { command: ['pnpm', 1], cwd: '.' }, storybooks: {} },
      'cli.command must be a list of words, starting with the program',
    ],
    [
      'the command holds an empty word',
      { cli: { command: ['pnpm', ''], cwd: '.' }, storybooks: {} },
      'cli.command must be a list of words, starting with the program',
    ],
    [
      'the command is a string',
      { cli: { command: 'pnpm exec visual-check', cwd: '.' }, storybooks: {} },
      'cli.command must be a list of words, starting with the program',
    ],
    ['the folder is missing', { cli: { command: ['pnpm'] }, storybooks: {} }, 'cli.cwd must be a folder'],
    [
      'storybooks is a list',
      { cli: { command: ['pnpm'], cwd: '.' }, storybooks: [] },
      "storybooks must map each Storybook's name to its start command and folder",
    ],
    [
      'a Storybook has no command',
      { cli: { command: ['pnpm'], cwd: '.' }, storybooks: { web: { cwd: '.' } } },
      'storybooks.web.command must be a list of words, starting with the program',
    ],
    [
      'a Storybook has no folder',
      { cli: { command: ['pnpm'], cwd: '.' }, storybooks: { web: { command: ['pnpm'] } } },
      'storybooks.web.cwd must be a folder',
    ],
  ])('gives the reason when %s', (_case, setup, reason) => {
    expect(() => setupOf(JSON.stringify(setup), setupDir)).toThrow(new Error(reason))
  })
})

describe('cliArgvOf', () => {
  it("appends the caller's arguments in order, then the JSON reporter", () => {
    expect(cliArgvOf(['pnpm', 'exec', 'visual-check'], ['test', '--base', 'main'])).toEqual([
      'pnpm',
      'exec',
      'visual-check',
      'test',
      '--base',
      'main',
      '--reporter',
      'json',
    ])
  })

  it('appends the JSON reporter when the caller gives no arguments', () => {
    expect(cliArgvOf(['visual-check'], [])).toEqual(['visual-check', '--reporter', 'json'])
  })
})

describe('windowsCommandLineOf', () => {
  it("quotes every word, so cmd.exe's special characters stay literal", () => {
    expect(windowsCommandLineOf(['pnpm', 'exec', 'visual-check', 'test', '--filter', '^(a|b)&<c> d$'])).toBe(
      '"pnpm" "exec" "visual-check" "test" "--filter" "^(a|b)&<c> d$"',
    )
  })

  it("doubles a word's trailing backslashes and leaves inner ones", () => {
    expect(windowsCommandLineOf(['C:\\dir\\', 'C:\\a\\b'])).toBe('"C:\\dir\\\\" "C:\\a\\b"')
  })

  it('passes a lone percent sign, which cmd.exe leaves as it is', () => {
    expect(windowsCommandLineOf(['--threshold', '50%'])).toBe('"--threshold" "50%"')
  })

  it.each([
    ['a double quote', 'say "hi"'],
    ['a line feed', `two${'\n'}lines`],
    ['a carriage return', `two${'\r'}lines`],
    ['a name between percent signs', 'C:\\%PATH%\\bin'],
  ])('refuses a word holding %s, naming it', (_case, word) => {
    expect(() => windowsCommandLineOf(['pnpm', word])).toThrow(
      new Error(
        `On Windows the script can't pass an argument that holds a double quote, a line break or a %name%: ${word}`,
      ),
    )
  })
})

describe('exitCodeOf', () => {
  it.each([
    [0, null, 0],
    [1, 'SIGTERM', 1],
    [null, 'SIGINT', 130],
    [null, 'SIGTERM', 143],
    [null, null, 2],
    [null, 'SIGNOTONE', 2],
  ] as const)('gives %s and %s the exit code %s', (code, signal, exitCode) => {
    expect(exitCodeOf(code, signal)).toBe(exitCode)
  })
})
