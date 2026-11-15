import { snapshotKeyOf } from '../baselines/baseline-files.js'
import { type BrokenStory, failureReasonOf } from '../capture/capture-session.js'
import type { OptionsRequest, StorybookOptions, StorybookOptionsRead } from '../capture/read-options.js'
import type { Tolerance, Viewport } from '../config/define-config.js'
import { checkModeRules, type ModeRulesStory } from '../config/mode-rules.js'
import type { ResolvedConfig, ResolvedStorybook } from '../config/resolve-config.js'
import { checkStoryOptions, type ModeDefinition, type StoryOptions } from '../config/story-options.js'
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
 * What planning needs of the config: its readyTimeout, in ms, its viewport and its tolerance.
 */
type PlanConfig = Pick<ResolvedConfig, 'readyTimeout' | 'viewport' | 'tolerance'>

/**
 * A snapshot the run captures: the default capture or a listed mode of a selected story that isn't disabled, with its
 * Storybook, its key, the story's options and tolerance, and the snapshot's viewport and globals.
 */
export interface SnapshotToCapture {
  /**
   * The story's Storybook.
   */
  storybook: ResolvedStorybook
  /**
   * The story.
   */
  story: Story
  /**
   * The snapshot's mode, `undefined` for the default capture.
   */
  mode: string | undefined
  /**
   * The snapshot's key, which names its baseline: `<story-id>` for the default capture, `<story-id>.<mode>` for a mode.
   */
  key: string
  /**
   * The story's validated options.
   */
  options: StoryOptions
  /**
   * The story's tolerance: the config's under the story's, key by key. A mode shares it.
   */
  tolerance: Required<Tolerance>
  /**
   * The size the snapshot is laid out and captured at.
   */
  viewport: Required<Viewport>
  /**
   * The globals the snapshot's story URL sets, in order: its mode's, none for the default capture.
   */
  globals: NonNullable<ModeDefinition['globals']>
}

/**
 * The one snapshot of a selected story whose stories file didn't load: broken, with no mode, since its options and so
 * its modes are unknown.
 */
interface BrokenSnapshot {
  /**
   * The story's Storybook.
   */
  storybook: ResolvedStorybook
  /**
   * The story.
   */
  story: Story
  /**
   * No mode, since the story's modes are unknown.
   */
  mode: undefined
  /**
   * The snapshot's key, the story ID.
   */
  key: string
  /**
   * Why the story can't be captured: `load-failed`, with a message naming its stories file.
   */
  broken: BrokenStory
}

/**
 * One snapshot the run takes: one it captures or, when the story's stories file didn't load, the broken one the story
 * makes.
 */
export type PlannedSnapshot = SnapshotToCapture | BrokenSnapshot

/**
 * What the page read of one story of a file that loaded: its options and the globals it pins.
 */
type StoryRead = Extract<FileOptions, { outcome: 'loaded' }>['stories'][number]

/**
 * What the page read of a Storybook's stories files, ready to look each story up in.
 */
interface StorybookRead {
  /**
   * What the page read of each stories file, by its path.
   */
  files: Map<string, FileOptions>
  /**
   * What the page read of each story of a file that loaded, by story ID.
   */
  stories: Map<string, StoryRead>
}

/**
 * One story of a Storybook's `index.json` with its options checked.
 */
