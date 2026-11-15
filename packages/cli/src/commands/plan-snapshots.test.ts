import { describe, expect, it } from 'vitest'
import type { OptionsRequest, StorybookOptionsRead } from '../capture/read-options.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { FileOptions } from '../storybook/options-read.js'
import type { Story } from '../storybook/read-stories.js'
import { planSnapshots } from './plan-snapshots.js'

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
      5_000,
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

    expect(await planSnapshots([allSelected(web, []), allSelected(docs, [storyOf('a')])], reader.read, 5_000)).toEqual({
      snapshots: [{ storybook: docs, story: storyOf('a'), options: {} }],
    })
    expect(reader.requests.map(({ storybookName }) => storybookName)).toEqual(['docs'])
  })

  it('plans the selected stories in order with their validated options, leaving out the disabled ones', async () => {
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
          { storybook: web, stories: [storyOf('d'), storyOf('c'), storyOf('b'), storyOf('a')], allStories: stories },
          allSelected(docs, [storyOf('x')]),
        ],
        reader.read,
        5_000,
      ),
    ).toEqual({
      snapshots: [
        { storybook: web, story: storyOf('d'), options: {} },
        { storybook: web, story: storyOf('c'), options: { disable: false } },
        { storybook: web, story: storyOf('a'), options: { tolerance: { pixels: 3 } } },
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

    expect(await planSnapshots([allSelected(web, stories)], reader.read, 5_000)).toEqual({
      snapshots: [
        {
          storybook: web,
          story: stories[0],
          broken: {
            reason: 'load-failed',
            message: "Its stories file ./a.stories.tsx failed to load: SyntaxError: Unexpected token '<'.",
          },
        },
        {
          storybook: web,
          story: stories[1],
          broken: {
            reason: 'load-failed',
            message: 'Its stories file ./b.stories.tsx failed to load: TypeError: x is not a function.',
          },
        },
        {
          storybook: web,
          story: stories[2],
          broken: { reason: 'load-failed', message: 'Its stories file ./c.stories.tsx failed to load.' },
        },
      ],
    })
  })

  it("breaks every story of a file that didn't load within readyTimeout, without checking its options", async () => {
    const reader = readerOf(
      {},
      { web: { declaredGlobals: null, files: [{ importPath: './button.stories.tsx', outcome: 'timed-out' }] } },
    )
    const broken = {
      reason: 'load-failed',
      message: "Its stories file ./button.stories.tsx didn't load within readyTimeout (7500 ms).",
    }

    expect(await planSnapshots([allSelected(web, [storyOf('a'), storyOf('b')])], reader.read, 7_500)).toEqual({
      snapshots: [
        { storybook: web, story: storyOf('a'), broken },
        { storybook: web, story: storyOf('b'), broken },
      ],
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
      5_000,
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

    expect(await planSnapshots([allSelected(web, stories)], reader.read, 5_000)).toEqual({
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
    const plan = await planSnapshots([allSelected(web, stories)], reader.read, 5_000)

    expect('problem' in plan && plan.problem.split('\n')).toHaveLength(22)
    expect('problem' in plan && plan.problem).not.toContain('more.')
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
        5_000,
      ),
    ).toEqual({ problem: "Storybook docs's preview never started." })
    expect(reader.requests.map(({ storybookName }) => storybookName)).toEqual(['web', 'docs'])
  })

  it('throws when a read leaves out a stories file it was asked for', async () => {
    const reader = readerOf({}, { web: { declaredGlobals: null, files: [] } })

    await expect(planSnapshots([allSelected(web, [storyOf('a')])], reader.read, 5_000)).rejects.toThrow(
      'The options read left out ./button.stories.tsx, the stories file of a.',
    )
  })

  it('throws when the selection holds a story index.json does not list', async () => {
    const reader = readerOf()

    await expect(
      planSnapshots([{ storybook: web, stories: [storyOf('b')], allStories: [storyOf('a')] }], reader.read, 5_000),
    ).rejects.toThrow("The selection holds b, which the Storybook's index.json doesn't list.")
  })

  it('throws when a read leaves out a story of a file that loaded', async () => {
    const reader = readerOf(
      {},
      { web: { declaredGlobals: null, files: [loadedFile('./button.stories.tsx', { a: undefined })] } },
    )

    await expect(planSnapshots([allSelected(web, [storyOf('a'), storyOf('b')])], reader.read, 5_000)).rejects.toThrow(
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
        5_000,
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
  const plan = await planSnapshots([allSelected(web, stories)], reader.read, 5_000)

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

    expect(await planSnapshots([allSelected(web, [storyOf('a')])], reader.read, 5_000)).toEqual({
      snapshots: [
        { storybook: web, story: storyOf('a'), options: { modes: { dark: { globals: { theme: 'dark' } } } } },
      ],
    })
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
      5_000,
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
      5_000,
    )

    expect('problem' in plan && plan.problem).toContain('  - b: visualCheck.modes.dark: sets')
  })
})
