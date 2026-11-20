import type { SkillCommand, SkillSetup } from '../agent-skill/setup-file.js'
import type { DetectedProject } from './detect-project.js'
import { relativePathOf } from './find-storybooks.js'
import { installedBinCommandOf, type PackageManager } from './package-manager.js'
import { defaultStorybookPort, urlPortOf } from './questions.js'
import { defaultConfigDir } from './storybook-scripts.js'

/**
 * A Storybook the skill's `setup.json` gets a start command for: its config name, absolute folders and URL.
 */
export interface SkillStorybook {
  /**
   * The Storybook's config name.
   */
  name: string
  /**
   * The absolute folder Storybook runs in, its `dir`.
   */
  dir: string
  /**
   * The absolute path of its config folder.
   */
  configDir: string
  /**
   * Its URL outside CI, or `undefined` when the config can't be loaded.
   */
  url: string | undefined
}

/**
 * What `skillSetupOf` works from: the project `init` detected and the package manager it sets up for.
 */
interface SkillSetupContext {
  /**
   * The project `init` detected.
   */
  project: Pick<DetectedProject, 'root' | 'yarnBerry' | 'storybooks'>
  /**
   * The project's package manager.
   */
  packageManager: PackageManager
}

/**
 * What `skillSetupOf` takes: its context and the Storybooks to start.
 */
interface SkillSetupInput extends SkillSetupContext {
  /**
   * The Storybooks to start. Their start commands follow this order, except that JSON puts integer-like names first.
   */
  storybooks: readonly SkillStorybook[]
}

/**
 * Gives the words of the command that runs the installed binary `bin` with `args`, never downloading.
 */
function installedBinWordsOf(context: SkillSetupContext, bin: string, args: readonly string[]): string[] {
  const { command, args: allArgs } = installedBinCommandOf(context.packageManager, bin, args, context.project.yarnBerry)

  return [command, ...allArgs]
}

/**
 * Gives the command that starts `storybook`: the start `init` detected for its config folder, else `storybook dev`
 * on its URL's port in its folder.
 */
function startCommandOf(context: SkillSetupContext, storybook: SkillStorybook): SkillCommand {
  const { project, packageManager } = context
  const { dir, configDir, url } = storybook
  const start = project.storybooks.find(
    (detected) => detected.configDir === relativePathOf(project.root, configDir),
  )?.start

  if (start?.kind === 'script') {
    return { command: [packageManager, 'run', start.call.script], cwd: start.packageDir }
  }

  if (start?.kind === 'nx') {
    return {
      command: installedBinWordsOf(context, 'nx', ['run', `${start.project}:${start.target}`]),
      cwd: project.root,
    }
  }

  const config = relativePathOf(dir, configDir)
  const port = url === undefined ? defaultStorybookPort : urlPortOf(new URL(url))
  const configArgs = config === defaultConfigDir ? [] : ['-c', config]

  return { command: installedBinWordsOf(context, 'storybook', ['dev', '-p', String(port), ...configArgs]), cwd: dir }
}

/**
 * Builds what the agent skill's `setup.json` holds: the project's CLI run from the workspace root, and each
 * Storybook's start command, in a form that never downloads. A start script runs as `<pm> run <script>` in the folder
 * of the `package.json` that holds it; an Nx target as `nx run <project>:<target>` from the root; a Storybook with no
 * start found as `storybook dev` on its URL's port in its folder, with `-c` when its config folder isn't `.storybook`.
 */
export function skillSetupOf(input: SkillSetupInput): SkillSetup {
  const { storybooks, ...context } = input

  return {
    cli: { command: installedBinWordsOf(context, 'visual-check', []), cwd: context.project.root },
    storybooks: Object.fromEntries(storybooks.map((storybook) => [storybook.name, startCommandOf(context, storybook)])),
  }
}
