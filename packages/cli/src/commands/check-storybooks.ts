import { readStories, type Story } from '../storybook/read-stories.js'
import { StorybookError, StorybookUnreachableError } from '../storybook/storybook-error.js'
import { checkStorybookVersion } from '../storybook/storybook-version.js'

/**
 * A Storybook in the run, as the checks need it.
 */
interface StorybookInRun {
  /**
   * The name the config gives the Storybook.
   */
  name: string
  /**
   * The absolute folder Storybook runs in.
   */
  dir: string
  /**
   * Where the running Storybook is served.
   */
  url: string
}

/**
 * A Storybook that passed its checks, with what they read.
 */
interface CheckedStorybook<T extends StorybookInRun> {
  /**
   * The Storybook.
   */
  storybook: T
  /**
   * The version of the `storybook` package installed for it, or `undefined` when it can't be read.
   */
  version: string | undefined
  /**
   * Its stories, from `index.json`.
   */
  stories: Story[]
}

/**
 * What the checks found: every Storybook with its version and stories, or the problems that stop the run. Warnings go
 * to standard error either way and never change the exit code.
 */
type StorybookChecks<T extends StorybookInRun> =
  | { storybooks: CheckedStorybook<T>[]; warnings: string[] }
  | { problems: string[]; unreachable: UnreachableStorybook[]; warnings: string[] }

/**
 * A Storybook where nothing answers, named as the report names it.
 */
interface UnreachableStorybook {
  /**
   * The name the config gives the Storybook.
   */
  name: string
  /**
   * Where the Storybook should be served.
   */
  url: string
}

/**
 * What checking one Storybook gave: the version warning if it has one, and either the checked Storybook or the problem
 * that stops the run.
 */
type StorybookOutcome<T extends StorybookInRun> = { warning: string | undefined } & (
  | CheckedStorybook<T>
  | { storybook: T; problem: string; unreachable: boolean }
)

/**
 * Checks one Storybook's version, then reads its stories. A version that is too old is the Storybook's problem, and
 * its `index.json` isn't read. A Storybook's own error becomes a problem; any other error is thrown.
 */
async function checkOneStorybook<T extends StorybookInRun>(storybook: T, cwd: string): Promise<StorybookOutcome<T>> {
  let warning: string | undefined

  try {
    const check = checkStorybookVersion(storybook, cwd)

    warning = check.warning

    return { storybook, version: check.version, stories: await readStories(storybook, cwd), warning }
  } catch (error) {
    if (error instanceof StorybookError) {
      return { storybook, problem: error.message, unreachable: error instanceof StorybookUnreachableError, warning }
    }

    throw error
  }
}

/**
 * Checks every Storybook in the run: the version of its installed `storybook`, then its stories from `index.json`.
 * Each Storybook that passes comes back with both. Every Storybook is checked, and every problem is reported, in
 * config order, with the Storybooks where nothing answers, by name and URL. With several Storybooks in the run and one
 * of them unreachable, the problems end with a line that suggests `--storybook`.
 *
 * @throws {Error} When a check fails in a way that isn't a Storybook's problem.
 */
export async function checkStorybooks<T extends StorybookInRun>(
  storybooks: T[],
  cwd: string,
): Promise<StorybookChecks<T>> {
  const outcomes = await Promise.all(storybooks.map((storybook) => checkOneStorybook(storybook, cwd)))
  const warnings = outcomes.flatMap((outcome) => outcome.warning ?? [])
  const failed = outcomes.filter((outcome) => 'problem' in outcome)

  if (failed.length === 0) {
    return {
      storybooks: outcomes
        .filter((outcome) => 'stories' in outcome)
        .map(({ storybook, version, stories }) => ({ storybook, version, stories })),
      warnings,
    }
  }

  const problems = failed.map((outcome) => outcome.problem)
  const unreachable = failed.flatMap(({ unreachable, storybook }) =>
    unreachable ? [{ name: storybook.name, url: storybook.url }] : [],
  )

  if (unreachable.length > 0 && storybooks.length > 1) {
    problems.push('To check one Storybook on its own, pass --storybook <name>.')
  }

  return { problems, unreachable, warnings }
}
