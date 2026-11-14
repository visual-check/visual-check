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
 * What the checks found: every Storybook's stories, or the problems that stop the run. Warnings go to standard error
 * either way and never change the exit code.
 */
type StorybookChecks =
  | { storybooks: { name: string; stories: Story[] }[]; warnings: string[] }
  | { problems: string[]; warnings: string[] }

/**
 * What checking one Storybook gave: the version warning if it has one, and either its stories or the problem that
 * stops the run.
 */
type StorybookOutcome = { warning: string | undefined } & (
  | { name: string; stories: Story[] }
  | { problem: string; unreachable: boolean }
)

/**
 * Checks one Storybook's version, then reads its stories. A version that is too old is the Storybook's problem, and
 * its `index.json` isn't read. A Storybook's own error becomes a problem; any other error is thrown.
 */
async function checkOneStorybook(storybook: StorybookInRun, cwd: string): Promise<StorybookOutcome> {
  let warning: string | undefined

  try {
    warning = checkStorybookVersion(storybook, cwd)

    return { name: storybook.name, stories: await readStories(storybook, cwd), warning }
  } catch (error) {
    if (error instanceof StorybookError) {
      return { problem: error.message, unreachable: error instanceof StorybookUnreachableError, warning }
    }

    throw error
  }
}

/**
 * Checks every Storybook in the run: the version of its installed `storybook`, then its stories from `index.json`.
 * Every Storybook is checked, and every problem is reported, in config order. With several Storybooks in the run and
 * one of them unreachable, the problems end with a line that suggests `--storybook`.
 *
 * @throws {Error} When a check fails in a way that isn't a Storybook's problem.
 */
export async function checkStorybooks(storybooks: StorybookInRun[], cwd: string): Promise<StorybookChecks> {
  const outcomes = await Promise.all(storybooks.map((storybook) => checkOneStorybook(storybook, cwd)))
  const warnings = outcomes.flatMap((outcome) => outcome.warning ?? [])
  const failed = outcomes.filter((outcome) => 'problem' in outcome)

  if (failed.length === 0) {
    return {
      storybooks: outcomes
        .filter((outcome) => 'stories' in outcome)
        .map((outcome) => ({ name: outcome.name, stories: outcome.stories })),
      warnings,
    }
  }

  const problems = failed.map((outcome) => outcome.problem)

  if (failed.some((outcome) => outcome.unreachable) && storybooks.length > 1) {
    problems.push('To check one Storybook on its own, pass --storybook <name>.')
  }

  return { problems, warnings }
}
