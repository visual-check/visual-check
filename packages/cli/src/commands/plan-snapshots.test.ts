import { describe, expect, it } from 'vitest'
import type { BrokenStory } from '../capture/capture-session.js'
import type { OptionsRequest, StorybookOptionsRead } from '../capture/read-options.js'
import type { ResolvedConfig, ResolvedStorybook } from '../config/resolve-config.js'
import type { StoryOptions } from '../config/story-options.js'
import { pageErrorPolicyOf } from '../page-errors/page-error-policy.js'
import type { FileOptions } from '../storybook/options-read.js'
import type { Story } from '../storybook/read-stories.js'
import { type PlannedSnapshot, planSnapshots } from './plan-snapshots.js'

/**
 * Builds a Storybook with the given name, served at `http://<name>.test`.
 */
function storybookOf(name: string): ResolvedStorybook {
  return {
    name,
    dir: `/${name}`,
    configDir: `/${name}/.storybook`,
    baselines: `/${name}/baselines`,
    url: `http://${name}.test`,
  }
}

/**
 * Builds a story with the given ID in the given stories file.
 */
function storyOf(id: string, importPath = './button.stories.tsx'): Story {
  return { id, title: 'Title', name: 'Name', importPath }
}

/**
 * Builds a Storybook with every story selected.
 */
function allSelected(storybook: ResolvedStorybook, stories: Story[]) {
  return { storybook, stories, allStories: stories }
}

/**
 * Builds what the page read of a loaded stories file whose stories have the given options, by ID, each pinning the
 * globals `pinned` gives it, none when it gives none.
 */
function loadedFile(
  importPath: string,
  options: Record<string, unknown>,
  pinned: Record<string, string[]> = {},
): FileOptions {
  return {
    importPath,
    outcome: 'loaded',
    stories: Object.entries(options).map(([id, value]) => ({ id, options: value, pinnedGlobals: pinned[id] ?? [] })),
  }
}

/**
 * The globals of every Storybook a reader answers for.
 */
interface ReaderGlobals {
  /**
   * The globals each Storybook declares. Unknown, as `null`, when not given.
   */
  declared?: string[] | null
  /**
   * The globals each story pins, by ID. None when not given.
   */
  pinned?: Record<string, string[]>
}

/**
 * Builds a reader that answers each request as the page would where every file loads, each story with its options
 * from `options` by ID, and records each request. `answers` replaces the answer for a Storybook, by name. `globals`
 * gives the globals each Storybook declares and each story pins.
 */
function readerOf(
  options: Record<string, unknown> = {},
  answers: Record<string, StorybookOptionsRead> = {},
  { declared = null, pinned = {} }: ReaderGlobals = {},
): { requests: OptionsRequest[]; read: (request: OptionsRequest) => Promise<StorybookOptionsRead> } {
  const requests: OptionsRequest[] = []
  const read = async (request: OptionsRequest): Promise<StorybookOptionsRead> => {
    requests.push(request)

    return (
      answers[request.storybookName] ?? {
        declaredGlobals: declared,
        files: request.files.map(({ importPath, storyIds }) =>
          loadedFile(importPath, Object.fromEntries(storyIds.map((id) => [id, options[id]])), pinned),
        ),
      }
    )
  }

  return { requests, read }
}

/**
 * The fix the problem for invalid options ends with, with no trailing newline.
 */
const fixLine =
  'Fix parameters.visualCheck where the preview, the stories file or the story sets it, then run visual-check again.'

/**
 * The issue of a story whose `disable` is `1`.
 */
const disableIssue = 'visualCheck.disable: must be true or false. Got 1.'

/**
 * The config most cases plan with: its readyTimeout, its viewport, its tolerance, and the defaults for page errors.
 */
const config = {
  readyTimeout: 5_000,
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1, touch: false },
  tolerance: { color: 0.01, pixels: 20 },
  pageErrors: 'fail',
  expectedPageErrors: [],
} satisfies Pick<ResolvedConfig, 'readyTimeout' | 'viewport' | 'tolerance' | 'pageErrors' | 'expectedPageErrors'>

