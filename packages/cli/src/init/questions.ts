import { findStorybookUrlProblem, serveStorybookFix } from '../config/find-storybook-url-problem.js'
import { type AddonAnswer, addonOfferedTo, askAddons } from './addon-question.js'
import type { DetectedProject, DetectedStorybook } from './detect-project.js'
import { storybookFolderOf } from './find-storybooks.js'
import { listOf, nonEmptyOf } from './list-of.js'
import { commandLineOf, type Manifest, type PackageManager, scriptsOf, storybookCommandOf } from './package-manager.js'
import { type Choice, countingPrompter, type Prompter } from './prompter.js'
import { defaultConfigDir, storybookCallsOf } from './storybook-scripts.js'
import { portOfStart, type StartWorkspace, startCommandOf, startWorkspaceOf } from './storybook-start.js'

/**
 * What the person chose for one Storybook.
 */
export interface StorybookAnswers {
  /**
   * The config folder of the Storybook, relative to the project root.
   */
  configDir: string
  /**
   * The name of the Storybook: lowercase letters, digits and `-`, unique within the project.
   */
  name: string
  /**
   * The URL visual-check opens the Storybook at.
   */
  url: string
  /**
   * The command that starts the Storybook.
   */
  startCommand: string
  /**
   * The absolute folder of the Storybook's package, where it runs: its `dir` in the config.
   */
  packageDir: string
  /**
   * The absolute folder of the `package.json` the Storybook's dependencies go in.
   */
  manifestDir: string
  /**
   * The parsed `package.json` in `manifestDir`.
   */
  manifest: Manifest
}

/**
 * What the person chose for one `package.json` script that runs visual-check.
 */
export interface ScriptAnswer {
  /**
   * The name of the script.
   */
  name: string
  /**
   * Whether `init` adds the script. `false` when an existing script already runs the command.
   */
  add: boolean
}

/**
 * Everything `init` asked and found out about what to set up.
 */
export interface Answers {
  /**
   * The package manager: the detected one, or the one the person named.
   */
  packageManager: PackageManager
  /**
   * The answers for each Storybook chosen, in the order they were found. Empty when a config already exists.
   */
  storybooks: StorybookAnswers[]
  /**
   * The scripts that run `visual-check test` and `visual-check update`.
   */
  scripts: {
    /**
     * The script that runs `visual-check test`.
     */
    test: ScriptAnswer
    /**
     * The script that runs `visual-check update`.
     */
    update: ScriptAnswer
  }
  /**
   * The Storybooks that get the visual-check addon.
   */
  addons: AddonAnswer[]
}

/**
 * What `askQuestions` needs.
 */
interface QuestionInput {
  /**
   * The project `init` detected.
   */
  project: DetectedProject
  /**
   * Where the questions go. With `--yes`, a prompter that takes every default.
   */
  prompter: Prompter
  /**
   * The visual-check config that already exists, or `undefined` for none. Its Storybooks aren't asked about again, and
   * only they get the addon question.
   */
  existingConfig?:
    | {
        /**
         * The name of each Storybook in the config, by config folder relative to the project root.
         */
        names: Record<string, string>
      }
    | undefined
}

/**
 * The package manager `init` suggests when nothing shows one.
 */
const defaultPackageManager: PackageManager = 'npm'

/**
 * The package managers the package manager question offers, in order.
 */
const packageManagerChoices: readonly [Choice<PackageManager>, ...Choice<PackageManager>[]] = [
  { value: 'npm', label: 'npm' },
  { value: 'pnpm', label: 'pnpm' },
  { value: 'yarn', label: 'yarn', hint: 'Yarn 1, or 2 and later' },
  { value: 'bun', label: 'bun', hint: 'works, but untested' },
]

/**
 * The port Storybook starts on when nothing sets another.
 */
export const defaultStorybookPort = 6006

/**
 * The script names `init` suggests, by the visual-check command each runs.
 */
