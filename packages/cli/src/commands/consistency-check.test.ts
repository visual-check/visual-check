import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BaselineError } from '../baselines/baseline-error.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { Story } from '../storybook/read-stories.js'
import { checkConsistency } from './consistency-check.js'
import type { PlannedSnapshot } from './plan-snapshots.js'

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

/**
 * Makes an empty temporary folder and returns its real path.
 */
function createFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-consistency-')))

  temporaryFolders.push(folder)

  return folder
}

/**
 * Bytes that stand in for a baseline. The check never decodes them.
 */
const bytes = new Uint8Array([1, 2, 3])

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * Builds a Storybook whose baselines are in the given folder.
 */
function storybookOf(name: string, baselines: string): ResolvedStorybook {
  return { name, dir: `/${name}`, configDir: `/${name}/.storybook`, baselines, url: `http://${name}.test` }
}

/**
 * Builds a story with the given ID.
 */
function storyOf(id: string): Story {
  return { id, title: 'Title', name: 'Name', importPath: './button.stories.tsx' }
}

/**
 * Builds the planned snapshot of a story's default capture, or of one of its modes, selected unless `selected` says
 * otherwise.
 */
function snapshotOf(storybook: ResolvedStorybook, id: string, mode?: string, selected = true): PlannedSnapshot {
  return {
    storybook,
    story: storyOf(id),
    mode,
    key: mode === undefined ? id : `${id}.${mode}`,
    selected,
    options: {},
    tolerance: { color: 0.01, pixels: 20 },
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1, touch: false },
    globals: {},
  }
}

/**
 * Builds the planned broken snapshot of a story whose stories file didn't load, selected unless `selected` says
 * otherwise.
 */
function brokenOf(storybook: ResolvedStorybook, id: string, selected = true): PlannedSnapshot {
  return {
    storybook,
    story: storyOf(id),
    mode: undefined,
    key: id,
    selected,
    broken: { reason: 'load-failed', message: "Its stories file didn't load." },
  }
}

/**
 * Writes a stand-in baseline for each file name into the folder.
 */
function writeBaselines(folder: string, names: string[]): void {
  mkdirSync(folder, { recursive: true })

  for (const name of names) {
    writeFileSync(join(folder, name), bytes)
  }
}

describe('checkConsistency', () => {
  it('gives each Storybook its baselines, orphans and expected paths, in the order given', async () => {
    const firstFolder = createFolder()
    const secondFolder = createFolder()
    const first = storybookOf('first', firstFolder)
    const second = storybookOf('second', secondFolder)

    writeBaselines(firstFolder, ['b.png', 'a.png', 'z.png'])
    writeBaselines(secondFolder, ['c.png'])

    const check = await checkConsistency(
      [second, first],
      [snapshotOf(first, 'a'), snapshotOf(first, 'b', 'dark', false), snapshotOf(second, 'c')],
    )

    expect(check.storybooks).toEqual([
      { storybook: second, paths: [join(secondFolder, 'c.png')], orphans: [], expected: [join(secondFolder, 'c.png')] },
      {
        storybook: first,
        paths: [join(firstFolder, 'a.png'), join(firstFolder, 'b.png'), join(firstFolder, 'z.png')],
        orphans: [join(firstFolder, 'b.png'), join(firstFolder, 'z.png')],
        expected: [join(firstFolder, 'a.png'), join(firstFolder, 'b.dark.png')],
      },
    ])
  })

  it('lists the snapshots with no baseline as missing, selected or not, a broken one and a mode included', async () => {
    const folder = createFolder()
    const storybook = storybookOf('web', folder)
    const there = snapshotOf(storybook, 'there')
    const selected = snapshotOf(storybook, 'selected')
    const unselected = snapshotOf(storybook, 'unselected', undefined, false)
    const mode = snapshotOf(storybook, 'mode', 'dark', false)
    const modeThere = snapshotOf(storybook, 'mode', 'light', false)
    const broken = brokenOf(storybook, 'broken', false)

    writeBaselines(folder, ['there.png', 'mode.light.png'])

    const check = await checkConsistency([storybook], [there, selected, unselected, mode, modeThere, broken])

    expect(check.missing).toEqual(new Set([selected, unselected, mode, broken]))
  })

  it('leaves out the snapshots of a Storybook that is not given', async () => {
    const given = storybookOf('given', createFolder())
    const other = storybookOf('other', createFolder())
    const wanted = snapshotOf(given, 'a')

    const check = await checkConsistency([given], [wanted, snapshotOf(other, 'b')])

    expect(check.missing).toEqual(new Set([wanted]))
  })

  it("never calls a baseline an orphan that could belong to a story whose stories file didn't load", async () => {
    const folder = createFolder()
    const storybook = storybookOf('web', folder)

    writeBaselines(folder, ['broken.png', 'broken.dark.png', 'broken-other.png', 'other.png'])

    const check = await checkConsistency([storybook], [brokenOf(storybook, 'broken'), snapshotOf(storybook, 'kept')])

    expect(check.storybooks[0]?.orphans).toEqual([join(folder, 'broken-other.png'), join(folder, 'other.png')])
  })

  it('leaves out a file that does not end in .png', async () => {
    const folder = createFolder()
    const storybook = storybookOf('web', folder)

    writeBaselines(folder, ['a.png', 'notes.txt', '.visual-check-abc.tmp'])

    const check = await checkConsistency([storybook], [snapshotOf(storybook, 'a')])

    expect(check.storybooks[0]).toMatchObject({ paths: [join(folder, 'a.png')], orphans: [] })
  })

  it('takes a missing baselines folder for no baselines: every snapshot is missing and nothing is an orphan', async () => {
    const folder = join(createFolder(), 'baselines')
    const storybook = storybookOf('web', folder)
    const snapshot = snapshotOf(storybook, 'a', undefined, false)

    const check = await checkConsistency([storybook], [snapshot])

    expect(check.storybooks).toEqual([{ storybook, paths: [], orphans: [], expected: [join(folder, 'a.png')] }])
    expect(check.missing).toEqual(new Set([snapshot]))
    expect(existsSync(folder)).toBe(false)
  })

  it('throws a BaselineError for a baselines folder that can not be listed', async () => {
    const folder = join(createFolder(), 'baselines')

    writeFileSync(folder, bytes)

    const error = await checkConsistency([storybookOf('web', folder)], []).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BaselineError)
    expect(error).toMatchObject({ action: 'list', path: folder })
  })

  it.skipIf(process.platform !== 'darwin')(
    'leaves out an orphan the file system takes for an expected baseline',
    async (context) => {
      const folder = createFolder()
      const storybook = storybookOf('web', folder)

      writeBaselines(folder, ['A.png'])

      if (!existsSync(join(folder, 'a.png'))) {
        context.skip('This folder is on a file system that tells the two names apart.')
      }

      const snapshot = snapshotOf(storybook, 'a')
      const check = await checkConsistency([storybook], [snapshot])

      expect(check.storybooks[0]).toMatchObject({ paths: [join(folder, 'A.png')], orphans: [] })
      expect(check.missing.size).toBe(0)
    },
  )
})
