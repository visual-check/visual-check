import { join } from 'node:path'
import { docsUrlOf } from '../docs-site/docs-url.js'
import { relativePathOf, workspaceFolderOf } from './find-storybooks.js'
import { listOf } from './list-of.js'
import { type PackageManager, runScriptCommandOf } from './package-manager.js'
import type { Answers } from './questions.js'
import { type Segment, textOf } from './segment.js'

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
   * The absolute path of Storybook's config folder, which holds `visual-check.ts`.
   */
  configDir: string
  /**
   * The absolute path of the folder that holds the Storybook's baselines: the config's `baselines`, or the default.
   */
  baselines: string
  /**
   * The command that starts the Storybook.
   */
  startCommand: string
}

/**
 * A row of a next step: the command to run, when there's one, and what it does, or what to do when there's none.
 *
 * @public
 */
export interface NextStepRow {
  /**
   * What the command does, or what to do when the row has no command.
   */
  text: Segment[]
  /**
   * The command to run.
   */
  command?: string
}

/**
 * What the closing message tells, as data the plain text and the terminal UI each lay out their own way.
 *
 * @public
 */
export interface NextSteps {
  /**
   * The steps to a first passing run, in order, each one row or more: a row per Storybook to start.
   */
  steps: NextStepRow[][]
  /**
   * The workspace root, where the steps run and the paths start, named for the folder `init` runs in, or `undefined`
   * when `init` runs in the root.
   */
  runFrom: Segment[] | undefined
  /**
   * Each set-up Storybook's `visual-check.ts`, where options for every story go, relative to the workspace root, once
   * each, in the order of the Storybooks.
   */
  modesFiles: string[]
  /**
   * The workspace packages whose own scripts check only their Storybooks, relative to the workspace root, in the order
   * of the Storybooks.
   */
  packageFolders: string[]
  /**
   * The docs page that tells how to run visual-check in CI.
   */
  ciUrl: string
}

/**
 * The scripts `init` replaced in one `package.json`.
 */
export interface ReplacedScripts {
  /**
   * The path of the `package.json`, relative to the workspace root.
   */
  manifest: string
  /**
   * The names of the scripts it replaced there, in order.
   */
  names: string[]
}

/**
 * What the closing message tells.
 */
interface ClosingMessageInput {
  /**
   * The folder `init` runs in. Below the root, the steps say to run them from the root.
   */
  cwd: string
  /**
   * The absolute workspace root, where the commands run. Paths are shown relative to it.
   */
  root: string
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
  /**
   * The absolute folders of the workspace packages whose own scripts check only their Storybooks.
   */
  packageDirs: readonly string[]
  /**
   * Whether a Storybook has no baselines yet, so the steps include writing the first ones.
   */
  needsBaselines: boolean
}

/**
 * How many spaces come between the longest command and the text after it.
 */
const commandGap = 3

/**
 * The most characters a command may have to count toward the width of the commands' column, enough for the default
 * start command `pnpm exec storybook dev -p 65535`. A longer one would leave too little room for the text, so it
 * doesn't widen the column, and takes a line of its own.
 */
const longestColumnCommand = 32

/**
 * Returns the line that names the scripts `init` replaced, by the `package.json` it replaced them in, or `undefined`
 * when it replaced none. A `package.json` with none replaced is left out.
 */
