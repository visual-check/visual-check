import { dirname, join } from 'node:path'
import type { ProbeDocker } from '../container/docker-probe.js'
import { closingMessageOf, type SetUpStorybook, type Written, writtenLinesOf } from './closing-message.js'
import { type DetectedProject, detectProject } from './detect-project.js'
import { type ExistingConfig, existingConfigOf, existingStorybooksOf } from './existing-config.js'
import type { ListFiles } from './find-storybooks.js'
import { blockingProblemsOf, dockerWarningOf, versionNotesOf } from './init-checks.js'
import { addAddons, dependenciesToAddOf, installDependencies } from './install.js'
import { InputEndedError, type Prompter } from './prompter.js'
import { type Answers, askQuestions } from './questions.js'
import type { RunCommand } from './run-command.js'
import { configSourceOf, modesFileSource, setScripts, visualCheckGitignore, writeIfMissing } from './setup-files.js'
import {
  type FindUnlistedDependencies,
  fallowFailureWarningOf,
  unlistedDependenciesWarningOf,
} from './unlisted-dependencies.js'

/**
 * What `runInit` needs besides the folder it runs in: the flags, what it runs on, the prompter, and the tools that
 * reach outside the process. A test gives fakes.
 *
 * @public
 */
export interface InitTools {
  /**
   * Whether `--yes` was passed, which takes every default.
   */
  yes: boolean
  /**
   * Whether there's a terminal to ask questions in.
   */
  interactive: boolean
  /**
   * The Node version, such as `22.23.1`.
   */
  nodeVersion: string
  /**
   * The OS `init` runs on, which decides whether the Docker warning adds the WSL sentence.
   */
  os: NodeJS.Platform
  /**
   * The version of the CLI that runs `init`, which the dependencies and the addon are added at.
   */
  cliVersion: string
  /**
   * The range of `@visual-check/chromium` the CLI works with, which the browser package is added at.
   */
  browserRange: string
  /**
   * Asks the questions and shows the notes that come before and between them: the terminal's prompter, or with
   * `--yes` the defaults prompter. A prompter that collects its notes in `notes`, as the defaults prompter does, has
   * them printed on stderr, in order, before the warnings the answers call for. The terminal's prompter shows them as
   * they come, and has no `notes`. `runInit` closes it.
   */
  prompter: Prompter & { notes?: readonly string[] }
  /**
   * Asks Docker what its engine has. `init` asks once, only to warn when Docker can't run the browser.
   */
  probeDocker: ProbeDocker
  /**
   * Lists the files of the project, where `init` looks for Storybooks.
   */
  listFiles: ListFiles
  /**
   * Runs the package manager and `storybook add`.
   */
  runCommand: RunCommand
  /**
   * Asks Fallow for the packages the project imports and doesn't list.
   */
  findUnlistedDependencies: FindUnlistedDependencies
  /**
   * Writes progress as it happens: each command `init` runs, and its output.
   */
  progress: (text: string) => void
}

/**
 * What `init` produced: the exit code and the text for each output stream.
 */
interface InitResult {
  /**
   * The process exit code.
   */
  exitCode: number
  /**
   * Text for standard output: the files written, then the closing message.
   */
  stdout: string
  /**
   * Text for standard error: the problems, hints and warnings, a line each.
   */
  stderr: string
}

/**
 * What `init` settled before it writes anything.
 */
interface Setup {
  /**
   * The answers to the questions.
   */
  answers: Answers
  /**
   * The absolute path of the config: the one that was there, or the one `init` writes.
   */
  configPath: string
  /**
   * The source of the config to write, or `undefined` when one was already there.
   */
  configSource: string | undefined
  /**
   * The Storybooks `init` sets up.
   */
  storybooks: SetUpStorybook[]
  /**
   * The hints and warnings for stderr so far, a line each, in the order they arose.
   */
  notes: string[]
}

/**
 * The name of the config `init` writes.
 */
const configFileName = 'visual-check.config.ts'

