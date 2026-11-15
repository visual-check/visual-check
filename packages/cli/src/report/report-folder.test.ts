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
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearReport, ReportError, reportFolderOf, writeFailureImages } from './report-folder.js'

/**
 * The temporary folders the tests made, removed after each test.
 */
const temporaryFolders: string[] = []

/**
 * Makes an empty temporary folder and returns its real path.
 */
function createFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'visual-check-report-')))

  temporaryFolders.push(folder)

  return folder
}

/**
 * Bytes that stand in for a differing snapshot's images, each its own.
 */
const images = {
  baseline: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]),
  snapshot: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]),
  diff: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 3]),
}

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('reportFolderOf', () => {
  it('places the report folder in .visual-check/report beside the config file', () => {
    expect(reportFolderOf(join('/project', 'visual-check.config.ts'))).toBe(join('/project', '.visual-check', 'report'))
  })
})

describe('clearReport', () => {
  it('removes the report folder and everything in it', async () => {
    const folder = join(createFolder(), 'report')

    mkdirSync(join(folder, 'images', 'web'), { recursive: true })
    writeFileSync(join(folder, 'images', 'web', 'a.diff.png'), 'old')
    writeFileSync(join(folder, 'report.json'), '{}')

    await clearReport(folder)

    expect(existsSync(folder)).toBe(false)
  })

  it('does nothing for a report folder that is missing', async () => {
    const folder = createFolder()

    await clearReport(join(folder, 'report'))

    expect(readdirSync(folder)).toEqual([])
  })

  it("throws a ReportError with the path and the system's reason when the folder can't be removed", async () => {
    const folder = createFolder()
    const report = join(folder, '.visual-check', 'report')

    writeFileSync(join(folder, '.visual-check'), '')

    const error = await clearReport(report).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ReportError)
    expect(error).toMatchObject({
      action: 'clear',
      path: report,
      reason: 'ENOTDIR: not a directory',
      message: `Couldn't clear ${report}: ENOTDIR: not a directory.`,
    })
  })
})

describe('writeFailureImages', () => {
  it("creates the Storybook's images folder and writes each image exactly, named by the key", async () => {
    const folder = join(createFolder(), 'report')
    const imagesFolder = join(folder, 'images', 'web')

    await writeFailureImages(folder, 'web', 'button--primary.dark', images)

    expect(readdirSync(imagesFolder).sort()).toEqual([
      'button--primary.dark.baseline.png',
      'button--primary.dark.diff.png',
      'button--primary.dark.snapshot.png',
    ])
    expect(new Uint8Array(readFileSync(join(imagesFolder, 'button--primary.dark.baseline.png')))).toEqual(
      images.baseline,
    )
    expect(new Uint8Array(readFileSync(join(imagesFolder, 'button--primary.dark.snapshot.png')))).toEqual(
      images.snapshot,
    )
    expect(new Uint8Array(readFileSync(join(imagesFolder, 'button--primary.dark.diff.png')))).toEqual(images.diff)
  })

  it('keeps the images of other snapshots and Storybooks', async () => {
    const folder = join(createFolder(), 'report')

    await writeFailureImages(folder, 'web', 'a', images)
    await writeFailureImages(folder, 'web', 'b', images)
    await writeFailureImages(folder, 'docs', 'a', images)

    expect(readdirSync(join(folder, 'images')).sort()).toEqual(['docs', 'web'])
    expect(readdirSync(join(folder, 'images', 'web'))).toHaveLength(6)
  })

  it("throws a ReportError when the images folder can't be made", async () => {
    const folder = createFolder()

    writeFileSync(join(folder, 'images'), '')

    await expect(writeFailureImages(folder, 'web', 'a', images)).rejects.toMatchObject({
      name: 'ReportError',
      action: 'write',
      path: join(folder, 'images', 'web'),
      reason: 'ENOTDIR: not a directory',
    })
  })

  it("throws a ReportError naming the image that can't be written", async () => {
    const folder = createFolder()
    const path = join(folder, 'images', 'web', 'a.snapshot.png')

    mkdirSync(path, { recursive: true })

    await expect(writeFailureImages(folder, 'web', 'a', images)).rejects.toMatchObject({
      action: 'write',
      path,
      reason: 'EISDIR: illegal operation on a directory',
    })
  })
})