const defaultScriptNames = { test: 'visual:check', update: 'visual:update' } as const

/**
 * The script names `init` suggests instead, by the visual-check command each runs, when the other script already has
 * the default one.
 */
const otherScriptNames = { test: 'visual:test', update: 'visual:update-baselines' } as const

/**
 * The hint of the question that names each script, by the visual-check command the script runs.
 */
const scriptHints = {
  test: 'Compares each story with its baseline.',
  update: 'Writes the baselines.',
} as const

/**
 * What `plannedQuestionCountOf` needs.
 */
interface QuestionPlanInput extends Omit<QuestionInput, 'prompter'> {
  /**
   * The Storybooks ticked, once the question which to set up is answered. Before, every Storybook counts as ticked, as
   * the question starts.
   */
  chosen?: readonly DetectedStorybook[]
}

/**
 * Counts the questions `askQuestions` plans to ask: the package manager when nothing shows it; with no config yet,
 * which Storybooks to set up when there's more than one, then for each one ticked its name, its URL and, when nothing
 * starts it, its start command; each script that no script already runs; and the addon when a Storybook takes it.
 */
export function plannedQuestionCountOf({
  project,
  existingConfig,
  chosen = project.storybooks,
}: QuestionPlanInput): number {
  const scripts = scriptsOf(project.manifest)
  const storybookQuestions =
    existingConfig === undefined
      ? (project.storybooks.length > 1 ? 1 : 0) +
        chosen.reduce((count, { start }) => count + (start === undefined ? 3 : 2), 0)
      : 0
  const addonOffered = addonOfferedTo({
    project,
    // Names don't change which Storybooks are offered the addon, so the default ones stand in for the answers.
    answered: chosen.map(({ configDir, defaultName }) => ({ configDir, name: defaultName })),
    existingConfig,
  })

  return (
    (project.packageManager === undefined ? 1 : 0) +
    storybookQuestions +
    (['test', 'update'] as const).filter((kind) => reusedScriptOf(scripts, kind) === undefined).length +
    (addonOffered.length > 0 ? 1 : 0)
  )
}

/**
 * Asks the questions of `init`, in order: the package manager, which Storybooks to set up, each of them, the script
 * names, and the addon. Gives the answers, and the warnings the answers call for. It prints nothing: hints go through
 * the prompter. Before each question it tells the prompter how far through the planned questions the person is, and
 * plans again once the Storybooks to set up are ticked.
 */
export async function askQuestions({
  project,
  prompter,
  existingConfig,
}: QuestionInput): Promise<{ answers: Answers; warnings: string[] }> {
  const warnings: string[] = []
  const counted = countingPrompter(prompter, plannedQuestionCountOf({ project, existingConfig }))
  const packageManager = await askPackageManager(project, counted)
  const chosen = existingConfig === undefined ? await askWhichStorybooks(project.storybooks, project.root, counted) : []

  counted.replan(plannedQuestionCountOf({ project, existingConfig, chosen }))

  const storybooks = await askStorybooks(project, chosen, packageManager, counted, warnings)
  const scripts = await askScripts(project, counted)
  const addons = await askAddons({ project, answered: storybooks, existingConfig, prompter: counted })

  return {
    answers: { packageManager, storybooks, scripts, addons },
    warnings: [...warnings, ...sharedPortWarningsOf(storybooks)],
  }
}

/**
 * Returns the detected package manager, or asks for one from a list when nothing shows it.
 */
function askPackageManager(project: DetectedProject, prompter: Prompter): Promise<PackageManager> {
  if (project.packageManager !== undefined) {
    return Promise.resolve(project.packageManager)
  }

  return prompter.select('Package manager', {
    choices: packageManagerChoices,
    defaultValue: defaultPackageManager,
    hint: 'No lockfile or packageManager field names one.',
  })
}

/**
 * Asks about each Storybook chosen in turn. The names already answered are taken.
 */
