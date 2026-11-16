import { relative } from 'node:path'
import { ContainerError, DockerMissingError } from '../container/container-error.js'
import { classifyStorybookVersion, minimumText, newestSupportedMajor } from '../storybook/storybook-version.js'
import type { DetectedProject } from './detect-project.js'

/**
 * What `blockingProblemsOf` looks at.
 */
interface BlockingCheck {
  /**
   * The folder `init` runs in.
   */
  cwd: string
  /**
   * The Node version, such as `22.23.1`.
   */
  nodeVersion: string
  /**
   * The project `init` detected.
   */
  project: DetectedProject
  /**
   * Whether `--yes` was passed.
   */
  yes: boolean
  /**
   * Whether there's a terminal to ask questions in.
   */
  interactive: boolean
}

/**
 * The oldest Node major version visual-check runs on.
 */
const minimumNodeMajor = 22

/**
 * Lists what stops `init` before it asks anything, each as one line of text, in the order the checks run: Node, an
 * unreadable `package.json`, Deno, no terminal without `--yes`, no Storybook, and each Storybook older than the
 * minimum. Gives `[]` when `init` can go on.
 */
export function blockingProblemsOf({ cwd, nodeVersion, project, yes, interactive }: BlockingCheck): string[] {
  const problems: string[] = []

  if (Number(nodeVersion.split('.')[0]) < minimumNodeMajor) {
    problems.push(
      `visual-check needs Node ${minimumNodeMajor} or later, and this is Node ${nodeVersion}. ` +
        'Upgrade Node, then run visual-check init again.',
    )
  }

  if (project.manifestProblem !== undefined) {
    problems.push(
      `visual-check init can't read ${relative(cwd, project.manifestPath)}: ${project.manifestProblem}. ` +
        'Fix it, then run visual-check init again.',
    )
  }

  if (project.denoFile !== undefined) {
    problems.push(
      `visual-check doesn't support Deno, and this project has ${project.denoFile}. ` +
        'Run visual-check init in a Node project.',
    )
  }

  if (!yes && !interactive) {
    problems.push(
      "visual-check init asks questions, and there's no terminal to ask them in. " +
        'Run it in a terminal, or pass --yes to take every default.',
    )
  }

  problems.push(...storybookProblemsOf(project))

  return problems
}

/**
 * Lists the Storybook problems of a project: none found, or a version below the minimum.
 */
function storybookProblemsOf(project: DetectedProject): string[] {
  if (project.storybooks.length === 0) {
    return [
      'visual-check init found no Storybook: git lists no .storybook/main file (.ts, .js, .mjs, .cjs, .mts or .cts), ' +
        'and no script in package.json passes -c to storybook. Add Storybook, then run visual-check init again.',
    ]
  }

  return project.storybooks
    .filter(({ version }) => version !== undefined && classifyStorybookVersion(version) === 'below-minimum')
    .map(
      ({ configDir, version }) =>
        `The Storybook in ${configDir} runs storybook ${version}, and visual-check needs ${minimumText} or later. ` +
        'Upgrade storybook, then run visual-check init again.',
    )
}

/**
 * Lists the notes about Storybook versions that don't stop `init`: a warning for a version above the tested ones, a
 * hint for a Storybook that isn't installed, so has no version.
 */
export function versionNotesOf(project: DetectedProject): string[] {
  return project.storybooks.flatMap(({ configDir, version }) => {
    if (version === undefined) {
      return [
        `hint: storybook isn't installed for the Storybook in ${configDir}, so init can't tell its version and skips ` +
          'the addon. Install dependencies, then run visual-check init again to add it.',
      ]
    }

    if (classifyStorybookVersion(version) === 'above-maximum') {
      return [
        `Warning: The Storybook in ${configDir} runs storybook ${version}, ` +
          `and visual-check is tested on ${minimumText} to ${newestSupportedMajor}. init carries on.`,
      ]
    }

    return []
  })
}

/**
 * Words the warning for a Docker that `probeDocker` rejected. A Docker that is missing or stopped gets the fix to start
 * or install it, and on Windows a missing one also gets the WSL sentence. Any other container error gives its message.
 *
 * @throws The error itself, when it isn't a `ContainerError`.
 */
export function dockerWarningOf(error: unknown, os: NodeJS.Platform): string {
  if (!(error instanceof ContainerError)) {
    throw error
  }

  if (error.fix !== 'docker') {
    return `Warning: ${error.message}`
  }

  const warning =
    `Warning: ${error.message} visual-check runs the browser in Docker: start or install Docker before you ` +
    "run visual:update, or set platform: 'host' in visual-check.config.ts."

  return os === 'win32' && error instanceof DockerMissingError
    ? `${warning} If Docker runs inside WSL, run visual-check from inside WSL too.`
    : warning
}
