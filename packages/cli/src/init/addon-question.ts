import type { DetectedProject, DetectedStorybook } from './detect-project.js'
import { nonEmptyOf } from './list-of.js'
import { listsDependency } from './package-manager.js'
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
const addonPackage = '@visual-check/storybook-addon'

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
 * Pairs each Storybook that may get the addon with its name: the one answered or, with an existing config, the one in
 * the config. A Storybook not chosen, or with a config one it doesn't hold, is left out.
 */
function namedStorybooksOf({
  project,
  answered,
  existingConfig,
}: AddonQuestionInput): { storybook: DetectedStorybook; name: string }[] {
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
 * Asks which Storybooks get the addon, from a checklist with all ticked: each chosen, or in the existing config, that
 * is on Storybook 10 and whose package doesn't list the addon. Each on another known version gets a note first. Gives
 * the ones ticked, which may be none.
 */
export async function askAddons(input: AddonQuestionInput): Promise<AddonAnswer[]> {
  const { prompter } = input
  const named = namedStorybooksOf(input)

  for (const { storybook, name } of named) {
    const note = skippedAddonNoteOf(name, storybook.version)

    if (note !== undefined) {
      prompter.note(note)
    }
  }

  const fitting = named.filter(
    ({ storybook: { version, manifest } }) =>
      version !== undefined && majorOf(version) === addonStorybookMajor && !listsDependency(manifest, addonPackage),
  )
  const choices = nonEmptyOf(
    fitting.map(({ storybook, name }): Choice<string> => ({ value: storybook.configDir, label: name })),
  )

  if (choices === undefined) {
    return []
  }

  const chosen = await prompter.checklist('Add the Storybook addon to', {
    choices,
    defaultValues: fitting.map(({ storybook }) => storybook.configDir),
    hint: 'Check and update the open story from inside Storybook.',
  })

  return fitting
    .filter(({ storybook }) => chosen.includes(storybook.configDir))
    .map(({ storybook: { configDir, packageDir }, name }) => ({ configDir, name, packageDir }))
}
