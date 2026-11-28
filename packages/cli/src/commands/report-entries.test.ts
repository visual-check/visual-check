import { describe, expect, it } from 'vitest'
import { baselineStemOf } from '../baselines/baseline-files.js'
import type { BrokenStory } from '../capture/capture-session.js'
import type { ResolvedStorybook } from '../config/resolve-config.js'
import type { ReportBrokenDetails } from '../report/report-document.js'
import { failedLoadsHintMessageOf } from './failed-loads-hint.js'
import type { PlannedSnapshot, SnapshotToCapture } from './plan-snapshots.js'
import {
  consoleOf,
  deletedEntryOf,
  detailsOf,
  isListed,
  orphanEntryOf,
  pixelsOf,
  reportReasons,
  sizeOf,
  storyUpdateEntryOf,
  testCountsOf,
  testEntryOf,
  updateCountsOf,
  updateEntryOf,
} from './report-entries.js'
import type { ReportedComparison, SnapshotResult } from './snapshot-result.js'

const configFolder = '/project'

const storybook: ResolvedStorybook = {
  name: 'web',
  dir: '/project/web',
  configDir: '/project/web/.storybook',
  baselines: '/project/web/baselines',
  url: 'http://web.test',
}

const story = { id: 'button--primary', title: 'Button', name: 'Primary', importPath: './Button.stories.tsx' }

function itemOf(overrides: Partial<SnapshotToCapture> = {}): SnapshotToCapture {
  return {
    storybook,
    story,
    mode: undefined,
    key: 'button--primary',
    selected: true,
    options: {},
    tolerance: { color: 0.01, pixels: 20 },
    pageErrorPolicy: { check: 'fail', expected: [], storyExpected: [] },
    viewport: { width: 1280, height: 720, deviceScaleFactor: 2, touch: false },
    globals: {},
    ...overrides,
  }
}

const pixelsComparison: ReportedComparison = {
  reason: 'pixels',
  message: '84 differ, 80 allowed (20 at scale 2)',
  differ: 84,
  allowed: 80,
  baselineSize: { width: 2560, height: 1440 },
  snapshotSize: { width: 2560, height: 1440 },
}

const sizeComparison: ReportedComparison = {
  reason: 'size',
  message: 'size changed: 2560×1440 → 2560×1500',
  differ: 15_360,
  allowed: 80,
  baselineSize: { width: 2560, height: 1440 },
  snapshotSize: { width: 2560, height: 1500 },
}

const images = {
  baseline: 'images/web/button--primary.baseline.png',
  snapshot: 'images/web/button--primary.snapshot.png',
  diff: 'images/web/button--primary.diff.png',
}

const noImages = { baseline: null, snapshot: null, diff: null }

const entryKeys = [
  'storybook',
  'id',
  'kind',
  'story',
  'importPath',
  'mode',
  'status',
  'reason',
  'message',
  'flaky',
  'attempts',
  'pixels',
  'size',
  'details',
  'hints',
  'console',
  'pageErrors',
  'staleExpectedPageErrors',
  'baseline',
  'images',
]

const updateEntryKeys = [...entryKeys, 'realRequestHosts', 'remoteContentHosts']

const differsResult: SnapshotResult = {
  status: 'differs',
  detail: `differs: ${pixelsComparison.message}`,
  attempts: 3,
  pageErrors: [],
  staleExpectedPageErrors: [],
  comparison: pixelsComparison,
  console: [{ kind: 'console.log', text: 'rendered' }],
  images,
}

const flakyResult: SnapshotResult = {
  status: 'passed',
  detail: '120 ms · flaky',
  flaky: true,
  attempts: 3,
  pageErrors: [],
  staleExpectedPageErrors: [],
  comparison: pixelsComparison,
  console: [],
  images,
}

const brokenStory: BrokenStory = {
  reason: 'play-threw',
  message: "The story's play function threw Error: Boom.",
  errorText: 'Error: Boom',
  stack: ['at play (a.ts:1:1)'],
}

const loadFailed: BrokenStory = {
  reason: 'load-failed',
  message: "The stories file ./Button.stories.tsx didn't load.",
  loadError: 'SyntaxError: Unexpected token',
  readyTimeoutMs: undefined,
}

