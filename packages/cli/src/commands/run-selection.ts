import {
  type AffectedStories,
  type AffectedStorybook,
  workOutAffectedStories,
} from '../affected-stories/affected-stories.js'
import type { FindReachedFiles } from '../affected-stories/fallow-graph.js'
import type { ResolvedConfig, ResolvedStorybook } from '../config/resolve-config.js'
import type { ReportSelection } from '../report/report-document.js'
import type { Story } from '../storybook/read-stories.js'
import type { Selection } from './parse-command-line.js'
import { reportSelectionOf } from './run-report.js'
import type { StorybookSelection } from './run-snapshots.js'
import { type StoryChoice, selectStories } from './select-stories.js'

/**
 * What a run is, as far as the selection it takes with no selection flag goes.
 */
interface SelectionRun {
  /**
   * Whether the `CI` environment variable says the run is in CI.
   */
  ci: boolean
  /**
   * Whether the run is a shard of `test --shard`.
   */
  sharded: boolean
  /**
   * Whether the run is `test --consistency`.
   */
  consistencyOnly: boolean
}

/**
 * Gives the selection a run takes. A selection flag decides it. With none, `test --consistency`, a run in CI and a
 * shard cover every story, and any other run covers the affected stories. `test --consistency` captures nothing, so it
 * works nothing out.
 */
export function effectiveSelectionOf(selection: Selection, run: SelectionRun): Selection {
  if (selection.kind !== 'default') {
    return selection
  }

  return run.consistencyOnly || run.ci || run.sharded ? { kind: 'all' } : { kind: 'affected' }
}

/**
 * A Storybook in the run, with every story its `index.json` lists, before any story is selected.
 */
interface IndexedStorybook {
  /**
   * The Storybook.
   */
  storybook: ResolvedStorybook
  /**
   * The version of the `storybook` package installed for it, or `undefined` when it can't be read.
   */
  version: string | undefined
  /**
   * Every story its `index.json` lists, whatever the selection.
   */
  stories: Story[]
}

/**
 * What `workOutRunSelection` reads.
 */
interface RunSelectionInput {
  /**
   * The selection the run takes, with `default` already turned into `affected` or `all`.
   */
  selection: Selection
  /**
   * The ref `--base` names, or `undefined` when the flag isn't given.
   */
  baseRef: string | undefined
  /**
   * The environment, for `GITHUB_BASE_REF`.
   */
  environment: Record<string, string | undefined>
  /**
   * The folder the CLI runs in.
   */
  cwd: string
  /**
   * Each Storybook in the run, in config order, with every story its `index.json` lists.
   */
  storybooks: readonly IndexedStorybook[]
  /**
   * The baselines folder of every Storybook in the config, those the run leaves out included, absolute paths.
   */
  baselinesFolders: readonly string[]
  /**
   * visual-check's config file, an absolute path.
   */
  configPath: string
  /**
   * The globs, relative to the config file's folder, whose matches select every story or nothing.
   */
  affected: ResolvedConfig['affected']
  /**
   * Finds the files the changed files reach.
   */
  findReachedFiles: FindReachedFiles
}

/**
 * The stories a run takes, with what it says about how it picked them.
 */
export interface RunSelection {
  /**
   * Each Storybook in the run, in config order, with its selected stories and every story it has.
   */
  selections: StorybookSelection[]
  /**
   * How the run picked its stories, for the report.
   */
  report: ReportSelection
  /**
   * The warning that the affected stories couldn't be worked out, so every story is covered, with its newline, or
   * nothing.
   */
  warning: string
  /**
   * The notes printed after the header: that no story is affected, with a hint at `--all`, or none.
   */
  notes: string[]
}

/**
 * The hint every note about an empty affected selection ends with.
 */
const allHint = 'Run with --all to cover every story.'

/**
 * Gives the choice of a Storybook's stories that its affected stories make: every story, or those of its affected
 * stories files plus its affected stories by ID.
 */
function choiceOf(affected: AffectedStorybook | undefined): StoryChoice {
  // workOutAffectedStories gives one entry per Storybook, so `undefined` never comes.
  if (affected === undefined || affected.all) {
    return { kind: 'all' }
  }

  return { kind: 'affected', storiesFiles: affected.storiesFiles, storyIds: affected.storyIds }
}

/**
 * Gives the note of an affected run that selected no story in any Storybook, and didn't fall back: that no file
 * changed since the base, or that no changed file affects a story, each with a hint at `--all`. Gives none for a run
 * that selected a story or fell back.
 */
export function emptySelectionNotesOf(affected: AffectedStories, selections: readonly StorybookSelection[]): string[] {
  const { base, changedFiles, fallback } = affected

  if (fallback !== null || base === null || changedFiles === null) {
    return []
  }

  if (selections.some(({ stories }) => stories.length > 0)) {
    return []
  }

  if (changedFiles === 0) {
    return [`No files changed since ${base.slice(0, 7)}, so no story is affected. ${allHint}`]
  }

  if (changedFiles === 1) {
    return [`The changed file affects no story. ${allHint}`]
  }

  return [`None of the ${changedFiles} changed files affects a story. ${allHint}`]
}

/**
 * Gives the warning of a run that couldn't work out its affected stories, with its newline, or nothing when it could.
 */
export function fallbackWarningOf(fallback: string | null): string {
  if (fallback === null) {
    return ''
  }

  return `Warning: visual-check can't work out the affected stories, so it covers every story: ${fallback}.\n`
}

/**
 * Works out the stories a run takes in each Storybook. `all` keeps every story and `filter` the stories whose ID it
 * matches. `affected` finds the changed files since the base and what they reach, once for every Storybook in the run,
 * reads them with the config file's `affected` globs, and keeps the affected stories: the stories of the affected
 * stories files and the stories of the changed baselines, or every story of a Storybook a change reaches as a whole;
 * when that can't be worked out, it keeps every story, with a warning that says why. An affected run that keeps no
 * story at all gets a note that hints at `--all`.
 *
 * @throws {InvalidBaseError} When `--base` names no commit in the repository.
 */
export async function workOutRunSelection(input: RunSelectionInput): Promise<RunSelection> {
  const { selection, storybooks } = input

  if (selection.kind !== 'affected') {
    const choice: StoryChoice = selection.kind === 'filter' ? selection : { kind: 'all' }

    return {
      selections: storybooks.map((storybook) => ({
        ...storybook,
        stories: selectStories(storybook.stories, choice),
        allStories: storybook.stories,
      })),
      report: reportSelectionOf(selection),
      warning: '',
      notes: [],
    }
  }

  const affected = await workOutAffectedStories({
    baseRef: input.baseRef,
    environment: input.environment,
    cwd: input.cwd,
    storybooks: storybooks.map(({ storybook, stories }) => ({
      dir: storybook.dir,
      configDir: storybook.configDir,
      storiesFiles: [...new Set(stories.map((story) => story.importPath))],
      baselines: storybook.baselines,
      storyIds: stories.map((story) => story.id),
    })),
    baselinesFolders: input.baselinesFolders,
    configPath: input.configPath,
    affected: input.affected,
    findReachedFiles: input.findReachedFiles,
  })
  const selections = storybooks.map((storybook, index) => ({
    ...storybook,
    stories: selectStories(storybook.stories, choiceOf(affected.storybooks[index])),
    allStories: storybook.stories,
  }))

  return {
    selections,
    report: { by: 'affected', base: affected.base, changedFiles: affected.changedFiles, fallback: affected.fallback },
    warning: fallbackWarningOf(affected.fallback),
    notes: emptySelectionNotesOf(affected, selections),
  }
}
