import { type BrokenStory, failureReasonOf } from '../capture/capture-session.js'
import type { OptionsRequest, StorybookOptionsRead } from '../capture/read-options.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import { checkStoryOptions, type StoryOptions } from '../config/story-options.js'
import type { FileOptions, StoriesFile } from '../storybook/options-read.js'
import { previewUrlOf, type Story } from '../storybook/read-stories.js'

/**
 * A Storybook as planning needs it: its selected stories, and every story its `index.json` lists.
 */
interface StorybookStories {
  /**
   * The Storybook.
   */
  storybook: ResolvedStorybook
  /**
   * Its selected stories, in the order they are taken and printed.
   */
  stories: Story[]
  /**
   * Every story its `index.json` lists, whose options are read and checked whatever the selection.
   */
  allStories: Story[]
}

/**
 * Reads the per-story options of a Storybook's stories files, as `RunBrowser.readOptions` does.
 */
type ReadOptions = (request: OptionsRequest) => Promise<StorybookOptionsRead>

/**
 * One story's per-story options once checked: its options, or, when its stories file didn't load, the broken story it
 * makes.
 */
type StoryOptionsOf =
  | {
      /**
       * The story's validated options.
       */
      options: StoryOptions
    }
  | {
      /**
       * Why the story can't be captured: `load-failed`, with a message naming its stories file.
       */
      broken: BrokenStory
    }

/**
 * One snapshot the run takes: a selected story that isn't disabled, with its Storybook, and its options or, when its
 * stories file didn't load, the broken story it makes.
 */
export type PlannedSnapshot = {
  /**
   * The story's Storybook.
   */
  storybook: ResolvedStorybook
  /**
   * The story.
   */
  story: Story
} & StoryOptionsOf

/**
 * What the page read of a Storybook's stories files, ready to look each story up in.
 */
interface StorybookRead {
  /**
   * What the page read of each stories file, by its path.
   */
  files: Map<string, FileOptions>
  /**
   * The options of each story of a file that loaded, by story ID.
   */
  options: Map<string, unknown>
}

/**
 * A Storybook's name and its invalid options, as the problem for invalid options names them.
 */
interface StorybookIssues {
  /**
   * The Storybook's name in the config.
   */
  name: string
  /**
   * Each invalid option, as `<story-id>: <issue>`.
   */
  issues: string[]
}

/**
 * The most issues the problem for invalid options shows for one Storybook.
 */
const shownIssuesLimit = 20

/**
 * Groups the stories by their stories file: each file where its first story is, with its stories in the given order.
 */
function storiesFilesOf(stories: readonly Story[]): StoriesFile[] {
  const files = new Map<string, StoriesFile>()

  for (const { id, importPath } of stories) {
    const file = files.get(importPath)

    if (file === undefined) {
      files.set(importPath, { importPath, storyIds: [id] })
    } else {
      file.storyIds.push(id)
    }
  }

  return [...files.values()]
}

/**
 * Reads the per-story options of every story a Storybook's `index.json` lists, grouped by stories file. A Storybook
 * with no stories isn't read.
 */
async function readStorybookOptions(
  readOptions: ReadOptions,
  { storybook, allStories }: StorybookStories,
): Promise<StorybookOptionsRead> {
  if (allStories.length === 0) {
    return { files: [] }
  }

  return await readOptions({
    storybookName: storybook.name,
    previewUrl: previewUrlOf(storybook.url),
    files: storiesFilesOf(allStories),
  })
}

/**
 * Says why the stories of a file that didn't load are broken.
 */
function loadFailedOf(file: Exclude<FileOptions, { outcome: 'loaded' }>, readyTimeoutMs: number): BrokenStory {
  if (file.outcome === 'timed-out') {
    return {
      reason: 'load-failed',
      message: `Its stories file ${file.importPath} didn't load within readyTimeout (${readyTimeoutMs} ms).`,
    }
  }

  const failed = `Its stories file ${file.importPath} failed to load`

  return {
    reason: 'load-failed',
    message: file.message === '' ? `${failed}.` : `${failed}: ${failureReasonOf(file.message)}`,
  }
}

/**
 * Gets what the page read of a Storybook's stories files ready to look each story up in.
 */
function storybookReadOf(files: readonly FileOptions[]): StorybookRead {
  return {
    files: new Map(files.map((file) => [file.importPath, file])),
    options: new Map(
      files.flatMap((file) => (file.outcome === 'loaded' ? file.stories.map(({ id, options }) => [id, options]) : [])),
    ),
  }
}

/**
 * Gives what the page read of the story's stories file.
 *
 * @throws {Error} When the read left the file out, which reading the options rules out.
 */
function fileReadOf(read: StorybookRead, story: Story): FileOptions {
  const file = read.files.get(story.importPath)

  if (file === undefined) {
    throw new Error(`The options read left out ${story.importPath}, the stories file of ${story.id}.`)
  }

  return file
}

