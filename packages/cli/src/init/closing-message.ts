import { dirname, join } from 'node:path'
import { isFile } from '../config/find-config.js'
import { docsUrlOf } from '../docs-site/docs-url.js'
import { relativePathOf } from './find-storybooks.js'
import { listOf } from './list-of.js'
import { type PackageManager, runScriptCommandOf } from './package-manager.js'
import type { Answers } from './questions.js'
import type { ScriptChanges } from './setup-files.js'

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
   * The scripts it added to `package.json` and the ones it replaced there.
   */
  scripts: ScriptChanges
}

/**
 * What `init` wrote, worded for the person.
 *
 * @public
 */
export interface WrittenList {
  /**
   * The paths of the files it wrote, relative to the folder `init` runs in, in the order it wrote them.
   */
  files: string[]
  /**
   * A line naming the scripts it added to `package.json`, when it added any, then a line per script it replaced there,
   * with what that script ran before.
   */
  scripts: string[]
}

/**
 * A piece of a line of the closing message: plain words, or a command, path or URL, which the terminal UI picks out.
 *
 * @public
 */
export type Segment =
  | string
  | {
      /**
       * The command, path or URL.
       */
      code: string
    }

/**
 * How to spread `visualCheck` into the parameters of one config folder's preview file.
 */
interface PreviewSnippet {
  /**
   * The preview file, relative to the folder `init` runs in.
   */
  file: string
  /**
   * The two lines to put in it, without indentation.
   */
  lines: string[]
}

/**
 * What the closing message tells, as data the plain text and the terminal UI each lay out their own way.
 *
 * @public
 */
export interface NextSteps {
  /**
   * The four steps to a first passing run, in order, each a line of segments.
   */
  steps: Segment[][]
  /**
   * How to set options for every story, one per config folder, in the order of the Storybooks.
   */
  previews: PreviewSnippet[]
  /**
   * The docs page that tells how to run visual-check in CI.
   */
  ciUrl: string
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
 * Words what `init` wrote: the path of each file, relative to `cwd`, then a line naming the scripts it added, when it
 * added any, and a line per script it replaced, with what that script ran before.
 */
export function writtenListOf(written: Written, cwd: string): WrittenList {
  const { added, replaced } = written.scripts
  const scripts: string[] = []

  if (added.length === 1) {
    scripts.push(`Added the script ${added[0]} to package.json.`)
  } else if (added.length > 1) {
    scripts.push(`Added the scripts ${listOf(added)} to package.json.`)
  }

  for (const { name, previous } of replaced) {
    scripts.push(`Replaced the script ${name} in package.json. It ran: ${previous}`)
  }

  return { files: written.files.map((file) => relativePathOf(cwd, file)), scripts }
}

/**
 * Lists what `init` wrote, as its plain text says it: a `Wrote <path>` line per file, then the lines about the scripts.
 */
export function writtenLinesOf({ files, scripts }: WrittenList): string[] {
  return [...files.map((file) => `Wrote ${file}`), ...scripts]
}

/**
 * Names the items in order, as `listOf` does, each a code segment: `a`, `a and b`, or `a, b and c`.
 */
function codeListOf(items: readonly string[]): Segment[] {
  return items.flatMap((item, index): Segment[] => {
    if (index === 0) {
      return [{ code: item }]
    }

    return [index === items.length - 1 ? ' and ' : ', ', { code: item }]
  })
}

/**
 * Joins segments into plain text.
 */
function textOf(segments: readonly Segment[]): string {
  return segments.map((segment) => (typeof segment === 'string' ? segment : segment.code)).join('')
}

/**
 * Returns the first step: start the Storybook, or each Storybook with its own command. With none set up, when the
 * config holds none `init` could set up, it's to add one, as the hints say.
 */
function startStepOf({ cwd, configPath, storybooks }: ClosingMessageInput): Segment[] {
  const [first, ...others] = storybooks

  if (first === undefined) {
    return ['Add your Storybook to ', { code: relativePathOf(cwd, configPath) }, ', as the hints say, then start it.']
  }

  if (others.length === 0) {
    return ['Start Storybook with ', { code: first.startCommand }, '.']
  }

  return [
    'Start each Storybook: ',
    ...storybooks.flatMap(({ name, startCommand }, index): Segment[] => [
      { code: startCommand },
      ` for ${name}${index === storybooks.length - 1 ? '.' : ', '}`,
    ]),
  ]
}

/**
 * Returns the last step: commit the config, each Storybook's `visual-check.ts`, and each `.visual-check/` folder, the
 * config folder's last. Each path shows once.
 */
function commitStepOf({ cwd, configPath, storybooks }: ClosingMessageInput): Segment[] {
  const paths = [
    relativePathOf(cwd, configPath),
    ...storybooks.map(({ configDir }) => relativePathOf(cwd, join(configDir, 'visual-check.ts'))),
    ...[...storybooks.map(({ dir }) => dir), dirname(configPath)].map(
      (folder) => `${relativePathOf(cwd, join(folder, '.visual-check'))}/`,
    ),
  ]

  return ['Commit ', ...codeListOf([...new Set(paths)]), '.']
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
 * Returns the line that leads into the snippet for a preview file: to set options for every story, spread
 * `visualCheck` into the parameters there.
 *
 * @public
 */
export function previewIntroOf(file: string): Segment[] {
  return ['To set options for every story, spread visualCheck into the parameters in ', { code: file }, ':']
}

/**
 * Returns what the closing message tells: the four steps to a first passing run, how to set options for every story in
 * each config folder's preview file, and the docs page that tells how to run visual-check in CI. Commands, paths and
 * URLs are code segments. It says nothing about remote content.
 */
export function nextStepsOf(input: ClosingMessageInput): NextSteps {
  const { cwd, packageManager, storybooks, scripts } = input
  const configDirs = [...new Set(storybooks.map(({ configDir }) => configDir))]

  return {
    steps: [
      startStepOf(input),
      [
        'Run ',
        { code: runScriptCommandOf(packageManager, scripts.update.name) },
        ' to write baselines. The first run downloads the browser image.',
      ],
      [
        'Run ',
        { code: runScriptCommandOf(packageManager, scripts.test.name) },
        '. It should pass. If a story fails, see ',
        { code: docsUrlOf('broken-stories') },
        '.',
      ],
      commitStepOf(input),
    ],
    previews: configDirs.map((configDir) => ({
      file: relativePathOf(cwd, previewFileIn(configDir)),
      lines: ["import { visualCheck } from './visual-check'", 'parameters: { ...visualCheck({}) },'],
    })),
    ciUrl: docsUrlOf('ci'),
  }
}

/**
 * Returns the message `init` ends with, as plain text: the next steps numbered, the preview snippets indented, and the
 * docs link for CI.
 */
export function closingMessageTextOf({ steps, previews, ciUrl }: NextSteps): string {
  return [
    'visual-check is set up. Next:',
    ...steps.map((step, index) => `  ${index + 1}. ${textOf(step)}`),
    ...previews.flatMap(({ file, lines }) => ['', textOf(previewIntroOf(file)), ...lines.map((line) => `  ${line}`)]),
    '',
    `To run visual-check in CI, see ${ciUrl}.`,
    '',
  ].join('\n')
}