/**
 * Sets up visual-check in the project around `cwd`. It detects the project and runs the checks that stop it, before it
 * writes or runs anything. Then it notes the Storybook versions, Docker and a config that's already there, asks its
 * questions, writes the files that are missing and the scripts, adds the dependencies and the addon, and asks Fallow
 * for unlisted dependencies. A check that fails, input that ends before every answer is in, or a failed install, exits
 * 2. It closes the prompter when done.
 *
 * @throws Any error besides the ones it words, such as a `package.json` it can't write.
 *
 * @public
 */
export async function runInit(cwd: string, tools: InitTools): Promise<InitResult> {
  try {
    const { nodeVersion, yes, interactive } = tools
    const project = await detectProject(cwd, tools.listFiles)
    const problems = blockingProblemsOf({ cwd, nodeVersion, project, yes, interactive })

    if (project === undefined || problems.length > 0) {
      return failureOf(problems)
    }

    const setup = await settleSetup(cwd, project, tools)

    return 'exitCode' in setup ? setup : await applySetup(cwd, project, setup, tools)
  } finally {
    tools.prompter.close()
  }
}

/**
 * Settles what to set up: shows what's known before the questions, then asks them. Gives the result to exit with
 * instead when the input ends before every answer is in: the notes collected so far, then why it stopped.
 */
async function settleSetup(cwd: string, project: DetectedProject, tools: InitTools): Promise<Setup | InitResult> {
  const { prompter } = tools
  const existing = await noteBeforeQuestions(cwd, project, tools)
  let asked: Awaited<ReturnType<typeof askQuestions>>

  try {
    asked = await askQuestions({ project, prompter, existingConfig: existing })
  } catch (error) {
    if (error instanceof InputEndedError) {
      return failureOf([...(prompter.notes ?? []), error.message])
    }

    throw error
  }

  return setupOf(project, asked.answers, existing, [...(prompter.notes ?? []), ...asked.warnings])
}

/**
 * Shows, through the prompter, what's known before the questions, so a person answering sees it first: the notes on
 * Storybook versions, the Docker warning, and the hints or the warning about a config that's already there. Gives that
 * config.
 */
async function noteBeforeQuestions(
  cwd: string,
  project: DetectedProject,
  tools: InitTools,
): Promise<ExistingConfig | undefined> {
  const dockerNotes = await dockerNotesOf(tools.probeDocker, tools.os)
  const existing = await existingConfigOf(cwd, project)

  for (const note of [...versionNotesOf(project), ...dockerNotes, ...(existing?.notes ?? [])]) {
    tools.prompter.note(note)
  }

  return existing
}

/**
 * Builds what to set up from the answers: the config to write when there was none, and the Storybooks, the ones
 * answered or the config's own.
 */
function setupOf(
  project: DetectedProject,
  answers: Answers,
  existing: ExistingConfig | undefined,
  notes: string[],
): Setup {
  if (existing !== undefined) {
    return {
      answers,
      configPath: existing.path,
      configSource: undefined,
      storybooks: existingStorybooksOf(project, existing, answers.packageManager),
      notes,
    }
  }

  return {
    answers,
    configPath: join(project.root, configFileName),
    configSource: configSourceOf(answers.storybooks.map(({ name, url, configDir }) => ({ name, url, configDir }))),
    storybooks: answers.storybooks.map(({ name, configDir, startCommand }) => ({
      name,
      dir: project.storybooks.find((storybook) => storybook.configDir === configDir)?.packageDir ?? project.root,
      configDir: join(project.root, configDir),
      startCommand,
    })),
    notes,
  }
}

/**
 * Writes the files and the scripts, adds the dependencies and the addon, and checks for unlisted dependencies. A failed
 * install exits 2 after listing the files written so far, with no closing message.
 */