/**
 * The page error policy of a story whose options set neither `pageErrors` nor `expectedPageErrors`, under `config`.
 */
const defaultPageErrorPolicy = { check: 'fail', expected: [], storyExpected: [] }

/**
 * Builds the planned default capture of a story with the given options, at the config's tolerance under the story's,
 * and at the config's viewport unless `viewport` replaces it. It is selected unless `selected` says otherwise.
 */
function defaultCaptureOf(
  storybook: ResolvedStorybook,
  story: Story | undefined,
  options: StoryOptions,
  viewport = config.viewport,
  selected = true,
): PlannedSnapshot {
  if (story === undefined) {
    throw new Error('The test asks for a story it has none of.')
  }

  const tolerance = { ...config.tolerance, ...options.tolerance }

  return {
    storybook,
    story,
    mode: undefined,
    key: story.id,
    selected,
    options,
    tolerance,
    pageErrorPolicy: pageErrorPolicyOf(config, options),
    viewport,
    globals: {},
  }
}

/**
 * Builds the planned broken snapshot of a story whose stories file didn't load. It is selected unless `selected` says
 * otherwise.
 */
function brokenOf(
  storybook: ResolvedStorybook,
  story: Story | undefined,
  broken: BrokenStory,
  selected = true,
): PlannedSnapshot {
  if (story === undefined) {
    throw new Error('The test asks for a story it has none of.')
  }

  return { storybook, story, mode: undefined, key: story.id, selected, broken }
}

/**
 * The Storybook most cases plan.
 */
const web = storybookOf('web')

/**
 * A second Storybook, after `web` in config order.
 */
const docs = storybookOf('docs')

