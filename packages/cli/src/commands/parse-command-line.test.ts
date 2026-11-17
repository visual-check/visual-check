import { describe, expect, it } from 'vitest'
import { parseCommandLine, UsageError } from './parse-command-line.js'

/**
 * The options a run has when no flag is given.
 */
const defaultOptions = {
  selection: { kind: 'default' },
  storybook: undefined,
  url: undefined,
  config: undefined,
  workers: undefined,
  consistency: false,
  shard: undefined,
  reporter: undefined,
}

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

  it.each(['filter', 'storybook', 'url', 'config', 'shard', 'reporter'])('rejects an empty --%s', (flag) => {
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
    ['--workers', ['--workers', '2']],
    ['--consistency', ['--consistency']],
    ['--shard', ['--shard', '2/4']],
    ['--reporter', ['--reporter', 'json']],
  ])('rejects %s for init', (flag, flagArguments) => {
    expect(usageErrorOf('init', ...flagArguments).message).toBe(`${flag} doesn't apply to init.`)
  })

  it('names the first flag given to init, in the order all, filter, storybook, url, config', () => {
    expect(usageErrorOf('init', '--config', 'a.ts', '--storybook', 'web').message).toBe(
      "--storybook doesn't apply to init.",
    )
  })

  it.each(['localhost:6006', 'ftp://example.com', 'nope'])('rejects the --url %j', (value) => {
    expect(usageErrorOf('test', '--url', value).message).toBe(
      `--url takes an http: or https: URL, such as 'http://127.0.0.1:6006'. Got '${value}'.`,
    )
  })

  it.each(['https://user:hunter2@example.com', 'http://:hunter2@127.0.0.1:6006'])(
    'rejects the --url %j, which holds a login, without printing it',
    (value) => {
      const { message } = usageErrorOf('test', '--url', value)

      expect(message).toBe(
        "--url can't hold a user name or password. visual-check sends no login: serve Storybook where visual-check " +
          'runs (storybook dev, or its static build served in the same CI job) and point --url at that.',
      )
      expect(message).not.toContain('hunter2')
    },
  )

  it('finds a login behind a protocol that is not http', () => {
    const { message } = usageErrorOf('test', '--url', 'ftp://u:hunter2@h')

    expect(message).toContain("--url can't hold a user name or password")
    expect(message).not.toContain('hunter2')
  })

  it('leaves out a value with an @ that may hide a password', () => {
    expect(usageErrorOf('test', '--url', 'user:hunter2@host:6006').message).toBe(
      "--url takes an http: or https: URL, such as 'http://127.0.0.1:6006'.",
    )
  })

  it('leaves out an extra argument that may hold a password, such as a URL given without --url', () => {
    const { message } = usageErrorOf('test', 'https://u:hunter2@h.io')

    expect(message).toBe('Unexpected argument (not shown: it may hold a password).')
    expect(message).not.toContain('hunter2')
  })

  it('leaves out an unknown command that may hold a password, such as a URL given first', () => {
    const { message } = usageErrorOf('https://u:hunter2@h.io', 'test')

    expect(message).toBe('Unknown command (not shown: it may hold a password). The commands are init, test and update.')
    expect(message).not.toContain('hunter2')
  })

  it('reports an unknown command and a flag that does not apply to init before a bad --url', () => {
    expect(usageErrorOf('tset', '--url', 'x').message).toBe(
      "Unknown command 'tset'. The commands are init, test and update.",
    )
    expect(usageErrorOf('init', '--url', 'nope').message).toBe("--url doesn't apply to init.")
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

  it.each([
    ['test', '2', 2],
    ['update', '12', 12],
  ] as const)('carries --workers for %s as a number', (command, value, workers) => {
    expect(parseCommandLine([command, '--workers', value])).toEqual({
      command,
      options: { ...defaultOptions, workers },
    })
  })

  it.each(['0', '1.5', '-1', 'auto', '02', '9007199254740992'])('rejects --workers %s, naming the value', (value) => {
    expect(usageErrorOf('test', `--workers=${value}`).message).toBe(
      `--workers takes a whole number of 1 or more. Got '${value}'.`,
    )
  })

  it('rejects an empty --workers', () => {
    expect(usageErrorOf('test', '--workers', '').message).toBe('--workers needs a value.')
  })
})

describe('parseCommandLine --consistency', () => {
  it('carries --consistency alone for test', () => {
    expect(parseCommandLine(['test', '--consistency'])).toEqual({
      command: 'test',
      options: { ...defaultOptions, consistency: true },
    })
  })

  it('carries --consistency with --storybook, --url and --config', () => {
    expect(
      parseCommandLine([
        'test',
        '--consistency',
        '--storybook',
        'web',
        '--url',
        'http://127.0.0.1:6006',
        '--config',
        'a.ts',
      ]),
    ).toEqual({
      command: 'test',
      options: {
        ...defaultOptions,
        consistency: true,
        storybook: 'web',
        url: 'http://127.0.0.1:6006',
        config: 'a.ts',
      },
    })
  })

  it.each([['--all'], ['--filter', 'x']])('rejects --consistency with %s', (...selectionFlags) => {
    expect(usageErrorOf('test', '--consistency', ...selectionFlags).message).toBe(
      '--consistency covers every story, so it takes no --all or --filter. Use --storybook to narrow it.',
    )
  })

  it('rejects --consistency for update', () => {
    expect(usageErrorOf('update', '--consistency').message).toBe('--consistency applies only to test.')
  })
})

