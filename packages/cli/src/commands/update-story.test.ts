import { existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { BaselineError } from '../baselines/baseline-error.js'
import { writeBaseline as writeBaselineFile } from '../baselines/baseline-files.js'
import { greyPng, reencodePng } from '../visual-diff/images.fixture.js'
import {
  absentMarkerPath,
  cleanUpRuns,
  createRun,
  defaultRunSnapshot,
  type FakeBrowserRecord,
  fakeBrowser,
  hostOptions,
  otherSnapshot,
  printed,
  removeMarkerFolder,
  takeUnusedUrl,
} from './run-cli.fixture.js'
import type { StoryProgress } from './story-run.js'
import { ciUpdateRefusal } from './update-baselines.js'
import { type StoryUpdate, type UpdateOutcome, updateStory } from './update-story.js'

/**
 * The options of a story that lists two modes: `dark`, which sets a global, and `mobile`, which sets a viewport.
 */
const twoModes = { modes: { dark: { globals: { theme: 'dark' } }, mobile: { viewport: { width: 400 } } } }

/**
 * A baseline with the pixels of `defaultRunSnapshot` but other bytes, so within tolerance of it and not identical.
 */
const reencodedSnapshot = new Uint8Array(await reencodePng(defaultRunSnapshot, 9))

/**
 * What a test gives an update besides its project, and what it saw.
 */
interface UpdateSetup {
  /**
   * The update.
   */
  update: StoryUpdate
  /**
   * Every progress, in order.
   */
  progress: StoryProgress[]
}

/**
 * Builds what an update launches its fake browsers with, as `fakeBrowser` says, with what they saw.
 */
function fakeLaunch(...fake: Parameters<typeof fakeBrowser>): {
  options: Pick<StoryUpdate, 'launchBrowser'>
  record: FakeBrowserRecord
} {
  const { options, record } = fakeBrowser(...fake)

  return { options: { launchBrowser: options.launchBrowser }, record }
}

/**
 * Builds an update of story `a` of the Storybook in `project` that's served at `url`, in the fake browser
 * `launchBrowser` launches, which captures a page again at once. `overrides` replace any of it.
 */
function updateOf(
  project: string,
  url: string,
  overrides: Partial<StoryUpdate> & Pick<StoryUpdate, 'launchBrowser'>,
): UpdateSetup {
  const progress: StoryProgress[] = []

  return {
    update: {
      ...hostOptions,
      imageMarkerPath: absentMarkerPath,
      storyId: 'a',
      configDir: join(project, '.storybook'),
      url,
      cwd: project,
      environment: {},
      signal: new AbortController().signal,
      progress: (step) => progress.push(step),
      ...overrides,
    },
    progress,
  }
}

/**
 * Gives the outcome as a finished update.
 */
function updatedOf(outcome: UpdateOutcome): Extract<UpdateOutcome, { result: 'updated' }> {
  if (outcome.result !== 'updated') {
    throw new Error(`The update ended ${JSON.stringify(outcome)}.`)
  }

  return outcome
}

/**
 * Gives the bytes of every file in the folder, by its name, and none when there's no folder.
 */
function filesIn(folder: string): Record<string, Buffer> {
  if (!existsSync(folder)) {
    return {}
  }

  return Object.fromEntries(readdirSync(folder).map((name) => [name, readFileSync(join(folder, name))]))
}

afterEach(cleanUpRuns)

afterAll(removeMarkerFolder)

describe('updateStory', () => {
  it('writes each snapshot, one within tolerance too, in the planned order', async () => {
    const baselines = { a: reencodedSnapshot, 'a.dark': otherSnapshot }
    const { project, url, folder } = await createRun(['a'], baselines)
    const { options } = fakeLaunch({}, { read: { options: { a: twoModes } } })
    const outcome = updatedOf(await updateStory(updateOf(project, url, options).update))

    expect(Buffer.compare(reencodedSnapshot, defaultRunSnapshot)).not.toBe(0)
    expect(outcome).toMatchObject({ storybook: 'web', disabled: false, notices: [], warnings: [] })
    expect(outcome.snapshots).toMatchObject([
      {
        id: 'a',
        mode: null,
        status: 'written',
        reason: 'within-tolerance',
        message: 'Written: within tolerance',
        attempts: 2,
        baseline: '.visual-check/baselines/a.png',
      },
      {
        id: 'a.dark',
        mode: 'dark',
        status: 'written',
        reason: 'differs',
        pixels: { differ: 100 },
        baseline: '.visual-check/baselines/a.dark.png',
      },
      {
        id: 'a.mobile',
        mode: 'mobile',
        status: 'written',
        reason: 'missing',
        message: 'Written: missing',
        baseline: '.visual-check/baselines/a.mobile.png',
      },
    ])
    expect(filesIn(folder)).toEqual({
      'a.png': Buffer.from(defaultRunSnapshot),
      'a.dark.png': Buffer.from(defaultRunSnapshot),
      'a.mobile.png': Buffer.from(defaultRunSnapshot),
    })
  })

  it('leaves a baseline identical to the capture untouched', async () => {
    const { project, url, folder } = await createRun(['a'], { a: defaultRunSnapshot })
    const path = join(folder, 'a.png')

    utimesSync(path, 1_000_000, 1_000_000)

    const before = statSync(path).mtimeMs
    const { options } = fakeLaunch()
    const outcome = updatedOf(await updateStory(updateOf(project, url, options).update))

    expect(outcome.snapshots).toMatchObject([
      { status: 'kept', reason: null, message: 'Untouched: identical, byte for byte', attempts: 2 },
    ])
    expect(readFileSync(path)).toEqual(Buffer.from(defaultRunSnapshot))
    expect(statSync(path).mtimeMs).toBe(before)
  })

  it('writes nothing for a snapshot whose page changes after its capture, and the others still', async () => {
    const { project, url, folder } = await createRun(['a'])
    const { options } = fakeLaunch(
      { a: { snapshotLater: otherSnapshot, byGlobals: { 'theme:dark': { snapshotLater: defaultRunSnapshot } } } },
      { read: { options: { a: { modes: { dark: twoModes.modes.dark } } } } },
    )
    const outcome = updatedOf(await updateStory(updateOf(project, url, options).update))

    expect(outcome.snapshots).toMatchObject([
      { id: 'a', status: 'broken', reason: 'changed-after-capture', attempts: 1 },
      { id: 'a.dark', status: 'written', reason: 'missing' },
    ])
    expect(Object.keys(filesIn(folder))).toEqual(['a.dark.png'])
  })

  it('gives a story whose loads never agree as unstable, after 3 loads', async () => {
    const grey = new Uint8Array(await greyPng(10, 10, 128))
    const { project, url, folder } = await createRun(['a'])
    const { options } = fakeLaunch({ a: { captures: [{}, { snapshot: otherSnapshot }, { snapshot: grey }] } })
    const outcome = updatedOf(await updateStory(updateOf(project, url, options).update))

    expect(outcome.snapshots).toMatchObject([{ status: 'broken', reason: 'unstable', attempts: 3 }])
    expect(filesIn(folder)).toEqual({})
  })

  it('warns by host of the real requests, without the hosts the config silences', async () => {
    const { project, url } = await createRun(['a'], {}, "silenceHosts: ['*.silenced.test'],")
    const { options, record } = fakeLaunch({ a: { requestHosts: ['api.test', 'x.silenced.test'] } })
    const outcome = updatedOf(await updateStory(updateOf(project, url, options).update))

    expect(outcome.warnings).toEqual([
      {
        kind: 'real-requests',
        host: 'api.test',
        stories: [{ storybook: 'web', story: 'a' }],
        message: 'api.test: 1 story (a). This story makes real network requests and may be unreliable.',
      },
    ])
    expect(outcome.snapshots).toMatchObject([{ realRequestHosts: ['api.test', 'x.silenced.test'] }])
    expect(record.setups[0]?.watchRequests).toBe(false)
    expect(record.setups.slice(1).length).toBeGreaterThan(0)
    expect(record.setups.slice(1).every((setup) => setup.watchRequests)).toBe(true)
  })

  it('captures and writes nothing of a disabled story', async () => {
    const { project, url, folder } = await createRun(['a'])
    const { options, record } = fakeLaunch({}, { read: { options: { a: { disable: true } } } })

    expect(await updateStory(updateOf(project, url, options).update)).toEqual({
      result: 'updated',
      storybook: 'web',
      snapshots: [],
      disabled: true,
      notices: [],
      warnings: [],
    })
    expect(record.captures).toEqual([])
    expect(filesIn(folder)).toEqual({})
  })

  it('writes with the given writer once every snapshot is taken, in the planned order', async () => {
    const { project, url, folder } = await createRun(['a'])
    const { options } = fakeLaunch({}, { read: { options: { a: twoModes } } })
    const { update, progress } = updateOf(project, url, options)
    const writes: [string, Buffer][] = []
    const writeBaseline = async (path: string, bytes: Uint8Array) => {
      writes.push([`${path.slice(folder.length + 1)} after ${JSON.stringify(progress.at(-1))}`, Buffer.from(bytes)])
    }

    updatedOf(await updateStory({ ...update, writeBaseline }))

    const last = JSON.stringify({ step: 'capturing', finished: 3, total: 3 })
    const captured = Buffer.from(defaultRunSnapshot)

    expect(writes).toEqual([
      [`a.png after ${last}`, captured],
      [`a.dark.png after ${last}`, captured],
      [`a.mobile.png after ${last}`, captured],
    ])
    expect(filesIn(folder)).toEqual({})
  })
})

describe('updateStory stopped', () => {
  it('refuses to run with CI set, before anything', async () => {
    const { project, url, folder } = await createRun(['a'])
    const { options, record } = fakeLaunch()
    const { update, progress } = updateOf(project, url, { ...options, environment: { CI: 'true' } })

    expect(await updateStory(update)).toEqual({
      result: 'stopped',
      cause: 'run',
      message: ciUpdateRefusal,
      notices: [],
    })
    expect(progress).toEqual([])
    expect(record.launches).toEqual([])
    expect(filesIn(folder)).toEqual({})
  })

  it("gives the CLI's message when a baseline can't be written", async () => {
    const { project, url, folder } = await createRun(['a'])
    const { options } = fakeLaunch()
    const { update } = updateOf(project, url, options)
    const writeBaseline = (path: string) =>
      Promise.reject(new BaselineError('write', path, new Error('the disk is full')))

    expect(await updateStory({ ...update, writeBaseline })).toMatchObject({
      result: 'stopped',
      cause: 'run',
      message: expect.stringMatching(/^visual-check couldn't write .*a\.png: the disk is full/),
      notices: [],
    })
    expect(filesIn(folder)).toEqual({})
  })

  it("gives the CLI's message when the baselines folder is a file", async () => {
    const { project, url } = await createRun(['a'])

    writeFileSync(join(project, '.visual-check'), '')

    expect(await updateStory(updateOf(project, url, fakeLaunch().options).update)).toMatchObject({
      result: 'stopped',
      cause: 'run',
      message: expect.stringContaining('.visual-check/baselines/a.png'),
    })
  })
})

describe("updateStory's notices", () => {
  it("say that CLI runs check the config's url, and that the browser exited and was relaunched", async () => {
    const { project, url } = await createRun(['a'], {}, 'workers: 1')
    const other = 'http://127.0.0.1:1'

    writeFileSync(
      join(project, 'visual-check.config.mjs'),
      `export default { storybooks: { web: { url: '${other}' } }, workers: 1 }\n`,
    )

    const { options } = fakeLaunch(
      { a: { browserExits: true, byGlobals: { 'theme:dark': { browserExits: false } } } },
      { read: { options: { a: { modes: { dark: twoModes.modes.dark } } } } },
    )
    const outcome = updatedOf(await updateStory(updateOf(project, url, options).update))

    expect(outcome.snapshots).toMatchObject([
      { status: 'broken', reason: 'browser-exited' },
      { status: 'written', mode: 'dark' },
    ])
    expect(outcome.notices).toEqual([
      `This Storybook runs at ${url}. CLI runs check ${other}, the config's url.`,
      printed(
        'The browser was killed by signal SIGKILL while in use.',
        'visual-check relaunches it once for the rest of the run.',
        "The browser's last output:",
        '  Out of memory',
        '  bye from browser 1',
      ).trim(),
    ])
  })

  it('come with an update that stopped too', async () => {
    const { project } = await createRun(['a'])
    const url = await takeUnusedUrl()

    expect(await updateStory(updateOf(project, url, fakeLaunch().options).update)).toMatchObject({
      result: 'stopped',
      notices: [expect.stringMatching(/^This Storybook runs at /)],
    })
  })
})

describe('updateStory cancelled', () => {
  it('writes nothing when its signal aborts after the last snapshot', async () => {
    const { project, url, folder } = await createRun(['a'], { a: otherSnapshot })
    const controller = new AbortController()
    const { update } = updateOf(project, url, {
      ...fakeLaunch().options,
      signal: controller.signal,
      progress: (progress) => {
        if (progress.step === 'capturing' && progress.finished === progress.total) {
          controller.abort()
        }
      },
    })

    expect(await updateStory(update)).toEqual({ result: 'cancelled' })
    expect(filesIn(folder)).toEqual({ 'a.png': Buffer.from(otherSnapshot) })
  })

  it('writes every baseline when its signal aborts once they are being written', async () => {
    const { project, url, folder } = await createRun(['a'])
    const controller = new AbortController()
    const { options } = fakeLaunch({}, { read: { options: { a: twoModes } } })
    const { update } = updateOf(project, url, { ...options, signal: controller.signal })
    const writeBaseline = async (path: string, bytes: Uint8Array) => {
      controller.abort()
      await writeBaselineFile(path, bytes)
    }
    const outcome = updatedOf(await updateStory({ ...update, writeBaseline }))

    expect(outcome.snapshots).toHaveLength(3)
    expect(Object.keys(filesIn(folder)).sort()).toEqual(['a.dark.png', 'a.mobile.png', 'a.png'])
  })
})