const brokenItem: PlannedSnapshot = {
  storybook,
  story,
  mode: undefined,
  key: 'button--primary',
  selected: true,
  broken: loadFailed,
}

describe('isListed', () => {
  it('lists anything but a plain pass and a kept baseline, and a flaky pass', () => {
    const listed = (status: SnapshotResult['status'], flaky?: boolean): boolean =>
      isListed({
        status,
        detail: '',
        attempts: 1,
        pageErrors: [],
        staleExpectedPageErrors: [],
        ...(flaky === undefined ? {} : { flaky }),
      })

    expect(listed('passed')).toBe(false)
    expect(listed('passed', true)).toBe(true)
    expect(listed('differs')).toBe(true)
    expect(listed('missing')).toBe(true)
    expect(listed('broken')).toBe(true)
    expect(listed('written')).toBe(true)
    expect(listed('kept')).toBe(false)
    expect(listed('kept', true)).toBe(false)
  })

  it('lists a pass with page errors or stale expected page errors, never a kept baseline', () => {
    const passed: SnapshotResult = {
      status: 'passed',
      detail: '',
      attempts: 1,
      pageErrors: [],
      staleExpectedPageErrors: [],
    }
    const pageErrors = [{ kind: 'console.error' as const, text: 'Boom', severity: 'warn' as const }]

    expect(isListed({ ...passed, pageErrors })).toBe(true)
    expect(isListed({ ...passed, staleExpectedPageErrors: ['"Boom"'] })).toBe(true)
    expect(isListed({ ...passed, status: 'kept', pageErrors, staleExpectedPageErrors: ['"Boom"'] })).toBe(false)
  })
})

