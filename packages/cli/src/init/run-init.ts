import { dirname, join } from 'node:path'
import { installSkill } from '../agent-skill/install-skill.js'
import type { SkillSetup } from '../agent-skill/setup-file.js'
import { claudeSkillFolder, skillFolder } from '../agent-skill/skill-files.js'
import { BaselineError } from '../baselines/baseline-error.js'
import { listBaselines } from '../baselines/baseline-files.js'
import { defaultBaselinesIn } from '../config/resolve-config.js'
import type { ProbeDocker } from '../container/docker-probe.js'
import {
  closingMessageTextOf,
  type NextSteps,
  nextStepsOf,
  type ReplacedScripts,
  replacedScriptsLineOf,
  type SetUpStorybook,
} from './closing-message.js'
import { type DetectedProject, type DetectedStorybook, detectProject } from './detect-project.js'
import { type ExistingConfig, existingConfigOf, existingStorybooksOf } from './existing-config.js'
import { type ListFiles, relativePathOf } from './find-storybooks.js'
import { type FindIgnoredPaths, ignoredSkillWarningOf } from './ignored-skill.js'
import { blockingProblemsOf, dockerWarningOf, versionNotesOf } from './init-checks.js'
import {
  type AddonStep,
  addAddons,
  addonStepsOf,
  addonTitleOf,
  dependenciesToAddOf,
  type InstallStep,
  installDependencies,
  installStepsOf,
  type ManualInstall,
  manualInstallTextOf,
  rushInstallOf,
} from './install.js'
import { type PackageScripts, packageScriptsOf } from './package-scripts.js'
import { InputEndedError, type Prompter } from './prompter.js'
import { type Answers, askQuestions } from './questions.js'
import type { RunCommand } from './run-command.js'
import { type Message, textOf } from './segment.js'
import {
  configSourceOf,
  configStorybookOf,
  modesFileSource,
  setScripts,
  visualCheckGitignore,
  writeIfMissing,
} from './setup-files.js'
import { runStep, type SetupProgress } from './setup-progress.js'
import { skillSetupOf } from './skill-setup.js'
import {
  type FindUnlistedDependencies,
  fallowFailureWarningOf,
  unlistedDependenciesWarningOf,
} from './unlisted-dependencies.js'
import { packageManagerListOf } from './workspace.js'

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
   * The range of `@visual-check/chromium` the CLI works with, which the browser package is added at when
   * `browserVersion` is `undefined`.
   */
  browserRange: string
  /**
   * The exact version of `@visual-check/chromium` this CLI release was packed with, the newest it was tested on: its
   * `devDependencies` entry, which `pnpm pack` writes over `workspace:*`. `undefined` when that entry isn't a plain
   * version, as in this repository's workspace.
   */
  browserVersion: string | undefined
  /**
   * Asks the questions and shows the notes that come before and between them: the terminal UI, or with `--yes` outside
   * a terminal the defaults prompter. A prompter that collects its notes in `notes`, as the defaults prompter does, has
   * them printed on stderr, in order, before the warnings the answers call for. The terminal UI shows them as they
   * come, and has no `notes`.
   */
  prompter: Prompter & { notes?: readonly Message[] }
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
   * Asks git which of the agent skill's paths it ignores.
   */
  findIgnoredPaths: FindIgnoredPaths
  /**
   * Reports the steps after the questions as they happen: each one's start and end, and its command's output.
   */
  progress: SetupProgress
}

/**
 * What `init` produced: the exit code, the text for each output stream, the messages stderr holds, and, once it has
 * written, the summary the terminal UI shows.
 *
 * @public
 */
export interface InitResult {
  /**
   * The process exit code.
   */
  exitCode: number
  /**
   * Text for standard output: the line that names the scripts replaced in each `package.json`, when there are any, then
   * under Rush the install steps to run, then the closing message, which a failed install leaves out.
   */
  stdout: string
  /**
   * Text for standard error: the messages, each ending with a line break.
   */
  stderr: string
  /**
   * The problems, hints and warnings, in the order they arose. A message can span lines, and its segments pick out what
   * it names, so the terminal UI shows these rather than split `stderr`.
   */
  messages: readonly Message[]
  /**
   * What the terminal UI sums the run up with, once `init` has written: the scripts it replaced, and the next steps
   * when it got to the end. A run that stopped before it wrote has none.
   */
  summary?: InitSummary
}

/**
 * What the terminal UI sums up a run that wrote with.
 */
