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

/**
 * The top-level keys of `setup.json` this version's runner script reads. A version that needs a new key adds it here,
 * so the run that refreshes the skill after an upgrade warns to run `init` again.
 */
const setupKeys = ['cli', 'storybooks'] as const

/**
 * Says what keeps an installed `setup.json` from serving this version's runner script: it doesn't exist, isn't JSON,
 * or lacks a key the script reads. `undefined` when nothing does. It doesn't check the values: the script does.
 */
export function setupFileProblemOf(text: string | undefined): string | undefined {
  if (text === undefined) {
    return "doesn't exist"
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return "isn't valid JSON"
  }

  const record = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}
  const missing = setupKeys.filter((key) => !Object.hasOwn(record, key))

  return missing.length === 0 ? undefined : `has no ${missing.join(' or ')}`
}
