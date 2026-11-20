import { relative, sep } from 'node:path'

/**
 * A command the runner script runs: its words, the program first, and the absolute folder it runs in.
 *
 * @public
 */
export interface SkillCommand {
  /**
   * The command's words, the program first. No word is ever split.
   */
  command: string[]
  /**
   * The absolute folder the command runs in. `setup.json` holds it relative to its own folder.
   */
  cwd: string
}

/**
 * What the agent skill's `setup.json` holds: the CLI command, and each Storybook's start command by config name.
 *
 * @public
 */
export interface SkillSetup {
  /**
   * The command that runs the project's own visual-check CLI, from the workspace root.
   */
  cli: SkillCommand
  /**
   * Each Storybook's start command, keyed by its config name. JSON puts integer-like names, such as `2`, first.
   */
  storybooks: Record<string, SkillCommand>
}

/**
 * Gives the text of `setup.json` in `setupDir`: two-space JSON ending in a line break, each `cwd` relative to
 * `setupDir` with `/` separators, `.` for `setupDir` itself.
 */
export function setupFileTextOf(setup: SkillSetup, setupDir: string): string {
  const entryOf = ({ command, cwd }: SkillCommand) => ({
    command,
    cwd: relative(setupDir, cwd).split(sep).join('/') || '.',
  })
  const storybooks = Object.fromEntries(
    Object.entries(setup.storybooks).map(([name, command]) => [name, entryOf(command)]),
  )

  return `${JSON.stringify({ cli: entryOf(setup.cli), storybooks }, null, 2)}\n`
}
