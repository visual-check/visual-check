import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { ReportImageBytes } from '../report/report-folder.js'
import { createImageFiles } from './image-files.js'

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

/**
 * Bytes that stand in for a differing snapshot's images, each its own.
 */
const bytes = {
  baseline: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]),
  snapshot: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]),
  diff: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 3]),
}

/**
 * Bytes that stand in for another snapshot.
 */
const otherSnapshot = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4])

/**
 * Makes an empty temporary folder and returns its real path.
 */
function createFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-images-')))

  temporaryFolders.push(folder)

  return folder
}

/**
 * Builds the Storybook called `name` that runs in `dir`.
 */
function storybookIn(dir: string, name = 'web'): ResolvedStorybook {
  return {
    name,
    dir,
    configDir: join(dir, '.storybook'),
    baselines: join(dir, '.visual-check', 'baselines'),
    url: 'http://127.0.0.1:6006',
  }
}

/**
 * Gives the files in `.visual-check` of `dir`, as sorted paths relative to it with `/`.
 */
function filesIn(dir: string): string[] {
  const folder = join(dir, '.visual-check')

  if (!existsSync(folder)) {
    return []
  }

  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

/**
 * Reads the file at `path` in `.visual-check` of `dir`.
 */
function fileIn(dir: string, path: string | null): Uint8Array {
  return new Uint8Array(readFileSync(join(dir, '.visual-check', path ?? '')))
}

/**
 * Writes a file at `path` in `.visual-check` of `dir`, as something else leaves it.
 */
function leave(dir: string, path: string): void {
  const file = join(dir, '.visual-check', path)

  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, 'left')
}

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('createImageFiles', () => {
  it("places the images in .visual-check in the Storybook's folder", () => {
    expect(createImageFiles().folderOf(storybookIn('/project/apps/web'))).toBe(
      join('/project/apps/web', '.visual-check'),
    )
  })

  it('gives the paths relative to the folder, with /, and null for an image there is none of', () => {
    const storybook = storybookIn('/project')
    const images = createImageFiles()

    expect(images.pathsOf(storybook, 'a.dark', bytes)).toEqual({
      baseline: 'snapshots/web/a.dark.baseline.png',
      snapshot: 'snapshots/web/a.dark.snapshot.png',
      diff: 'diffs/web/a.dark.png',
    })
    expect(images.pathsOf(storybook, 'a', { snapshot: bytes.snapshot })).toEqual({
      baseline: null,
      snapshot: 'snapshots/web/a.snapshot.png',
      diff: null,
    })
  })

  it('writes nothing until it replaces images', () => {
    const dir = createFolder()
    const images = createImageFiles()

    images.folderOf(storybookIn(dir))
    images.pathsOf(storybookIn(dir), 'a', bytes)

    expect(readdirSync(dir)).toEqual([])
  })

  it('writes each image exactly, at the path it gave', async () => {
    const dir = createFolder()
    const storybook = storybookIn(dir)
    const images = createImageFiles()
    const paths = images.pathsOf(storybook, 'a', bytes)

    await images.replace(
      storybook,
      'a',
      new Map<string, Partial<ReportImageBytes>>([
        ['a', bytes],
        ['a.mobile', { snapshot: otherSnapshot }],
      ]),
    )

    expect(filesIn(dir)).toEqual([
      'diffs/web/a.png',
      'snapshots/web/a.baseline.png',
      'snapshots/web/a.mobile.snapshot.png',
      'snapshots/web/a.snapshot.png',
    ])
    expect(fileIn(dir, paths.baseline)).toEqual(new Uint8Array(bytes.baseline))
    expect(fileIn(dir, paths.snapshot)).toEqual(bytes.snapshot)
    expect(fileIn(dir, paths.diff)).toEqual(bytes.diff)
    expect(fileIn(dir, 'snapshots/web/a.mobile.snapshot.png')).toEqual(otherSnapshot)
  })

  it('keeps a mode called baseline apart from the default capture', async () => {
    const dir = createFolder()

    await createImageFiles().replace(
      storybookIn(dir),
      'a',
      new Map([
        ['a', bytes],
        ['a.baseline', bytes],
      ]),
    )

    expect(filesIn(dir)).toHaveLength(6)
  })

  it("empties both of a Storybook's folders the first time, with nothing to write too", async () => {
    const dir = createFolder()
    const images = createImageFiles()

    leave(dir, 'snapshots/web/old.snapshot.png')
    leave(dir, 'diffs/web/old.png')
    leave(dir, 'baselines/a.png')
    leave(dir, 'report/report.json')

    await images.replace(storybookIn(dir), 'a', new Map())

    expect(filesIn(dir)).toEqual(['baselines/a.png', 'report/report.json'])

    await images.replace(storybookIn(dir), 'a', new Map([['a', bytes]]))
    await images.replace(storybookIn(dir), 'b', new Map([['b', { snapshot: bytes.snapshot }]]))

    expect(filesIn(dir)).toEqual([
      'baselines/a.png',
      'diffs/web/a.png',
      'report/report.json',
      'snapshots/web/a.baseline.png',
      'snapshots/web/a.snapshot.png',
      'snapshots/web/b.snapshot.png',
    ])
  })

  it("replaces the images of the story's last check alone", async () => {
    const dir = createFolder()
    const storybook = storybookIn(dir)
    const images = createImageFiles()

    await images.replace(
      storybook,
      'a',
      new Map([
        ['a', bytes],
        ['a.dark', bytes],
      ]),
    )
    await images.replace(storybook, 'b', new Map([['b', bytes]]))
    await images.replace(storybook, 'a', new Map([['a', { snapshot: otherSnapshot }]]))

    expect(filesIn(dir)).toEqual([
      'diffs/web/b.png',
      'snapshots/web/a.snapshot.png',
      'snapshots/web/b.baseline.png',
      'snapshots/web/b.snapshot.png',
    ])
    expect(fileIn(dir, 'snapshots/web/a.snapshot.png')).toEqual(otherSnapshot)

    await images.replace(storybook, 'a', new Map())

    expect(filesIn(dir)).toEqual(['diffs/web/b.png', 'snapshots/web/b.baseline.png', 'snapshots/web/b.snapshot.png'])
  })

  it('keeps two Storybooks in one folder apart', async () => {
    const dir = createFolder()
    const images = createImageFiles()

    leave(dir, 'snapshots/docs/old.snapshot.png')
    await images.replace(storybookIn(dir), 'a', new Map([['a', { snapshot: bytes.snapshot }]]))

    expect(filesIn(dir)).toEqual(['snapshots/docs/old.snapshot.png', 'snapshots/web/a.snapshot.png'])

    await images.replace(storybookIn(dir, 'docs'), 'a', new Map([['a', { snapshot: otherSnapshot }]]))

    expect(filesIn(dir)).toEqual(['snapshots/docs/a.snapshot.png', 'snapshots/web/a.snapshot.png'])

    await images.replace(storybookIn(dir), 'a', new Map())

    expect(filesIn(dir)).toEqual(['snapshots/docs/a.snapshot.png'])
  })

  it("throws a ReportError when the folders can't be emptied, and empties them the next time", async () => {
    const dir = createFolder()
    const images = createImageFiles()

    leave(dir, 'snapshots')

    await expect(images.replace(storybookIn(dir), 'a', new Map([['a', bytes]]))).rejects.toMatchObject({
      name: 'ReportError',
      action: 'clear',
      path: join(dir, '.visual-check', 'snapshots', 'web'),
      reason: 'ENOTDIR: not a directory',
    })

    rmSync(join(dir, '.visual-check', 'snapshots'))
    leave(dir, 'diffs/web/old.png')
    await images.replace(storybookIn(dir), 'a', new Map([['a', { snapshot: bytes.snapshot }]]))

    expect(filesIn(dir)).toEqual(['snapshots/web/a.snapshot.png'])
  })

  it("throws a ReportError when a folder can't be made", async () => {
    const dir = createFolder()
    const images = createImageFiles()

    await images.replace(storybookIn(dir), 'a', new Map())
    leave(dir, 'snapshots')

    await expect(images.replace(storybookIn(dir), 'a', new Map([['a', bytes]]))).rejects.toMatchObject({
      name: 'ReportError',
      action: 'write',
      path: join(dir, '.visual-check', 'snapshots', 'web'),
      reason: 'ENOTDIR: not a directory',
    })
  })

  it("keeps the last check's images when an image can't be written, and removes both checks' the next time", async () => {
    const dir = createFolder()
    const storybook = storybookIn(dir)
    const images = createImageFiles()
    const blocked = join(dir, '.visual-check', 'snapshots', 'web', 'a.mobile.snapshot.png')

    await images.replace(storybook, 'a', new Map([['a.dark', { snapshot: bytes.snapshot }]]))
    mkdirSync(blocked)

    const failing = images.replace(
      storybook,
      'a',
      new Map([
        ['a.light', { snapshot: bytes.snapshot }],
        ['a.mobile', { snapshot: bytes.snapshot }],
      ]),
    )

    await expect(failing).rejects.toMatchObject({ name: 'ReportError', action: 'write', path: blocked })
    expect(filesIn(dir)).toEqual(['snapshots/web/a.dark.snapshot.png', 'snapshots/web/a.light.snapshot.png'])

    rmSync(blocked, { recursive: true })
    await images.replace(storybook, 'a', new Map())

    expect(filesIn(dir)).toEqual([])
  })

  it("throws a ReportError when an image of the last check can't be removed", async () => {
    const dir = createFolder()
    const storybook = storybookIn(dir)
    const images = createImageFiles()
    const path = join(dir, '.visual-check', 'snapshots', 'web', 'a.snapshot.png')

    await images.replace(storybook, 'a', new Map([['a', { snapshot: bytes.snapshot }]]))
    rmSync(path)
    mkdirSync(path)

    await expect(images.replace(storybook, 'a', new Map())).rejects.toMatchObject({
      name: 'ReportError',
      action: 'clear',
      path,
    })
  })
})
