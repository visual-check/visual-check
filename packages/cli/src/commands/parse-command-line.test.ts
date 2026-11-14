import { describe, expect, it } from 'vitest'
import { parseCommandLine, UsageError } from './parse-command-line.js'

/**
 * The options a run has when no flag is given.
 */
const defaultOptions = { selection: { kind: 'default' }, storybook: undefined, url: undefined, config: undefined }

/**
 * Parses the command line and returns the `UsageError` it throws, failing the test when it throws nothing else.
 */
function usageErrorOf(...commandLineArguments: string[]): UsageError {
  try {
    parseCommandLine(commandLineArguments)
  } catch (error) {
    if (error instanceof UsageError) {
      return error
    }

    throw error
  }

  throw new Error('Expected a UsageError.')
}

describe('parseCommandLine', () => {
  it.each(['test', 'update'] as const)('parses %s with the default options', (command) => {
    expect(parseCommandLine([command])).toEqual({ command, options: defaultOptions })
  })

  it('parses init', () => {
    expect(parseCommandLine(['init'])).toEqual({ command: 'init' })
  })

  it('parses --help alone, with a command and with other flags', () => {
    expect(parseCommandLine(['--help'])).toEqual({ command: 'help' })
    expect(parseCommandLine(['test', '--help'])).toEqual({ command: 'help' })
    expect(parseCommandLine(['--all', '--filter', 'x', '--help'])).toEqual({ command: 'help' })
    expect(parseCommandLine(['init', '--all', '--help'])).toEqual({ command: 'help' })
  })

  it('parses --version', () => {
    expect(parseCommandLine(['--version'])).toEqual({ command: 'version' })
  })

  it('rejects no command', () => {
    expect(usageErrorOf().message).toBe('No command given.')
    expect(usageErrorOf('--all').message).toBe('No command given.')
  })

  it('rejects an unknown command', () => {
    expect(usageErrorOf('build').message).toBe("Unknown command 'build'. The commands are init, test and update.")
  })

  it('reports an unknown command before an extra argument', () => {
    expect(usageErrorOf('tset', 'foo').message).toBe("Unknown command 'tset'. The commands are init, test and update.")
  })

  it('lets --help win over a bad flag, but not after a -- separator', () => {
    expect(parseCommandLine(['--help', '--bogus'])).toEqual({ command: 'help' })
    expect(parseCommandLine(['--bogus', '--help'])).toEqual({ command: 'help' })
    expect(usageErrorOf('test', '--', '--help').message).toBe("Unexpected argument '--help'.")
  })

  it.each(['filter', 'storybook', 'url', 'config'])('rejects an empty --%s', (flag) => {
    expect(usageErrorOf('test', `--${flag}=`).message).toBe(`--${flag} needs a value.`)
    expect(usageErrorOf('test', `--${flag}`, '').message).toBe(`--${flag} needs a value.`)
  })

  it('rejects an extra argument', () => {
    expect(usageErrorOf('test', 'extra').message).toBe("Unexpected argument 'extra'.")
  })

  it('rejects an unknown flag', () => {
    expect(usageErrorOf('test', '--nope').message).toContain("Unknown option '--nope'")
  })

  it('rejects a flag with no value', () => {
    expect(usageErrorOf('test', '--filter').message).toContain("Option '--filter <value>' argument missing")
  })

  it.each([
    ['--all', ['--all']],
    ['--filter', ['--filter', 'x']],
    ['--storybook', ['--storybook', 'web']],
    ['--url', ['--url', 'http://127.0.0.1:6006']],
    ['--config', ['--config', 'visual-check.config.ts']],
  ])('rejects %s for init', (flag, flagArguments) => {
    expect(usageErrorOf('init', ...flagArguments).message).toBe(`${flag} doesn't apply to init.`)
  })

  it('names the first flag given to init, in the order all, filter, storybook, url, config', () => {
    expect(usageErrorOf('init', '--config', 'a.ts', '--storybook', 'web').message).toBe(
      "--storybook doesn't apply to init.",
    )
  })

  it('rejects --all with --filter', () => {
    expect(usageErrorOf('test', '--all', '--filter', 'x').message).toBe(
      "--all and --filter can't be used together. Pick one.",
    )
  })

  it('rejects a --filter that is not a regular expression', () => {
    expect(usageErrorOf('test', '--filter', '(').message).toMatch(/^--filter takes a regular expression: .+/)
  })

  it('builds a working regular expression from --filter', () => {
    const command = parseCommandLine(['test', '--filter', '^button--'])

    expect(command).toMatchObject({ options: { selection: { kind: 'filter' } } })

    if (command.command !== 'test' || command.options.selection.kind !== 'filter') {
      throw new Error('Expected a test command with a filter.')
    }

    expect(command.options.selection.pattern.test('button--primary')).toBe(true)
    expect(command.options.selection.pattern.test('forms-button--primary')).toBe(false)
  })

  it('tells --all from no selection flag', () => {
    expect(parseCommandLine(['update', '--all'])).toEqual({
      command: 'update',
      options: { ...defaultOptions, selection: { kind: 'all' } },
    })
  })

  it('carries --storybook, --url and --config', () => {
    expect(
      parseCommandLine(['test', '--storybook', 'web', '--url', 'http://127.0.0.1:6006', '--config', 'a.ts']),
    ).toEqual({
      command: 'test',
      options: { ...defaultOptions, storybook: 'web', url: 'http://127.0.0.1:6006', config: 'a.ts' },
    })
  })
})
