import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { baselineStemOf } from '../baselines/baseline-files.js'
import type { BrokenStory, StoryCapture, StoryToCapture } from '../capture/capture-session.js'
import type { ConsoleMessage } from '../capture/driver/driver.js'
import { writeReportImages } from '../report/report-folder.js'
import { greyPng, whitePixels } from '../visual-diff/images.fixture.js'
import { createVisualDiff } from '../visual-diff/visual-diff.js'
import type { SnapshotToCapture } from './plan-snapshots.js'
import type { CaptureStory } from './snapshot-result.js'
import { type TestTools, testSnapshot } from './test-snapshot.js'

/**
 * A black PNG file of 10 × 10 pixels.
 */
const black = new Uint8Array(await greyPng(10, 10, 0))

/**
 * A white PNG file of 10 × 10 pixels, whose 100 pixels all differ from `black`'s.
 */
const white = new Uint8Array(await greyPng(10, 10, 255))

/**
 * `black` with 3 white pixels: within the default tolerance of `black`.
 */
const threeWhite = new Uint8Array(await greyPng(10, 10, 0, whitePixels(3, 10)))

/**
 * A black PNG file of 10 × 12 pixels: the size differs from `black`'s.
 */
const taller = new Uint8Array(await greyPng(10, 12, 0))

/**
 * An image of a broken story's page.
 */
const brokenImage = new Uint8Array(await greyPng(10, 10, 128))

/**
 * The console messages of the first capture.
 */
const firstConsole: ConsoleMessage[] = [{ kind: 'console.log', text: 'first' }]

/**
 * The broken story the fake gives for a story whose `play` threw.
 */
const brokenStory: BrokenStory = {
  reason: 'play-threw',
  message: "The story's play function threw Boom.",
  errorText: 'Boom',
  stack: [],
}

/**
 * The visual diff every test compares with, closed after the last test.
 */
const visualDiff = createVisualDiff()

afterAll(async () => {
  await visualDiff.close()
})

/**
 * The folders the tests made, removed after each test.
 */
const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

/**
 * A snapshot to test, its report folder and the tools to test it with.
 */
interface TestSetup {
  /**
   * The snapshot.
   */
  item: SnapshotToCapture
  /**
   * The report folder.
   */
  reportFolder: string
  /**
   * What `test` is given.
   */
  tools: TestTools
}

/**
 * Builds the default capture of story `a`, holding `baseline` as its baseline when given, with a report folder of its
 * own and `retries` retries.
 */
function setupOf(baseline: Uint8Array | undefined, retries: number): TestSetup {
  const folder = mkdtempSync(join(tmpdir(), 'visual-check-test-'))
  const reportFolder = join(folder, 'report')

  folders.push(folder)

  if (baseline !== undefined) {
    writeFileSync(join(folder, 'a.png'), baseline)
  }

  return {
    item: {
      storybook: { name: 'web', dir: '/web', configDir: '/web/.storybook', baselines: folder, url: 'http://web.test' },
      story: { id: 'a', title: 'Title', name: 'Name', importPath: './a.stories.tsx' },
      mode: undefined,
      key: 'a',
      selected: true,
      options: {},
      tolerance: { color: 0.01, pixels: 20 },
      viewport: { width: 10, height: 10, deviceScaleFactor: 1, touch: false },
      globals: {},
    },
    reportFolder,
    tools: {
      visualDiff,
      writeImages: (item, images) =>
        writeReportImages(reportFolder, item.storybook.name, baselineStemOf(item.key), images),
      retries,
      captureMissing: false,
    },
  }
}

/**
 * A fake `CaptureStory` that gives `captures` in order, one per call, and throws when asked for more.
 */
function captureStoryOf(captures: readonly StoryCapture[]): CaptureStory {
  const queue = [...captures]

  return async () => {
    const capture = queue.shift()

    if (capture === undefined) {
      throw new Error('The test gave too few captures.')
    }

    return capture
  }
}

/**
 * A capture of `snapshot`, with `console` as its console messages, none when not given.
 */
function captureOf(snapshot: Uint8Array, console: ConsoleMessage[] = []): StoryCapture {
  return { snapshot, completingMs: undefined, console }
}

/**
 * Reads a report image's bytes.
 */
function reportImageAt(reportFolder: string, path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(reportFolder, path)))
}

