import { findStorybookUrlProblem, serveStorybookFix } from '../config/find-storybook-url-problem.js'
import type { DetectedProject, DetectedStorybook } from './detect-project.js'
import {
  commandLineOf,
  listsDependency,
  type PackageManager,
  runScriptCommandOf,
  scriptsOf,
  storybookCommandOf,
} from './package-manager.js'
import type { Choice, Prompter } from './prompter.js'
import { defaultConfigDir, storybookCallsOf } from './storybook-scripts.js'

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
   * The answers for each Storybook, in the order they were found. Empty when a config already exists.
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
   * The Storybooks that get the visual-check addon: the config folder and the name of each.
   */
  addons: AddonAnswer[]
}

/**
 * A Storybook the addon is added to.
 */
export interface AddonAnswer {
  /**
   * The config folder of the Storybook, relative to the project root.
   */
  configDir: string
  /**
   * The name of the Storybook.
   */
  name: string
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
  test: 'Runs visual-check test, which compares each story with its baseline.',
  update: 'Runs visual-check update, which writes the baselines.',
} as const

/**
 * The name of the addon package.
 */
const addonPackage = '@visual-check/storybook-addon'

/**
 * The Storybook major version the addon is added to.
 */
const addonStorybookMajor = 10

/**
 * Asks the questions of `init`, in order: the package manager, each Storybook, the script names, and the addon. Gives
 * the answers, and the warnings the answers call for. It prints nothing: hints go through the prompter.
 */
export async function askQuestions({
  project,
  prompter,
  existingConfig,
}: QuestionInput): Promise<{ answers: Answers; warnings: string[] }> {
  const warnings: string[] = []
  const packageManager = await askPackageManager(project, prompter)
  const storybooks =
    existingConfig === undefined ? await askStorybooks(project, packageManager, prompter, warnings) : []
  const scripts = await askScripts(project, prompter)
  const addons = await askAddons(project, namedStorybooksOf(project, storybooks, existingConfig), prompter)

  return { answers: { packageManager, storybooks, scripts, addons }, warnings }
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
    hint: "Nothing in package.json or a lockfile names one. init installs visual-check's packages with it.",
  })
}

/**
 * Asks about each Storybook in turn. The names already answered are taken.
 */
async function askStorybooks(
  project: DetectedProject,
  packageManager: PackageManager,
  prompter: Prompter,
  warnings: string[],
): Promise<StorybookAnswers[]> {
  const answers: StorybookAnswers[] = []

  for (const storybook of project.storybooks) {
    const taken = answers.map(({ name }) => name)

    answers.push(await askStorybook(storybook, taken, packageManager, prompter, warnings))
  }

  return answers
}

/**
 * Asks for the name, the URL and the start command of one Storybook, and warns when the URL's port isn't the port its
 * start command uses.
 */
async function askStorybook(
  storybook: DetectedStorybook,
  takenNames: readonly string[],
  packageManager: PackageManager,
  prompter: Prompter,
  warnings: string[],
): Promise<StorybookAnswers> {
  const name = await askName(storybook, takenNames, prompter)
  const url = await askUrl(storybook, name, prompter)
  const startCommand = await askStartCommand(storybook, name, url, packageManager, prompter)
  const commandPort = startPortOf(storybook, startCommand)

  if (commandPort !== undefined && urlPortOf(url) !== commandPort) {
    warnings.push(
      `Warning: ${name}'s URL, ${url}, has port ${urlPortOf(url)}, ` +
        `and its start command, ${startCommand}, starts Storybook on port ${commandPort}.`,
    )
  }

  return { configDir: storybook.configDir, name, url, startCommand }
}

/**
 * Returns the port a Storybook's start command starts it on: the one its start script sets, or, for a command the person
 * typed, the one its `storybook dev` call sets. `undefined` when none is set, or the command runs no `storybook dev`.
 */
function startPortOf(storybook: DetectedStorybook, startCommand: string): number | undefined {
  if (storybook.startScript !== undefined) {
    return storybook.startScript.port
  }

  return storybookCallsOf({ start: startCommand }).find((call) => call.subcommand === 'dev')?.port
}

/**
 * Asks for the name of a Storybook.
 */