describe('planSnapshots', () => {
  it('reads each Storybook once, in order, with every story grouped by file, whatever the selection', async () => {
    const webStories = [
      storyOf('a', './a.stories.tsx'),
      storyOf('b', './b.stories.tsx'),
      storyOf('c', './a.stories.tsx'),
      storyOf('d', './c.stories.tsx'),
    ]
    const reader = readerOf()

    await planSnapshots(
      [
        { storybook: web, stories: [storyOf('b', './b.stories.tsx')], allStories: webStories },
        allSelected(docs, [storyOf('e')]),
      ],
      reader.read,
      config,
    )

    expect(reader.requests).toEqual([
      {
        storybookName: 'web',
        previewUrl: 'http://web.test/iframe.html?viewMode=story',
        files: [
          { importPath: './a.stories.tsx', storyIds: ['a', 'c'] },
          { importPath: './b.stories.tsx', storyIds: ['b'] },
          { importPath: './c.stories.tsx', storyIds: ['d'] },
        ],
      },
      {
        storybookName: 'docs',
        previewUrl: 'http://docs.test/iframe.html?viewMode=story',
        files: [{ importPath: './button.stories.tsx', storyIds: ['e'] }],
      },
    ])
  })

  it("doesn't read a Storybook with no stories", async () => {
    const reader = readerOf()

    expect(await planSnapshots([allSelected(web, []), allSelected(docs, [storyOf('a')])], reader.read, config)).toEqual(
      {
        snapshots: [defaultCaptureOf(docs, storyOf('a'), {})],
      },
    )
    expect(reader.requests.map(({ storybookName }) => storybookName)).toEqual(['docs'])
  })

  it('plans the stories in index.json order with their validated options, leaving out the disabled ones', async () => {
    const stories = [storyOf('a'), storyOf('b'), storyOf('c'), storyOf('d')]
    const reader = readerOf({
      a: { tolerance: { pixels: 3 }, extra: undefined },
      b: { disable: true },
      c: { disable: false },
      x: { disable: true },
    })

    expect(
      await planSnapshots(
        [
          { storybook: web, stories: [storyOf('a'), storyOf('b'), storyOf('c'), storyOf('d')], allStories: stories },
          allSelected(docs, [storyOf('x')]),
        ],
        reader.read,
        config,
      ),
    ).toEqual({
      snapshots: [
        defaultCaptureOf(web, storyOf('a'), { tolerance: { pixels: 3 } }),
        defaultCaptureOf(web, storyOf('c'), { disable: false }),
        defaultCaptureOf(web, storyOf('d'), {}),
      ],
    })
  })

  it('plans a story the selection leaves out with selected false, in index.json order', async () => {
    const stories = [storyOf('a'), storyOf('b'), storyOf('c')]
    const plan = await planSnapshots(
      [{ storybook: web, stories: [storyOf('a'), storyOf('c')], allStories: stories }],
      readerOf({ b: { tolerance: { pixels: 3 } } }).read,
      config,
    )

    expect(plan).toEqual({
      snapshots: [
        defaultCaptureOf(web, storyOf('a'), {}),
        defaultCaptureOf(web, storyOf('b'), { tolerance: { pixels: 3 } }, config.viewport, false),
        defaultCaptureOf(web, storyOf('c'), {}),
      ],
    })
  })

  it('plans no snapshot of a disabled story the selection leaves out', async () => {
    const stories = [storyOf('a'), storyOf('b')]
    const plan = await planSnapshots(
      [{ storybook: web, stories: [storyOf('a')], allStories: stories }],
      readerOf({ b: { disable: true } }).read,
      config,
    )

    expect(plan).toEqual({ snapshots: [defaultCaptureOf(web, storyOf('a'), {})] })
  })

  it("plans a broken snapshot with selected false for a story the selection leaves out of a file that didn't load", async () => {
    const stories = [storyOf('a', './a.stories.tsx'), storyOf('b', './b.stories.tsx')]
    const files: FileOptions[] = [
      { importPath: './a.stories.tsx', outcome: 'timed-out' },
      { importPath: './b.stories.tsx', outcome: 'timed-out' },
    ]
    const broken: BrokenStory = {
      reason: 'load-failed',
      message: "Its stories file ./b.stories.tsx didn't load within readyTimeout (5000 ms).",
      loadError: undefined,
      readyTimeoutMs: 5000,
    }
    const plan = await planSnapshots(
      [{ storybook: web, stories: [stories[0] as Story], allStories: stories }],
      readerOf({}, { web: { declaredGlobals: null, files } }).read,
      config,
    )

    expect(plan).toEqual({
      snapshots: [
        brokenOf(web, stories[0], { ...broken, message: broken.message.replace('./b.', './a.') }),
        brokenOf(web, stories[1], broken, false),
      ],
    })
  })

  it("breaks every story of a file that failed to load, ending the page's message with a period", async () => {
    const stories = [storyOf('a', './a.stories.tsx'), storyOf('b', './b.stories.tsx'), storyOf('c', './c.stories.tsx')]
    const files: FileOptions[] = [
      { importPath: './a.stories.tsx', outcome: 'failed', message: "SyntaxError: Unexpected token '<'" },
      { importPath: './b.stories.tsx', outcome: 'failed', message: 'TypeError: x is not a function.' },
      { importPath: './c.stories.tsx', outcome: 'failed', message: '' },
    ]
    const reader = readerOf({}, { web: { declaredGlobals: null, files } })

    expect(await planSnapshots([allSelected(web, stories)], reader.read, config)).toEqual({
      snapshots: [
        brokenOf(web, stories[0], {
          reason: 'load-failed',
          message: "Its stories file ./a.stories.tsx failed to load: SyntaxError: Unexpected token '<'.",
          loadError: "SyntaxError: Unexpected token '<'",
          readyTimeoutMs: undefined,
        }),
        brokenOf(web, stories[1], {
          reason: 'load-failed',
          message: 'Its stories file ./b.stories.tsx failed to load: TypeError: x is not a function.',
          loadError: 'TypeError: x is not a function.',
          readyTimeoutMs: undefined,
        }),
        brokenOf(web, stories[2], {
          reason: 'load-failed',
          message: 'Its stories file ./c.stories.tsx failed to load.',
          loadError: undefined,
          readyTimeoutMs: undefined,
        }),
      ],
    })
  })

  it("breaks every story of a file that didn't load within readyTimeout, without checking its options", async () => {
    const reader = readerOf(
      {},
      { web: { declaredGlobals: null, files: [{ importPath: './button.stories.tsx', outcome: 'timed-out' }] } },
    )
    const broken: BrokenStory = {
      reason: 'load-failed',
      message: "Its stories file ./button.stories.tsx didn't load within readyTimeout (7500 ms).",
      loadError: undefined,
      readyTimeoutMs: 7500,
    }

    expect(
      await planSnapshots([allSelected(web, [storyOf('a'), storyOf('b')])], reader.read, {
        ...config,
        readyTimeout: 7_500,
      }),
    ).toEqual({
      snapshots: [brokenOf(web, storyOf('a'), broken), brokenOf(web, storyOf('b'), broken)],
    })
  })

  it('gives every issue of every Storybook, each naming its story, including stories the selection leaves out', async () => {
    const reader = readerOf({ a: { retries: 1, disable: 1 }, b: { disable: 1 }, d: { disable: 1 } })
    const plan = await planSnapshots(
      [
        { storybook: web, stories: [storyOf('a')], allStories: [storyOf('a'), storyOf('b')] },
        allSelected(storybookOf('quick'), [storyOf('c')]),
        allSelected(docs, [storyOf('d')]),
      ],
      reader.read,
      config,
    )

    expect(plan).toEqual({
      problem: expect.stringMatching(
        /^Storybook web has invalid per-story options:\n {2}- a: visualCheck\.retries: unknown key\.[^\n]*\n/,
      ),
    })
    expect('problem' in plan && plan.problem.split('\n').slice(2)).toEqual([
      `  - a: ${disableIssue}`,
      `  - b: ${disableIssue}`,
      'Storybook docs has invalid per-story options:',
      `  - d: ${disableIssue}`,
      fixLine,
    ])
  })

  it('shows the first 20 issues of a Storybook and counts the rest', async () => {
    const stories = Array.from({ length: 23 }, (_, index) => storyOf(`s${index + 1}`))
    const reader = readerOf(Object.fromEntries(stories.map(({ id }) => [id, { disable: 1 }])))

    expect(await planSnapshots([allSelected(web, stories)], reader.read, config)).toEqual({
      problem:
        'Storybook web has invalid per-story options:\n' +
        stories
          .slice(0, 20)
          .map(({ id }) => `  - ${id}: ${disableIssue}\n`)
          .join('') +
        '  - …and 3 more.\n' +
        fixLine,
    })
  })

  it('shows all 20 issues of a Storybook that has exactly 20', async () => {
    const stories = Array.from({ length: 20 }, (_, index) => storyOf(`s${index + 1}`))
    const reader = readerOf(Object.fromEntries(stories.map(({ id }) => [id, { disable: 1 }])))
    const plan = await planSnapshots([allSelected(web, stories)], reader.read, config)

    expect('problem' in plan && plan.problem.split('\n')).toHaveLength(22)
    expect('problem' in plan && plan.problem).not.toContain('more.')
  })

  it('gives a block for each Storybook with two snapshots whose baselines would be one file, selected or not', async () => {
    const reader = readerOf({ a: { modes: { dark: {} } } })
    const plan = await planSnapshots(
      [
        { storybook: web, stories: [storyOf('b')], allStories: [storyOf('a'), storyOf('b'), storyOf('a.dark')] },
        allSelected(storybookOf('quick'), [storyOf('c')]),
        allSelected(docs, [storyOf('d'), storyOf('D')]),
      ],
      reader.read,
      config,
    )

    expect(plan).toEqual({
      problem:
        'Storybook web has two snapshots whose baselines would be one file, a.dark.png: a in mode dark and a.dark.\n' +
        'Storybook docs has two snapshots whose baselines would be one file, d.png: d and D.\n' +
        'Their names differ only in letter case or in how an accented letter is encoded.\n' +
        'Rename one of the stories or modes, then run visual-check again.',
    })
  })

  it('gives invalid options before two snapshots whose baselines would be one file', async () => {
    const reader = readerOf({ c: { disable: 1 } })
    const plan = await planSnapshots(
      [allSelected(web, [storyOf('a'), storyOf('A'), storyOf('c')])],
      reader.read,
      config,
    )

    expect(plan).toEqual({
      problem: `Storybook web has invalid per-story options:\n  - c: ${disableIssue}\n${fixLine}`,
    })
  })

  it("gives a read's problem as it is, without reading the Storybooks after it", async () => {
    const reader = readerOf({ c: { disable: 1 } }, { docs: { problem: "Storybook docs's preview never started." } })

    expect(
      await planSnapshots(
        [
          allSelected(web, [storyOf('c')]),
          allSelected(docs, [storyOf('a')]),
          allSelected(storybookOf('quick'), [storyOf('b')]),
        ],
        reader.read,
        config,
      ),
    ).toEqual({ problem: "Storybook docs's preview never started." })
    expect(reader.requests.map(({ storybookName }) => storybookName)).toEqual(['web', 'docs'])
  })

  it('throws when a read leaves out a stories file it was asked for', async () => {
    const reader = readerOf({}, { web: { declaredGlobals: null, files: [] } })

    await expect(planSnapshots([allSelected(web, [storyOf('a')])], reader.read, config)).rejects.toThrow(
      'The options read left out ./button.stories.tsx, the stories file of a.',
    )
  })

  it('throws when the selection holds a story index.json does not list', async () => {
    const reader = readerOf()

    await expect(
      planSnapshots([{ storybook: web, stories: [storyOf('b')], allStories: [storyOf('a')] }], reader.read, config),
    ).rejects.toThrow("The selection holds b, which the Storybook's index.json doesn't list.")
  })

  it('throws when a read leaves out a story of a file that loaded', async () => {
    const reader = readerOf(
      {},
      { web: { declaredGlobals: null, files: [loadedFile('./button.stories.tsx', { a: undefined })] } },
    )

    await expect(planSnapshots([allSelected(web, [storyOf('a'), storyOf('b')])], reader.read, config)).rejects.toThrow(
      'The options read left out b, a story of ./button.stories.tsx.',
    )
  })

  it('throws what the read throws', async () => {
    const error = new Error('The browser failed to launch.')

    await expect(
      planSnapshots(
        [allSelected(web, [storyOf('a')])],
        async () => {
          throw error
        },
        config,
      ),
    ).rejects.toBe(error)
  })
})