async function askStorybooks(
  project: DetectedProject,
  chosen: readonly DetectedStorybook[],
  packageManager: PackageManager,
  prompter: Prompter,
  warnings: string[],
): Promise<StorybookAnswers[]> {
  const answers: StorybookAnswers[] = []
  const workspace = startWorkspaceOf(project, packageManager)

  for (const storybook of chosen) {
    const taken = answers.map(({ name }) => name)

    answers.push(await askStorybook(storybook, project.root, taken, packageManager, workspace, prompter, warnings))
  }

  return answers
}

/**
 * Asks which Storybooks to set up, from a checklist with all ticked, and gives the ones ticked. A lone Storybook is
 * set up without asking.
 */
async function askWhichStorybooks(
  storybooks: readonly DetectedStorybook[],
  root: string,
  prompter: Prompter,
): Promise<readonly DetectedStorybook[]> {
  const choices = nonEmptyOf(
    storybooks.map(
      ({ configDir, packageName, defaultName }): Choice<string> => ({
        value: configDir,
        label: storybookFolderOf(configDir, root),
        hint: packageName ?? defaultName,
      }),
    ),
  )

  if (choices === undefined || choices.length === 1) {
    return storybooks
  }

  const chosen = await prompter.checklist('Storybooks to set up', {
    choices,
    defaultValues: storybooks.map(({ configDir }) => configDir),
    hint: 'The ones ticked go in the config.',
    validate: (values) => (values.length === 0 ? 'Tick at least one Storybook.' : undefined),
  })

  return storybooks.filter(({ configDir }) => chosen.includes(configDir))
}

/**
 * The host names that all reach this machine, which share its ports. Any `127.x.x.x` does too.
 */
const loopbackHosts = new Set(['localhost', '[::1]', '0.0.0.0'])

/**
 * Returns the host a URL's port is taken on: one for every name of this machine, else the URL's host name.
 */
function portHostOf(url: URL): string {
  return loopbackHosts.has(url.hostname) || url.hostname.startsWith('127.') ? 'loopback' : url.hostname
}

/**
 * Words a warning for each port two Storybooks or more share on the same host: they can't run at the same time.
 * Every name of this machine counts as one host.
 */
function sharedPortWarningsOf(storybooks: readonly StorybookAnswers[]): string[] {
  const namesByHost = new Map<string, { port: number; names: string[] }>()

  for (const { name, url } of storybooks) {
    const parsed = new URL(url)
    const port = urlPortOf(parsed)
    const key = `${portHostOf(parsed)}:${port}`
    const sharing = namesByHost.get(key)

    if (sharing === undefined) {
      namesByHost.set(key, { port, names: [name] })
    } else {
      sharing.names.push(name)
    }
  }

  return [...namesByHost.values()]
    .filter(({ names }) => names.length > 1)
    .map(
      ({ port, names }) =>
        `Warning: ${listOf(names)} ${names.length === 2 ? 'both' : 'all'} use port ${port}, ` +
        "so they can't run at the same time. Give each Storybook its own port.",
    )
}

/**
 * Asks for the name, the URL and the start command of one Storybook, and warns when the URL's port isn't the port its
 * start command uses.
 */
async function askStorybook(
  storybook: DetectedStorybook,
  root: string,
  takenNames: readonly string[],
  packageManager: PackageManager,
  workspace: StartWorkspace,
  prompter: Prompter,
  warnings: string[],
): Promise<StorybookAnswers> {
  const { configDir, packageDir, manifestDir, manifest } = storybook
  const name = await askName(storybook, root, takenNames, prompter)
  const url = await askUrl(storybook, name, prompter)
  const urlPort = urlPortOf(new URL(url))
  const startCommand = await askStartCommand(storybook, name, urlPort, packageManager, workspace, prompter)
  const commandPort = startPortOf(storybook, startCommand)

  if (commandPort !== undefined && urlPort !== commandPort) {
    warnings.push(
      `Warning: ${name}'s URL, ${url}, has port ${urlPort}, ` +
        `and its start command, ${startCommand}, starts Storybook on port ${commandPort}.`,
    )
  }

  return { configDir, name, url, startCommand, packageDir, manifestDir, manifest }
}

