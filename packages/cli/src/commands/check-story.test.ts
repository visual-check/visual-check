import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { Driver, Page } from '../capture/driver/driver.js'
import { DockerMissingError } from '../container/container-error.js'
import { reportImagePathOf } from '../report/report-document.js'
import { ReportError, type ReportImageBytes } from '../report/report-folder.js'
import { previewUrlOf } from '../storybook/read-stories.js'
import { type CheckOutcome, checkStory, type StoryCheck } from './check-story.js'
import {
  absentMarkerPath,
  browserPackage,
  cleanUpRuns,
  createRun,
  defaultRunSnapshot,
  type FakeBrowserRecord,
  fakeBrowser,
  hostOptions,
  installStorybook,
  otherSnapshot,
  printed,
  removeMarkerFolder,
  storyIdsOf,
  takeUnusedUrl,
} from './run-cli.fixture.js'
import type { StoryProgress } from './story-run.js'
import { createWarmBrowser } from './warm-browser.js'

/**
 * The options of a story that lists two modes: `dark`, which sets a global, and `mobile`, which sets a viewport.
 */
const twoModes = { modes: { dark: { globals: { theme: 'dark' } }, mobile: { viewport: { width: 400 } } } }

/**
 * The options of a story that lists two modes, each of which sets a global.
 */
const twoThemes = { modes: { dark: { globals: { theme: 'dark' } }, sepia: { globals: { theme: 'sepia' } } } }

/**
 * The notice of a check whose first fake browser exited and was relaunched.
 */
const relaunchNotice = printed(
  'The browser was killed by signal SIGKILL while in use.',
  'visual-check relaunches it once for the rest of the run.',
  "The browser's last output:",
  '  Out of memory',
  '  bye from browser 1',
).trim()

/**
 * A step a fake page stops at: the options read, or a capture.
 */
type HeldStep = 'read' | 'capture'

/**
 * One replacement of a story's images.
 */
interface ReplacedImages {
  /**
   * The story, as `<storybook> <story ID>`.
   */
  story: string
  /**
   * The new images, by stem.
   */
  images: Record<string, Partial<ReportImageBytes>>
}

/**
 * What a test gives a check besides its project, and what it saw.
 */
interface CheckSetup {
  /**
   * The check.
   */
  check: StoryCheck
  /**
   * Every progress, in order.
   */
  progress: StoryProgress[]
  /**
   * Every replacement of a story's images, in order.
   */
  replaced: ReplacedImages[]
  /**
   * The folder the check's image paths are relative to.
   */
  imagesFolder: string
}

/**
 * Builds what a check launches its fake browsers with, as `fakeBrowser` says, with what they saw.
 */
function fakeLaunch(...fake: Parameters<typeof fakeBrowser>): {
  options: Pick<StoryCheck, 'launchBrowser'>
  record: FakeBrowserRecord
} {
  const { options, record } = fakeBrowser(...fake)

  return { options: { launchBrowser: options.launchBrowser }, record }
}

/**
 * Gives the path of an image as the report lists it, or `null` when there's no image.
 */
function pathOf(
  storybook: string,
  stem: string,
  kind: keyof ReportImageBytes,
  images: Partial<ReportImageBytes>,
): string | null {
  return images[kind] === undefined ? null : reportImagePathOf(storybook, stem, kind)
}

/**
 * Builds a check of story `a` of the Storybook in `project` that's served at `url`, in the fake browser `launchBrowser`
 * launches, whose images are recorded rather than written. `overrides` replace any of it.
 */
function checkOf(
  project: string,
  url: string,
  overrides: Partial<StoryCheck> & Pick<StoryCheck, 'launchBrowser'>,
): CheckSetup {
  const progress: StoryProgress[] = []
  const replaced: ReplacedImages[] = []
  const imagesFolder = join(project, 'images')

  return {
    check: {
      ...hostOptions,
      imageMarkerPath: absentMarkerPath,
      storyId: 'a',
      configDir: join(project, '.storybook'),
      url,
      cwd: project,
      environment: {},
      images: {
        folderOf: () => imagesFolder,
        pathsOf: ({ name }, stem, images) => ({
          baseline: pathOf(name, stem, 'baseline', images),
          snapshot: pathOf(name, stem, 'snapshot', images),
          diff: pathOf(name, stem, 'diff', images),
          compared: null,
        }),
        replace: async ({ name }, storyId, images) => {
          replaced.push({ story: `${name} ${storyId}`, images: Object.fromEntries(images) })
        },
      },
      signal: new AbortController().signal,
      progress: (step) => progress.push(step),
      ...overrides,
    },
    progress,
    replaced,
    imagesFolder,
  }
}