describe('testEntryOf', () => {
  it('describes a snapshot that differs by pixels, with its images, console and the first capture message', () => {
    expect(testEntryOf(itemOf(), differsResult, configFolder)).toStrictEqual({
      storybook: 'web',
      id: 'button--primary',
      kind: 'story',
      story: 'button--primary',
      importPath: './Button.stories.tsx',
      mode: null,
      status: 'differs',
      reason: 'pixels',
      message: '84 differ, 80 allowed (20 at scale 2)',
      flaky: false,
      attempts: 3,
      pixels: { differ: 84, allowed: 80, budget: 20, scale: 2 },
      size: null,
      details: null,
      hints: [],
      console: [{ level: 'log', text: 'rendered' }],
      pageErrors: [],
      staleExpectedPageErrors: [],
      baseline: 'web/baselines/button--primary.png',
      images,
    })
  })

  it('describes a size difference with both sizes', () => {
    const entry = testEntryOf(itemOf(), { ...differsResult, comparison: sizeComparison }, configFolder)

    expect(entry).toMatchObject({
      status: 'differs',
      reason: 'size',
      message: 'size changed: 2560×1440 → 2560×1500',
      pixels: { differ: 15_360, allowed: 80, budget: 20, scale: 2 },
      size: { baseline: [2560, 1440], snapshot: [2560, 1500] },
    })
  })

  it('gives a remote content hint with its hosts and message', () => {
    const entry = testEntryOf(itemOf(), { ...differsResult, hintHosts: ['a.com', 'b.com'] }, configFolder)

    expect(entry.hints).toEqual([
      {
        kind: 'remote-content',
        hosts: ['a.com', 'b.com'],
        message:
          'Differs only inside remote content from a.com and b.com. A CDN can serve different bytes to different ' +
          "machines. Mask it by host: { host: 'a.com' }, { host: 'b.com' }. " +
          'See https://visual-check.vercel.app/docs/remote-content',
      },
    ])
  })

  it("gives a failed loads hint with the files of a broken story whose page couldn't load Storybook's files", () => {
    const failedLoads = [
      { url: 'http://localhost:6006/assets/card.stories-B0zV1TVO.js', error: 'net::ERR_EMPTY_RESPONSE' },
    ]
    const result: SnapshotResult = {
      status: 'broken',
      detail: '',
      attempts: 1,
      pageErrors: [],
      staleExpectedPageErrors: [],
      broken: { reason: 'timeout', message: 'Not ready.', readyTimeoutMs: 10_000, failedLoads },
    }

    expect(testEntryOf(itemOf(), result, configFolder).hints).toEqual([
      { kind: 'failed-loads', files: failedLoads, message: failedLoadsHintMessageOf() },
    ])
  })

  it('gives no failed loads hint to a broken story without any', () => {
    const result: SnapshotResult = {
      status: 'broken',
      detail: '',
      attempts: 1,
      pageErrors: [],
      staleExpectedPageErrors: [],
      broken: brokenStory,
    }

    expect(testEntryOf(itemOf(), result, configFolder).hints).toEqual([])
  })

  it('lists the page errors of a pass, a load with its load error, and its stale expected page errors', () => {
    const result: SnapshotResult = {
      status: 'passed',
      detail: '',
      attempts: 1,
      pageErrors: [
        { kind: 'console.error', text: 'Failed to fetch', severity: 'fail' },
        { kind: 'load', text: 'http://web.test/api', loadError: 'HTTP 500', severity: 'fail' },
      ],
      staleExpectedPageErrors: ['"gone"', '/timeout/i'],
    }
    const entry = testEntryOf(itemOf(), result, configFolder)

    expect(entry).toMatchObject({
      status: 'passed',
      message: 'Passed.',
      pageErrors: [
        { kind: 'console.error', text: 'Failed to fetch', severity: 'fail' },
        { kind: 'load', text: 'http://web.test/api', loadError: 'HTTP 500', severity: 'fail' },
      ],
      staleExpectedPageErrors: ['"gone"', '/timeout/i'],
    })
    expect(Object.keys(entry.pageErrors[0] ?? {})).toEqual(['kind', 'text', 'severity'])
  })

  it("describes a flaky pass by the retry that passed, with the first capture's comparison and images", () => {
    expect(testEntryOf(itemOf(), flakyResult, configFolder)).toMatchObject({
      status: 'passed',
      reason: null,
      message: 'Passed on retry 2 after its first capture differed: 84 differ, 80 allowed (20 at scale 2)',
      flaky: true,
      attempts: 3,
      pixels: { differ: 84, allowed: 80, budget: 20, scale: 2 },
      images,
    })
  })

  it('describes a plain pass with nothing to show', () => {
    expect(
      testEntryOf(
        itemOf(),
        { status: 'passed', detail: '120 ms', attempts: 1, pageErrors: [], staleExpectedPageErrors: [], console: [] },
        configFolder,
      ),
    ).toMatchObject({
      status: 'passed',
      reason: null,
      message: 'Passed.',
      flaky: false,
      attempts: 1,
      pixels: null,
      size: null,
      details: null,
      images: noImages,
    })
  })

  it('describes a missing baseline with no capture and no images', () => {
    expect(
      testEntryOf(
        itemOf(),
        {
          status: 'missing',
          detail: 'missing: no baseline yet',
          attempts: 0,
          pageErrors: [],
          staleExpectedPageErrors: [],
        },
        configFolder,
      ),
    ).toMatchObject({
      status: 'missing',
      reason: null,
      message: 'No baseline yet. Run visual-check update to write it.',
      attempts: 0,
      pixels: null,
      console: [],
      images: noImages,
    })
  })

  it("describes a broken story by its reason, details, console and its page's image", () => {
    const result: SnapshotResult = {
      status: 'broken',
      detail: `broken: ${brokenStory.message}`,
      attempts: 1,
      pageErrors: [],
      staleExpectedPageErrors: [],
      broken: brokenStory,
      console: [{ kind: 'error', text: 'Error: Boom' }],
      images: { baseline: null, snapshot: 'images/web/button--primary.snapshot.png', diff: null },
    }

    expect(testEntryOf(itemOf(), result, configFolder)).toMatchObject({
      status: 'broken',
      reason: 'play-threw',
      message: "The story's play function threw Error: Boom.",
      attempts: 1,
      pixels: null,
      details: { play: { message: 'Error: Boom', stack: ['at play (a.ts:1:1)'] } },
      console: [{ level: 'error', text: 'Uncaught Error: Boom' }],
      images: { baseline: null, snapshot: 'images/web/button--primary.snapshot.png', diff: null },
    })
  })

  it("describes a story whose stories file didn't load, with no attempt and its load error alone", () => {
    const entry = testEntryOf(
      brokenItem,
      { status: 'broken', detail: '', attempts: 0, pageErrors: [], staleExpectedPageErrors: [], broken: loadFailed },
      configFolder,
    )

    expect(entry).toMatchObject({ status: 'broken', reason: 'load-failed', attempts: 0, console: [] })
    expect(entry.details).toStrictEqual({ loadError: 'SyntaxError: Unexpected token' })
  })

  it("names a mode's snapshot by its key and mode", () => {
    const entry = testEntryOf(itemOf({ mode: 'dark', key: 'button--primary.dark' }), differsResult, configFolder)

    expect(entry).toMatchObject({
      id: 'button--primary.dark',
      story: 'button--primary',
      mode: 'dark',
      baseline: 'web/baselines/button--primary.dark.png',
    })
  })

  it('keeps the full key as the id while the baseline path has the shortened stem', () => {
    const key = `button--primary.${'m'.repeat(300)}`
    const entry = testEntryOf(itemOf({ mode: 'm'.repeat(300), key }), differsResult, configFolder)

    expect(entry.id).toBe(key)
    expect(entry.baseline).toBe(`web/baselines/${baselineStemOf(key)}.png`)
    expect(baselineStemOf(key)).not.toBe(key)
  })

  it.each<[string, SnapshotResult]>([
    ['passed', { status: 'passed', detail: '', attempts: 1, pageErrors: [], staleExpectedPageErrors: [] }],
    ['passed flaky', flakyResult],
    ['differs', differsResult],
    ['missing', { status: 'missing', detail: '', attempts: 0, pageErrors: [], staleExpectedPageErrors: [] }],
    [
      'broken',
      { status: 'broken', detail: '', attempts: 0, pageErrors: [], staleExpectedPageErrors: [], broken: loadFailed },
    ],
  ])('builds the keys of a %s entry in the order of the document', (_, result) => {
    expect(Object.keys(testEntryOf(itemOf(), result, configFolder))).toEqual(entryKeys)
  })

  it("rejects an update's result", () => {
    expect(() =>
      testEntryOf(
        itemOf(),
        { status: 'kept', detail: 'kept', attempts: 1, pageErrors: [], staleExpectedPageErrors: [] },
        configFolder,
      ),
    ).toThrow()
  })
})

