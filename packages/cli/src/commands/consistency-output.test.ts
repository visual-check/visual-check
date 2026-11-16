import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { ConsistencyCheck } from './consistency-check.js'
import { consistencyOutputOf, orphanLabelOf, orphanLinesOf } from './consistency-output.js'
import type { PlannedSnapshot } from './plan-snapshots.js'

/**
 * The folder the CLI runs in.
 */
const cwd = join('/', 'project')

/**
 * Builds a Storybook whose baselines are in `<name>/.visual-check/baselines` inside the project.
 */
function storybookOf(name: string): ResolvedStorybook {
  const dir = join(cwd, name)

  return {
    name,
    dir,
    configDir: join(dir, '.storybook'),
    baselines: join(dir, '.visual-check', 'baselines'),
    url: `http://${name}.test`,
  }
}

/**
 * Builds the planned snapshot of a story's default capture, or of one of its modes, selected.
 */
function snapshotOf(storybook: ResolvedStorybook, id: string, mode?: string): PlannedSnapshot {
  return {
    storybook,
    story: { id, title: 'Title', name: 'Name', importPath: './button.stories.tsx' },
    mode,
    key: mode === undefined ? id : `${id}.${mode}`,
    selected: true,
    options: {},
    tolerance: { color: 0.01, pixels: 20 },
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1, touch: false },
    globals: {},
  }
}

/**
 * Builds the planned broken snapshot of a story whose stories file didn't load.
 */
function brokenOf(storybook: ResolvedStorybook, id: string): PlannedSnapshot {
  return {
    storybook,
    story: { id, title: 'Title', name: 'Name', importPath: './broken.stories.tsx' },
    mode: undefined,
    key: id,
    selected: false,
    broken: { reason: 'load-failed', message: 'Its stories file ./broken.stories.tsx failed to load: Error: boom.' },
  }
}

/**
 * Builds a check of the Storybooks, each with the orphans of the given file names, that finds the given snapshots'
 * baselines missing.
 */
function checkOf(
  orphans: readonly (readonly [storybook: ResolvedStorybook, fileNames: string[]])[],
  missing: PlannedSnapshot[] = [],
): ConsistencyCheck {
  return {
    storybooks: orphans.map(([storybook, fileNames]) => ({
      storybook,
      paths: [],
      orphans: fileNames.map((name) => join(storybook.baselines, name)),
      expected: [],
    })),
    missing: new Set(missing),
  }
}

/**
 * The detail of a missing baseline's line.
 */
const missingDetail = 'missing: no baseline yet; run visual-check update to write it'

/**
 * Builds what stdout holds after printing these lines.
 */
function printed(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('')
}

describe('orphanLabelOf', () => {
  it('says orphan for 1 and orphans otherwise', () => {
    expect([0, 1, 2].map(orphanLabelOf)).toEqual(['orphans', 'orphan', 'orphans'])
  })
})

describe('orphanLinesOf', () => {
  it('gives a line for each orphan, Storybooks in the order given, with its stem and its path from the cwd', () => {
    const web = storybookOf('web')
    const docs = storybookOf('docs')

    expect(
      orphanLinesOf(
        cwd,
        checkOf([
          [web, ['a.png', 'b.dark.png']],
          [docs, []],
          [docs, ['c.png']],
        ]).storybooks,
      ),
    ).toEqual([
      '✗ web  a  orphan: no story calls for web/.visual-check/baselines/a.png; run visual-check update to delete it',
      '✗ web  b.dark  orphan: no story calls for web/.visual-check/baselines/b.dark.png; run visual-check update to ' +
        'delete it',
      '✗ docs  c  orphan: no story calls for docs/.visual-check/baselines/c.png; run visual-check update to delete it',
    ])
  })
})

describe('consistencyOutputOf', () => {
  it('says the baselines are consistent when the check finds nothing', () => {
    const web = storybookOf('web')
    const planned = [snapshotOf(web, 'a'), snapshotOf(web, 'a', 'dark')]

    expect(consistencyOutputOf({ version: '1.2.3', cwd, planned, check: checkOf([[web, []]]) })).toEqual({
      consistent: true,
      stdout: printed(
        'visual-check 1.2.3 · test · consistency · 2 snapshots',
        'Consistent: every baseline the stories call for is there, and none is an orphan.',
      ),
    })
  })

  it('counts a single snapshot with the noun in the singular', () => {
    const web = storybookOf('web')
    const output = consistencyOutputOf({ version: '1.2.3', cwd, planned: [snapshotOf(web, 'a')], check: checkOf([]) })

    expect(output.stdout.split('\n')[0]).toBe('visual-check 1.2.3 · test · consistency · 1 snapshot')
  })

  it('lists missing and broken snapshots in planned order, then the orphans, then the counts', () => {
    const web = storybookOf('web')
    const docs = storybookOf('docs')
    const missingMode = snapshotOf(web, 'a', 'dark')
    const broken = brokenOf(web, 'b')
    const missingDocs = snapshotOf(docs, 'd')
    const planned = [snapshotOf(web, 'a'), missingMode, broken, snapshotOf(docs, 'c'), missingDocs]
    const check = checkOf(
      [
        [web, ['old.png']],
        [docs, ['gone.png']],
      ],
      [missingMode, broken, missingDocs],
    )

    expect(consistencyOutputOf({ version: '1.2.3', cwd, planned, check })).toEqual({
      consistent: false,
      stdout: printed(
        'visual-check 1.2.3 · test · consistency · 5 snapshots',
        `✗ web  a  dark  ${missingDetail}`,
        '! web  b  broken: Its stories file ./broken.stories.tsx failed to load: Error: boom.',
        `✗ docs  d  ${missingDetail}`,
        '✗ web  old  orphan: no story calls for web/.visual-check/baselines/old.png; run visual-check update to ' +
          'delete it',
        '✗ docs  gone  orphan: no story calls for docs/.visual-check/baselines/gone.png; run visual-check update to ' +
          'delete it',
        '2 missing · 1 broken · 2 orphans',
      ),
    })
  })

  it('leaves out zero counts but the first', () => {
    const web = storybookOf('web')
    const planned = [brokenOf(web, 'a'), snapshotOf(web, 'b')]
    const brokenOnly = consistencyOutputOf({ version: '1.2.3', cwd, planned, check: checkOf([[web, []]]) })
    const orphanOnly = consistencyOutputOf({
      version: '1.2.3',
      cwd,
      planned: [snapshotOf(web, 'b')],
      check: checkOf([[web, ['old.png']]]),
    })

    expect(brokenOnly.consistent).toBe(false)
    expect(brokenOnly.stdout.endsWith('\n0 missing · 1 broken\n')).toBe(true)
    expect(orphanOnly.consistent).toBe(false)
    expect(orphanOnly.stdout.endsWith('\n0 missing · 1 orphan\n')).toBe(true)
  })
})