describe('testSnapshot', () => {
  it('takes no capture of a missing baseline unless asked to', async () => {
    const { item, tools } = setupOf(undefined, 2)

    expect(await testSnapshot(item, captureStoryOf([]), tools)).toMatchObject({ status: 'missing', attempts: 0 })
  })

  it('captures a missing baseline once when asked to, with its snapshot as its only image', async () => {
    const { item, reportFolder, tools } = setupOf(undefined, 2)
    const asked: StoryToCapture[] = []
    const captureStory: CaptureStory = async (story) => {
      asked.push(story)

      return { ...captureOf(white, firstConsole), completingMs: 7 }
    }
    const result = await testSnapshot(item, captureStory, { ...tools, captureMissing: true })

    expect(result).toStrictEqual({
      status: 'missing',
      detail: 'missing: no baseline yet; run visual-check update to write it',
      attempts: 1,
      completingMs: 7,
      console: firstConsole,
      images: { baseline: null, snapshot: 'images/web/a.snapshot.png', diff: null },
    })
    expect(asked).toMatchObject([{ id: 'a', imageWhenBroken: true }])
    expect(reportImageAt(reportFolder, 'images/web/a.snapshot.png')).toEqual(white)
    expect(existsSync(join(item.storybook.baselines, 'a.png'))).toBe(false)
  })

  it('gives a missing baseline whose capture is broken as broken, with the image of its page', async () => {
    const { item, reportFolder, tools } = setupOf(undefined, 2)
    const captures: StoryCapture[] = [{ broken: brokenStory, console: firstConsole, image: brokenImage }]
    const result = await testSnapshot(item, captureStoryOf(captures), { ...tools, captureMissing: true })

    expect(result).toStrictEqual({
      status: 'broken',
      detail: `broken: ${brokenStory.message}`,
      attempts: 1,
      broken: brokenStory,
      console: firstConsole,
      images: { baseline: null, snapshot: 'images/web/a.snapshot.png', diff: null },
    })
    expect(reportImageAt(reportFolder, 'images/web/a.snapshot.png')).toEqual(brokenImage)
  })

  it('passes in one capture, with its console messages and nothing more to list', async () => {
    const { item, tools } = setupOf(black, 2)
    const result = await testSnapshot(item, captureStoryOf([captureOf(threeWhite, firstConsole)]), tools)

    expect(result).toMatchObject({ status: 'passed', attempts: 1, console: firstConsole })
    expect(result.comparison).toBeUndefined()
    expect(result.images).toBeUndefined()
  })

  it("counts every retry of a snapshot that differs, listing the first capture's comparison, console and images", async () => {
    const { item, reportFolder, tools } = setupOf(black, 2)
    const captures = [captureOf(white, firstConsole), captureOf(white), captureOf(white)]
    const result = await testSnapshot(item, captureStoryOf(captures), tools)

    expect(result).toStrictEqual({
      status: 'differs',
      detail: 'differs: 100 differ, 20 allowed',
      attempts: 3,
      completingMs: undefined,
      comparison: {
        reason: 'pixels',
        message: '100 differ, 20 allowed',
        differ: 100,
        allowed: 20,
        baselineSize: { width: 10, height: 10 },
        snapshotSize: { width: 10, height: 10 },
      },
      console: firstConsole,
      images: {
        baseline: 'images/web/a.baseline.png',
        snapshot: 'images/web/a.snapshot.png',
        diff: 'images/web/a.diff.png',
      },
    })
    expect(reportImageAt(reportFolder, 'images/web/a.baseline.png')).toEqual(black)
    expect(reportImageAt(reportFolder, 'images/web/a.snapshot.png')).toEqual(white)
    expect(existsSync(join(reportFolder, 'images/web/a.diff.png'))).toBe(true)
  })

  it('lists a size difference by its sizes', async () => {
    const { item, tools } = setupOf(black, 0)
    const result = await testSnapshot(item, captureStoryOf([captureOf(taller)]), tools)

    expect(result).toMatchObject({
      status: 'differs',
      attempts: 1,
      comparison: { reason: 'size', baselineSize: { width: 10, height: 10 }, snapshotSize: { width: 10, height: 12 } },
    })
  })

  it("passes flaky on a retry, listing the first capture's comparison, console and images", async () => {
    const { item, reportFolder, tools } = setupOf(black, 2)
    const captures = [captureOf(white, firstConsole), captureOf(black, [{ kind: 'console.log', text: 'retry' }])]
    const result = await testSnapshot(item, captureStoryOf(captures), tools)

    expect(result).toMatchObject({
      status: 'passed',
      flaky: true,
      attempts: 2,
      comparison: { reason: 'pixels', differ: 100 },
      console: firstConsole,
      images: { snapshot: 'images/web/a.snapshot.png' },
    })
    expect(reportImageAt(reportFolder, 'images/web/a.snapshot.png')).toEqual(white)
  })

  it('counts a retry that broke, keeping the first capture as the one listed', async () => {
    const { item, tools } = setupOf(black, 3)
    const captures: StoryCapture[] = [captureOf(white, firstConsole), captureOf(white), { broken: brokenStory }]
    const result = await testSnapshot(item, captureStoryOf(captures), tools)

    expect(result).toMatchObject({ status: 'differs', attempts: 3, console: firstConsole })
    expect(result.broken).toBeUndefined()
  })

  it('names the hosts of the remote content a difference lies inside', async () => {
    const { item, tools } = setupOf(black, 1)
    const box = { host: 'cdn.test', x: 0, y: 0, width: 10, height: 10 }
    const captures: StoryCapture[] = [captureOf(white), { ...captureOf(white), remoteContent: [box] }]
    const result = await testSnapshot(item, captureStoryOf(captures), tools)

    expect(result).toMatchObject({ status: 'differs', hintHosts: ['cdn.test'] })
  })

  it("leaves a broken story's image of its page as its snapshot, with its broken story and console", async () => {
    const { item, reportFolder, tools } = setupOf(black, 2)
    const captures: StoryCapture[] = [{ broken: brokenStory, console: firstConsole, image: brokenImage }]
    const result = await testSnapshot(item, captureStoryOf(captures), tools)

    expect(result).toStrictEqual({
      status: 'broken',
      detail: `broken: ${brokenStory.message}`,
      attempts: 1,
      broken: brokenStory,
      console: firstConsole,
      images: { baseline: null, snapshot: 'images/web/a.snapshot.png', diff: null },
    })
    expect(reportImageAt(reportFolder, 'images/web/a.snapshot.png')).toEqual(brokenImage)
  })

  it('writes nothing for a broken story with no image and no page', async () => {
    const { item, reportFolder, tools } = setupOf(black, 2)
    const result = await testSnapshot(item, captureStoryOf([{ broken: brokenStory }]), tools)

    expect(result).toStrictEqual({
      status: 'broken',
      detail: `broken: ${brokenStory.message}`,
      attempts: 1,
      broken: brokenStory,
    })
    expect(existsSync(reportFolder)).toBe(false)
  })
})