describe('orphanEntryOf', () => {
  it('describes an orphan by its stem, with its copied baseline and no story', () => {
    const path = '/project/web/baselines/old--story.png'
    const entry = orphanEntryOf(storybook, path, configFolder, 'images/web/old--story.baseline.png')

    expect(entry).toStrictEqual({
      storybook: 'web',
      id: 'old--story',
      kind: 'story',
      story: null,
      importPath: null,
      mode: null,
      status: 'orphan',
      reason: null,
      message: 'No story calls for web/baselines/old--story.png. Run visual-check update to delete it.',
      flaky: false,
      attempts: 0,
      pixels: null,
      size: null,
      details: null,
      hints: [],
      console: [],
      pageErrors: [],
      staleExpectedPageErrors: [],
      baseline: 'web/baselines/old--story.png',
      images: { baseline: 'images/web/old--story.baseline.png', snapshot: null, diff: null },
    })
    expect(Object.keys(entry)).toEqual(entryKeys)
  })

  it('has no image when its baseline was not copied', () => {
    expect(orphanEntryOf(storybook, '/project/web/baselines/a.png', configFolder, null).images).toEqual(noImages)
  })
})

describe('updateEntryOf', () => {
  const hosts = { requests: ['api.test'], remoteContent: ['cdn.test'] }

  it('describes a baseline written for a missing one, with the hosts of its first load', () => {
    const result: SnapshotResult = {
      status: 'written',
      detail: 'written: missing',
      attempts: 2,
      pageErrors: [],
      staleExpectedPageErrors: [],
      writtenFor: 'missing',
      hosts,
      console: [{ kind: 'console.warn', text: 'careful' }],
    }

    expect(updateEntryOf(itemOf(), result, configFolder)).toStrictEqual({
      storybook: 'web',
      id: 'button--primary',
      kind: 'story',
      story: 'button--primary',
      importPath: './Button.stories.tsx',
      mode: null,
      status: 'written',
      reason: 'missing',
      message: 'Written: missing',
      flaky: false,
      attempts: 2,
      pixels: null,
      size: null,
      details: null,
      hints: [],
      console: [{ level: 'warn', text: 'careful' }],
      pageErrors: [],
      staleExpectedPageErrors: [],
      baseline: 'web/baselines/button--primary.png',
      images: noImages,
      realRequestHosts: ['api.test'],
      remoteContentHosts: ['cdn.test'],
    })
  })

  it("describes a baseline written over one that differed, flaky, with the first load's comparison", () => {
    const result: SnapshotResult = {
      status: 'written',
      detail: 'written: differs: 84 differ, 80 allowed (20 at scale 2) · flaky',
      flaky: true,
      attempts: 3,
      pageErrors: [],
      staleExpectedPageErrors: [],
      writtenFor: 'differs',
      comparison: pixelsComparison,
      hosts,
      console: [],
    }

    expect(updateEntryOf(itemOf(), result, configFolder)).toMatchObject({
      status: 'written',
      reason: 'differs',
      message: 'Written: differs: 84 differ, 80 allowed (20 at scale 2)',
      flaky: true,
      attempts: 3,
      pixels: { differ: 84, allowed: 80, budget: 20, scale: 2 },
    })
  })

  it('describes a broken story with no hosts', () => {
    const unstable: BrokenStory = { reason: 'unstable', message: "No two of the story's 3 loads agreed." }
    const entry = updateEntryOf(
      itemOf(),
      { status: 'broken', detail: '', attempts: 3, pageErrors: [], staleExpectedPageErrors: [], broken: unstable },
      configFolder,
    )

    expect(entry).toMatchObject({
      status: 'broken',
      reason: 'unstable',
      message: "No two of the story's 3 loads agreed.",
      attempts: 3,
      details: {},
      realRequestHosts: [],
      remoteContentHosts: [],
    })
  })

  it.each<[string, SnapshotResult]>([
    [
      'written',
      {
        status: 'written',
        detail: '',
        attempts: 2,
        pageErrors: [],
        staleExpectedPageErrors: [],
        writtenFor: 'missing',
      },
    ],
    [
      'broken',
      { status: 'broken', detail: '', attempts: 0, pageErrors: [], staleExpectedPageErrors: [], broken: loadFailed },
    ],
  ])('builds the keys of a %s entry in the order of the document', (_, result) => {
    expect(Object.keys(updateEntryOf(itemOf(), result, configFolder))).toEqual(updateEntryKeys)
  })

  it("rejects a test's result and a kept baseline", () => {
    expect(() =>
      updateEntryOf(
        itemOf(),
        { status: 'kept', detail: 'kept', attempts: 1, pageErrors: [], staleExpectedPageErrors: [] },
        configFolder,
      ),
    ).toThrow()
    expect(() => updateEntryOf(itemOf(), differsResult, configFolder)).toThrow()
  })

  it('rejects a baseline written within tolerance, which only the addon writes', () => {
    const result: SnapshotResult = {
      status: 'written',
      detail: '',
      attempts: 2,
      pageErrors: [],
      staleExpectedPageErrors: [],
      writtenFor: 'within-tolerance',
    }

    expect(() => updateEntryOf(itemOf(), result, configFolder)).toThrow(
      'An update report has no snapshot written within tolerance.',
    )
  })
})