/**
 * Gives the outcome as a finished check.
 */
function checkedOf(outcome: CheckOutcome): Extract<CheckOutcome, { result: 'checked' }> {
  if (outcome.result !== 'checked') {
    throw new Error(`The check ended ${JSON.stringify(outcome)}.`)
  }

  return outcome
}

/**
 * Gives the bytes of every file in the folder, by its name.
 */
function filesIn(folder: string): Record<string, Buffer> {
  return Object.fromEntries(readdirSync(folder).map((name) => [name, readFileSync(join(folder, name))]))
}

/**
 * Wraps a page so that it stops at a step `isHeld` holds, calling `reached`, until the page closes, which fails the
 * step.
 */
function heldPageOf(page: Page, isHeld: (step: HeldStep) => boolean, reached: () => void): Page {
  let fail: (error: Error) => void = () => undefined
  const closed = new Promise<never>((_resolve, reject) => {
    fail = reject
  })

  closed.catch(() => undefined)

  const hold = async (): Promise<never> => {
    reached()

    return await closed
  }

  return {
    ...page,
    evaluate: async (expression, timeoutMs) =>
      expression.includes('.readOptions(') && isHeld('read')
        ? await hold()
        : await page.evaluate(expression, timeoutMs),
    capture: async (area) => (isHeld('capture') ? await hold() : await page.capture(area)),
    close: async () => {
      fail(new Error('The page is closed.'))
      await page.close()
    },
  }
}

/**
 * Wraps a driver so that its pages stop as `heldPageOf` says.
 */
function heldDriverOf(driver: Driver, isHeld: (step: HeldStep) => boolean, reached: () => void): Driver {
  return { ...driver, newPage: async (setup) => heldPageOf(await driver.newPage(setup), isHeld, reached) }
}

afterEach(cleanUpRuns)

afterAll(removeMarkerFolder)