describe('parseCommandLine --shard', () => {
  it.each([
    ['1/1', { index: 1, total: 1 }],
    ['2/4', { index: 2, total: 4 }],
    ['4/4', { index: 4, total: 4 }],
    ['10/12', { index: 10, total: 12 }],
  ])('carries --shard %s for test', (value, shard) => {
    expect(parseCommandLine(['test', '--shard', value])).toEqual({
      command: 'test',
      options: { ...defaultOptions, shard },
    })
  })

  it.each([['--filter', 'x'], ['--storybook', 'web'], ['--all']])('accepts --shard with %s', (...selectionFlags) => {
    expect(parseCommandLine(['test', '--shard', '2/4', ...selectionFlags])).toMatchObject({
      command: 'test',
      options: { shard: { index: 2, total: 4 } },
    })
  })

  it.each([
    '0/4',
    '5/4',
    '1.5/4',
    '2/4.0',
    '-1/4',
    'a/4',
    '2',
    '2/',
    '/4',
    '2/0',
    '0/0',
    ' 2/4',
    '2 / 4',
    '02/4',
    '9007199254740992/9007199254740993',
  ])('rejects --shard %j, naming the value', (value) => {
    expect(usageErrorOf('test', `--shard=${value}`).message).toBe(
      `--shard takes k/n, two whole numbers with 1 ≤ k ≤ n, such as 2/4. Got '${value}'.`,
    )
  })

  it('rejects an empty --shard', () => {
    expect(usageErrorOf('test', '--shard', '').message).toBe('--shard needs a value.')
  })

  it('rejects --shard for update, even with a bad value', () => {
    expect(usageErrorOf('update', '--shard', '2/4').message).toBe('--shard applies only to test.')
    expect(usageErrorOf('update', '--shard', 'nope').message).toBe('--shard applies only to test.')
  })

  it('rejects --shard with --consistency, even with a bad value', () => {
    const message = '--consistency runs in a job of its own, so it takes no --shard.'

    expect(usageErrorOf('test', '--consistency', '--shard', '2/4').message).toBe(message)
    expect(usageErrorOf('test', '--consistency', '--shard', 'nope').message).toBe(message)
  })

  it.each(['live', 'log', 'json'] as const)('parses --reporter %s for test', (reporter) => {
    expect(parseCommandLine(['test', '--reporter', reporter])).toEqual({
      command: 'test',
      options: { ...defaultOptions, reporter },
    })
  })

  it.each(['live', 'log', 'json'] as const)('parses --reporter %s for update', (reporter) => {
    expect(parseCommandLine(['update', '--reporter', reporter])).toEqual({
      command: 'update',
      options: { ...defaultOptions, reporter },
    })
  })

  it.each(['nope', 'JSON', 'json,log'])('rejects --reporter %j, naming the value', (value) => {
    expect(usageErrorOf('test', '--reporter', value).message).toBe(
      `--reporter takes live, log or json. Got '${value}'.`,
    )
  })
})

describe('parseCommandLine usage errors of a run', () => {
  it('names the run of a test whose flags clash, with its --config and --reporter', () => {
    expect(
      usageErrorOf('test', '--all', '--filter', 'a', '--config', 'configs/visual-check.config.ts', '--reporter', 'json')
        .run,
    ).toEqual({ command: 'test', config: 'configs/visual-check.config.ts', reporter: 'json' })
  })

  it('names the run of an update given a flag that applies only to test', () => {
    expect(usageErrorOf('update', '--shard', '1/2').run).toEqual({
      command: 'update',
      config: undefined,
      reporter: undefined,
    })
  })

  it('leaves out a --reporter that is itself the problem', () => {
    expect(usageErrorOf('test', '--reporter', 'nope').run).toEqual({
      command: 'test',
      config: undefined,
      reporter: undefined,
    })
  })

  it.each([
    ['an unknown flag', ['test', '--bogus'], 'test', undefined, undefined],
    ['json and an unknown flag', ['test', '--reporter', 'json', '--bogus'], 'test', undefined, 'json'],
    ['log and an unknown flag', ['test', '--bogus', '--reporter', 'log'], 'test', undefined, 'log'],
    ['an unknown reporter and flag', ['test', '--bogus', '--reporter', 'nope'], 'test', undefined, undefined],
    [
      'a config and an unknown flag',
      ['update', '--bogus', '--reporter=json', '--config', 'c.mjs'],
      'update',
      'c.mjs',
      'json',
    ],
    ['a flag missing its value', ['test', '--reporter', 'json', '--config'], 'test', undefined, 'json'],
    ['a flag whose value is another flag', ['test', '--filter', '--reporter', 'json'], 'test', undefined, 'json'],
    ['a config whose value is another flag', ['test', '--config', '--reporter=log'], 'test', undefined, 'log'],
  ] as const)(
    'names the run of a command line with %s that fails to parse, as far as its flags tell',
    (_, commandLineArguments, command, config, reporter) => {
      expect(usageErrorOf(...commandLineArguments).run).toEqual({ command, config, reporter })
    },
  )

  it.each([
    ['an unknown flag with no command', ['--nope', '--reporter', 'json']],
    ['an unknown flag of init', ['init', '--nope', '--reporter', 'json']],
    ['an unknown command', ['tset', '--all']],
    ['no command', ['--all']],
    ['init', ['init', '--all']],
  ])('names no run for %s', (_, commandLineArguments) => {
    expect(usageErrorOf(...commandLineArguments).run).toBeUndefined()
  })
})
