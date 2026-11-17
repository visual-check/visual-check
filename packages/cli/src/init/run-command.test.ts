import { describe, expect, it } from 'vitest'
import { createRunCommand, quoteArgumentOf, windowsCommandLineOf } from './run-command.js'

describe('createRunCommand', () => {
  it('resolves the exit code and sends the output to progress', async () => {
    let output = ''
    const runCommand = createRunCommand((text) => {
      output += text
    })
    const code = await runCommand(
      process.execPath,
      ['-e', "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"],
      process.cwd(),
    )

    expect(code).toBe(3)
    expect(output).toContain('out')
    expect(output).toContain('err')
  })

  it.skipIf(process.platform === 'win32')("resolves 127 for a command that can't start", async () => {
    let output = ''
    const runCommand = createRunCommand((text) => {
      output += text
    })
    const code = await runCommand('visual-check-no-such-command-xyz', [], process.cwd())

    expect(code).toBe(127)
    expect(output).toBe(
      "visual-check-no-such-command-xyz couldn't start: spawn visual-check-no-such-command-xyz ENOENT\n",
    )
  })

  it('resolves 127 when spawn throws, without rejecting', async () => {
    let output = ''
    const runCommand = createRunCommand((text) => {
      output += text
    })
    const code = await runCommand('a\0b', [], process.cwd())

    expect(code).toBe(127)
    expect(output).toContain("a\0b couldn't start: ")
  })
})

describe('quoteArgumentOf', () => {
  it('quotes a plain argument', () => {
    expect(quoteArgumentOf('add')).toBe('"add"')
  })

  it('quotes an argument with a space', () => {
    expect(quoteArgumentOf('my folder')).toBe('"my folder"')
  })

  it('quotes a range with a caret', () => {
    expect(quoteArgumentOf('@visual-check/chromium@^157.0.0')).toBe('"@visual-check/chromium@^157.0.0"')
  })
})

describe('windowsCommandLineOf', () => {
  it('quotes the command and every argument into one string', () => {
    expect(windowsCommandLineOf({ command: 'pnpm', args: ['add', '--save-dev', 'a@^1.0.0'] })).toBe(
      '"pnpm" "add" "--save-dev" "a@^1.0.0"',
    )
  })
})
