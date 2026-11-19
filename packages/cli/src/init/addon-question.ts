import type { DetectedProject, DetectedStorybook } from './detect-project.js'
import { nonEmptyOf } from './list-of.js'
import { listsDependency, type Manifest } from './package-manager.js'
import type { Choice, Prompter } from './prompter.js'

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
  /**
   * The absolute folder of the Storybook's package, where it runs.
   */
  packageDir: string
  /**
   * The absolute folder of the `package.json` the addon goes in.
   */
  manifestDir: string
  /**
   * The parsed `package.json` in `manifestDir`.
   */
  manifest: Manifest
}

/**
 * What `askAddons` needs.
 */
interface AddonQuestionInput {
  /**
   * The project `init` detected.
   */
  project: DetectedProject
  /**
   * The Storybooks chosen and named, by config folder relative to the project root. Empty when a config already
   * exists.
   */
  answered: readonly {
    /**
     * The config folder of the Storybook, relative to the project root.
     */
    configDir: string
    /**
     * The name of the Storybook.
     */
    name: string
  }[]
  /**
   * The visual-check config that already exists, or `undefined` for none. Then only its Storybooks are offered the
   * addon.
   */
  existingConfig:
    | {
        /**
         * The name of each Storybook in the config, by config folder relative to the project root.
         */
        names: Record<string, string>
      }
    | undefined
  /**
   * Where the question and the notes go.
   */
  prompter: Prompter
}

/**
 * The name of the addon package.
 */
export const addonPackage = '@visual-check/storybook-addon'

/**
 * The Storybook major version the addon is added to.
 */
const addonStorybookMajor = 10

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
 * A Storybook that may get the addon, with its name.
 */
interface NamedStorybook {
  /**
   * The Storybook.
   */
  storybook: DetectedStorybook
  /**
   * Its name: the one answered or, with an existing config, the one in the config.
   */
  name: string
}

/**
 * What decides which Storybooks the addon question is about: `askAddons`'s input without the prompter.
 */
type AddonCandidates = Omit<AddonQuestionInput, 'prompter'>

/**
 * Pairs each Storybook that may get the addon with its name: the one answered or, with an existing config, the one in
 * the config. A Storybook not chosen, or with a config one it doesn't hold, is left out.
 */
function namedStorybooksOf({ project, answered, existingConfig }: AddonCandidates): NamedStorybook[] {
  return project.storybooks.flatMap((storybook) => {
    const name =
      existingConfig === undefined
        ? answered.find(({ configDir }) => configDir === storybook.configDir)?.name
        : existingNameOf(existingConfig.names, storybook.configDir)

    return name === undefined ? [] : [{ storybook, name }]
  })
}

/**
 * Words the note for a Storybook on a major version other than 10, the one the addon is for, so `init` skips it. Gives
 * `undefined` for 10, and for a Storybook with no known version, which a note before the questions covers.
 */
function skippedAddonNoteOf(name: string, version: string | undefined): string | undefined {
  const major = version === undefined ? undefined : majorOf(version)

  return major === undefined || major === addonStorybookMajor
    ? undefined
    : `hint: ${name} runs Storybook ${major}, and the addon is for Storybook 10, so init skips it.`
}

/**
 * Whether the addon question offers a Storybook: it is on Storybook 10 and its package doesn't list the addon yet.
 */
function takesAddon({ version, manifest }: DetectedStorybook): boolean {
  return version !== undefined && majorOf(version) === addonStorybookMajor && !listsDependency(manifest, addonPackage)
}

/**
 * Lists the Storybooks the addon question offers, with their names: each answered or, with an existing config, each
 * in it, that is on Storybook 10 and whose package doesn't list the addon. The question is asked only when there's one.
 */
export function addonOfferedTo(candidates: AddonCandidates): NamedStorybook[] {
  return namedStorybooksOf(candidates).filter(({ storybook }) => takesAddon(storybook))
}

/**
 * The hint of the addon question.
 */
const addonHint = 'Check and update the open story from inside Storybook.'

/**
 * Asks which of the Storybooks that take the addon get it: yes or no, yes by default, for one, or a checklist with all
 * ticked for more. Gives the config folders of the ones that get it. Asks nothing for none.
 */
async function askAddonTargets(fitting: readonly NamedStorybook[], prompter: Prompter): Promise<string[]> {
  const choices = nonEmptyOf(
    fitting.map(({ storybook, name }): Choice<string> => ({ value: storybook.configDir, label: name })),
  )

  if (choices === undefined) {
    return []
  }

  if (choices.length === 1) {
    const [{ value, label }] = choices
    const add = await prompter.confirm(['Add the Storybook addon to ', { code: label }, '?'], {
      defaultValue: true,
      hint: addonHint,
    })

    return add ? [value] : []
  }

  return prompter.checklist('Add the Storybook addon to', {
    choices,
    defaultValues: choices.map(({ value }) => value),
    hint: addonHint,
  })
}

/**
 * Asks which Storybooks get the addon: each chosen, or in the existing config, that is on Storybook 10 and whose
 * package doesn't list the addon. For one it asks yes or no, for more it asks from a checklist with all ticked. Each on
 * another known version gets a note first. Gives the ones that get it, which may be none.
 */
export async function askAddons(input: AddonQuestionInput): Promise<AddonAnswer[]> {
  const { prompter } = input

  for (const { storybook, name } of namedStorybooksOf(input)) {
    const note = skippedAddonNoteOf(name, storybook.version)

    if (note !== undefined) {
      prompter.note(note)
    }
  }

  const fitting = addonOfferedTo(input)
  const chosen = await askAddonTargets(fitting, prompter)

  return fitting
    .filter(({ storybook }) => chosen.includes(storybook.configDir))
    .map(({ storybook: { configDir, packageDir, manifestDir, manifest }, name }) => ({
      configDir,
      name,
      packageDir,
      manifestDir,
      manifest,
    }))
}