/**
 * The issue of a global `key` that Storybook `web` doesn't declare, at `path` in `storyId`.
 */
function undeclaredOf(storyId: string, path: string, key: string): string {
  return `${storyId}: ${path}: Storybook web doesn't declare the global ${key}, so it would drop it from the story's URL. Add ${key} to initialGlobals or globalTypes in <configDir>/preview.`
}

/**
 * The issue of a story whose mode `Dark` has a name with an uppercase letter.
 */
function badNameOf(storyId: string): string {
  return `${storyId}: visualCheck.modes.Dark: a mode name takes lowercase letters, digits and -. Rename it in <configDir>/visual-check.ts.`
}

/**
 * Plans `web` with every story selected, read by `reader`, and gives the lines of its problem, or fails when it has
 * none.
 */
async function problemLinesOf(stories: Story[], reader: ReturnType<typeof readerOf>): Promise<string[]> {
  const plan = await planSnapshots([allSelected(web, stories)], reader.read, config)

  return 'problem' in plan ? plan.problem.split('\n') : expect.fail(`The plan has no problem: ${JSON.stringify(plan)}`)
}

describe('planSnapshots mode rules', () => {
  it("gives each mode rule's issue, naming its story and key, after the type issues", async () => {
    const reader = readerOf(
      {
        a: { disable: 1 },
        b: { modes: { Dark: null, firefox: { viewport: { width: 320 } } } },
        c: { modes: { dark: { globals: { theme: 'dark', font: 'a/b' } } } },
        d: { modes: { dark: { globals: { theme: 'light' } } } },
        e: { modes: { dark: { globals: { theme: 'dark', font: 'a/b' } } } },
      },
      {},
      { declared: ['theme'], pinned: { e: ['theme'] } },
    )

    expect(
      await problemLinesOf(
        ['a', 'b', 'c', 'd', 'e'].map((id) => storyOf(id)),
        reader,
      ),
    ).toEqual([
      'Storybook web has invalid per-story options:',
      `  - a: ${disableIssue}`,
      `  - ${badNameOf('b')}`,
      "  - b: visualCheck.modes.firefox: chromium, webkit and firefox are kept for browsers' baselines, so no mode can take them. Rename it in <configDir>/visual-check.ts.",
      `  - ${undeclaredOf('c', 'visualCheck.modes.dark.globals.font', 'font')}`,
      '  - c: visualCheck.modes.dark.globals.font: must be a string of only letters, digits, spaces, _ and -, or Storybook drops it from the story\'s URL. Got "a/b".',
      '  - d: visualCheck.modes.dark: sets {"globals":{"theme":"light"}} here but {"globals":{"theme":"dark","font":"a/b"}} in c. A mode means one thing in a Storybook, so declare it once in <configDir>/visual-check.ts.',
      "  - e: visualCheck.modes.dark.globals.theme: the story or its meta pins theme in its own globals, which win over the mode's, so the mode's theme never reaches the story. Leave dark out of the story's modes, or theme out of its globals.",
      fixLine,
    ])
  })

  it('shows the first 20 issues of a Storybook, type and mode issues together, and counts the rest', async () => {
    const typeStories = Array.from({ length: 15 }, (_, index) => storyOf(`t${index + 1}`))
    const modeStories = Array.from({ length: 10 }, (_, index) => storyOf(`m${index + 1}`))
    const reader = readerOf(
      {
        ...Object.fromEntries(typeStories.map(({ id }) => [id, { disable: 1 }])),
        ...Object.fromEntries(modeStories.map(({ id }) => [id, { modes: { dark: { globals: { theme: 'dark' } } } }])),
      },
      {},
      { pinned: Object.fromEntries(modeStories.map(({ id }) => [id, ['theme']])) },
    )
    const lines = await problemLinesOf([...modeStories, ...typeStories], reader)

    expect(lines.slice(1, 16)).toEqual(typeStories.map(({ id }) => `  - ${id}: ${disableIssue}`))
    expect(lines.slice(16, 21).map((line) => line.split(':')[0])).toEqual([
      '  - m1',
      '  - m2',
      '  - m3',
      '  - m4',
      '  - m5',
    ])
    expect(lines.slice(21)).toEqual(['  - …and 5 more.', fixLine])
  })

  it("skips the declared-globals rule for a Storybook whose declared globals the page couldn't read", async () => {
    const reader = readerOf({ a: { modes: { dark: { globals: { theme: 'dark' } } } } })
    const plan = await planSnapshots([allSelected(web, [storyOf('a')])], reader.read, config)

    expect('snapshots' in plan && plan.snapshots.map(({ key }) => key)).toEqual(['a', 'a.dark'])
  })

  it('checks each Storybook against its own declared globals', async () => {
    const options = { modes: { dark: { globals: { theme: 'dark' } } } }
    const reader = readerOf(
      { a: options, b: options },
      { docs: { declaredGlobals: ['theme'], files: [loadedFile('./button.stories.tsx', { b: options })] } },
      { declared: [] },
    )
    const plan = await planSnapshots(
      [allSelected(web, [storyOf('a')]), allSelected(docs, [storyOf('b')])],
      reader.read,
      config,
    )

    expect(plan).toEqual({
      problem: [
        'Storybook web has invalid per-story options:',
        `  - ${undeclaredOf('a', 'visualCheck.modes.dark.globals.theme', 'theme')}`,
        fixLine,
      ].join('\n'),
    })
  })

  it('checks the mode rules of the stories of the files that loaded only', async () => {
    const files: FileOptions[] = [
      { importPath: './a.stories.tsx', outcome: 'failed', message: 'Boom' },
      loadedFile('./b.stories.tsx', { b: { modes: { dark: { globals: { theme: 'dark' } } } } }),
    ]
    const reader = readerOf({}, { web: { declaredGlobals: [], files } })

    expect(await problemLinesOf([storyOf('a', './a.stories.tsx'), storyOf('b', './b.stories.tsx')], reader)).toEqual([
      'Storybook web has invalid per-story options:',
      `  - ${undeclaredOf('b', 'visualCheck.modes.dark.globals.theme', 'theme')}`,
      fixLine,
    ])
  })

  it('leaves the stories with type issues out of the mode rules', async () => {
    const reader = readerOf(
      {
        a: { disable: 1, modes: { Dark: null, dark: { globals: { theme: 'dark' } } } },
        b: { modes: { dark: { globals: { theme: 'light' } } } },
      },
      {},
      { declared: ['theme'] },
    )

    expect(await problemLinesOf([storyOf('a'), storyOf('b')], reader)).toEqual([
      'Storybook web has invalid per-story options:',
      `  - a: ${disableIssue}`,
      fixLine,
    ])
  })

  it('passes the stories to the mode rules in index.json order, whatever the selection', async () => {
    const reader = readerOf({
      a: { modes: { dark: { globals: { theme: 'dark' } } } },
      b: { modes: { dark: { globals: { theme: 'light' } } } },
    })
    const plan = await planSnapshots(
      [{ storybook: web, stories: [storyOf('b')], allStories: [storyOf('a'), storyOf('b')] }],
      reader.read,
      config,
    )

    expect('problem' in plan && plan.problem).toContain('  - b: visualCheck.modes.dark: sets')
  })
})