describe('checkStory', () => {
  it('captures the default capture and each mode, missing baselines too, in order', async () => {
    const baselines = { a: defaultRunSnapshot, 'a.dark': defaultRunSnapshot }
    const { project, url, folder } = await createRun(['a', 'b'], baselines, 'retries: 0')
    const before = filesIn(folder)
    const { options } = fakeLaunch(
      { a: { byGlobals: { 'theme:dark': { snapshot: otherSnapshot, waitsFor: 'a' } } } },
      { read: { options: { a: twoModes } } },
    )
    const { check, replaced, imagesFolder } = checkOf(project, url, options)
    const outcome = checkedOf(await checkStory(check))

    expect(outcome).toMatchObject({ storybook: 'web', imagesFolder, disabled: false, notices: [] })
    expect(outcome.snapshots).toMatchObject([
      { id: 'a', mode: null, status: 'passed', attempts: 1, images: { baseline: null, snapshot: null, diff: null } },
      {
        id: 'a.dark',
        mode: 'dark',
        status: 'differs',
        reason: 'pixels',
        baseline: '.visual-check/baselines/a.dark.png',
        images: {
          baseline: 'images/web/a.dark.baseline.png',
          snapshot: 'images/web/a.dark.snapshot.png',
          diff: 'images/web/a.dark.diff.png',
        },
      },
      {
        id: 'a.mobile',
        mode: 'mobile',
        status: 'missing',
        attempts: 1,
        images: { baseline: null, snapshot: 'images/web/a.mobile.snapshot.png', diff: null },
      },
    ])
    expect(replaced).toEqual([
      {
        story: 'web a',
        images: {
          'a.dark': {
            baseline: Buffer.from(defaultRunSnapshot),
            snapshot: otherSnapshot,
            diff: expect.any(Uint8Array),
          },
          'a.mobile': { snapshot: defaultRunSnapshot },
        },
      },
    ])
    expect(filesIn(folder)).toEqual(before)
  })

  it("gives each entry as the report does, with the config's folder as its baseline's root", async () => {
    const { project, url } = await createRun(['a'])
    const { options } = fakeLaunch({
      a: {
        consoleMessages: [{ kind: 'console.warn', text: 'careful' }],
        pageErrors: [{ kind: 'console.error', text: 'boom' }],
      },
    })
    const outcome = checkedOf(await checkStory(checkOf(project, url, options).check))

    expect(outcome.snapshots).toEqual([
      {
        storybook: 'web',
        id: 'a',
        kind: 'story',
        story: 'a',
        importPath: './button.stories.tsx',
        mode: null,
        status: 'missing',
        reason: null,
        message: 'No baseline yet. Run visual-check update to write it.',
        flaky: false,
        attempts: 1,
        pixels: null,
        size: null,
        details: null,
        hints: [],
        console: [{ level: 'warn', text: 'careful' }],
        pageErrors: [{ kind: 'console.error', text: 'boom', severity: 'fail' }],
        staleExpectedPageErrors: [],
        baseline: '.visual-check/baselines/a.png',
        images: { baseline: null, snapshot: 'images/web/a.snapshot.png', diff: null, compared: null },
      },
    ])
  })

  it("reads and captures only this story's file", async () => {
    const { project, url } = await createRun(['a', 'b', 'c'], {}, '', { b: './other.stories.tsx' })
    const { options, record } = fakeLaunch({}, { read: { failed: { './other.stories.tsx': 'Boom' } } })

    checkedOf(await checkStory(checkOf(project, url, options).check))

    expect(record.reads.map(({ files }) => files)).toEqual([[{ importPath: './button.stories.tsx', storyIds: ['a'] }]])
    expect(storyIdsOf(record.urls)).toEqual(['a'])
    expect(record.driverCloses).toBe(1)
  })

  it("captures at this Storybook's own address", async () => {
    const { project, url } = await createRun(['a'])
    const own = url.replace('127.0.0.1', 'localhost')
    const { options, record } = fakeLaunch()

    checkedOf(await checkStory(checkOf(project, own, options).check))

    expect(record.urls.every((loaded) => loaded.startsWith(`${own}/`))).toBe(true)
  })

  it('tells its progress: the preparation, the browser and each capture', async () => {
    const { project, url } = await createRun(['a'], {}, 'workers: 1')
    const { options } = fakeLaunch({}, { read: { options: { a: twoModes } } })
    const { check, progress } = checkOf(project, url, options)

    await checkStory(check)

    expect(progress).toEqual([
      { step: 'preparing' },
      { step: 'browser', text: `Pulling ${browserPackage.imageReference}\n` },
      { step: 'capturing', finished: 0, total: 3 },
      { step: 'capturing', finished: 1, total: 3 },
      { step: 'capturing', finished: 2, total: 3 },
      { step: 'capturing', finished: 3, total: 3 },
    ])
  })

  it('gives a broken story with the image of its page', async () => {
    const { project, url } = await createRun(['a'], { a: defaultRunSnapshot })
    const { options } = fakeLaunch({ a: { broken: true } })
    const outcome = checkedOf(await checkStory(checkOf(project, url, options).check))

    expect(outcome.snapshots).toMatchObject([
      { status: 'broken', reason: 'error', details: {}, images: { snapshot: 'images/web/a.snapshot.png' } },
    ])
  })

  it("gives a story whose stories file didn't load as broken, with its details", async () => {
    const { project, url } = await createRun(['a'])
    const { options } = fakeLaunch({}, { read: { failed: { './button.stories.tsx': 'Boom' } } })
    const outcome = checkedOf(await checkStory(checkOf(project, url, options).check))

    expect(outcome.snapshots).toMatchObject([
      { status: 'broken', reason: 'load-failed', details: { loadError: 'Boom' }, attempts: 0 },
    ])
  })

  it("retries a snapshot that differs as often as the config's retries say, flaky when one passes", async () => {
    const { project, url } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 1')
    const { options } = fakeLaunch({ a: { captures: [{ snapshot: otherSnapshot }, {}] } })
    const outcome = checkedOf(await checkStory(checkOf(project, url, options).check))

    expect(outcome.snapshots).toMatchObject([{ status: 'passed', flaky: true, attempts: 2 }])
  })

  it('gives the hint of a difference inside remote content', async () => {
    const { project, url } = await createRun(['a'], { a: defaultRunSnapshot }, 'retries: 1')
    const remote = [{ host: 'cdn.test', x: 0, y: 0, width: 10, height: 10 }]
    const { options } = fakeLaunch({ a: { snapshot: otherSnapshot, remote } })
    const outcome = checkedOf(await checkStory(checkOf(project, url, options).check))

    expect(outcome.snapshots).toMatchObject([
      { status: 'differs', hints: [{ kind: 'remote-content', hosts: ['cdn.test'] }] },
    ])
  })

  it('captures nothing of a disabled story', async () => {
    const { project, url } = await createRun(['a'])
    const { options, record } = fakeLaunch({}, { read: { options: { a: { disable: true } } } })
    const { check, replaced, imagesFolder } = checkOf(project, url, options)

    expect(await checkStory(check)).toEqual({
      result: 'checked',
      storybook: 'web',
      imagesFolder,
      snapshots: [],
      disabled: true,
      notices: [],
    })
    expect(record.captures).toEqual([])
    expect(record.closed).toBe(true)
    expect(replaced).toEqual([{ story: 'web a', images: {} }])
  })

  it('reads a config edited since the last check', async () => {
    const { project, url } = await createRun(['a'])
    const { options } = fakeLaunch()
    const { check } = checkOf(project, url, options)

    expect(checkedOf(await checkStory(check)).storybook).toBe('web')
    writeFileSync(
      join(project, 'visual-check.config.mjs'),
      `export default { storybooks: { docs: { url: '${url}' } } }\n`,
    )
    expect(checkedOf(await checkStory(check)).storybook).toBe('docs')
  })

  it('needs no URL in the config for this environment', async () => {
    const { project, url } = await createRun(['a'])

    writeFileSync(
      join(project, 'visual-check.config.mjs'),
      `export default { storybooks: { web: { url: { ci: '${url}' } } } }\n`,
    )

    const { options } = fakeLaunch()

    expect(checkedOf(await checkStory(checkOf(project, url, options).check)).notices).toEqual([])
  })
})

