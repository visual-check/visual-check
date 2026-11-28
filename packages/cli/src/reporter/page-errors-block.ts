import type { ReportPageError } from '../report/report-document.js'

/**
 * How many of a snapshot's page errors the block lists.
 */
const listedPageErrorCount = 5

/**
 * The words each kind of page error is shown with.
 */
const kindWords: Record<ReportPageError['kind'], string> = {
  'console.error': 'console.error',
  error: 'uncaught error',
  unhandledrejection: 'unhandled rejection',
  load: 'failed load',
}

/**
 * A snapshot's page errors and the story's stale expected page errors, with the name the block lists it by.
 *
 * @public
 */
export interface NamedPageErrors {
  /**
   * The snapshot's name, such as `web  button--primary  dark`.
   */
  name: string
  /**
   * Its page errors that no expected page error matches, each with its severity.
   */
  pageErrors: readonly ReportPageError[]
  /**
   * The story's own expected page errors that matched none of its page errors, as written.
   */
  staleExpectedPageErrors: readonly string[]
}

/**
 * The command whose page errors are listed: `test` fails on those with severity `fail`, `update` never does.
 *
 * @public
 */
export type PageErrorsCommand = 'test' | 'update'

/**
 * Gives a page error in one line: its kind in words, such as `uncaught error`, the first line of its text that isn't
 * blank, as a stack trace spans several, and a load's network error or HTTP status after a `·`. A text with no such line
 * leaves the kind alone.
 *
 * @public
 */
export function pageErrorTextOf({ kind, text, loadError }: Omit<ReportPageError, 'severity'>): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '')
  const status = loadError === undefined ? '' : ` · ${loadError}`

  return `${[kindWords[kind], ...(firstLine === undefined ? [] : [firstLine])].join(' ')}${status}`
}

/**
 * Counts the snapshots in words, such as `3 snapshots with page errors, 2 of which fail the run`: for `test`, how many
 * of them have a page error that fails it, all of them, some, or none; `update` never fails on page errors.
 *
 * @public
 */
export function snapshotsWithPageErrorsOf(
  snapshots: readonly Pick<NamedPageErrors, 'pageErrors'>[],
  command: PageErrorsCommand,
): string {
  const count = snapshots.length
  const failing =
    command === 'test'
      ? snapshots.filter(({ pageErrors }) => pageErrors.some(({ severity }) => severity === 'fail')).length
      : 0
  const counted = `${count} ${count === 1 ? 'snapshot' : 'snapshots'} with page errors`
  const fail = failing === 1 ? 'fails' : 'fail'

  if (failing === 0) {
    return counted
  }

  return failing === count ? `${counted}, which ${fail} the run` : `${counted}, ${failing} of which ${fail} the run`
}

/**
 * Gives a page error's severity as its line shows it: for `test`, `fail` or `warn`; for `update`, which never fails on
 * page errors, `fails test` or `warn`.
 */
function severityOf({ severity }: ReportPageError, command: PageErrorsCommand): string {
  return command === 'update' && severity === 'fail' ? 'fails test' : severity
}

/**
 * Gives a snapshot's lines: its name, then indented by two spaces its first 5 page errors, each with its severity, how
 * many more it has, and its stale expected page errors.
 */
function snapshotLinesOf(
  { name, pageErrors, staleExpectedPageErrors }: NamedPageErrors,
  command: PageErrorsCommand,
): string[] {
  const more = pageErrors.length - listedPageErrorCount
  const details = [
    ...pageErrors
      .slice(0, listedPageErrorCount)
      .map((error) => `page error (${severityOf(error, command)}): ${pageErrorTextOf(error)}`),
    ...(more > 0 ? [`…and ${more} more ${more === 1 ? 'page error' : 'page errors'}`] : []),
    ...staleExpectedPageErrors.map((entry) => `stale expected page error: ${entry}`),
  ]

  return [name, ...details.map((line) => `  ${line}`)]
}

/**
 * Lists the snapshots that have page errors or stale expected page errors, in the order given, under a heading that
 * counts them and, for `test`, how many fail the run: each by its name, then indented its first 5 page errors with
 * their severity, how many more it has, and its stale expected page errors. Gives no line when none has either.
 *
 * @public
 */
export function pageErrorsBlockOf(snapshots: readonly NamedPageErrors[], command: PageErrorsCommand): string[] {
  const listed = snapshots.filter(
    ({ pageErrors, staleExpectedPageErrors }) => pageErrors.length > 0 || staleExpectedPageErrors.length > 0,
  )

  if (listed.length === 0) {
    return []
  }

  return [
    `── ${snapshotsWithPageErrorsOf(listed, command)} ──`,
    ...listed.flatMap((snapshot) => snapshotLinesOf(snapshot, command)),
  ]
}