/**
 * Gives the story's options as the page read them from its stories file, which loaded.
 *
 * @throws {Error} When the read left the story out, which reading the options rules out.
 */
function optionsReadOf(read: StorybookRead, story: Story): unknown {
  if (!read.options.has(story.id)) {
    throw new Error(`The options read left out ${story.id}, a story of ${story.importPath}.`)
  }

  return read.options.get(story.id)
}

/**
 * Checks one story's options from what the page read of its stories file: its validated options or its issues, or,
 * when the file didn't load, the broken story it makes.
 */
function checkedStoryOf(
  read: StorybookRead,
  story: Story,
  readyTimeoutMs: number,
): StoryOptionsOf | { issues: string[] } {
  const file = fileReadOf(read, story)

  if (file.outcome !== 'loaded') {
    return { broken: loadFailedOf(file, readyTimeoutMs) }
  }

  return checkStoryOptions(optionsReadOf(read, story))
}

/**
 * Whether a checked story is taken: it's broken, or its options are valid and don't disable it.
 */
function isTaken(checked: StoryOptionsOf | { issues: string[] }): checked is StoryOptionsOf {
  if ('issues' in checked) {
    return false
  }

  return !('options' in checked) || checked.options.disable !== true
}

/**
 * Plans one Storybook's snapshots from what the page read of its stories files: every story it lists is checked, and
 * each selected story that isn't disabled is planned. Gives its planned snapshots and its issues.
 */
function planStorybook(
  selection: StorybookStories,
  read: readonly FileOptions[],
  readyTimeoutMs: number,
): { snapshots: PlannedSnapshot[]; issues: string[] } {
  const { storybook, stories, allStories } = selection
  const storybookRead = storybookReadOf(read)
  const issues = allStories.flatMap((story) => {
    const checked = checkedStoryOf(storybookRead, story, readyTimeoutMs)

    return 'issues' in checked ? checked.issues.map((issue) => `${story.id}: ${issue}`) : []
  })
  const snapshots = stories.flatMap((story): PlannedSnapshot[] => {
    const checked = checkedStoryOf(storybookRead, story, readyTimeoutMs)

    return isTaken(checked) ? [{ storybook, story, ...checked }] : []
  })

  return { snapshots, issues }
}

/**
 * Lists one Storybook's issues under its name, showing the first 20 and counting the rest.
 */
function issuesBlockOf({ name, issues }: StorybookIssues): string {
  const shown = issues.slice(0, shownIssuesLimit).map((issue) => `  - ${issue}\n`)
  const more = issues.length > shownIssuesLimit ? [`  - …and ${issues.length - shownIssuesLimit} more.\n`] : []

  return [`Storybook ${name} has invalid per-story options:\n`, ...shown, ...more].join('')
}

/**
 * Builds the problem for invalid per-story options: a block for each Storybook with issues, in the order given, then
 * the fix, with no trailing newline. Gives `undefined` when no Storybook has an issue.
 */
function invalidOptionsProblemOf(storybooks: readonly StorybookIssues[]): string | undefined {
  const blocks = storybooks.filter(({ issues }) => issues.length > 0).map(issuesBlockOf)

  if (blocks.length === 0) {
    return undefined
  }

  return `${blocks.join('')}Fix parameters.visualCheck where the preview, the stories file or the story sets it, then run visual-check again.`
}

/**
 * Plans the snapshots of a run from each Storybook's per-story options, which it reads with `readOptions`, one read per
 * Storybook with stories, in the order given. A read covers every story the Storybook's `index.json` lists whatever
 * the selection, and every story's options are checked. Gives the snapshots in the order given and then selection
 * order: each selected story that isn't disabled, with its options, or, when its stories file failed to load or didn't
 * load within readyTimeout, the broken story it makes, `load-failed`. A read's problem stops the planning at once, and
 * the Storybooks after it aren't read. Invalid options stop it once every Storybook is read, with one block of issues
 * per Storybook. Either way, it gives the problem, with no trailing newline.
 *
 * @throws {Error} What `readOptions` throws, and when a read leaves out a stories file or a story it was asked for.
 */
export async function planSnapshots(
  selections: readonly StorybookStories[],
  readOptions: ReadOptions,
  readyTimeoutMs: number,
): Promise<{ snapshots: PlannedSnapshot[] } | { problem: string }> {
  const snapshots: PlannedSnapshot[] = []
  const invalid: StorybookIssues[] = []

  for (const selection of selections) {
    const read = await readStorybookOptions(readOptions, selection)

    if ('problem' in read) {
      return read
    }

    const planned = planStorybook(selection, read.files, readyTimeoutMs)

    snapshots.push(...planned.snapshots)
    invalid.push({ name: selection.storybook.name, issues: planned.issues })
  }

  const problem = invalidOptionsProblemOf(invalid)

  return problem === undefined ? { snapshots } : { problem }
}
