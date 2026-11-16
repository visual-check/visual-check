import { dirname, join } from 'node:path'
import { isFile } from '../config/find-config.js'
import { docsUrlOf } from '../docs-site/docs-url.js'
import { relativePathOf } from './find-storybooks.js'
import { type PackageManager, runScriptCommandOf, visualCheckCommandOf } from './package-manager.js'
import type { Answers, ScriptAnswer } from './questions.js'

/**
 * A Storybook `init` set up, with what the closing message says about it.
 */
export interface SetUpStorybook {
  /**
   * The Storybook's name.
   */
  name: string
  /**
   * The absolute folder Storybook runs in, which holds its `.visual-check/` folder.
   */
  dir: string
  /**
   * The absolute path of Storybook's config folder, which holds `visual-check.ts` and the preview file.
   */
  configDir: string
  /**
   * The command that starts the Storybook.
   */
  startCommand: string
}

/**
 * What `init` wrote.
 */
export interface Written {
  /**
   * The absolute paths of the files it wrote, in the order it wrote them.
   */
  files: string[]
  /**
   * The names of the scripts it added to `package.json`.
   */
  scripts: string[]
}

/**
 * What the closing message tells.
 */
interface ClosingMessageInput {
  /**
   * The folder `init` runs in. Paths are shown relative to it.
   */
  cwd: string
  /**
   * The package manager of the project.
   */
  packageManager: PackageManager
  /**
   * The absolute path of the config: the one that was there, or the one `init` wrote.
   */
  configPath: string
  /**
   * The Storybooks that were set up, in the config's order.
   */
  storybooks: readonly SetUpStorybook[]
  /**
   * The scripts that run `visual-check test` and `visual-check update`.
   */
  scripts: Answers['scripts']
}

/**
 * The extensions a Storybook preview file takes, in the order `init` looks for them.
 */
const previewExtensions = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'mts', 'cjs', 'cts']

/**
 * Names the items in order: `a`, `a and b`, or `a, b and c`.
 */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) {
    return items.join('')
  }

  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/**
 * Lists what `init` wrote: a `Wrote <path>` line per file, then a line naming the scripts it added, when it added any.
 */
export function writtenLinesOf(written: Written, cwd: string): string[] {
  const lines = written.files.map((file) => `Wrote ${relativePathOf(cwd, file)}`)

  if (written.scripts.length === 1) {
    lines.push(`Added the script ${written.scripts[0]} to package.json.`)
  } else if (written.scripts.length > 1) {
    lines.push(`Added the scripts ${listOf(written.scripts)} to package.json.`)
  }

  return lines
}

/**
 * Returns the command that runs one kind of visual-check command: its script, or the binary itself when `init` added
 * no script for it.
 */
function commandOf(packageManager: PackageManager, kind: 'test' | 'update', script: ScriptAnswer | undefined): string {
  return script === undefined
    ? visualCheckCommandOf(packageManager, kind)
    : runScriptCommandOf(packageManager, script.name)
}

/**
 * Returns the first step: start the Storybook, or each Storybook with its own command. With none set up, when the
 * config holds none `init` could set up, it's to add one, as the hints say.
 */
function startStepOf({ cwd, configPath, storybooks }: ClosingMessageInput): string {
  const [first, ...others] = storybooks

  if (first === undefined) {
    return `Add your Storybook to ${relativePathOf(cwd, configPath)}, as the hints say, then start it.`
  }

  if (others.length === 0) {
    return `Start Storybook with ${first.startCommand}.`
  }

  const commands = storybooks.map(({ name, startCommand }) => `${startCommand} for ${name}`)

  return `Start each Storybook: ${commands.join(', ')}.`
}

/**
 * Returns the last step: commit the config, each Storybook's `visual-check.ts`, and each `.visual-check/` folder, the
 * config folder's last. Each path shows once.
 */
function commitStepOf({ cwd, configPath, storybooks }: ClosingMessageInput): string {
  const paths = [
    relativePathOf(cwd, configPath),
    ...storybooks.map(({ configDir }) => relativePathOf(cwd, join(configDir, 'visual-check.ts'))),
    ...[...storybooks.map(({ dir }) => dir), dirname(configPath)].map(
      (folder) => `${relativePathOf(cwd, join(folder, '.visual-check'))}/`,
    ),
  ]

  return `Commit ${listOf([...new Set(paths)])}.`
}

/**
 * Returns the preview file of a config folder: the first `preview.<extension>` there, else `preview.ts`.
 */
function previewFileIn(configDir: string): string {
  const existing = previewExtensions
    .map((extension) => join(configDir, `preview.${extension}`))
    .find((path) => isFile(path))

  return existing ?? join(configDir, 'preview.ts')
}

/**
 * Returns the lines that tell how to spread `visualCheck` into the parameters of a config folder's preview file.
 */
function previewLinesOf(configDir: string, cwd: string): string[] {
  const previewFile = relativePathOf(cwd, previewFileIn(configDir))

  return [
    `To set options for every story, spread visualCheck into the parameters in ${previewFile}:`,
    "  import { visualCheck } from './visual-check'",
    '  parameters: { ...visualCheck({}) },',
  ]
}

/**
 * Returns the message `init` ends with: the four steps to a first passing run, how to set options for every story in
 * each config folder's preview file, and where the docs tell how to run visual-check in CI. It says nothing about
 * remote content.
 */
export function closingMessageOf(input: ClosingMessageInput): string {
  const { cwd, packageManager, storybooks, scripts } = input
  const configDirs = [...new Set(storybooks.map(({ configDir }) => configDir))]

  return [
    'visual-check is set up. Next:',
    `  1. ${startStepOf(input)}`,
    `  2. Run ${commandOf(packageManager, 'update', scripts.update)} to write baselines. ` +
      'The first run downloads the browser image.',
    `  3. Run ${commandOf(packageManager, 'test', scripts.test)}. It should pass. ` +
      `If a story fails, see ${docsUrlOf('broken-stories')}.`,
    `  4. ${commitStepOf(input)}`,
    ...configDirs.flatMap((configDir) => ['', ...previewLinesOf(configDir, cwd)]),
    '',
    `To run visual-check in CI, see ${docsUrlOf('ci')}.`,
    '',
  ].join('\n')
}