describe('checkStory stopped', () => {
  it('gives the message of a config that is missing, as a config problem', async () => {
    const { project, url } = await createRun(['a'])
    const { options } = fakeLaunch()

    rmSync(join(project, 'visual-check.config.mjs'))

    expect(await checkStory(checkOf(project, url, options).check)).toEqual({
      result: 'stopped',
      cause: 'config',
      message:
        'No visual-check.config.ts (or .mts, .js, .mjs) found in the current folder or its parents. ' +
        'Run visual-check init to create one.',
      notices: [],
    })
  })

  it('gives the message of a config that lists another Storybook, as a config problem', async () => {
    const { project, url } = await createRun(['a'])
    const { options } = fakeLaunch()
    const { check } = checkOf(project, url, { ...options, configDir: join(project, 'other', '.storybook') })

    expect(await checkStory(check)).toEqual({
      result: 'stopped',
      cause: 'config',
      message:
        'visual-check.config.mjs lists no Storybook whose config folder is other/.storybook. ' +
        'It lists web (.storybook).',
      notices: [],
    })
  })

  it('gives the message of an invalid config, as a config problem', async () => {
    const { project, url } = await createRun(['a'], {}, "retries: 'often'")
    const { options } = fakeLaunch()

    expect(await checkStory(checkOf(project, url, options).check)).toMatchObject({
      result: 'stopped',
      cause: 'config',
      message: expect.stringMatching(/^visual-check\.config\.mjs .*retries/s),
    })
  })

  it('gives the message of a story the index lacks', async () => {
    const { project, url } = await createRun(['b'])
    const { options, record } = fakeLaunch()

    expect(await checkStory(checkOf(project, url, options).check)).toEqual({
      result: 'stopped',
      cause: 'run',
      message: "Storybook web's index.json lists no story a. It may have been renamed or removed.",
      notices: [],
    })
    expect(record.launches).toEqual([])
  })

  it('gives the message of an address where nothing answers', async () => {
    const { project } = await createRun(['a'])
    const url = await takeUnusedUrl()
    const { options } = fakeLaunch()

    expect(await checkStory(checkOf(project, url, options).check)).toMatchObject({
      result: 'stopped',
      cause: 'run',
      message: expect.stringMatching(/^Storybook web doesn't answer at .*[^\n]$/),
    })
  })

  it('gives both fixes when Docker is missing, as the CLI does', async () => {
    const { project, url } = await createRun(['a'])
    const { options } = fakeLaunch()
    const probeDocker = () => Promise.reject(new DockerMissingError("there's no docker command on PATH."))

    expect(await checkStory(checkOf(project, url, { ...options, probeDocker }).check)).toEqual({
      result: 'stopped',
      cause: 'run',
      message: "there's no docker command on PATH.\nStart or install Docker, or set platform: 'host' in the config.",
      notices: [],
    })
  })

  it("adds the job container's fix inside a container", async () => {
    const { project, url } = await createRun(['a'])
    const { options } = fakeLaunch()
    const probeDocker = () => Promise.reject(new DockerMissingError("there's no docker command on PATH."))
    const { check } = checkOf(project, url, { ...options, probeDocker, insideContainer: true })

    expect(await checkStory(check)).toMatchObject({
      message: expect.stringContaining('\nInside a container, run visual-check in a job container'),
    })
  })

  it('gives the invalid options of the story', async () => {
    const { project, url } = await createRun(['a'])
    const { options } = fakeLaunch({}, { read: { options: { a: { element: 1 } } } })
    const { check, replaced } = checkOf(project, url, options)

    expect(await checkStory(check)).toMatchObject({
      result: 'stopped',
      cause: 'run',
      message: expect.stringMatching(/^Storybook web has invalid per-story options:\n {2}- a: /),
    })
    expect(replaced).toEqual([])
  })

  it('gives the problem of an options read that failed', async () => {
    const { project, url } = await createRun(['a'])
    const answer = { outcome: 'timed-out', step: 'preview-start' }
    const { options, record } = fakeLaunch({}, { read: { answers: { [previewUrlOf(url)]: answer } } })
    const { check, replaced } = checkOf(project, url, options)

    expect(await checkStory(check)).toMatchObject({
      result: 'stopped',
      cause: 'run',
      message: expect.stringMatching(/^Storybook web's preview never started at /),
    })
    expect(replaced).toEqual([])
    expect(record.captures).toEqual([])
  })

  it("gives the image's problem when one can't be written", async () => {
    const { project, url } = await createRun(['a'])
    const { options } = fakeLaunch()
    const { check, imagesFolder } = checkOf(project, url, options)
    const replace = () =>
      Promise.reject(new ReportError('write', join(imagesFolder, 'a.png'), new Error('the disk is full')))

    expect(await checkStory({ ...check, images: { ...check.images, replace } })).toEqual({
      result: 'stopped',
      cause: 'run',
      message:
        "visual-check couldn't write images/a.png: the disk is full. " +
        'Check that its folder is writable and the disk has room.',
      notices: [],
    })
  })

  it("gives the images folder's problem when the last check's images can't be removed", async () => {
    const { project, url } = await createRun(['a'])
    const { options, record } = fakeLaunch()
    const { check, imagesFolder } = checkOf(project, url, options)
    const replace = () => Promise.reject(new ReportError('clear', imagesFolder, new Error('it is open')))

    expect(await checkStory({ ...check, images: { ...check.images, replace } })).toMatchObject({
      message: "visual-check couldn't clear images: it is open. Check that visual-check can remove it.",
    })
    expect(record.closed).toBe(true)
  })

  it.each([
    ['before the browser', (error: Error) => ({ probeDocker: () => Promise.reject(error) })],
    ['at the launch', (error: Error) => ({ launchBrowser: () => Promise.reject(error) })],
  ])('gives the stack of an unexpected error %s', async (_when, failingWith) => {
    const { project, url } = await createRun(['a'])
    const error = new Error('Boom')
    const { check } = checkOf(project, url, { ...fakeLaunch().options, ...failingWith(error) })

    expect(await checkStory(check)).toEqual({ result: 'stopped', cause: 'run', message: error.stack, notices: [] })
  })
})

describe("checkStory's notices", () => {
  it("says that CLI runs check the config's url when it's another one", async () => {
    const { project, url } = await createRun(['a'])
    const other = 'http://127.0.0.1:1'

    writeFileSync(
      join(project, 'visual-check.config.mjs'),
      `export default { storybooks: { web: { url: '${other}' } } }\n`,
    )

    const { options } = fakeLaunch()

    expect(checkedOf(await checkStory(checkOf(project, url, options).check)).notices).toEqual([
      `This Storybook runs at ${url}. CLI runs check ${other}, the config's url.`,
    ])
  })

  it('says nothing about another loopback name', async () => {
    const { project, url } = await createRun(['a'])
    const { options } = fakeLaunch()
    const { check } = checkOf(project, url.replace('127.0.0.1', 'localhost'), options)

    expect(checkedOf(await checkStory(check)).notices).toEqual([])
  })

  it('come with a check that stopped too, the address first', async () => {
    const { project } = await createRun(['a'])
    const url = await takeUnusedUrl()

    installStorybook(project, '12.0.0')

    expect(await checkStory(checkOf(project, url, fakeLaunch().options).check)).toMatchObject({
      result: 'stopped',
      notices: [
        expect.stringMatching(/^This Storybook runs at /),
        'Warning: Storybook web runs storybook 12.0.0, and visual-check supports 9.1 to 11. The run carries on.',
      ],
    })
  })

  it('say that the browser exited and was relaunched, with the story in flight broken', async () => {
    const { project, url } = await createRun(['a'], {}, 'workers: 1')
    const { options, record } = fakeLaunch(
      { a: { browserExits: true, byGlobals: { 'theme:dark': { browserExits: false } } } },
      { read: { options: { a: { modes: { dark: twoModes.modes.dark } } } } },
    )
    const outcome = checkedOf(await checkStory(checkOf(project, url, options).check))

    expect(outcome.snapshots).toMatchObject([
      { status: 'broken', reason: 'browser-exited' },
      { status: 'missing', mode: 'dark' },
    ])
    expect(outcome.notices).toEqual([relaunchNotice])
    expect(record.launches).toHaveLength(2)
  })

  it("come with the CLI's error when the relaunched browser exits too", async () => {
    const { project, url } = await createRun(['a'], {}, 'workers: 1')
    const { options } = fakeLaunch({ a: { browserExits: true } }, { read: { options: { a: twoThemes } } })
    const { check, replaced } = checkOf(project, url, options)
    const stopped = {
      result: 'stopped',
      cause: 'run',
      message: printed(
        'The browser was killed by signal SIGKILL while in use.',
        "The browser's output below may say why. Running out of memory is a common cause. Run visual-check again.",
        "The browser's last output:",
        '  Out of memory',
        '  bye from browser 2',
      ).trim(),
      notices: [relaunchNotice],
    }

    expect(await checkStory(check)).toEqual(stopped)
    expect(replaced).toEqual([])
    // The next check counts the exits from none again: its first exit relaunches the browser.
    expect(await checkStory(check)).toMatchObject({ notices: [expect.stringContaining('relaunches it once')] })
  })

  it("don't blame the platform once a missing baseline's snapshot was captured", async () => {
    const { project, url } = await createRun(['a'], {}, 'workers: 1')
    const exits = { browserExits: true, graphicsFailed: true }
    const { options } = fakeLaunch(
      { a: { byGlobals: { 'theme:dark': exits, 'theme:sepia': exits } } },
      { read: { options: { a: twoThemes } } },
    )

    expect(await checkStory(checkOf(project, url, options).check)).toMatchObject({
      result: 'stopped',
      message: expect.stringContaining('The browser was killed by signal SIGKILL while in use.'),
    })
  })
})

describe('checkStory cancelled', () => {
  it('leaves the images of the last check alone when its signal aborts after the last capture', async () => {
    const { project, url } = await createRun(['a'])
    const controller = new AbortController()
    const { check, replaced } = checkOf(project, url, {
      ...fakeLaunch().options,
      signal: controller.signal,
      progress: (progress) => {
        if (progress.step === 'capturing' && progress.finished === progress.total) {
          controller.abort()
        }
      },
    })

    expect(await checkStory(check)).toEqual({ result: 'cancelled' })
    expect(replaced).toEqual([])
  })

  it('finishes when its signal aborts once its images are being replaced', async () => {
    const { project, url } = await createRun(['a'])
    const controller = new AbortController()
    const { check } = checkOf(project, url, { ...fakeLaunch().options, signal: controller.signal })
    const replace = async () => controller.abort()
    const outcome = checkedOf(await checkStory({ ...check, images: { ...check.images, replace } }))

    expect(outcome.snapshots).toHaveLength(1)
  })

  it('is stopped when its images fail to be replaced, even once its signal has aborted', async () => {
    const { project, url } = await createRun(['a'])
    const controller = new AbortController()
    const { check, imagesFolder } = checkOf(project, url, { ...fakeLaunch().options, signal: controller.signal })
    const replace = async () => {
      controller.abort()

      throw new ReportError('write', join(imagesFolder, 'a.png'), new Error('the disk is full'))
    }

    expect(await checkStory({ ...check, images: { ...check.images, replace } })).toEqual({
      result: 'stopped',
      cause: 'run',
      message:
        "visual-check couldn't write images/a.png: the disk is full. " +
        'Check that its folder is writable and the disk has room.',
      notices: [],
    })
  })

  it('ends before anything when its signal has already aborted', async () => {
    const { project, url } = await createRun(['a'])
    const { options, record } = fakeLaunch()
    const { check } = checkOf(project, url, { ...options, signal: AbortSignal.abort() })

    expect(await checkStory(check)).toEqual({ result: 'cancelled' })
    expect(record.launches).toEqual([])
  })

  it('abandons a config that never ends', async () => {
    const { project, url } = await createRun(['a'])
    const controller = new AbortController()
    const { check } = checkOf(project, url, { ...fakeLaunch().options, signal: controller.signal })

    writeFileSync(join(project, 'visual-check.config.mjs'), 'for (;;) {}\n')

    const checking = checkStory(check)

    setTimeout(() => controller.abort(), 100)
    expect(await checking).toEqual({ result: 'cancelled' })
  })

  it('abandons the Docker probe, and the next check works', async () => {
    const { project, url } = await createRun(['a'])
    const controller = new AbortController()
    const { options } = fakeLaunch()
    const probeDocker = () => {
      controller.abort()

      return new Promise<never>(() => undefined)
    }
    const { check } = checkOf(project, url, { ...options, probeDocker, signal: controller.signal })

    expect(await checkStory(check)).toEqual({ result: 'cancelled' })
    checkedOf(await checkStory(checkOf(project, url, options).check))
  })

  it('abandons a launch, and the next check gets the browser once it connects', async () => {
    const { project, url } = await createRun(['a'])
    const controller = new AbortController()
    const { options, record } = fakeLaunch()
    let connect: () => void = () => undefined
    const connected = new Promise<void>((resolve) => {
      connect = resolve
    })
    const warm = createWarmBrowser(async (launch) => {
      controller.abort()
      await connected

      return await options.launchBrowser(launch)
    })
    const { signal } = controller
    const { check } = checkOf(project, url, { ...options, launchBrowser: warm.launcherFor(signal), signal })

    expect(await checkStory(check)).toEqual({ result: 'cancelled' })
    connect()

    const next = new AbortController().signal

    checkedOf(
      await checkStory(
        checkOf(project, url, { ...options, launchBrowser: warm.launcherFor(next), signal: next }).check,
      ),
    )
    expect(record.launches).toHaveLength(1)
    await warm.close()
  })

  it.each<[string, HeldStep]>([
    ['the read of its options', 'read'],
    ['a capture', 'capture'],
  ])('stops during %s, and the next check works in the same browser', async (_what, step) => {
    let held: HeldStep | undefined = step
    const { project, url } = await createRun(['a'])
    const controller = new AbortController()
    const { options, record } = fakeLaunch({}, { read: { options: { a: twoModes } } })
    const warm = createWarmBrowser(async (launch) =>
      heldDriverOf(
        await options.launchBrowser(launch),
        (reached) => reached === held,
        () => controller.abort(),
      ),
    )
    const { signal } = controller
    const { check, replaced } = checkOf(project, url, {
      ...options,
      launchBrowser: warm.launcherFor(signal),
      signal,
    })

    expect(await checkStory(check)).toEqual({ result: 'cancelled' })
    expect(record.captures).toEqual([])
    expect(replaced).toEqual([])
    held = undefined

    const next = new AbortController().signal
    const launchBrowser = warm.launcherFor(next)
    const outcome = checkedOf(
      await checkStory(checkOf(project, url, { ...options, launchBrowser, signal: next }).check),
    )

    expect(outcome.snapshots).toHaveLength(3)
    expect(record.launches).toHaveLength(1)
    await warm.close()
  })
})
