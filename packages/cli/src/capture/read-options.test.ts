import { describe, expect, it } from 'vitest'
import { optionsReadAnswer } from '../storybook/options-read.fixture.js'
import { optionsReadExpression, type StoriesFile } from '../storybook/options-read.js'
import { minimumText, newestSupportedMajor } from '../storybook/storybook-version.js'
import { type CaptureSettings, pageSetupOf } from './capture-session.js'
import { BrowserExitedError, PageTimeoutError } from './driver/driver.js'
import { FakeDriver, type FakePageBehaviour } from './fake-driver.fixture.js'
import { type OptionsRequest, readStoryOptions } from './read-options.js'

/**
 * The settings every read runs with.
 */
const settings: CaptureSettings = {
  readyTimeoutMs: 15_000,
  timezone: 'Europe/Warsaw',
  locale: 'pl-PL',
  colorScheme: 'dark',
  maskColor: '#FF00FF',
  listHosts: true,
  brokenImageTimeLimitMs: 5_000,
}

/**
 * The stories files every read asks for.
 */
const files: StoriesFile[] = [{ importPath: './src/button.stories.ts', storyIds: ['button--primary', 'button--link'] }]

/**
 * The request every read makes.
 */
const request: OptionsRequest = {
  storybookName: 'web',
  previewUrl: 'http://127.0.0.1:6006/iframe.html?viewMode=story',
  files,
}

/**
 * Reads with a driver whose first page behaves as given, and gives the result with the driver. The read asks for
 * `request` by default.
 */
async function readWith(
  page: FakePageBehaviour = {},
  asked: OptionsRequest = request,
): Promise<{ driver: FakeDriver; read: unknown }> {
  const driver = new FakeDriver({ pages: [page] })

  return { driver, read: await readStoryOptions(driver, settings, asked) }
}

/**
 * The problem an answer that doesn't match what the read asked for gives, after what's wrong with it.
 */
function mismatchProblemOf(mismatch: string): { problem: string } {
  return {
    problem:
      "The page's answer to visual-check's read of Storybook web's per-story options doesn't match what it asked " +
      `for: ${mismatch}. Run visual-check again, and report it if it keeps failing.`,
  }
}

/**
 * Gives an exit of the browser.
 */
function exitOf(): BrowserExitedError {
  return new BrowserExitedError({ code: 137, signal: null, error: undefined }, ['Out of memory'], false)
}