function askName(storybook: DetectedStorybook, takenNames: readonly string[], prompter: Prompter): Promise<string> {
  return prompter.text(`Name of the Storybook in ${storybook.configDir}`, {
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
 * Asks for the URL of a Storybook. A start script that sets no port gets a hint first. The message about a URL with a
 * login never holds the URL, so the password isn't echoed.
 */
function askUrl(storybook: DetectedStorybook, name: string, prompter: Prompter): Promise<string> {
  const { startScript } = storybook

  if (startScript !== undefined && startScript.port === undefined) {
    prompter.note(
      `hint: The ${startScript.script} script sets no port. ` +
        `Add -p ${defaultStorybookPort} to it, so Storybook always starts on the port in ${name}'s URL.`,
    )
  }

  return prompter.text(`URL of ${name}`, {
    defaultValue: `http://127.0.0.1:${startScript?.port ?? defaultStorybookPort}`,
    hint: 'Where visual-check opens this Storybook, locally and in CI. Use 127.0.0.1, not localhost.',
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
function urlPortOf(url: string): number {
  const parsed = new URL(url)

  if (parsed.port !== '') {
    return Number(parsed.port)
  }

  return parsed.protocol === 'https:' ? 443 : 80
}

/**
 * Finds the command that starts a Storybook: the one that runs its start script, or, with no script, the one the
 * person gives.
 */
async function askStartCommand(
  storybook: DetectedStorybook,
  name: string,
  url: string,
  packageManager: PackageManager,
  prompter: Prompter,
): Promise<string> {
  if (storybook.startScript !== undefined) {
    return runScriptCommandOf(packageManager, storybook.startScript.script)
  }

  const configArgs = storybook.configDir === defaultConfigDir ? [] : ['-c', storybook.configDir]
  const command = storybookCommandOf(packageManager, ['dev', '-p', String(urlPortOf(url)), ...configArgs])

  return prompter.text(`Command that starts ${name}`, {
    defaultValue: commandLineOf(command),
    hint: 'No script starts this Storybook, so the next steps use this command.',
  })
}

/**
 * Settles the scripts that run `visual-check test` and `visual-check update`. A script that already runs one is reused.
 * The person names each other one, and its name never takes the other script's.
 */
async function askScripts(project: DetectedProject, prompter: Prompter): Promise<Answers['scripts']> {
  const scripts = scriptsOf(project.manifest)
  const startScripts = project.storybooks.flatMap(({ startScript }) =>
    startScript === undefined ? [] : [startScript.script],
  )
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
 * replaced, unless it starts a Storybook. The name can't be `otherName`, the other script's, which the suggested name
 * avoids too.
 */
async function askScript(
  kind: 'test' | 'update',
  scripts: Record<string, string>,
  startScripts: readonly string[],
  otherName: string | undefined,
  prompter: Prompter,
): Promise<ScriptAnswer> {
  const defaultName = defaultScriptNameOf(kind, otherName)
  const name = await prompter.text(`Name of the script that runs visual-check ${kind}`, {
    defaultValue: defaultName,
    hint: scriptHintOf(kind, defaultName, scripts, startScripts),
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
 * Returns the name the question for a script suggests: the kind's default, unless the other script already has it.
 * Then the test script gets `visual:test` and the update script `visual:update-baselines`, so taking the default, as
 * `--yes` does, never replaces the other script.
 */
function defaultScriptNameOf(kind: 'test' | 'update', otherName: string | undefined): string {
  const name = defaultScriptNames[kind]

  return name === otherName ? otherScriptNames[kind] : name
}

/**
 * Returns the hint of the question that names a script. When another script already has the suggested `name`, keeping
 * that name replaces it, unless it starts a Storybook, so the hint says what that script runs now.
 */
function scriptHintOf(
  kind: 'test' | 'update',
  name: string,
  scripts: Record<string, string>,
  startScripts: readonly string[],
): string {
  const current = scripts[name]

  if (current === undefined || startScripts.includes(name)) {
    return scriptHints[kind]
  }

  return `${scriptHints[kind]} package.json's ${name} runs ${current} now; init replaces it.`
}

/**
 * Returns the major version of a version text, or `undefined` for one that starts with no number.
 */
function majorOf(version: string): number | undefined {
  const match = /^\D*(\d+)/.exec(version)

  return match?.[1] === undefined ? undefined : Number(match[1])
}

/**
 * Returns the name the config gives the Storybook in `configDir`, or `undefined` when it holds none.
 */
function existingNameOf(names: Record<string, string>, configDir: string): string | undefined {
  return Object.hasOwn(names, configDir) ? names[configDir] : undefined
}

/**
 * Pairs each Storybook that may get the addon with its name: the one answered or, with an existing config, the one in
 * the config. With a config, a Storybook it doesn't hold is left out.
 */
function namedStorybooksOf(
  project: DetectedProject,
  answered: readonly StorybookAnswers[],
  existingConfig: QuestionInput['existingConfig'],
): { storybook: DetectedStorybook; name: string }[] {
  return project.storybooks.flatMap((storybook, index) => {
    const name =
      existingConfig === undefined ? answered[index]?.name : existingNameOf(existingConfig.names, storybook.configDir)

    return name === undefined ? [] : [{ storybook, name }]
  })
}

/**
 * Asks whether to add the addon to one Storybook. Yes by default.
 */
function askAddon(name: string, prompter: Prompter): Promise<boolean> {
  return prompter.confirm(`Add the Storybook addon to ${name}?`, {
    defaultValue: true,
    hint: 'Checks and updates the open story from inside Storybook. Added through storybook add.',
  })
}

/**
 * Asks, for each Storybook 10 that doesn't list the addon, whether to add it. Gives the ones the person said yes to.
 */
async function askAddons(
  project: DetectedProject,
  named: readonly { storybook: DetectedStorybook; name: string }[],
  prompter: Prompter,
): Promise<AddonAnswer[]> {
  const addons: AddonAnswer[] = []

  for (const { storybook, name } of named) {
    const { configDir, version } = storybook
    const wanted =
      version !== undefined &&
      majorOf(version) === addonStorybookMajor &&
      !listsDependency(project.manifest, addonPackage)

    if (wanted && (await askAddon(name, prompter))) {
      addons.push({ configDir, name })
    }
  }

  return addons
}
