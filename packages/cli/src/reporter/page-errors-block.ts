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
 * Gives a page error in one line: its kind in words, such as `uncaught error`, the first line of its text, as a stack
 * trace spans several, and a load's network error or HTTP status after a `·`.
 *
 * @public
 */
export function pageErrorTextOf({ kind, text, loadError }: Omit<ReportPageError, 'severity'>): string {
  const status = loadError === undefined ? '' : ` · ${loadError}`

  return `${kindWords[kind]} ${text.split(/\r?\n/)[0]}${status}`
}

/**
 * Gives a snapshot's lines: its name, then indented by two spaces its first 5 page errors, each with its severity, how
 * many more it has, and its stale expected page errors.
 */
function snapshotLinesOf({ name, pageErrors, staleExpectedPageErrors }: NamedPageErrors): string[] {
  const more = pageErrors.length - listedPageErrorCount
  const details = [
    ...pageErrors
      .slice(0, listedPageErrorCount)
      .map((error) => `page error (${error.severity}): ${pageErrorTextOf(error)}`),
    ...(more > 0 ? [`…and ${more} more ${more === 1 ? 'page error' : 'page errors'}`] : []),
    ...staleExpectedPageErrors.map((entry) => `stale expected page error: ${entry}`),
  ]

  return [name, ...details.map((line) => `  ${line}`)]
}

/**
 * Lists the snapshots that have page errors or stale expected page errors, in the order given, under a heading that
 * counts them: each by its name, then indented its first 5 page errors with their severity, how many more it has, and
 * its stale expected page errors. Gives no line when none has either.
 *
 * @public
 */
export function pageErrorsBlockOf(snapshots: readonly NamedPageErrors[]): string[] {
  const listed = snapshots.filter(
    ({ pageErrors, staleExpectedPageErrors }) => pageErrors.length > 0 || staleExpectedPageErrors.length > 0,
  )

  if (listed.length === 0) {
    return []
  }

  const heading = `── ${listed.length} ${listed.length === 1 ? 'snapshot' : 'snapshots'} with page errors ──`

  return [heading, ...listed.flatMap(snapshotLinesOf)]
}