describe('readStoryOptions', () => {
  it("sets the page up as a capture page that never watches requests, and loads the preview within readyTimeout, giving the read twice that and the page's margin", async () => {
    const { driver } = await readWith()

    expect(driver.setups).toEqual([{ ...pageSetupOf(settings), watchRequests: false }])
    expect(pageSetupOf(settings).watchRequests).toBe(true)
    expect(driver.calls.map(({ method }) => method)).toEqual(['goto', 'evaluate', 'close'])
    expect(driver.calls[0]?.args).toEqual([request.previewUrl, 15_000])
    expect(driver.calls[1]?.args).toEqual([optionsReadExpression(files, 15_000), 31_000])
  })

  it('gives every file loaded, and nothing else read, by default', async () => {
    const { read } = await readWith()

    expect(read).toEqual({
      declaredGlobals: null,
      files: [
        {
          importPath: './src/button.stories.ts',
          outcome: 'loaded',
          stories: [
            { id: 'button--primary', options: undefined, pinnedGlobals: [] },
            { id: 'button--link', options: undefined, pinnedGlobals: [] },
          ],
        },
      ],
    })
  })

  it("passes the Storybook's declared globals and the files the page read through, and closes the page", async () => {
    const answer = optionsReadAnswer(
      [
        {
          importPath: './src/button.stories.ts',
          stories: [{ id: 'button--primary', options: { threshold: 0.1 }, pinnedGlobals: ['theme'] }],
        },
        { importPath: './src/broken.stories.ts', outcome: 'failed', message: 'Boom' },
        { importPath: './src/slow.stories.ts', outcome: 'timed-out' },
      ],
      ['theme', 'locale'],
    )
    const { driver, read } = await readWith(
      { optionsRead: async () => answer },
      {
        ...request,
        files: [
          { importPath: './src/button.stories.ts', storyIds: ['button--primary'] },
          { importPath: './src/broken.stories.ts', storyIds: ['broken--one', 'broken--two'] },
          { importPath: './src/slow.stories.ts', storyIds: ['slow--one'] },
        ],
      },
    )

    expect(read).toEqual({
      declaredGlobals: ['theme', 'locale'],
      files: [
        {
          importPath: './src/button.stories.ts',
          outcome: 'loaded',
          stories: [{ id: 'button--primary', options: { threshold: 0.1 }, pinnedGlobals: ['theme'] }],
        },
        { importPath: './src/broken.stories.ts', outcome: 'failed', message: 'Boom' },
        { importPath: './src/slow.stories.ts', outcome: 'timed-out' },
      ],
    })
    expect(driver.methods()).toEqual(['1:goto', '1:evaluate', '1:close'])
  })

  it.each([
    [
      'the preview never started',
      { outcome: 'timed-out', step: 'preview-start' },
      "Storybook web's preview never started at http://127.0.0.1:6006/iframe.html?viewMode=story within readyTimeout (15000 ms). Open it to see why, or raise readyTimeout.",
    ],
    [
      'the preview never became ready',
      { outcome: 'timed-out', step: 'preview-ready' },
      "Storybook web's preview started at http://127.0.0.1:6006/iframe.html?viewMode=story but never became ready within readyTimeout (15000 ms). Open it to see why, or raise readyTimeout.",
    ],
    [
      'the preview failed with a message',
      { outcome: 'preview-failed', message: 'The index failed to load' },
      "Storybook web's preview failed to load: The index failed to load. Open http://127.0.0.1:6006/iframe.html?viewMode=story to see the error, then fix what Storybook reports.",
    ],
    [
      'the preview failed with a message that ends with a period',
      { outcome: 'preview-failed', message: 'Boom.' },
      "Storybook web's preview failed to load: Boom. Open http://127.0.0.1:6006/iframe.html?viewMode=story to see the error, then fix what Storybook reports.",
    ],
    [
      'the preview failed with no message',
      { outcome: 'preview-failed', message: '' },
      "Storybook web's preview failed to load. Open http://127.0.0.1:6006/iframe.html?viewMode=story to see the error, then fix what Storybook reports.",
    ],
    [
      'the preview has no loadStory',
      { outcome: 'unsupported' },
      `Storybook web's preview has no loadStory, so visual-check can't read its per-story options. Check that its version is one visual-check supports, ${minimumText} to ${newestSupportedMajor}.x.`,
    ],
    [
      'the page script is missing',
      { outcome: 'script-missing' },
      "visual-check's page script didn't run in the preview's page, so it couldn't read Storybook web's per-story options. Run visual-check again, and report it if it keeps failing.",
    ],
    [
      'the answer is not one the page gives',
      { outcome: 'nonsense' },
      `visual-check couldn't read Storybook web's per-story options: The options read in the page gave an answer visual-check doesn't know: {"outcome":"nonsense"}. Run visual-check again, and report it if it keeps failing.`,
    ],
  ])('gives a problem when %s, and closes the page', async (_name, answer, problem) => {
    const { driver, read } = await readWith({ optionsRead: async () => answer })

    expect(read).toEqual({ problem })
    expect(driver.methods()).toEqual(['1:goto', '1:evaluate', '1:close'])
  })

  it.each([
    ['leaves out a file', [], 'it left out the stories file ./src/button.stories.ts'],
    [
      'leaves out a story of a file that loaded',
      [{ importPath: './src/button.stories.ts', stories: [{ id: 'button--primary', options: undefined }] }],
      'it left out the story button--link of ./src/button.stories.ts',
    ],
    [
      'gives a file it was not asked for',
      [
        {
          importPath: './src/button.stories.ts',
          stories: [
            { id: 'button--primary', options: undefined },
            { id: 'button--link', options: undefined },
          ],
        },
        { importPath: './src/other.stories.ts', outcome: 'timed-out' as const },
      ],
      "it gave the stories file ./src/other.stories.ts, which visual-check didn't ask for",
    ],
    [
      'gives a story it was not asked for',
      [
        {
          importPath: './src/button.stories.ts',
          stories: [
            { id: 'button--primary', options: undefined },
            { id: 'button--link', options: undefined },
            { id: 'button--ghost', options: undefined },
          ],
        },
      ],
      "it gave the story button--ghost of ./src/button.stories.ts, which visual-check didn't ask for",
    ],
    [
      'gives a file twice',
      [
        { importPath: './src/button.stories.ts', outcome: 'timed-out' as const },
        { importPath: './src/button.stories.ts', outcome: 'timed-out' as const },
      ],
      'it gave the stories file ./src/button.stories.ts twice',
    ],
  ])('gives a problem when the answer %s, and closes the page', async (_name, answer, mismatch) => {
    const { driver, read } = await readWith({ optionsRead: async () => optionsReadAnswer(answer) })

    expect(read).toEqual(mismatchProblemOf(mismatch))
    expect(driver.methods()).toEqual(['1:goto', '1:evaluate', '1:close'])
  })

  it('takes a file that failed to load with none of its stories, and in another order than asked', async () => {
    const asked: OptionsRequest = {
      ...request,
      files: [
        { importPath: './src/a.stories.ts', storyIds: ['a--one'] },
        { importPath: './src/b.stories.ts', storyIds: ['b--one'] },
      ],
    }
    const answer = optionsReadAnswer([
      { importPath: './src/b.stories.ts', stories: [{ id: 'b--one', options: undefined }] },
      { importPath: './src/a.stories.ts', outcome: 'failed', message: 'Boom' },
    ])
    const { read } = await readWith({ optionsRead: async () => answer }, asked)

    expect(read).toEqual({
      declaredGlobals: null,
      files: [
        {
          importPath: './src/b.stories.ts',
          outcome: 'loaded',
          stories: [{ id: 'b--one', options: undefined, pinnedGlobals: [] }],
        },
        { importPath: './src/a.stories.ts', outcome: 'failed', message: 'Boom' },
      ],
    })
  })

  it('gives a problem when the page cannot be opened', async () => {
    const driver = new FakeDriver({
      newPage: async () => {
        throw new Error('Too many pages')
      },
    })

    expect(await readStoryOptions(driver, settings, request)).toEqual({
      problem:
        "visual-check couldn't open a page to read Storybook web's per-story options: Too many pages. Run visual-check again, and report it if it keeps failing.",
    })
  })

  it('gives a problem when the preview cannot be loaded, and closes the page', async () => {
    const { driver, read } = await readWith({
      goto: async () => {
        throw new Error('net::ERR_CONNECTION_REFUSED')
      },
    })

    expect(read).toEqual({
      problem: `visual-check couldn't load Storybook web's preview at ${request.previewUrl}: net::ERR_CONNECTION_REFUSED. Check that Storybook is running there, or restart it.`,
    })
    expect(driver.methods()).toEqual(['1:goto', '1:close'])
  })

  it('gives a problem naming readyTimeout when the preview takes too long to load', async () => {
    const { driver, read } = await readWith({
      goto: async () => {
        throw new PageTimeoutError('Navigation timed out', 15_000)
      },
    })

    expect(read).toEqual({
      problem: `Storybook web's preview at ${request.previewUrl} didn't load within readyTimeout (15000 ms). Open it to see why, or raise readyTimeout.`,
    })
    expect(driver.methods()).toEqual(['1:goto', '1:close'])
  })

  it('gives a problem naming readyTimeout when the page stops answering', async () => {
    const { driver, read } = await readWith({
      optionsRead: async () => {
        throw new PageTimeoutError('The page stopped answering', 31_000)
      },
    })

    expect(read).toEqual({
      problem: `Storybook web's preview stopped answering while visual-check read its per-story options, within readyTimeout (15000 ms). Open ${request.previewUrl} to see why, or raise readyTimeout.`,
    })
    expect(driver.methods()).toEqual(['1:goto', '1:evaluate', '1:close'])
  })

  it('gives a problem when the read fails in the page another way, and closes the page', async () => {
    const { driver, read } = await readWith({
      optionsRead: async () => {
        throw new Error('The page crashed')
      },
    })

    expect(read).toEqual({
      problem:
        "visual-check couldn't read Storybook web's per-story options: The page crashed. Run visual-check again, and report it if it keeps failing.",
    })
    expect(driver.methods()).toEqual(['1:goto', '1:evaluate', '1:close'])
  })

  it.each([
    ['a failure', new Error('The page is gone')],
    ['an exit of the browser', exitOf()],
  ])("ignores %s closing the page, and the read's result stands", async (_name, failure) => {
    const { read } = await readWith({
      close: async () => {
        throw failure
      },
    })

    expect(read).toHaveProperty('files')
  })

  it('rethrows the exit when the browser exits as the page opens', async () => {
    const exit = exitOf()
    const driver = new FakeDriver({
      newPage: async () => {
        throw exit
      },
    })

    await expect(readStoryOptions(driver, settings, request)).rejects.toBe(exit)
  })

  it.each([
    ['loads the preview', 'goto'],
    ['reads the options', 'optionsRead'],
  ] as const)('rethrows the exit, closing no page, when the browser exits as it %s', async (_name, step) => {
    const exit = exitOf()
    const fail = async (): Promise<never> => {
      throw exit
    }
    const driver = new FakeDriver({ pages: [{ [step]: fail }] })

    await expect(readStoryOptions(driver, settings, request)).rejects.toBe(exit)
    expect(driver.methods()).not.toContain('1:close')
  })
})