/**
 * The mode most cases plan: a dark theme.
 */
const dark = { globals: { theme: 'dark', density: 2, animated: false } }

/**
 * A second mode: a phone's viewport.
 */
const mobile = { viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true } }

/**
 * Plans `web` with every story selected, read by a reader that answers with `options`, and gives its snapshots, or
 * fails when the plan has a problem.
 */
async function snapshotsOf(stories: Story[], options: Record<string, unknown>): Promise<PlannedSnapshot[]> {
  const plan = await planSnapshots([allSelected(web, stories)], readerOf(options).read, config)

  return 'snapshots' in plan ? plan.snapshots : expect.fail(`The plan has a problem: ${plan.problem}`)
}

describe('planSnapshots modes', () => {
  it('plans the default capture, then each listed mode in order, each with its key, viewport and globals', async () => {
    const options = { modes: { dark, mobile } }

    expect(await snapshotsOf([storyOf('a'), storyOf('b')], { a: options })).toEqual([
      defaultCaptureOf(web, storyOf('a'), options),
      {
        storybook: web,
        story: storyOf('a'),
        mode: 'dark',
        key: 'a.dark',
        selected: true,
        options,
        tolerance: config.tolerance,
        pageErrorPolicy: defaultPageErrorPolicy,
        viewport: config.viewport,
        globals: { theme: 'dark', density: 2, animated: false },
      },
      {
        storybook: web,
        story: storyOf('a'),
        mode: 'mobile',
        key: 'a.mobile',
        selected: true,
        options,
        tolerance: config.tolerance,
        pageErrorPolicy: defaultPageErrorPolicy,
        viewport: { width: 375, height: 667, deviceScaleFactor: 2, touch: true },
        globals: {},
      },
      defaultCaptureOf(web, storyOf('b'), {}),
    ])
  })

  it("keeps the other snapshots' keys when a story drops a mode", async () => {
    const snapshots = await snapshotsOf([storyOf('a')], { a: { modes: { dark: null, mobile } } })

    expect(snapshots.map(({ key, mode }) => [key, mode])).toEqual([
      ['a', undefined],
      ['a.mobile', 'mobile'],
    ])
  })

  it.each([
    ['no modes', {}],
    ['empty modes', { modes: {} }],
    ['every mode left out', { modes: { dark: null, mobile: null } }],
  ])('plans the default capture alone for a story with %s', async (_, options) => {
    expect(await snapshotsOf([storyOf('a')], { a: options })).toEqual([defaultCaptureOf(web, storyOf('a'), options)])
  })

  it("lays the default capture out at the config's viewport under the story's, key by key", async () => {
    const options = { viewport: { width: 375 } }

    expect(await snapshotsOf([storyOf('a')], { a: options })).toEqual([
      defaultCaptureOf(web, storyOf('a'), options, { width: 375, height: 720, deviceScaleFactor: 1, touch: false }),
    ])
  })

  it("lays a mode out at the default capture's viewport under the mode's, key by key", async () => {
    const snapshots = await snapshotsOf([storyOf('a')], {
      a: {
        viewport: { width: 1024, deviceScaleFactor: 2 },
        modes: { dark, narrow: { viewport: { width: 320, touch: true } } },
      },
    })

    expect(snapshots.map(({ key, ...snapshot }) => [key, 'viewport' in snapshot ? snapshot.viewport : null])).toEqual([
      ['a', { width: 1024, height: 720, deviceScaleFactor: 2, touch: false }],
      ['a.dark', { width: 1024, height: 720, deviceScaleFactor: 2, touch: false }],
      ['a.narrow', { width: 320, height: 720, deviceScaleFactor: 2, touch: true }],
    ])
  })

  it("gives each snapshot the config's tolerance under the story's, key by key, a mode sharing the story's", async () => {
    const snapshots = await snapshotsOf([storyOf('a'), storyOf('b'), storyOf('c')], {
      a: { tolerance: { pixels: 0 }, modes: { dark } },
      b: { tolerance: { color: 0.2, pixels: '1%' } },
    })

    expect(snapshots.map(({ key, ...snapshot }) => [key, 'tolerance' in snapshot ? snapshot.tolerance : null])).toEqual(
      [
        ['a', { color: 0.01, pixels: 0 }],
        ['a.dark', { color: 0.01, pixels: 0 }],
        ['b', { color: 0.2, pixels: '1%' }],
        ['c', { color: 0.01, pixels: 20 }],
      ],
    )
  })

  it("gives each snapshot the story's page error policy over the config's, a mode sharing the story's", async () => {
    const plan = await planSnapshots(
      [allSelected(web, [storyOf('a'), storyOf('b')])],
      readerOf({
        a: { pageErrors: 'warn', expectedPageErrors: ['Failed to fetch', /\/api\/orders/i], modes: { dark } },
      }).read,
      { ...config, pageErrors: 'off', expectedPageErrors: ['ResizeObserver', /timeout/] },
    )
    const snapshots = 'snapshots' in plan ? plan.snapshots : expect.fail(`The plan has a problem: ${plan.problem}`)

    expect(
      snapshots.map(({ key, ...snapshot }) => [key, 'pageErrorPolicy' in snapshot ? snapshot.pageErrorPolicy : null]),
    ).toEqual([
      [
        'a',
        {
          check: 'warn',
          expected: ['ResizeObserver', /timeout/, 'Failed to fetch', /\/api\/orders/i],
          storyExpected: ['Failed to fetch', /\/api\/orders/i],
        },
      ],
      [
        'a.dark',
        {
          check: 'warn',
          expected: ['ResizeObserver', /timeout/, 'Failed to fetch', /\/api\/orders/i],
          storyExpected: ['Failed to fetch', /\/api\/orders/i],
        },
      ],
      ['b', { check: 'off', expected: ['ResizeObserver', /timeout/], storyExpected: [] }],
    ])
  })

  it('plans no snapshot of a disabled story, whatever modes it lists', async () => {
    expect(await snapshotsOf([storyOf('a')], { a: { disable: true, modes: { dark, mobile } } })).toEqual([])
  })

  it("plans one broken snapshot, with no mode, for a story whose stories file didn't load", async () => {
    const reader = readerOf(
      {},
      { web: { declaredGlobals: null, files: [{ importPath: './button.stories.tsx', outcome: 'timed-out' }] } },
    )

    expect(await planSnapshots([allSelected(web, [storyOf('a')])], reader.read, config)).toEqual({
      snapshots: [
        brokenOf(web, storyOf('a'), {
          reason: 'load-failed',
          message: "Its stories file ./button.stories.tsx didn't load within readyTimeout (5000 ms).",
          loadError: undefined,
          readyTimeoutMs: 5000,
        }),
      ],
    })
  })
})