/**
 * Returns the port a Storybook's start command starts it on: the one its detected start sets, or, for a command the
 * person typed, the one its `storybook dev` call sets. `undefined` when none is set, or the command runs no
 * `storybook dev`.
 */
function startPortOf(storybook: DetectedStorybook, startCommand: string): number | undefined {
  if (storybook.start !== undefined) {
    return portOfStart(storybook.start)
  }

  return storybookCallsOf({ start: startCommand }).find((call) => call.subcommand === 'dev')?.port
}

/**
 * Asks for the name of a Storybook.
 */
function askName(
  storybook: DetectedStorybook,
  root: string,
  takenNames: readonly string[],
  prompter: Prompter,
): Promise<string> {
  return prompter.text(['Name of the Storybook in ', { code: storybookFolderOf(storybook.configDir, root) }], {
    defaultValue: storybook.defaultName,
    hint: 'What the config and the report call this Storybook.',
    validate(value) {
      if (!/^[a-z0-9-]+$/.test(value)) {
        return 'A Storybook name takes lowercase letters, digits and -.'
      }

      return takenNames.includes(value) ? `Another Storybook is already called ${value}.` : undefined
    },
  })
}

/**
 * Asks for the URL of a Storybook. A start script or Nx target that sets no port gets a hint first. The message about
 * a URL with a login never holds the URL, so the password isn't echoed.
 */
function askUrl(storybook: DetectedStorybook, name: string, prompter: Prompter): Promise<string> {
  const { start } = storybook

  if (start?.kind === 'script' && start.call.port === undefined) {
    prompter.note(
      `hint: The ${start.call.script} script sets no port. ` +
        `Add -p ${defaultStorybookPort} to it, so Storybook always starts on the port in ${name}'s URL.`,
    )
  }

  if (start?.kind === 'nx' && start.port === undefined) {
    prompter.note(
      `hint: The ${start.project}:${start.target} target sets no port. ` +
        `Set its port option to ${defaultStorybookPort}, so Storybook always starts on the port in ${name}'s URL.`,
    )
  }

  return prompter.text(['URL of ', { code: name }], {
    defaultValue: `http://127.0.0.1:${portOfStart(start) ?? defaultStorybookPort}`,
    hint: 'Where visual-check opens it, locally and in CI. Use 127.0.0.1, not localhost.',
    validate(value) {
      switch (findStorybookUrlProblem(value)) {
        case 'not-http':
          return 'Give an http: or https: URL, such as http://127.0.0.1:6006.'
        case 'login':
          return (
            "A Storybook URL can't hold a user name or password. " +
            `visual-check sends no login: ${serveStorybookFix} and point the URL at that.`
          )
        case undefined:
          return undefined
      }
    },
  })
}

/**
 * Returns the port of a URL: its own, or the one its protocol uses.
 */
export function urlPortOf(url: URL): number {
  if (url.port !== '') {
    return Number(url.port)
  }

  return url.protocol === 'https:' ? 443 : 80
}

/**
 * Finds the command that starts a Storybook: the one that runs its detected start, or, with none, the one the person
 * gives.
 */
async function askStartCommand(
  storybook: DetectedStorybook,
  name: string,
  urlPort: number,
  packageManager: PackageManager,
  workspace: StartWorkspace,
  prompter: Prompter,
): Promise<string> {
  if (storybook.start !== undefined) {
    return startCommandOf(storybook.start, packageManager, workspace)
  }

  const configArgs = storybook.configDir === defaultConfigDir ? [] : ['-c', storybook.configDir]
  const command = storybookCommandOf(packageManager, ['dev', '-p', String(urlPort), ...configArgs], workspace.yarnBerry)

  return prompter.text(['Command that starts ', { code: name }], {
    defaultValue: commandLineOf(command),
    hint: 'No script starts this Storybook. The next steps show this command.',
  })
}