async function applySetup(cwd: string, project: DetectedProject, setup: Setup, tools: InitTools): Promise<InitResult> {
  const { packageManager, scripts, addons } = setup.answers
  const { cliVersion, runCommand, progress } = tools
  const written = writeSetupFiles(project, setup)
  const writtenLines = writtenLinesOf(written, cwd)
  const problem = await installDependencies({
    installs: dependenciesToAddOf({
      root: project.root,
      rootManifest: project.manifest,
      // In a single package, every Storybook belongs to the root package.
      storybooks: project.storybooks.map(({ packageDir }) => ({ packageDir, manifest: project.manifest })),
      cliVersion,
      browserRange: tools.browserRange,
    }),
    packageManager,
    runCommand,
    progress,
  })

  if (problem !== undefined) {
    return { exitCode: 2, stdout: linesOf(writtenLines), stderr: linesOf([...setup.notes, problem]) }
  }

  const addonWarnings = await addAddons({
    addons,
    packageManager,
    cliVersion,
    root: project.root,
    runCommand,
    progress,
  })
  const fallowWarnings = await unlistedDependencyNotesOf(project.root, tools.findUnlistedDependencies)
  const closingMessage = closingMessageOf({
    cwd,
    packageManager,
    configPath: setup.configPath,
    storybooks: setup.storybooks,
    scripts,
  })

  return {
    exitCode: 0,
    stdout: writtenLines.length === 0 ? closingMessage : `${linesOf(writtenLines)}\n${closingMessage}`,
    stderr: linesOf([...setup.notes, ...addonWarnings, ...fallowWarnings]),
  }
}

/**
 * Asks Docker once whether it can run the browser. Gives the warning when it can't, else nothing.
 *
 * @throws Any error the probe throws besides a `ContainerError`.
 */
async function dockerNotesOf(probeDocker: ProbeDocker, os: NodeJS.Platform): Promise<string[]> {
  try {
    await probeDocker()

    return []
  } catch (error) {
    return [dockerWarningOf(error, os)]
  }
}

/**
 * Writes each file that's missing: the config when there was none, each Storybook's `visual-check.ts` and
 * `.visual-check/.gitignore`, and the config folder's `.visual-check/.gitignore`. Then sets the scripts. Gives what it
 * wrote. An existing file is never touched.
 */
function writeSetupFiles(project: DetectedProject, setup: Setup): Written {
  const { answers, configPath, configSource, storybooks } = setup
  const contents: (readonly [string, string])[] = [
    ...(configSource === undefined ? [] : [[configPath, configSource] as const]),
    ...storybooks.flatMap(({ dir, configDir }) => [
      [join(configDir, 'visual-check.ts'), modesFileSource] as const,
      [join(dir, '.visual-check', '.gitignore'), visualCheckGitignore] as const,
    ]),
    [join(dirname(configPath), '.visual-check', '.gitignore'), visualCheckGitignore],
  ]
  const files: string[] = []

  for (const [path, content] of contents) {
    if (writeIfMissing(path, content)) {
      files.push(path)
    }
  }

  return { files, scripts: setScripts(project.manifestPath, scriptsToSetOf(answers.scripts)) }
}

/**
 * Returns the scripts to set in `package.json`, by name: the ones the answers say to add.
 */
function scriptsToSetOf(scripts: Answers['scripts']): Record<string, string> {
  const toSet: Record<string, string> = {}

  for (const kind of ['test', 'update'] as const) {
    const script = scripts[kind]

    if (script.add) {
      toSet[script.name] = `visual-check ${kind}`
    }
  }

  return toSet
}

/**
 * Asks Fallow for unlisted dependencies. Gives the warning when it finds any, the warning that it couldn't check when
 * it throws, else nothing.
 */
async function unlistedDependencyNotesOf(root: string, find: FindUnlistedDependencies): Promise<string[]> {
  try {
    const warning = unlistedDependenciesWarningOf(await find(root))

    return warning === undefined ? [] : [warning]
  } catch (error) {
    return [fallowFailureWarningOf(error)]
  }
}

/**
 * Joins lines into text, each ending with a line break.
 */
function linesOf(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join('')
}

/**
 * Builds the result for problems that stop `init`: each on its own line on stderr, exit code 2.
 */
function failureOf(problems: readonly string[]): InitResult {
  return { exitCode: 2, stdout: '', stderr: linesOf(problems) }
}
