import { type ChildProcessByStdio, spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { CommandLine } from './package-manager.js'

/**
 * Runs a command in a folder and resolves its exit code. Where the command's output goes is up to the
 * implementation. The default one never rejects: a command that can't start resolves 127, which is what a POSIX shell
 * gives for a missing command. On Windows the command runs through `cmd.exe`, which exits 1 for a missing command.
 *
 * @public
 */
export type RunCommand = (command: string, args: readonly string[], cwd: string) => Promise<number>

/**
 * The exit code for a command that couldn't start.
 */
const couldNotStartExitCode = 127

/**
 * Double-quotes an argument for `cmd.exe`, so characters such as `^` stay as typed. Arguments never contain `"`, and
 * `cmd.exe` has no escape for one.
 */
export function quoteArgumentOf(argument: string): string {
  return `"${argument}"`
}

/**
 * Returns the one string Windows runs: the command and its arguments, each double-quoted. A command line with
 * separate arguments isn't passed to a shell, because Node deprecates that (DEP0190).
 */
export function windowsCommandLineOf({ command, args }: CommandLine): string {
  return [command, ...args].map(quoteArgumentOf).join(' ')
}

/**
 * Starts the command. On Windows it goes through a shell: `pnpm`, `npx` and `yarn` are `.cmd` shims, which Node won't
 * spawn without one since the fix for CVE-2024-27980.
 */
function startCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): ChildProcessByStdio<null, Readable, Readable> {
  const options = { cwd, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], windowsHide: true }

  return process.platform === 'win32'
    ? spawn(windowsCommandLineOf({ command, args: [...args] }), { ...options, shell: true })
    : spawn(command, [...args], options)
}

/**
 * Creates a `RunCommand` that spawns the command with its output piped to `progress` as it arrives. A command that
 * can't start writes why to `progress` and resolves 127.
 *
 * @public
 */
export function createRunCommand(progress: (text: string) => void): RunCommand {
  return (command, args, cwd) =>
    new Promise<number>((resolve) => {
      let settled = false
      const settle = (code: number): void => {
        if (!settled) {
          settled = true
          resolve(code)
        }
      }
      const failToStart = (error: unknown): void => {
        if (!settled) {
          progress(`${command} couldn't start: ${error instanceof Error ? error.message : String(error)}\n`)
        }

        settle(couldNotStartExitCode)
      }

      try {
        const child = startCommand(command, args, cwd)

        child.stdout.setEncoding('utf8').on('data', progress)
        child.stderr.setEncoding('utf8').on('data', progress)
        child.on('error', failToStart)
        child.on('close', (code) => settle(code ?? 1))
      } catch (error) {
        failToStart(error)
      }
    })
}