describe('storyUpdateEntryOf', () => {
  const hosts = { requests: ['api.test'], remoteContent: ['cdn.test'] }

  it.each([
    ['missing', { writtenFor: 'missing' }, 'Written: missing'],
    ['within-tolerance', { writtenFor: 'within-tolerance' }, 'Written: within tolerance'],
    [
      'differs',
      { writtenFor: 'differs', comparison: pixelsComparison },
      'Written: differs: 84 differ, 80 allowed (20 at scale 2)',
    ],
  ] as const)('describes a baseline written for %s, with the hosts of its first load', (reason, fields, message) => {
    const result: SnapshotResult = {
      status: 'written',
      detail: '',
      attempts: 2,
      pageErrors: [],
      staleExpectedPageErrors: [],
      hosts,
      ...fields,
    }
    const entry = storyUpdateEntryOf(itemOf(), result, configFolder)

    expect(entry).toMatchObject({
      status: 'written',
      reason,
      message,
      baseline: 'web/baselines/button--primary.png',
      realRequestHosts: ['api.test'],
      remoteContentHosts: ['cdn.test'],
    })
    expect(Object.keys(entry)).toEqual(updateEntryKeys)
  })

  it('describes a baseline identical to the capture as untouched, flaky when its loads disagreed', () => {
    const result: SnapshotResult = {
      status: 'kept',
      detail: 'kept: identical · flaky',
      attempts: 3,
      pageErrors: [],
      staleExpectedPageErrors: [],
      flaky: true,
      hosts,
    }

    expect(storyUpdateEntryOf(itemOf(), result, configFolder)).toMatchObject({
      status: 'kept',
      reason: null,
      message: 'Untouched: identical, byte for byte',
      flaky: true,
      attempts: 3,
      pixels: null,
      realRequestHosts: ['api.test'],
    })
  })

  it('describes a broken story with its reason and no hosts', () => {
    const result: SnapshotResult = {
      status: 'broken',
      detail: '',
      attempts: 1,
      pageErrors: [],
      staleExpectedPageErrors: [],
      broken: brokenStory,
    }

    expect(storyUpdateEntryOf(itemOf(), result, configFolder)).toMatchObject({
      status: 'broken',
      reason: 'play-threw',
      message: brokenStory.message,
      details: { play: { message: 'Error: Boom', stack: ['at play (a.ts:1:1)'] } },
      realRequestHosts: [],
      remoteContentHosts: [],
    })
  })

  it("rejects a test's result", () => {
    expect(() => storyUpdateEntryOf(itemOf(), differsResult, configFolder)).toThrow(
      "The addon's Update has no differs snapshot.",
    )
  })
})