interface CheckedStory {
  /**
   * The story.
   */
  story: Story
  /**
   * Its validated options or its issues, or, when its stories file didn't load, the broken story it makes.
   */
  checked: StoryOptionsOf | { issues: string[] }
  /**
   * The globals it pins, none when its stories file didn't load.
   */
  pinnedGlobals: readonly string[]
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
    return { declaredGlobals: null, files: [] }
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
    stories: new Map(
      files.flatMap((file) => (file.outcome === 'loaded' ? file.stories.map((story) => [story.id, story]) : [])),
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
 * Gives what the page read of the story from its stories file, which loaded.
 *
 * @throws {Error} When the read left the story out, which reading the options rules out.
 */
function storyReadOf(read: StorybookRead, story: Story): StoryRead {
  const storyRead = read.stories.get(story.id)

  if (storyRead === undefined) {
    throw new Error(`The options read left out ${story.id}, a story of ${story.importPath}.`)
  }

  return storyRead
}

/**
 * Checks one story's options from what the page read of its stories file: its validated options or its issues, with
 * the globals it pins, or, when the file didn't load, the broken story it makes.
 */
function checkedStoryOf(read: StorybookRead, story: Story, readyTimeoutMs: number): CheckedStory {
  const file = fileReadOf(read, story)

  if (file.outcome !== 'loaded') {
    return { story, checked: { broken: loadFailedOf(file, readyTimeoutMs) }, pinnedGlobals: [] }
  }

  const { options, pinnedGlobals } = storyReadOf(read, story)

  return { story, checked: checkStoryOptions(options), pinnedGlobals }
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
 * Gives the stories whose options are valid, in the order given, as the mode rules take them: with the globals each
 * pins. A story with issues, or of a file that didn't load, is left out.
 */
function modeRulesStoriesOf(checkedStories: readonly CheckedStory[]): ModeRulesStory[] {
  return checkedStories.flatMap(({ story, checked, pinnedGlobals }) =>
    'options' in checked ? [{ id: story.id, options: checked.options, pinnedGlobals }] : [],
  )
}

/**
 * Gives a selected story's checked options from the checks of every story its Storybook's `index.json` lists.
 *
 * @throws {Error} When `index.json` doesn't list the story, which selecting stories rules out.
 */
function checkedOf(checkedById: ReadonlyMap<string, CheckedStory>, story: Story): CheckedStory['checked'] {
  const checked = checkedById.get(story.id)

  if (checked === undefined) {
    throw new Error(`The selection holds ${story.id}, which the Storybook's index.json doesn't list.`)
  }

  return checked.checked
}

/**
 * Plans a taken story's snapshots: its default capture, at the config's viewport under the story's, key by key, with
 * no globals, then each mode it lists, in the order its options hold them, at the default capture's viewport under the
 * mode's, with the mode's globals. Each has the config's tolerance under the story's, key by key. A mode the story
 * leaves out, `null`, isn't planned. A story whose stories file didn't load gives one broken snapshot with no mode,
 * since its modes are unknown.
 */
function storySnapshotsOf(
  storybook: ResolvedStorybook,
  story: Story,
  checked: StoryOptionsOf,
  config: PlanConfig,
): PlannedSnapshot[] {
  if ('broken' in checked) {
    return [{ storybook, story, mode: undefined, key: snapshotKeyOf(story.id), broken: checked.broken }]
  }

  const { options } = checked
  const defaultCapture: SnapshotToCapture = {
    storybook,
    story,
    mode: undefined,
    key: snapshotKeyOf(story.id),
    options,
    tolerance: { ...config.tolerance, ...options.tolerance },
    viewport: { ...config.viewport, ...options.viewport },
    globals: {},
  }
  const modes = Object.entries(options.modes ?? {}).flatMap(([mode, definition]): SnapshotToCapture[] =>
    definition === null
      ? []
      : [
          {
            ...defaultCapture,
            mode,
            key: snapshotKeyOf(story.id, mode),
            viewport: { ...defaultCapture.viewport, ...definition.viewport },
            globals: definition.globals ?? {},
          },
        ],
  )

  return [defaultCapture, ...modes]
}

/**
 * Plans one Storybook's snapshots from what the page read: every story its `index.json` lists is checked, and each
 * selected story that isn't disabled is planned. Gives its planned snapshots and its issues: the type issues of every
 * story in `index.json` order, then the mode rules' issues of the stories whose options are valid, checked in
 * `index.json` order against the globals the Storybook declares, a rule skipped when the page couldn't read them.
 */
function planStorybook(
  selection: StorybookStories,
  { declaredGlobals, files }: StorybookOptions,
  config: PlanConfig,
): { snapshots: PlannedSnapshot[]; issues: string[] } {
  const { storybook, stories, allStories } = selection
  const storybookRead = storybookReadOf(files)
  const checkedStories = allStories.map((story) => checkedStoryOf(storybookRead, story, config.readyTimeout))
  const checkedById = new Map(checkedStories.map((checkedStory) => [checkedStory.story.id, checkedStory]))
  const typeIssues = checkedStories.flatMap(({ story, checked }) =>
    'issues' in checked ? checked.issues.map((issue) => `${story.id}: ${issue}`) : [],
  )
  const modeIssues = checkModeRules(
    storybook.name,
    modeRulesStoriesOf(checkedStories),
    declaredGlobals === null ? null : new Set(declaredGlobals),
  )
  const snapshots = stories.flatMap((story): PlannedSnapshot[] => {
    const checked = checkedOf(checkedById, story)

    return isTaken(checked) ? storySnapshotsOf(storybook, story, checked, config) : []
  })

  return { snapshots, issues: [...typeIssues, ...modeIssues] }
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
 * order. Each selected story that isn't disabled gives its default capture, then one snapshot per mode it lists, in
 * the order its options hold them, each with its key, its options, its tolerance and viewport over the config's and
 * its globals.
 * When its stories file failed to load or didn't load within readyTimeout, it gives one snapshot, the broken story it
 * makes, `load-failed`, with no mode. A read's problem stops the planning at once, and the Storybooks after it aren't
 * read. Invalid options stop it once every Storybook is read, with one block of issues per Storybook: each story's
 * type issues, then the mode rules' issues of the stories whose options are valid, checked against the globals the
 * Storybook declares and the globals each story pins. Either way, it gives the problem, with no trailing newline.
 *
 * @throws {Error} What `readOptions` throws, when a read leaves out a stories file or a story it was asked for, and
 * when the selection holds a story `index.json` doesn't list.
 */
export async function planSnapshots(
  selections: readonly StorybookStories[],
  readOptions: ReadOptions,
  config: PlanConfig,
): Promise<{ snapshots: PlannedSnapshot[] } | { problem: string }> {
  const snapshots: PlannedSnapshot[] = []
  const invalid: StorybookIssues[] = []

  for (const selection of selections) {
    const read = await readStorybookOptions(readOptions, selection)

    if ('problem' in read) {
      return read
    }

    const planned = planStorybook(selection, read, config)

    snapshots.push(...planned.snapshots)
    invalid.push({ name: selection.storybook.name, issues: planned.issues })
  }

  const problem = invalidOptionsProblemOf(invalid)

  return problem === undefined ? { snapshots } : { problem }
}
