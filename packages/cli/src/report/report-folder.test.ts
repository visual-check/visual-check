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
import { emptyTestCounts, testReportOf } from './report-document.js'
import {
  clearReport,
  copyBaselineToReport,
  ReportError,
  reportFolderOf,
  writeErrorReport,
  writeReportImages,
  writeReportJson,
} from './report-folder.js'

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

describe('writeReportImages', () => {
  it("creates the Storybook's images folder and writes each image exactly, named by the key", async () => {
    const folder = join(createFolder(), 'report')
    const imagesFolder = join(folder, 'images', 'web')

    await writeReportImages(folder, 'web', 'button--primary.dark', images)

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

    await writeReportImages(folder, 'web', 'a', images)
    await writeReportImages(folder, 'web', 'b', images)
    await writeReportImages(folder, 'docs', 'a', images)

    expect(readdirSync(join(folder, 'images')).sort()).toEqual(['docs', 'web'])
    expect(readdirSync(join(folder, 'images', 'web'))).toHaveLength(6)
  })

  it("throws a ReportError when the images folder can't be made", async () => {
    const folder = createFolder()

    writeFileSync(join(folder, 'images'), '')

    await expect(writeReportImages(folder, 'web', 'a', images)).rejects.toMatchObject({
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

    await expect(writeReportImages(folder, 'web', 'a', images)).rejects.toMatchObject({
      action: 'write',
      path,
      reason: 'EISDIR: illegal operation on a directory',
    })
  })
})

describe('writeReportImages returning paths', () => {
  it('writes only the images given and returns null for the rest', async () => {
    const folder = join(createFolder(), 'report')

    const paths = await writeReportImages(folder, 'web', 'a', { snapshot: images.snapshot })

    expect(paths).toEqual({ baseline: null, snapshot: 'images/web/a.snapshot.png', diff: null })
    expect(readdirSync(join(folder, 'images', 'web'))).toEqual(['a.snapshot.png'])
  })

  it('returns all three paths in the order baseline, snapshot, diff', async () => {
    const folder = join(createFolder(), 'report')

    const paths = await writeReportImages(folder, 'web', 'a', images)

    expect(Object.keys(paths)).toEqual(['baseline', 'snapshot', 'diff'])
    expect(paths).toEqual({
      baseline: 'images/web/a.baseline.png',
      snapshot: 'images/web/a.snapshot.png',
      diff: 'images/web/a.diff.png',
    })
  })
})

describe('copyBaselineToReport', () => {
  it('copies the baseline and returns its path in the report folder', async () => {
    const root = createFolder()
    const folder = join(root, 'report')
    const baseline = join(root, 'a.png')

    writeFileSync(baseline, images.baseline)

    const path = await copyBaselineToReport(folder, 'web', 'a', baseline)

    expect(path).toBe('images/web/a.baseline.png')
    expect(new Uint8Array(readFileSync(join(folder, 'images', 'web', 'a.baseline.png')))).toEqual(images.baseline)
  })

  it('throws a ReportError when the baseline is missing', async () => {
    const root = createFolder()

    await expect(copyBaselineToReport(join(root, 'report'), 'web', 'a', join(root, 'none.png'))).rejects.toMatchObject({
      name: 'ReportError',
      action: 'copy',
      path: join(root, 'none.png'),
      reason: 'ENOENT: no such file or directory',
      message: `Couldn't copy ${join(root, 'none.png')}: ENOENT: no such file or directory.`,
    })
  })
})

describe('report.json', () => {
  const report = testReportOf({
    visualCheck: '0.1.0',
    consistencyOnly: false,
    exitCode: 2,
    shard: null,
    selection: { by: 'all', base: null, changedFiles: null, fallback: null },
    reportDir: '.visual-check/report',
    storybooks: [],
    counts: emptyTestCounts(),
    snapshots: [],
    error: { message: 'No Storybook.', storybooks: [] },
  })

  it('writes the minified document and a newline, creating the folder', async () => {
    const folder = join(createFolder(), 'report')

    await writeReportJson(folder, report)

    expect(readFileSync(join(folder, 'report.json'), 'utf8')).toBe(`${JSON.stringify(report)}\n`)
  })

  it('throws a ReportError when the file is a folder', async () => {
    const folder = createFolder()

    mkdirSync(join(folder, 'report.json'))

    await expect(writeReportJson(folder, report)).rejects.toMatchObject({
      name: 'ReportError',
      path: join(folder, 'report.json'),
    })
  })

  it('replaces the old report with one that holds only the error', async () => {
    const folder = join(createFolder(), 'report')

    await writeReportImages(folder, 'web', 'a', images)
    await writeErrorReport(folder, report)

    expect(readdirSync(folder)).toEqual(['report.json'])
  })
})