describe('deletedEntryOf', () => {
  it('describes a deleted baseline by its stem, with no story and no hosts', () => {
    const entry = deletedEntryOf(storybook, '/project/web/baselines/old--story.png', configFolder)

    expect(entry).toMatchObject({
      id: 'old--story',
      story: null,
      importPath: null,
      mode: null,
      status: 'deleted',
      reason: null,
      message: 'Deleted: no story calls for it.',
      attempts: 0,
      baseline: 'web/baselines/old--story.png',
      images: noImages,
      realRequestHosts: [],
      remoteContentHosts: [],
    })
    expect(Object.keys(entry)).toEqual(updateEntryKeys)
  })
})

describe('testCountsOf', () => {
  it('counts each status, flaky passes among the passed, and the orphans', () => {
    const results: SnapshotResult[] = [
      { status: 'passed', detail: '', attempts: 1, pageErrors: [], staleExpectedPageErrors: [] },
      flakyResult,
      differsResult,
      { status: 'broken', detail: '', attempts: 1, pageErrors: [], staleExpectedPageErrors: [] },
      { status: 'missing', detail: '', attempts: 0, pageErrors: [], staleExpectedPageErrors: [] },
      { status: 'missing', detail: '', attempts: 0, pageErrors: [], staleExpectedPageErrors: [] },
    ]

    expect(testCountsOf(results, 3)).toStrictEqual({
      passed: 2,
      flaky: 1,
      differs: 1,
      broken: 1,
      missing: 2,
      orphan: 3,
    })
  })
})

describe('updateCountsOf', () => {
  it('counts written, deleted, kept and broken, and the flaky ones written or kept', () => {
    const results: SnapshotResult[] = [
      { status: 'written', detail: '', attempts: 2, pageErrors: [], staleExpectedPageErrors: [] },
      { status: 'written', detail: '', attempts: 3, pageErrors: [], staleExpectedPageErrors: [], flaky: true },
      { status: 'kept', detail: '', attempts: 1, pageErrors: [], staleExpectedPageErrors: [] },
      { status: 'kept', detail: '', attempts: 2, pageErrors: [], staleExpectedPageErrors: [], flaky: true },
      { status: 'broken', detail: '', attempts: 3, pageErrors: [], staleExpectedPageErrors: [] },
    ]

    expect(updateCountsOf(results, 4)).toStrictEqual({ written: 2, deleted: 4, kept: 2, broken: 1, flaky: 2 })
  })
})

