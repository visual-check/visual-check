// The checks of each other port's end-to-end check, as pure functions of what it reads: the expected outcomes, the CLI's
// JSON reports and the baselines' bytes. `e2e.ts` reads those and prints what these give.
import type { TestReport, UpdateReport } from '@visual-check/cli'

/**
 * The keys of the snapshots the check expects, from `expected-outcomes.json`.
 *
 * @public
 * @throws {Error} When any outcome isn't `passed`, since this check expects every grid story to pass.
 */
export function expectedKeysOf(outcomes: Record<string, string>): string[] {
  const notPassed = Object.entries(outcomes).filter(([, outcome]) => outcome !== 'passed')

  if (notPassed.length > 0) {
    throw new Error(
      `Every expected outcome must be passed, but ${notPassed.map(([key, outcome]) => `${key} is ${outcome}`).join(', ')}`,
    )
  }

  return Object.keys(outcomes)
}

/**
 * The name a test Storybook's config gives its Storybook, from the folder it is in: its renderer, `vue` for
 * `storybook-10-vue`.
 *
 * @public
 * @throws {Error} When the folder's name isn't `storybook-<major>-<renderer>`.
 */
export function storybookNameOf(folderName: string): string {
  const renderer = /^storybook-\d+-([a-z0-9]+)$/.exec(folderName)?.[1]

  if (renderer === undefined) {
    throw new Error(`${folderName} is not a test Storybook folder: storybook-<major>-<renderer>`)
  }

  return renderer
}

/**
 * Lists how a `test` report differs from every snapshot passing plainly: its exit code, its counts, and each entry it
 * lists, since a plain pass has none. A flaky pass is a problem too: the React port's images can only be matched byte
 * for byte when every capture of a grid story is the same.
 *
 * @public
 */
export function testReportProblems(
  report: Pick<TestReport, 'exitCode' | 'counts' | 'snapshots'>,
  keys: string[],
): string[] {
  const { counts } = report
  const failingCounts = (['flaky', 'differs', 'broken', 'missing', 'orphan'] as const).filter(
    (name) => counts[name] !== 0,
  )

  return [
    ...(report.exitCode === 0 ? [] : [`test exited ${report.exitCode}, not 0`]),
    ...(counts.passed === keys.length ? [] : [`test passed ${counts.passed} snapshots, not ${keys.length}`]),
    ...failingCounts.map((name) => `test counts ${counts[name]} ${name}, not 0`),
    ...report.snapshots.map(({ id, status }) => `test lists ${id} as ${status}`),
  ]
}

/**
 * Lists how an `update` report differs from writing every snapshot into an empty folder: its exit code and its counts.
 *
 * @public
 */
export function updateReportProblems(report: Pick<UpdateReport, 'exitCode' | 'counts'>, keys: string[]): string[] {
  const { counts } = report
  const otherCounts = (['kept', 'deleted', 'broken'] as const).filter((name) => counts[name] !== 0)

  return [
    ...(report.exitCode === 0 ? [] : [`update exited ${report.exitCode}, not 0`]),
    ...(counts.written === keys.length ? [] : [`update wrote ${counts.written} snapshots, not ${keys.length}`]),
    ...otherCounts.map((name) => `update counts ${counts[name]} ${name}, not 0`),
  ]
}

/**
 * Lists how a folder of baselines differs from the React Storybook's: a `<key>.png` it lacks, a file it has beyond
 * those, one the React Storybook lacks, and one whose bytes differ.
 *
 * @public
 * @param keys - The snapshots' keys.
 * @param own - The folder's files, by name.
 * @param react - The React Storybook's baselines, by name.
 * @param ownName - What the folder is, as the problems name it.
 */
export function sameImagesProblems(
  keys: string[],
  own: ReadonlyMap<string, Uint8Array>,
  react: ReadonlyMap<string, Uint8Array>,
  ownName: string,
): string[] {
  const names = keys.map((key) => `${key}.png`)
  const missing = names.filter((name) => !own.has(name))
  const extra = [...own.keys()].filter((name) => !names.includes(name))
  const notInReact = names.filter((name) => !react.has(name))
  const differing = names.filter((name) => {
    const ownBytes = own.get(name)
    const reactBytes = react.get(name)

    return ownBytes !== undefined && reactBytes !== undefined && !Buffer.from(ownBytes).equals(reactBytes)
  })

  return [
    ...missing.map((name) => `${ownName} lack ${name}`),
    ...extra.map((name) => `${ownName} hold ${name}, which no expected snapshot names`),
    ...notInReact.map((name) => `storybook-10-react's baselines lack ${name}`),
    ...differing.map((name) => `${ownName}' ${name} differs from storybook-10-react's`),
  ]
}