export function replacedScriptsLineOf(replaced: readonly ReplacedScripts[]): string | undefined {
  const groups = replaced.filter(({ names }) => names.length > 0)
  const count = groups.reduce((total, { names }) => total + names.length, 0)

  if (count === 0) {
    return undefined
  }

  const where = groups.map(({ manifest, names }) => `${listOf(names)} in ${manifest}`)
  // Each group may hold `and` already, so a comma sets the last group apart.
  const joined = where.length > 1 ? `${where.slice(0, -1).join(', ')}, and ${where.at(-1)}` : where.join('')

  return `Replaced the ${count === 1 ? 'script' : 'scripts'} ${joined}.`
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
 * Returns how many columns the commands of the steps take: the longest command of at most 32 characters, then a gap. A
 * row without a command starts its text where the commands start, so with no such command at all, it's 0.
 *
 * @public
 */
export function commandColumnWidthOf(steps: readonly (readonly NextStepRow[])[]): number {
  const widths = steps
    .flat()
    .map(({ command }) => (command === undefined || command.length > longestColumnCommand ? 0 : command.length))
  const longest = Math.max(0, ...widths)

  return longest === 0 ? 0 : longest + commandGap
}

/**
 * Whether a command fits the commands' column, `width` columns wide, with the gap after it. One that doesn't takes a
 * line of its own, and its text starts on the next line, where the text of the other rows starts.
 *
 * @public
 */
export function fitsCommandColumn(command: string, width: number): boolean {
  return command.length + commandGap <= width
}

/**
 * Returns the first step: start the Storybook, or a row per Storybook, each with its own command. With none set up,
 * when the config holds none `init` could set up, it's to add one, as the hints say.
 */
function startStepOf({ root, configPath, storybooks }: ClosingMessageInput): NextStepRow[] {
  const [first, ...others] = storybooks

  if (first === undefined) {
    return [
      {
        text: [
          'Add your Storybook to ',
          { code: relativePathOf(root, configPath) },
          ', as the hints say, then start it',
        ],
      },
    ]
  }

  if (others.length === 0) {
    return [{ command: first.startCommand, text: ['Start Storybook, and keep it running'] }]
  }

  return storybooks.map(({ name, startCommand }) => ({
    command: startCommand,
    text: [`Start ${name}, and keep it running`],
  }))
}

/**
 * Returns the heading of the steps: `Next`, and, when `init` runs below the workspace root, the root to run them from.
 *
 * @public
 */
export function nextHeadingOf(runFrom: readonly Segment[] | undefined): Segment[] {
  return runFrom === undefined ? ['Next'] : ['Next, from ', ...runFrom]
}

/**
 * Returns the line that points to where options for every story go: each Storybook's `visual-check.ts`.
 *
 * @public
 */
export function modesLineOf(files: readonly string[]): Segment[] {
  return ['To set options for every story, see ', ...codeListOf(files), '.']
}

/**
 * Returns the line that names the workspace packages whose own scripts check only their Storybooks.
 *
 * @public
 */
export function packageScriptsLineOf(folders: readonly string[]): Segment[] {
  return ['To check only one Storybook, run the scripts in its package: ', ...codeListOf(folders), '.']
}

/**
 * Returns the line that points to the docs page about running visual-check in CI.
 *
 * @public
 */
export function ciLineOf(url: string): Segment[] {
  return ['To run visual-check in CI, see ', { code: url }, '.']
}

/**
 * Returns what the closing message tells: the steps to a first passing run, each `visual-check.ts` where options for
 * every story go, the packages whose own scripts check only their Storybooks, and the docs page that tells how to run
 * visual-check in CI. The step that writes the first baselines is left out when no Storybook needs them. The commands
 * and paths are the workspace root's, so below the root it's named to run them from. Paths and URLs in the text are
 * code segments. It says nothing about remote content.
 */
export function nextStepsOf(input: ClosingMessageInput): NextSteps {
  const { cwd, root, packageManager, storybooks, scripts, packageDirs, needsBaselines } = input
  const modesFiles = storybooks.map(({ configDir }) => relativePathOf(root, join(configDir, 'visual-check.ts')))

  return {
    steps: [
      startStepOf(input),
      ...(needsBaselines
        ? [[{ command: runScriptCommandOf(packageManager, scripts.update.name), text: ['Write the first baselines'] }]]
        : []),
      [
        {
          command: runScriptCommandOf(packageManager, scripts.test.name),
          text: ['Check the stories against the baselines'],
        },
      ],
      [{ text: ['Commit the changes, baselines included'] }],
    ],
    runFrom: cwd === root ? undefined : workspaceFolderOf(cwd, root),
    modesFiles: [...new Set(modesFiles)],
    packageFolders: packageDirs.map((dir) => relativePathOf(root, dir)),
    ciUrl: docsUrlOf('ci'),
  }
}

/**
 * Returns the lines of one step as plain text: its number, then each row's command padded to `commandWidth` and its
 * text. A row without a command starts its text where the commands start. A command too long for the column takes a
 * line of its own, and its text starts on the next line where the other rows' text starts. The rows after the first
 * are indented as far as the first, without a number.
 */
function stepLinesOf(rows: readonly NextStepRow[], number: number, commandWidth: number): string[] {
  const numberColumn = `  ${number}. `
  const indent = ' '.repeat(numberColumn.length)

  return rows.flatMap(({ command, text }, index) => {
    const lead = index === 0 ? numberColumn : indent

    if (command === undefined) {
      return [`${lead}${textOf(text)}`]
    }

    if (fitsCommandColumn(command, commandWidth)) {
      return [`${lead}${command.padEnd(commandWidth)}${textOf(text)}`]
    }

    return [`${lead}${command}`, `${indent}${' '.repeat(commandWidth)}${textOf(text)}`]
  })
}

/**
 * Returns the message `init` ends with, as plain text: the next steps numbered, each command in a column of its own,
 * then where options for every story go, when a Storybook was set up, the packages whose own scripts check only their
 * Storybooks, when there are any, and the docs link for CI.
 */
export function closingMessageTextOf({ steps, runFrom, modesFiles, packageFolders, ciUrl }: NextSteps): string {
  const commandWidth = commandColumnWidthOf(steps)

  return [
    `visual-check is set up. ${textOf(nextHeadingOf(runFrom))}:`,
    ...steps.flatMap((rows, index) => stepLinesOf(rows, index + 1, commandWidth)),
    '',
    ...(modesFiles.length === 0 ? [] : [textOf(modesLineOf(modesFiles))]),
    ...(packageFolders.length === 0 ? [] : [textOf(packageScriptsLineOf(packageFolders))]),
    textOf(ciLineOf(ciUrl)),
    '',
  ].join('\n')
}
