import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cliArgvOf,
  exitCodeOf,
  failedStartMessageOf,
  indexUrlOf,
  outputTail,
  portMismatchMessageOf,
  portOf,
  reportOf,
  reusedLineOf,
  setupOf,
  startedPortOf,
  stoppedMidRunMessageOf,
  storybookArgvOf,
  windowsCommandLineOf,
} from '../skill/scripts/run.mjs'

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
  it("quotes every argument, so cmd.exe's special characters stay literal", () => {
    expect(windowsCommandLineOf(['pnpm', 'exec', 'visual-check', 'test', '--filter', '^(a|b)&<c> d$'])).toBe(
      'pnpm "exec" "visual-check" "test" "--filter" "^(a|b)&<c> d$"',
    )
  })

  it.each([['npm'], ['pnpm.cmd'], ['yarn'], ['my_tool-2']])(
    'leaves the program %s bare, so a .cmd shim found through PATH gets its own folder as %%~dp0',
    (program) => {
      expect(windowsCommandLineOf([program, 'run'])).toBe(`${program} "run"`)
    },
  )

  it.each([
    ['a path', 'C:\\Program Files\\nodejs\\npm.cmd'],
    ['a relative path', 'node_modules\\.bin\\storybook.cmd'],
    ['a name with a special character', 'a&b'],
    ['a name with a space', 'my tool'],
  ])('quotes a program that is %s', (_case, program) => {
    expect(windowsCommandLineOf([program, 'run'])).toBe(`"${program}" "run"`)
  })

  it("doubles a word's trailing backslashes and leaves inner ones", () => {
    expect(windowsCommandLineOf(['C:\\dir\\', 'C:\\a\\b'])).toBe('"C:\\dir\\\\" "C:\\a\\b"')
  })

  it('passes a lone percent sign, which cmd.exe leaves as it is', () => {
    expect(windowsCommandLineOf(['pnpm', '--threshold', '50%'])).toBe('pnpm "--threshold" "50%"')
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

describe('reportOf', () => {
  const web = { name: 'web', url: 'http://127.0.0.1:6006' }
  const docs = { name: 'docs', url: 'http://127.0.0.1:6007' }

  it('reads the Storybooks of a run error and those where nothing answers', () => {
    const stdout = JSON.stringify({
      exitCode: 2,
      storybooks: [web, docs],
      error: { message: 'Nothing answers.', storybooks: [docs] },
    })

    expect(reportOf(`${stdout}\n`)).toEqual({ storybooks: [web, docs], unreachable: [docs], runError: true })
  })

  it('reads a run without a run error', () => {
    expect(reportOf(JSON.stringify({ exitCode: 1, storybooks: [web], error: null }))).toEqual({
      storybooks: [web],
      unreachable: [],
      runError: false,
    })
  })

  it('reads a run error that names no Storybooks', () => {
    expect(reportOf(JSON.stringify({ exitCode: 2, storybooks: [], error: { message: 'Docker is missing.' } }))).toEqual(
      { storybooks: [], unreachable: [], runError: true },
    )
  })

  it('leaves out entries without a string name and URL', () => {
    const stdout = JSON.stringify({
      storybooks: [web, { name: 'no-url' }, { url: 'http://x' }, { name: 3, url: 'http://y' }, null],
      error: { storybooks: [{ name: 'docs' }, docs] },
    })

    expect(reportOf(stdout)).toEqual({ storybooks: [web], unreachable: [docs], runError: true })
  })

  it.each([
    ['junk', 'Error: boom'],
    ['nothing', ''],
    ['a list', '[]'],
    ['an object without Storybooks', '{"exitCode":0}'],
  ])('gives undefined for %s', (_case, stdout) => {
    expect(reportOf(stdout)).toBeUndefined()
  })
})

describe('storybookArgvOf', () => {
  it.each([[['pnpm', 'run', 'storybook']], [['yarn', 'storybook']], [['bun', 'run', 'storybook']]])(
    'appends --ci --exact-port without -- for %j',
    (argv) => {
      expect(storybookArgvOf(argv)).toEqual([...argv, '--ci', '--exact-port'])
    },
  )

  it.each([[['npm', 'run', 'storybook']], [['npm.cmd', 'run', 'storybook']], [['NPM.EXE', 'run', 'storybook']]])(
    'puts -- before the flags under npm, for %j',
    (argv) => {
      expect(storybookArgvOf(argv)).toEqual([...argv, '--', '--ci', '--exact-port'])
    },
  )

  it('adds no second -- under npm', () => {
    expect(storybookArgvOf(['npm', 'run', 'storybook', '--', '-p', '6006'])).toEqual([
      'npm',
      'run',
      'storybook',
      '--',
      '-p',
      '6006',
      '--ci',
      '--exact-port',
    ])
  })
})

describe('indexUrlOf', () => {
  it.each([
    ['http://127.0.0.1:6006', 'http://127.0.0.1:6006/index.json'],
    ['http://127.0.0.1:6006/', 'http://127.0.0.1:6006/index.json'],
    ['https://host/sb', 'https://host/sb/index.json'],
    ['https://host/sb/', 'https://host/sb/index.json'],
    ['https://user:secret@host/sb?path=/story/a#top', 'https://host/sb/index.json'],
  ])('gives %s the index %s', (url, index) => {
    expect(indexUrlOf(url)).toBe(index)
  })
})

describe('portOf', () => {
  it.each([
    ['http://127.0.0.1:6006', 6006],
    ['http://host/sb', 80],
    ['https://host/sb', 443],
    ['https://host:8443', 8443],
  ])('gives %s the port %s', (url, port) => {
    expect(portOf(url)).toBe(port)
  })
})

describe('startedPortOf', () => {
  const border = '\x1b[38;2;255;71;133m│\x1b[39m'

  it("reads the port of Storybook 10's banner, with its colours and borders", () => {
    const line = `│ ${border}   - Local:                http://127.0.0.1:6123/                           ${border}`

    expect(startedPortOf(line)).toBe(6123)
  })

  it("reads the port of Storybook 9.1's table row", () => {
    expect(startedPortOf('Local:            http://localhost:6006/')).toBe(6006)
  })

  it.each([
    ['a URL without the Local label', 'See https://storybook.js.org/docs for more.'],
    ['the network line', '│ │   - On your network:      http://192.168.1.2:6006/   │'],
    ['a Local label without a URL', 'Local:   not yet'],
  ])('gives undefined for %s', (_case, line) => {
    expect(startedPortOf(line)).toBeUndefined()
  })
})

describe('outputTail', () => {
  it('joins lines split across chunks and returns the lines each chunk completes', () => {
    const tail = outputTail(15)

    expect(tail.add('first li')).toEqual([])
    expect(tail.add('ne\r\nsecond\nthi')).toEqual(['first line', 'second'])
    expect(tail.lines()).toEqual(['first line', 'second', 'thi'])
  })

  it('strips colours and trailing whitespace, and skips blank lines', () => {
    const tail = outputTail(15)

    tail.add('\x1b[31mred\x1b[39m   \n\n   \n\tindented\n')

    expect(tail.lines()).toEqual(['red', '\tindented'])
  })

  it('keeps only the last lines', () => {
    const tail = outputTail(3)

    tail.add('1\n2\n3\n4\n')
    tail.add('5')

    expect(tail.lines()).toEqual(['3', '4', '5'])
  })
})

describe('the messages', () => {
  const index = 'http://127.0.0.1:6006/index.json'

  it('names both ports of a port mismatch', () => {
    expect(portMismatchMessageOf('web', 6007, 'http://127.0.0.1:6006')).toBe(
      'Storybook web started on port 6007, but its URL http://127.0.0.1:6006 is on port 6006. Make its start command and its URL use the same port.',
    )
  })

  it('shows the end of the output of a Storybook that exited, indented', () => {
    expect(failedStartMessageOf('web', { exitCode: 1 }, index, ['Error: boom', 'at main'])).toBe(
      `Storybook web exited with code 1 before it answered at ${index}. The end of its output:\n  Error: boom\n  at main`,
    )
  })

  it('says a Storybook that exited printed nothing', () => {
    expect(failedStartMessageOf('web', { exitCode: 1 }, index, [])).toBe(
      `Storybook web exited with code 1 before it answered at ${index}, and printed nothing.`,
    )
  })

  it('shows the end of the output of a Storybook that ran out of time', () => {
    expect(failedStartMessageOf('web', { timeout: true }, index, ['compiling'])).toBe(
      `Storybook web didn't answer at ${index} within 180 s. The end of its output:\n  compiling`,
    )
  })

  it('says a Storybook that ran out of time printed nothing', () => {
    expect(failedStartMessageOf('web', { timeout: true }, index, [])).toBe(
      `Storybook web didn't answer at ${index} within 180 s, and printed nothing.`,
    )
  })

  it('says a Storybook stopped answering during the run', () => {
    expect(stoppedMidRunMessageOf({ name: 'web', url: 'http://127.0.0.1:6006' })).toBe(
      "Storybook web stopped answering at http://127.0.0.1:6006 during the run, so the run's results can't be trusted. Another session may have stopped it. Run the script again.",
    )
  })

  it('says the run reused a Storybook', () => {
    expect(reusedLineOf({ name: 'web', url: 'http://127.0.0.1:6006' })).toBe(
      'Reused Storybook web, which was already running at http://127.0.0.1:6006.',
    )
  })
})
