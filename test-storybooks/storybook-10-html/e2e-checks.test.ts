import type { TestReport, UpdateReport } from '@visual-check/cli'
import { describe, expect, it } from 'vitest'
import { expectedKeysOf, sameImagesProblems, testReportProblems, updateReportProblems } from './e2e-checks.ts'

/**
 * The keys of two snapshots.
 */
const keys = ['grid--a', 'grid--b']

/**
 * A `test` report in which both snapshots pass, with the given changes.
 */
function testReportOf(
  changes: Partial<Pick<TestReport, 'exitCode' | 'snapshots'>> & { counts?: Partial<TestReport['counts']> } = {},
): Pick<TestReport, 'exitCode' | 'counts' | 'snapshots'> {
  return {
    exitCode: changes.exitCode ?? 0,
    counts: { passed: 2, flaky: 0, differs: 0, broken: 0, missing: 0, orphan: 0, ...changes.counts },
    snapshots: changes.snapshots ?? [],
  }
}

/**
 * An `update` report that writes both snapshots, with the given changes.
 */
function updateReportOf(
  changes: Partial<Pick<UpdateReport, 'exitCode'>> & { counts?: Partial<UpdateReport['counts']> } = {},
): Pick<UpdateReport, 'exitCode' | 'counts'> {
  return {
    exitCode: changes.exitCode ?? 0,
    counts: { written: 2, deleted: 0, kept: 0, broken: 0, flaky: 0, ...changes.counts },
  }
}

/**
 * A map of files, by name, from their bytes.
 */
function filesOf(files: Record<string, number[]>): Map<string, Uint8Array> {
  return new Map(Object.entries(files).map(([name, bytes]) => [name, Uint8Array.from(bytes)]))
}

describe('expectedKeysOf', () => {
  it('gives the keys when every outcome is passed', () => {
    expect(expectedKeysOf({ 'grid--a': 'passed', 'grid--b': 'passed' })).toEqual(keys)
  })

  it('throws naming each outcome that is not passed', () => {
    expect(() => expectedKeysOf({ 'grid--a': 'passed', 'grid--b': 'broken' })).toThrow(
      'Every expected outcome must be passed, but grid--b is broken',
    )
  })
})

describe('testReportProblems', () => {
  it('finds no problem when every snapshot passes', () => {
    expect(testReportProblems(testReportOf(), keys)).toEqual([])
  })

  it('names the exit code', () => {
    expect(testReportProblems(testReportOf({ exitCode: 1 }), keys)).toEqual(['test exited 1, not 0'])
  })

  it('names a passed count that is not the number of snapshots', () => {
    expect(testReportProblems(testReportOf({ counts: { passed: 1 } }), keys)).toEqual([
      'test passed 1 snapshots, not 2',
    ])
  })

  it('names a flaky count, though flaky snapshots pass', () => {
    expect(testReportProblems(testReportOf({ counts: { flaky: 1 } }), keys)).toEqual(['test counts 1 flaky, not 0'])
  })

  it('names each failing count', () => {
    expect(
      testReportProblems(testReportOf({ counts: { differs: 1, broken: 2, missing: 3, orphan: 4 } }), keys),
    ).toEqual([
      'test counts 1 differs, not 0',
      'test counts 2 broken, not 0',
      'test counts 3 missing, not 0',
      'test counts 4 orphan, not 0',
    ])
  })

  it('names each listed entry by its id and status', () => {
    const snapshots = [{ id: 'grid--a', status: 'differs' }] as TestReport['snapshots']

    expect(testReportProblems(testReportOf({ snapshots }), keys)).toEqual(['test lists grid--a as differs'])
  })
})

describe('updateReportProblems', () => {
  it('finds no problem when every snapshot is written', () => {
    expect(updateReportProblems(updateReportOf(), keys)).toEqual([])
  })

  it('names the exit code', () => {
    expect(updateReportProblems(updateReportOf({ exitCode: 1 }), keys)).toEqual(['update exited 1, not 0'])
  })

  it('names a written count that is not the number of snapshots', () => {
    expect(updateReportProblems(updateReportOf({ counts: { written: 1 } }), keys)).toEqual([
      'update wrote 1 snapshots, not 2',
    ])
  })

  it('names each kept, deleted and broken count', () => {
    expect(updateReportProblems(updateReportOf({ counts: { kept: 1, deleted: 2, broken: 3 } }), keys)).toEqual([
      'update counts 1 kept, not 0',
      'update counts 2 deleted, not 0',
      'update counts 3 broken, not 0',
    ])
  })
})

describe('sameImagesProblems', () => {
  /**
   * The React Storybook's baselines of both snapshots.
   */
  const react = filesOf({ 'grid--a.png': [1], 'grid--b.png': [2] })

  it('finds no problem when the files are the same', () => {
    expect(sameImagesProblems(keys, filesOf({ 'grid--a.png': [1], 'grid--b.png': [2] }), react, 'baselines')).toEqual(
      [],
    )
  })

  it('names a missing file', () => {
    expect(sameImagesProblems(keys, filesOf({ 'grid--a.png': [1] }), react, 'baselines')).toEqual([
      'baselines lack grid--b.png',
    ])
  })

  it('names an extra file', () => {
    expect(
      sameImagesProblems(
        keys,
        filesOf({ 'grid--a.png': [1], 'grid--b.png': [2], 'other.png': [3] }),
        react,
        'baselines',
      ),
    ).toEqual(['baselines hold other.png, which no expected snapshot names'])
  })

  it("names a file the React Storybook's baselines lack", () => {
    expect(
      sameImagesProblems(
        keys,
        filesOf({ 'grid--a.png': [1], 'grid--b.png': [2] }),
        filesOf({ 'grid--a.png': [1] }),
        'baselines',
      ),
    ).toEqual(["storybook-10-react's baselines lack grid--b.png"])
  })

  it('names a file whose bytes differ', () => {
    expect(sameImagesProblems(keys, filesOf({ 'grid--a.png': [1], 'grid--b.png': [9] }), react, 'baselines')).toEqual([
      "baselines' grid--b.png differs from storybook-10-react's",
    ])
  })
})