describe('pixelsOf', () => {
  it('gives the budget exactly as written', () => {
    expect(pixelsOf(pixelsComparison, { color: 0.01, pixels: '0.1%' }, 1)).toStrictEqual({
      differ: 84,
      allowed: 80,
      budget: '0.1%',
      scale: 1,
    })
  })
})

describe('sizeOf', () => {
  it('gives both sizes of a size difference, and nothing for a difference in pixels', () => {
    expect(sizeOf(sizeComparison)).toStrictEqual({ baseline: [2560, 1440], snapshot: [2560, 1500] })
    expect(sizeOf(pixelsComparison)).toBeNull()
  })
})

describe('detailsOf', () => {
  it.each([
    [
      'navigated-away',
      { reason: 'navigated-away', message: '', url: 'http://web.test/other' },
      { url: 'http://web.test/other' },
    ],
    ['play-threw', brokenStory, { play: { message: 'Error: Boom', stack: ['at play (a.ts:1:1)'] } }],
    [
      'play-threw with no error text',
      { reason: 'play-threw', message: "The story's play function threw an error.", errorText: '', stack: [] },
      { play: { message: "The story's play function threw an error.", stack: [] } },
    ],
    ['timeout', { reason: 'timeout', message: '', readyTimeoutMs: 15_000 }, { timeoutMs: 15_000 }],
    [
      'fonts-not-loaded',
      { reason: 'fonts-not-loaded', message: '', faces: ['Inter normal normal'], readyTimeoutMs: 15_000 },
      { timeoutMs: 15_000, pendingFonts: ['Inter normal normal'] },
    ],
    ['too-tall', { reason: 'too-tall', message: '', size: { width: 1280, height: 40_000 } }, { size: [1280, 40_000] }],
    [
      'grid-too-wide',
      { reason: 'grid-too-wide', message: '', grid: { width: 1400, viewportWidth: 1280 } },
      { grid: { width: 1400, viewportWidth: 1280 } },
    ],
    [
      'overflows',
      {
        reason: 'overflows',
        message: '',
        overflow: { area: 'element', top: 12, right: 197, bottom: 30, left: 4, viewportWidth: 1280 },
      },
      { overflow: { area: 'element', top: 12, right: 197, bottom: 30, left: 4, viewportWidth: 1280 } },
    ],
    [
      'load-failed that timed out',
      { reason: 'load-failed', message: '', loadError: undefined, readyTimeoutMs: 15_000 },
      { timeoutMs: 15_000 },
    ],
    ['load-failed', loadFailed, { loadError: 'SyntaxError: Unexpected token' }],
    ['error', { reason: 'error', message: 'The story threw' }, {}],
  ] satisfies [string, BrokenStory, ReportBrokenDetails][])('keeps only the details of %s', (_, broken, details) => {
    const kept = detailsOf(broken)

    expect(kept).toStrictEqual(details)
    expect(Object.keys(kept)).toEqual(Object.keys(details))
  })
})

describe('consoleOf', () => {
  it('maps each kind to its level, prefixing uncaught errors and unhandled rejections', () => {
    expect(
      consoleOf([
        { kind: 'console.debug', text: 'd' },
        { kind: 'console.info', text: 'i' },
        { kind: 'console.log', text: 'l' },
        { kind: 'console.warn', text: 'w' },
        { kind: 'console.error', text: 'e' },
        { kind: 'error', text: 'TypeError: x is undefined' },
        { kind: 'unhandledrejection', text: 'Error: nope' },
      ]),
    ).toStrictEqual([
      { level: 'debug', text: 'd' },
      { level: 'info', text: 'i' },
      { level: 'log', text: 'l' },
      { level: 'warn', text: 'w' },
      { level: 'error', text: 'e' },
      { level: 'error', text: 'Uncaught TypeError: x is undefined' },
      { level: 'error', text: 'Unhandled rejection: Error: nope' },
    ])
  })
})

describe('reportReasons', () => {
  it('maps each reason to the same code', () => {
    for (const [reason, code] of Object.entries(reportReasons)) {
      expect(code).toBe(reason)
    }
  })
})
