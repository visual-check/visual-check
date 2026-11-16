import { findStorybookUrlProblem, serveStorybookFix } from '../config/find-storybook-url-problem.js'
import type { DetectedProject, DetectedStorybook } from './detect-project.js'
import {
  isJsonObject,
  isPackageManager,
  type PackageManager,
  runScriptCommandOf,
  scriptsOf,
  storybookBinCommandOf,
} from './package-manager.js'
import type { Prompter } from './prompter.js'
import { defaultConfigDir } from './storybook-scripts.js'

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
   * The scripts that run `visual-check test` and `visual-check update`. A kind is `undefined` when `--yes` found the
   * default name taken by another script, so `init` adds none.
   */
  scripts: {
    /**
     * The script that runs `visual-check test`.
     */
    test: ScriptAnswer | undefined
    /**
     * The script that runs `visual-check update`.
     */
    update: ScriptAnswer | undefined
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
   * Whether `--yes` was passed.
   */
  yes: boolean
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
 * The port Storybook starts on when nothing sets another.
 */
const defaultStorybookPort = 6006

/**
 * The name of the addon package.
 */
const addonPackage = '@visual-check/storybook-addon'

/**
 * The `package.json` fields that may list the addon.
 */
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

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
  yes,
}: QuestionInput): Promise<{ answers: Answers; warnings: string[] }> {
  const warnings: string[] = []
  const packageManager = await askPackageManager(project, prompter)
  const storybooks =
    existingConfig === undefined ? await askStorybooks(project, packageManager, prompter, warnings) : []
  const scripts = await askScripts(project, prompter, yes, warnings)
  const addons = await askAddons(project, namedStorybooksOf(project, storybooks, existingConfig), prompter)

  return { answers: { packageManager, storybooks, scripts, addons }, warnings }
}

/**
 * Returns the detected package manager, or asks for one when nothing shows it.
 */
async function askPackageManager(project: DetectedProject, prompter: Prompter): Promise<PackageManager> {
  if (project.packageManager !== undefined) {
    return project.packageManager
  }

  const answer = await prompter.text('Package manager (npm, pnpm, yarn or bun)', {
    defaultValue: defaultPackageManager,
    validate: (value) => (isPackageManager(value) ? undefined : 'Pick npm, pnpm, yarn or bun.'),
  })

  // The validation accepts only a known name, so the fallback is never taken.
  return isPackageManager(answer) ? answer : defaultPackageManager
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
 * start script uses.
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
  const scriptPort = storybook.startScript?.port

  if (scriptPort !== undefined && urlPortOf(url) !== scriptPort) {
    warnings.push(
      `Warning: ${name}'s URL, ${url}, has port ${urlPortOf(url)}, ` +
        `and its start command, ${startCommand}, starts Storybook on port ${scriptPort}.`,
    )
  }

  return { configDir: storybook.configDir, name, url, startCommand }
}

/**
 * Asks for the name of a Storybook.
 */
function askName(storybook: DetectedStorybook, takenNames: readonly string[], prompter: Prompter): Promise<string> {
  return prompter.text(`Name of the Storybook in ${storybook.configDir}`, {
    defaultValue: storybook.defaultName,
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

  const words = [...storybookBinCommandOf(packageManager), 'dev', '-p', String(urlPortOf(url))]

  if (storybook.configDir !== defaultConfigDir) {
    words.push('-c', storybook.configDir)
  }

  return prompter.text(`Command that starts ${name}`, {
    defaultValue: words.join(' '),
  })
}

/**
 * Asks for the names of the scripts that run `visual-check test` and `visual-check update`.
 */
async function askScripts(
  project: DetectedProject,
  prompter: Prompter,
  yes: boolean,
  warnings: string[],
): Promise<Answers['scripts']> {
  const scripts = scriptsOf(project.manifest)
  const test = await askScript('test', scripts, undefined, prompter, yes, warnings)
  const update = await askScript('update', scripts, test?.name, prompter, yes, warnings)

  return { test, update }
}

/**
 * Settles the script that runs one kind of visual-check command: an existing script that already runs it, none when
 * `--yes` finds the default name taken, or a name the person gives.
 */
async function askScript(
  kind: 'test' | 'update',
  scripts: Record<string, string>,
  testName: string | undefined,
  prompter: Prompter,
  yes: boolean,
  warnings: string[],
): Promise<ScriptAnswer | undefined> {
  const runs = new RegExp(`(?:^|[\\s/;&|])visual-check\\s+${kind}(?=\\s|$)`)
  const existing = Object.entries(scripts).find(([, value]) => runs.test(value))

  if (existing !== undefined) {
    return { name: existing[0], add: false }
  }

  const defaultName = `visual:${kind}`

  if (yes && Object.hasOwn(scripts, defaultName)) {
    warnings.push(
      `Warning: package.json already has a ${defaultName} script, so init added none for visual-check ${kind}.`,
    )

    return undefined
  }

  const name = await prompter.text(`Name of the script that runs visual-check ${kind}`, {
    defaultValue: defaultName,
    validate(value) {
      if (/\s/.test(value)) {
        return "A script name can't hold spaces."
      }

      if (Object.hasOwn(scripts, value)) {
        return `package.json already has a ${value} script. Pick another name.`
      }

      return value === testName ? 'The test and update scripts need different names.' : undefined
    },
  })

  return { name, add: true }
}

/**
 * Returns whether a manifest lists the addon in any of its dependency fields.
 */
function listsAddon(manifest: DetectedProject['manifest']): boolean {
  return dependencyFields.some((field) => {
    const dependencies = manifest[field]

    return isJsonObject(dependencies) && addonPackage in dependencies
  })
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
    const wanted = version !== undefined && majorOf(version) === addonStorybookMajor && !listsAddon(project.manifest)

    if (wanted && (await prompter.confirm(`Add the Storybook addon to ${name}?`, true))) {
      addons.push({ configDir, name })
    }
  }

  return addons
}
