import { join } from 'node:path'
import { ContainerError, DockerMissingError } from '../container/container-error.js'
import { classifyStorybookVersion, minimumText, newestSupportedMajor } from '../storybook/storybook-version.js'
import type { DetectedProject } from './detect-project.js'
import { relativePathOf, storybookFolderOf } from './find-storybooks.js'
import type { Message } from './segment.js'

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
   * The project `init` detected, or `undefined` when it found no `package.json`.
   */
  project: DetectedProject | undefined
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
 * The problem when there's no project to set up.
 */
const noManifestProblem =
  "visual-check init found no package.json in the current folder or its parents. Run it in your project's folder."

/**
 * Lists what stops `init` before it asks anything, each as one line of text, in the order the checks run: Node, no
 * `package.json` (which ends the list, since the other checks need a project), a workspace root without one, an
 * unreadable `package.json` at the root, then in each Storybook's package, Deno, no terminal without `--yes`, no
 * Storybook, and each Storybook older than the minimum. Gives `[]` when `init` can go on.
 */
export function blockingProblemsOf({ cwd, nodeVersion, project, yes, interactive }: BlockingCheck): string[] {
  const nodeProblems = nodeProblemsOf(nodeVersion)

  if (project === undefined) {
    return [...nodeProblems, noManifestProblem]
  }

  return [...nodeProblems, ...setupProblemsOf(cwd, project, yes, interactive), ...storybookProblemsOf(project)]
}

/**
 * Lists the Node problem: a version below the minimum.
 */
function nodeProblemsOf(nodeVersion: string): string[] {
  if (Number(nodeVersion.split('.')[0]) >= minimumNodeMajor) {
    return []
  }

  return [
    `visual-check needs Node ${minimumNodeMajor} or later, and this is Node ${nodeVersion}. ` +
      'Upgrade Node, then run visual-check init again.',
  ]
}

/**
 * Lists the problems with the project and the run, in order: a workspace root without a `package.json`, such as
 * Rush's, an unreadable `package.json` at the root, then in each Storybook's package, Deno, and no terminal without
 * `--yes`.
 */
function setupProblemsOf(cwd: string, project: DetectedProject, yes: boolean, interactive: boolean): string[] {
  const problems: string[] = []

  if (!project.hasManifest) {
    const workspace = project.workspace.kind === 'rush' ? 'Rush workspace' : 'workspace'

    problems.push(
      `visual-check init needs a package.json at the root of this ${workspace}, for its scripts and the CLI. ` +
        'Add a private one, then run visual-check init again.',
    )
  }

  for (const [path, problem] of manifestProblemsOf(project)) {
    problems.push(
      `visual-check init can't read ${relativePathOf(cwd, path)}: ${problem}. Fix it, then run visual-check init again.`,
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

  return problems
}

/**
 * Gives what is wrong with each `package.json` `init` reads and can't: the root's, then each Storybook package's, by
 * absolute path, each once.
 */
function manifestProblemsOf(project: DetectedProject): Map<string, string> {
  const problems = new Map<string, string>()
  const found = [
    [project.manifestPath, project.manifestProblem] as const,
    ...project.storybooks.map(
      ({ manifestDir, manifestProblem }) => [join(manifestDir, 'package.json'), manifestProblem] as const,
    ),
  ]

  for (const [path, problem] of found) {
    if (problem !== undefined && !problems.has(path)) {
      problems.set(path, problem)
    }
  }

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
        `The Storybook in ${storybookFolderOf(configDir, project.root)} runs storybook ${version}, and visual-check needs ${minimumText} or later. ` +
        'Upgrade storybook, then run visual-check init again.',
    )
}

/**
 * The hint for a project on Yarn Plug'n'Play, where no Storybook's version can be read, so `init` skips the addon.
 */
const yarnPnpNote =
  "hint: init can't read Storybook's version under Yarn Plug'n'Play, so it skips the addon. To have init add it, " +
  'set nodeLinker: node-modules in .yarnrc.yml, run yarn install, then run init again.'

/**
 * Lists the notes about Storybook versions that don't stop `init`: a warning for a version above the tested ones, a
 * hint for a Storybook that isn't installed, so has no version. Under Yarn Plug'n'Play, one hint covers every Storybook
 * without a version, since none can be read there.
 */
export function versionNotesOf(project: DetectedProject): Message[] {
  const notes = project.storybooks.flatMap(({ configDir, version }) => {
    if (version === undefined) {
      return [
        project.yarnPnp
          ? yarnPnpNote
          : [
              "hint: storybook isn't installed for ",
              { code: storybookFolderOf(configDir, project.root) },
              ', so init skips its addon. Install dependencies, then run init again.',
            ],
      ]
    }

    if (classifyStorybookVersion(version) === 'above-maximum') {
      return [
        [
          'Warning: ',
          { code: storybookFolderOf(configDir, project.root) },
          ` runs storybook ${version}, ` +
            `newer than the versions visual-check is tested on (${minimumText} to ${newestSupportedMajor}).`,
        ],
      ]
    }

    return []
  })

  return [...new Set(notes)]
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
    `Warning: ${error.message} Start or install Docker before you run visual-check update, ` +
    "or set platform: 'host' in the config."

  return os === 'win32' && error instanceof DockerMissingError
    ? `${warning} If Docker runs inside WSL, run visual-check from inside WSL too.`
    : warning
}
