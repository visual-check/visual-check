import { relativePathOf } from './find-storybooks.js'
import { type PackageManager, rootBinScriptOf } from './package-manager.js'

/**
 * The scripts `init` sets in one workspace package's `package.json`.
 */
export interface PackageScripts {
  /**
   * The absolute folder of the package.
   */
  dir: string
  /**
   * The scripts, by name, each running visual-check for one of the package's Storybooks.
   */
  scripts: Record<string, string>
}

/**
 * What `packageScriptsOf` needs.
 */
interface PackageScriptsInput {
  /**
   * The absolute workspace root, whose `package.json` holds the scripts that run every Storybook.
   */
  root: string
  /**
   * The Storybooks set up, each with its name and the absolute folder of its package.
   */
  storybooks: readonly {
    /**
     * The Storybook's name, which `--storybook` takes.
     */
    name: string
    /**
     * The absolute folder of the Storybook's package.
     */
    dir: string
  }[]
  /**
   * The names of the root's scripts that run `visual-check test` and `visual-check update`.
   */
  scriptNames: {
    /**
     * The name of the script that runs `visual-check test`.
     */
    test: string
    /**
     * The name of the script that runs `visual-check update`.
     */
    update: string
  }
  /**
   * The package manager of the project.
   */
  packageManager: PackageManager
  /**
   * Whether Yarn is Yarn 2 or later.
   */
  yarnBerry: boolean
  /**
   * The package folders the package manager's own list names, relative to the root, or `undefined` when the root holds
   * no such list.
   */
  listedPackageDirs: readonly string[] | undefined
}

/**
 * Returns the scripts each Storybook's package gets, so running them in the package checks only its Storybooks. They
 * take the root's script names and run `visual-check test --storybook <name>` and `visual-check update --storybook
 * <name>`. A package with several Storybooks gets a pair for each, with `:<name>` after the root's names. Only a
 * package the package manager's own list names gets scripts, since only its scripts find the CLI the root installed:
 * not the root, nor a package only Nx, Lerna or Rush lists.
 */
export function packageScriptsOf(input: PackageScriptsInput): PackageScripts[] {
  const { root, storybooks, scriptNames, packageManager, yarnBerry, listedPackageDirs = [] } = input
  const namesByDir = new Map<string, string[]>()

  for (const { name, dir } of storybooks) {
    if (dir !== root && listedPackageDirs.includes(relativePathOf(root, dir))) {
      namesByDir.set(dir, [...(namesByDir.get(dir) ?? []), name])
    }
  }

  return [...namesByDir].map(([dir, names]) => {
    const scripts: Record<string, string> = {}

    for (const name of names) {
      const suffix = names.length > 1 ? `:${name}` : ''

      for (const kind of ['test', 'update'] as const) {
        scripts[`${scriptNames[kind]}${suffix}`] = rootBinScriptOf(
          packageManager,
          'visual-check',
          [kind, '--storybook', name],
          yarnBerry,
        )
      }
    }

    return { dir, scripts }
  })
}