interface InitSummary {
  /**
   * The line that names the scripts `init` replaced in each `package.json`, when it replaced any.
   */
  replacedLine?: string
  /**
   * The install steps to run, under Rush, where `init` installs nothing itself, when there's anything to add.
   */
  manualInstall?: ManualInstall
  /**
   * What to do next, when `init` got to the end. A failed install leaves it out.
   */
  nextSteps?: NextSteps
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
   * The packages that get the Storybook dependencies, by the folder of their `package.json`: the chosen Storybooks',
   * or with a config that was already there, the ones of its Storybooks that were detected.
   */
  withDependencies: Pick<DetectedStorybook, 'manifestDir' | 'manifest'>[]
  /**
   * What the agent skill's `setup.json` holds, or `undefined` when the person chose not to install it.
   */
  skill: SkillSetup | undefined
  /**
   * The hints and warnings for stderr so far, a line each, in the order they arose.
   */
  notes: Message[]
}

/**
 * The name of the config `init` writes.
 */
const configFileName = 'visual-check.config.ts'

/**
 * The title of the step that writes the files and the scripts.
 */
const writeFilesTitle = 'Write the files and scripts'

/**
 * The title of the step that asks Fallow for unlisted dependencies.
 */
const checkUnlistedTitle = 'Check for unlisted dependencies'

/**
 * Sets up visual-check in the workspace around `cwd`. It detects the project and runs the checks that stop it, before
 * it writes or runs anything. A stop gives detection's notes, then the problems. Then it notes what detection found,
 * the Storybook versions, Docker and a config that's already there, asks its questions, writes the files that are
 * missing and the scripts, installs the agent skill when the person says yes, writing over an earlier one, and warns
 * when git ignores its folder or its link, adds the dependencies and the addon, and asks Fallow for unlisted
 * dependencies. It never edits the project's own `.gitignore`. A check that fails, a question the person gives up on,
 * or a failed install, exits 2.
 *
 * @throws Any error besides the ones it words, such as a `package.json` it can't write.
 *
 * @public
 */
export async function runInit(cwd: string, tools: InitTools): Promise<InitResult> {
  const { nodeVersion, yes, interactive } = tools
  const project = await detectProject(cwd, tools.listFiles)
  const problems = blockingProblemsOf({ cwd, nodeVersion, project, yes, interactive })

  if (project === undefined || problems.length > 0) {
    return failureOf([...(project?.notes ?? []), ...problems])
  }

  const setup = await settleSetup(cwd, project, tools)

  return 'exitCode' in setup ? setup : await applySetup(cwd, project, setup, tools)
}

/**
 * Settles what to set up: shows what's known before the questions, then asks them. Gives the result to exit with
 * instead when the person gives up on a question: the notes collected so far, then why it stopped.
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
 * Shows, through the prompter, what's known before the questions, so a person answering sees it first: the notes from
 * detection, the notes on Storybook versions, the Docker warning, and the hints or the warning about a config that's
 * already there. Gives that config.
 */
async function noteBeforeQuestions(
  cwd: string,
  project: DetectedProject,
  tools: InitTools,
): Promise<ExistingConfig | undefined> {
  const dockerNotes = await dockerNotesOf(tools.probeDocker, tools.os)
  const existing = await existingConfigOf(cwd, project)

  for (const note of [...project.notes, ...versionNotesOf(project), ...dockerNotes, ...(existing?.notes ?? [])]) {
    tools.prompter.note(note)
  }

  return existing
}

/**
 * Builds what to set up from the answers: the config to write when there was none, listing each Storybook chosen with
 * its package folder as `dir`, the Storybooks, the ones answered or the config's own, and when the person chose the
 * agent skill, its `setup.json` for those Storybooks.
 */
function setupOf(
  project: DetectedProject,
  answers: Answers,
  existing: ExistingConfig | undefined,
  notes: Message[],
): Setup {
  const { packageManager } = answers

  if (existing !== undefined) {
    return {
      answers,
      configPath: existing.path,
      configSource: undefined,
      storybooks: existingStorybooksOf(project, existing, packageManager),
      withDependencies: project.storybooks.filter(({ configDir }) => Object.hasOwn(existing.names, configDir)),
      skill: answers.skill ? skillSetupOf({ project, packageManager, storybooks: existing.storybooks }) : undefined,
      notes,
    }
  }

  const { root } = project
  // Each Storybook answered, with its package folder as `dir` and its config folder made absolute.
  const placed = answers.storybooks.map(({ name, url, configDir, packageDir, startCommand }) => ({
    name,
    url,
    dir: packageDir,
    configDir: join(root, configDir),
    startCommand,
  }))

  return {
    answers,
    configPath: join(root, configFileName),
    configSource: configSourceOf(
      placed.map(({ name, url, dir, configDir }) =>
        configStorybookOf({ name, url, configFolder: root, packageDir: dir, configDir }),
      ),
    ),
    storybooks: placed.map(({ name, dir, configDir, startCommand }) => ({
      name,
      dir,
      configDir,
      baselines: defaultBaselinesIn(dir),
      startCommand,
    })),
    withDependencies: answers.storybooks,
    skill: answers.skill ? skillSetupOf({ project, packageManager, storybooks: placed }) : undefined,
    notes,
  }
}