/**
 * Settles the scripts that run `visual-check test` and `visual-check update`. A script that already runs one is reused.
 * The person names each other one, and its name never takes the other script's.
 */
async function askScripts(project: DetectedProject, prompter: Prompter): Promise<Answers['scripts']> {
  const scripts = scriptsOf(project.manifest)
  // The root and each Storybook's package get scripts of these names, so no start script may have one.
  const startScripts = project.storybooks.flatMap(({ start }) => (start?.kind === 'script' ? [start.call.script] : []))
  const reusedTest = reusedScriptOf(scripts, 'test')
  const reusedUpdate = reusedScriptOf(scripts, 'update')
  const test = reusedTest ?? (await askScript('test', scripts, startScripts, reusedUpdate?.name, prompter))
  const update = reusedUpdate ?? (await askScript('update', scripts, startScripts, test.name, prompter))

  return { test, update }
}

/**
 * Finds the script that already runs one kind of visual-check command, to reuse it. `undefined` when none does.
 */
function reusedScriptOf(scripts: Record<string, string>, kind: 'test' | 'update'): ScriptAnswer | undefined {
  const existing = Object.entries(scripts).find(([, value]) => runsVisualCheck(value, kind))

  return existing === undefined ? undefined : { name: existing[0], add: false }
}

/**
 * Asks for the name of the script that runs one kind of visual-check command. A script that already has that name is
 * replaced. The name can't be `otherName`, the other script's, nor a script that starts a Storybook, which the
 * suggested name avoids too.
 */
async function askScript(
  kind: 'test' | 'update',
  scripts: Record<string, string>,
  startScripts: readonly string[],
  otherName: string | undefined,
  prompter: Prompter,
): Promise<ScriptAnswer> {
  const defaultName = defaultScriptNameOf(kind, otherName, startScripts)
  const name = await prompter.text(`Name of the script that runs visual-check ${kind}`, {
    defaultValue: defaultName,
    hint: scriptHintOf(kind, defaultName, scripts),
    validate(value) {
      if (/\s/.test(value)) {
        return "A script name can't hold spaces."
      }

      if (startScripts.includes(value)) {
        return `The ${value} script starts Storybook. Pick another name.`
      }

      return value === otherName ? 'The test and update scripts need different names.' : undefined
    },
  })

  return { name, add: true }
}

/**
 * Whether a script runs the `kind` command of visual-check.
 */
function runsVisualCheck(script: string, kind: 'test' | 'update'): boolean {
  return new RegExp(`(?:^|[\\s/;&|])visual-check\\s+${kind}(?=\\s|$)`).test(script)
}

/**
 * Returns the name the question for a script suggests: the kind's default, unless the other script already has it or a
 * script with that name starts a Storybook. Then the test script gets `visual:test` and the update script
 * `visual:update-baselines`, so taking the default, as `--yes` does, never replaces the other script or a start script,
 * and passes the question's checks.
 */
function defaultScriptNameOf(
  kind: 'test' | 'update',
  otherName: string | undefined,
  startScripts: readonly string[],
): string {
  const name = defaultScriptNames[kind]

  return name === otherName || startScripts.includes(name) ? otherScriptNames[kind] : name
}

/**
 * Returns the hint of the question that names a script. When another script already has the suggested `name`, keeping
 * that name replaces it, so the hint says so. The suggested name never starts a Storybook.
 */
function scriptHintOf(kind: 'test' | 'update', name: string, scripts: Record<string, string>): string {
  if (scripts[name] === undefined) {
    return scriptHints[kind]
  }

  return `${scriptHints[kind]} Replaces your current ${name} script.`
}