/**
 * How `init` adds its packages and the addon: the commands it runs, or under Rush, the steps it prints instead.
 */
interface InstallPlan {
  /**
   * The add commands to run, each with its step's title. None under Rush.
   */
  installSteps: InstallStep[]
  /**
   * The `storybook add` commands to run after them. None under Rush.
   */
  addonSteps: AddonStep[]
  /**
   * The install steps to print under Rush, when there's anything to add.
   */
  manualInstall: ManualInstall | undefined
}

/**
 * Plans how to add the packages each folder still needs, the addon included, and then the addon to each Storybook
 * ticked. Under Rush, which installs through its own `rush add` and `rush update`, `init` runs none of it and prints
 * the steps instead.
 */
function installPlanOf(cwd: string, project: DetectedProject, setup: Setup, tools: InitTools): InstallPlan {
  const { root, yarnBerry, workspace } = project
  const { packageManager, addons } = setup.answers
  const { cliVersion } = tools
  const installs = dependenciesToAddOf({
    root,
    rootManifest: project.manifest,
    storybooks: setup.withDependencies,
    addons,
    cliVersion,
    browserRange: tools.browserRange,
    browserVersion: tools.browserVersion,
  })
  const addonSteps = addonStepsOf({ addons, packageManager, yarnBerry, cliVersion, root })
  const context = { packageManager, yarnBerry, root, packageManagerLists: workspace.packageManagerLists }

  if (workspace.kind === 'rush') {
    return { installSteps: [], addonSteps: [], manualInstall: rushInstallOf({ ...context, cwd, installs, addonSteps }) }
  }

  return { installSteps: installStepsOf({ ...context, installs }), addonSteps, manualInstall: undefined }
}

/**
 * Writes the files and the scripts, warns when git ignores the agent skill it installed, adds the dependencies and the
 * addon, and checks for unlisted dependencies. Under Rush it adds nothing and prints the install steps instead.
 * Standard output names the scripts it replaced, then gives the install steps under Rush, then the closing message. A
 * failed install exits 2 with no closing message. The result carries a summary for the terminal UI: the scripts
 * replaced, the install steps under Rush, and the next steps unless the install failed.
 */
async function applySetup(cwd: string, project: DetectedProject, setup: Setup, tools: InitTools): Promise<InitResult> {
  const { packageManager, scripts } = setup.answers
  const { runCommand, progress } = tools
  const { installSteps, addonSteps, manualInstall } = installPlanOf(cwd, project, setup, tools)
  const packageScripts = packageScriptsOf({
    root: project.root,
    storybooks: setup.storybooks,
    scriptNames: { test: scripts.test.name, update: scripts.update.name },
    packageManager,
    yarnBerry: project.yarnBerry,
    listedPackageDirs: packageManagerListOf(project.workspace.packageManagerLists, packageManager),
  })

  progress.plan([
    writeFilesTitle,
    ...installSteps.map(({ title }) => title),
    ...addonSteps.map(({ name }) => addonTitleOf(name)),
    checkUnlistedTitle,
  ])

  const replacedScripts = await runStep(
    progress,
    { title: writeFilesTitle },
    () => writeSetupFiles(project, setup, packageScripts, tools),
    () => 'done',
  )
  const ignoredWarnings = await ignoredSkillNotesOf(project.root, setup.skill, tools.findIgnoredPaths)
  const replacedLine = replacedScriptsLineOf(replacedScripts)
  const replacedSummary = replacedLine === undefined ? {} : { replacedLine }
  const problem = await installDependencies({ steps: installSteps, cwd, runCommand, progress })

  if (problem !== undefined) {
    return {
      ...resultOf(2, replacedLine === undefined ? '' : `${replacedLine}\n`, [
        ...setup.notes,
        ...ignoredWarnings,
        problem,
      ]),
      summary: replacedSummary,
    }
  }

  const addonWarnings = await addAddons({ steps: addonSteps, cwd, runCommand, progress })

  const fallowWarnings = await runStep(
    progress,
    { title: checkUnlistedTitle },
    () => unlistedDependencyNotesOf(project.root, tools.findUnlistedDependencies),
    (warnings) => (warnings.length > 0 ? 'warned' : 'done'),
  )

  const nextSteps = nextStepsOf({
    cwd,
    root: project.root,
    packageManager,
    configPath: setup.configPath,
    storybooks: setup.storybooks,
    scripts,
    packageDirs: packageScripts.map(({ dir }) => dir),
    needsBaselines: await needsBaselinesOf(setup.storybooks),
  })
  const stdout = [
    replacedLine,
    manualInstall === undefined ? undefined : manualInstallTextOf(manualInstall),
    closingMessageTextOf(nextSteps),
  ]
    .filter((part) => part !== undefined)
    .join('\n\n')

  return {
    ...resultOf(0, stdout, [...setup.notes, ...ignoredWarnings, ...addonWarnings, ...fallowWarnings]),
    summary: { ...replacedSummary, ...(manualInstall === undefined ? {} : { manualInstall }), nextSteps },
  }
}

/**
 * Whether the first baselines are still to be written: unless every Storybook set up has at least one in its baselines
 * folder, the one its config names or the default. With none set up, a Storybook is still to be added, so they are.
 *
 * @throws Any error besides a `BaselineError`, which counts as no baselines.
 */
async function needsBaselinesOf(storybooks: readonly SetUpStorybook[]): Promise<boolean> {
  const hasBaselines = await Promise.all(storybooks.map(({ baselines }) => holdsBaselines(baselines)))

  return hasBaselines.length === 0 || hasBaselines.includes(false)
}

/**
 * Whether a baselines folder holds at least one baseline. A folder that can't be listed holds none.
 *
 * @throws Any error besides a `BaselineError`.
 */
async function holdsBaselines(folder: string): Promise<boolean> {
  try {
    return (await listBaselines(folder)).length > 0
  } catch (error) {
    if (error instanceof BaselineError) {
      return false
    }

    throw error
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
 * `.visual-check/.gitignore`, and the config folder's `.visual-check/.gitignore`. Then sets the root's scripts and each
 * package's own. Gives the scripts it replaced, by `package.json`. An existing file is never touched, except the agent
 * skill's: when the person chose to install it, its files are written over for the CLI version, and linked, or copied
 * on Windows, for Claude Code.
 */
function writeSetupFiles(
  project: DetectedProject,
  setup: Setup,
  packageScripts: readonly PackageScripts[],
  skillTools: Pick<InitTools, 'cliVersion' | 'os'>,
): ReplacedScripts[] {
  const { answers, configPath, configSource, storybooks } = setup
  const contents: (readonly [string, string])[] = [
    ...(configSource === undefined ? [] : [[configPath, configSource] as const]),
    ...storybooks.flatMap(({ dir, configDir }) => [
      [join(configDir, 'visual-check.ts'), modesFileSource] as const,
      [join(dir, '.visual-check', '.gitignore'), visualCheckGitignore] as const,
    ]),
    [join(dirname(configPath), '.visual-check', '.gitignore'), visualCheckGitignore],
  ]

  for (const [path, content] of contents) {
    writeIfMissing(path, content)
  }

  if (setup.skill !== undefined) {
    installSkill({ root: project.root, cliVersion: skillTools.cliVersion, os: skillTools.os, setup: setup.skill })
  }

  const manifests = [
    { path: project.manifestPath, scripts: scriptsToSetOf(answers.scripts) },
    ...packageScripts.map(({ dir, scripts }) => ({ path: join(dir, 'package.json'), scripts })),
  ]

  return manifests.map(({ path, scripts }) => ({
    manifest: relativePathOf(project.root, path),
    names: setScripts(path, scripts),
  }))
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
 * Asks git, when `init` installed the agent skill, whether it ignores the skill's folder or its link. Gives the warning
 * when it ignores either, else nothing.
 */
async function ignoredSkillNotesOf(
  root: string,
  skill: SkillSetup | undefined,
  find: FindIgnoredPaths,
): Promise<string[]> {
  if (skill === undefined) {
    return []
  }

  const warning = ignoredSkillWarningOf(await find(root, [skillFolder, claudeSkillFolder]))

  return warning === undefined ? [] : [warning]
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
 * Builds a result with its messages, which stderr holds as plain text, a line each, or more for a message that spans
 * lines.
 */
function resultOf(exitCode: number, stdout: string, messages: readonly Message[]): InitResult {
  return { exitCode, stdout, stderr: linesOf(messages.map(textOf)), messages }
}

/**
 * Builds the result for problems that stop `init`: each on its own line on stderr, exit code 2.
 */
function failureOf(problems: readonly Message[]): InitResult {
  return resultOf(2, '', problems)
}
