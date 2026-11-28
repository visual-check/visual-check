import { appendFile, stat } from 'node:fs/promises'
import type { Report, ReportEntryFields } from '../report/report-document.js'
import { countsLineOf } from '../reporter/counts-line.js'
import { failureStatuses, testCountsLineOf } from '../reporter/end-block.js'
import { pageErrorCountsOf, pageErrorTextOf } from '../reporter/page-errors-block.js'
import { realRequestCountsOf } from '../reporter/real-requests-block.js'
import { systemReasonOf } from '../system-error/system-reason.js'

/**
 * The most a step summary file may hold, in bytes: GitHub's 1 MiB per step.
 */
const stepLimitBytes = 1024 * 1024

/**
 * The bytes left free for the Action, which appends the artifact link after the CLI.
 */
const actionBytes = 1024

/**
 * The most flaky snapshots the summary names.
 */
const listedFlakyCount = 100

/**
 * The most snapshots with page errors the summary names.
 */
const listedPageErrorSnapshotCount = 5

/**
 * The most snapshots with real network requests the summary names.
 */
const listedRealRequestSnapshotCount = 5

/**
 * The most hosts the summary names for one snapshot with real network requests.
 */
const listedHostCount = 3

/**
 * What starts a summary appended after what the file already holds: a blank line, so its heading is one.
 */
const separator = '\n\n'

/**
 * The note under an error cut to fit.
 */
const errorCutNote = "_The error is cut, to keep this summary under GitHub's 1 MiB._"

/**
 * The failures table's head: its column names and the line under them.
 */
const tableHead = '| Storybook | Story | Mode | Status | Message |\n| --- | --- | --- | --- | --- |'

/**
 * The `test` statuses `update` fixes, which the note on updating the baselines locally answers.
 */
const updatableStatuses: readonly string[] = ['differs', 'missing', 'orphan']

/**
 * How the person updates the baselines on their machine, which a failing `test`'s summary says.
 *
 * @public
 */
export interface LocalUpdate {
  /**
   * The name of the project's script whose command is exactly `visual-check update`, such as `visual:update`, or
   * `undefined` when none is.
   */
  script: string | undefined
  /**
   * Whether the browser runs in Docker on the person's machine: every platform but `host`.
   */
  docker: boolean
}

/**
 * An entry the summary lists, of either report.
 */
type ListedEntry = ReportEntryFields & {
  /**
   * The entry's status.
   */
  status: string
}

/**
 * The step summary couldn't be written, such as for a folder that doesn't exist or a path that is a folder.
 *
 * @public
 */
export class StepSummaryError extends Error {
  /**
   * The class's name, so a stack trace or a log line reads `StepSummaryError`.
   */
  override name = 'StepSummaryError'

  /**
   * The step summary file's path.
   */
  readonly path: string

  /**
   * The operating system's reason, such as `EACCES: permission denied`.
   */
  readonly reason: string

  /**
   * Keeps the path and the reason the error that caused it gives.
   */
  constructor(path: string, cause: unknown) {
    const reason = systemReasonOf(cause)

    super(`Couldn't write the step summary to ${path}: ${reason}.`, { cause })
    this.path = path
    this.reason = reason
  }
}

/**
 * Builds the run's step summary in Markdown, under `budgetBytes` in UTF-8: a heading naming the version, the command,
 * the shard and whether only the consistency check ran, then the counts, the flaky snapshots, at most 100, the
 * snapshots with page errors, how many and the first 5 with the first of each, for `test` the snapshots with real
 * network requests, how many and the first 5 with their first 3 hosts, then, for a `test` with a snapshot that
 * differs, a missing baseline or an orphan and a `localUpdate` given, how to update the baselines locally, and a table
 * of the failures in the report's order, the names and cells escaped. The table keeps its first rows that fit, and a
 * note says how many it leaves out. A run that exited 2 gives the heading and its error instead, cut to fit with a note
 * that says so, or the heading alone when not even the note fits. Gives `''` when even the part before the table's
 * rows, or the heading, doesn't fit.
 *
 * @public
 */
export function stepSummaryOf(report: Report, budgetBytes: number, localUpdate?: LocalUpdate): string {
  const heading = headingOf(report)

  if (report.error !== null) {
    return errorSummaryOf(heading, report.error.message, budgetBytes)
  }

  const blocks = [
    heading,
    countsOf(report),
    ...flakyBlockOf(report),
    ...pageErrorSnapshotsBlockOf(report),
    ...realRequestSnapshotsBlockOf(report),
  ]
  const failures = failuresOf(report)

  if (failures.length === 0) {
    return withinBudget(`${blocks.join('\n\n')}\n`, budgetBytes)
  }

  const head = [...blocks, ...updateNoteOf(failures, localUpdate), '**Failures**', tableHead].join('\n\n')

  return failuresSummaryOf(head, failures.map(rowOf), report, budgetBytes)
}

/**
 * Gives the note on updating the baselines locally, when the failures the summary lists hold a snapshot that differs,
 * a missing baseline or an orphan, the failures `update` fixes. An `update`'s failures are broken stories only, so it
 * never gets one. The note names the project's script, else `visual-check update`, and asks for Docker unless the
 * browser runs on the host. Gives no note with no `localUpdate`.
 */
function updateNoteOf(failures: readonly ListedEntry[], localUpdate: LocalUpdate | undefined): string[] {
  if (localUpdate === undefined || !failures.some((entry) => updatableStatuses.includes(entry.status))) {
    return []
  }

  const running = localUpdate.docker ? 'Storybook running and Docker up' : 'Storybook running'
  // The script's name holds no backtick or line break, the only characters that would break the code span.
  const run = localUpdate.script === undefined ? '`visual-check update`' : `the \`${localUpdate.script}\` script`

  return [
    `If the changes are intended, update the baselines on your machine: with ${running}, run ${run}, ` +
      'then commit the baselines it writes and deletes.',
  ]
}

/**
 * Gives the summary of a run that exited 2: the heading, then its error as an indented code block, so nothing in it
 * needs escaping. An error too long for the budget is cut at a character, with a note under it, and when not even
 * that fits the heading stands alone.
 */
function errorSummaryOf(heading: string, message: string, budgetBytes: number): string {
  const head = `${heading}\n\nThe run stopped with exit code 2:\n\n`
  const block = message
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
  const whole = `${head}${block}\n`

  if (byteLengthOf(whole) < budgetBytes) {
    return whole
  }

  const tail = `\n\n${errorCutNote}\n`
  const blockBytes = budgetBytes - 1 - byteLengthOf(head) - byteLengthOf(tail)

  if (blockBytes <= 0) {
    return withinBudget(`${heading}\n`, budgetBytes)
  }

  return `${head}${prefixWithin(block, blockBytes)}${tail}`
}

/**
 * Gives the longest start of the text that takes at most `maxBytes` in UTF-8, never splitting a character.
 */
function prefixWithin(text: string, maxBytes: number): string {
  let usedBytes = 0
  let end = 0

  for (const character of text) {
    usedBytes += byteLengthOf(character)

    if (usedBytes > maxBytes) {
      break
    }

    end += character.length
  }

  return text.slice(0, end)
}

/**
 * Gives the summary's heading: the version and the command, then the shard and whether only the consistency check ran.
 */
function headingOf(report: Report): string {
  const shard = report.shard === null ? '' : ` · shard ${report.shard.index}/${report.shard.total}`
  const consistency = report.consistencyOnly ? ' · consistency' : ''

  return `### visual-check ${report.visualCheck} · ${report.command}${shard}${consistency}`
}

/**
 * Gives the counts line: a `test`'s as its end block has it, without the time, or an `update`'s as its terminal has it.
 */
function countsOf(report: Report): string {
  if (report.command === 'test') {
    return testCountsLineOf(report.counts)
  }

  const { written, deleted, kept, broken } = report.counts

  return countsLineOf([
    ['written', written],
    ['deleted', deleted],
    ['kept', kept],
    ['broken', broken],
  ])
}

/**
 * Names the flaky snapshots under a heading, at most 100, then how many more there are. For `test` those are the
 * passes on a retry. Gives no block when none is flaky.
 */
function flakyBlockOf(report: Report): string[] {
  const entries: readonly ListedEntry[] = report.snapshots
  const flaky = entries.filter((entry) => entry.flaky && (report.command === 'update' || entry.status === 'passed'))

  if (flaky.length === 0) {
    return []
  }

  const names = flaky.slice(0, listedFlakyCount).map((entry) => `- ${entryNameOf(entry)}`)
  const more = flaky.length > listedFlakyCount ? [`- …and ${flaky.length - listedFlakyCount} more`] : []

  return ['**Flaky snapshots**', [...names, ...more].join('\n')]
}

/**
 * Gives the page errors block: how many snapshots have page errors and, for `test`, how many of them fail the run, then
 * how many stale expected page errors there are, then the first 5 snapshots that have either, whatever their status,
 * each with its first page error, else its first stale expected page error, then how many more there are. Gives no
 * block when no snapshot has either.
 */
function pageErrorSnapshotsBlockOf(report: Report): string[] {
  const entries: readonly ListedEntry[] = report.snapshots
  const listed = entries.filter((entry) => entry.pageErrors.length > 0 || entry.staleExpectedPageErrors.length > 0)

  if (listed.length === 0) {
    return []
  }

  const items = listed.slice(0, listedPageErrorSnapshotCount).map((entry) => {
    const [first] = entry.pageErrors
    const problem =
      first === undefined ? `stale expected page error ${entry.staleExpectedPageErrors[0]}` : pageErrorTextOf(first)

    return `- ${entryNameOf(entry)}: ${inlineTextOf(problem)}`
  })
  const more =
    listed.length > listedPageErrorSnapshotCount ? [`- …and ${listed.length - listedPageErrorSnapshotCount} more`] : []

  return ['**Page errors**', pageErrorCountsOf(entries, report.command), [...items, ...more].join('\n')]
}

/**
 * Gives the real network requests block of a `test`: how many snapshots have real network requests and how many of
 * them fail the run, then the first 5, whatever their status, each with its first 3 hosts, then how many more there
 * are. Gives no block when no snapshot has any, and none for `update`, which lists hosts as warnings instead.
 */
function realRequestSnapshotsBlockOf(report: Report): string[] {
  const listed = report.command === 'test' ? report.snapshots.filter((entry) => entry.realRequests.length > 0) : []

  if (listed.length === 0) {
    return []
  }

  const items = listed.slice(0, listedRealRequestSnapshotCount).map((entry) => {
    const hosts = entry.realRequests.slice(0, listedHostCount).map(({ host }) => host)
    const more = entry.realRequests.length > listedHostCount ? ', …' : ''

    return `- ${entryNameOf(entry)}: ${inlineTextOf(hosts.join(', '))}${more}`
  })
  const more =
    listed.length > listedRealRequestSnapshotCount
      ? [`- …and ${listed.length - listedRealRequestSnapshotCount} more`]
      : []

  return ['**Real network requests**', realRequestCountsOf(listed), [...items, ...more].join('\n')]
}

/**
 * Names an entry by its Storybook, its story ID or an orphan's stem, and its mode when it has one, each escaped, a `·`
 * apart.
 */
function entryNameOf({ storybook, story, id, mode }: ListedEntry): string {
  return [storybook, story ?? id, ...(mode === null ? [] : [mode])].map(inlineTextOf).join(' · ')
}

/**
 * Gives the entries the failures table lists, in the report's order: for `test` the snapshots that differ, the broken
 * and missing ones and the orphans; for `update` the broken stories.
 */
function failuresOf(report: Report): readonly ListedEntry[] {
  const entries: readonly ListedEntry[] = report.snapshots
  const statuses: readonly string[] = report.command === 'test' ? failureStatuses : ['broken']

  return entries.filter((entry) => statuses.includes(entry.status))
}

/**
 * Builds a failure's table row: its Storybook, story ID or an orphan's stem, mode, status and message.
 */
function rowOf({ storybook, story, id, mode, status, message }: ListedEntry): string {
  return `| ${[storybook, story ?? id, mode ?? '', status, message].map(inlineTextOf).join(' | ')} |`
}

/**
 * Escapes text for one line of Markdown, a list item or a table cell, so it can't end a cell or break the line and
 * the common inline markup shows as written: `&` and `<` become entities, `\`, `` ` ``, `*`, `_`, `[`, `]`, `|`, `~`
 * and `#` get a backslash, and each line break becomes a space.
 */
function inlineTextOf(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/[\\`*_[\]|~#]/g, '\\$&')
    .replace(/\r\n|\n|\r/g, ' ')
}

/**
 * Ends the summary after the table's head with the first rows that fit under the budget, and a note on how many it
 * leaves out, if any. Gives `''` when not even the head with the note on every row fits.
 */
function failuresSummaryOf(head: string, rows: readonly string[], report: Report, budgetBytes: number): string {
  const endOf = (leftOut: number): string => (leftOut === 0 ? '\n' : `\n\n${cutNoteOf(leftOut, report)}\n`)
  let usedBytes = byteLengthOf(head)

  if (usedBytes + byteLengthOf(endOf(rows.length)) >= budgetBytes) {
    return ''
  }

  let kept = 0

  for (const row of rows) {
    const rowBytes = byteLengthOf(`\n${row}`)

    if (usedBytes + rowBytes + byteLengthOf(endOf(rows.length - kept - 1)) >= budgetBytes) {
      break
    }

    usedBytes += rowBytes
    kept += 1
  }

  return `${[head, ...rows.slice(0, kept)].join('\n')}${endOf(rows.length - kept)}`
}

/**
 * Gives the note under a cut table: how many failures it leaves out and why, and for `test` that `report.json` lists
 * them all.
 */
function cutNoteOf(leftOut: number, report: Report): string {
  const count = leftOut === 1 ? "1 more failure isn't shown" : `${leftOut} more failures aren't shown`
  const where = report.command === 'test' ? ' report.json lists them all.' : ''

  return `_${count}, to keep this summary under GitHub's 1 MiB.${where}_`
}

/**
 * Gives the text when it fits under the budget, else `''`.
 */
function withinBudget(text: string, budgetBytes: number): string {
  return byteLengthOf(text) < budgetBytes ? text : ''
}

/**
 * Gives the text's length in UTF-8 bytes.
 */
function byteLengthOf(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Appends the run's step summary to the file at `path`, creating it when it doesn't exist, so the file stays under
 * GitHub's 1 MiB with 1 KiB left for the Action: the budget counts what the file already holds. After what it holds,
 * a blank line comes first, so the summary's heading is one. A failing `test` with a `localUpdate` says how to update
 * the baselines locally. Writes nothing when no summary fits.
 *
 * @throws {StepSummaryError} When the file can't be read or written.
 * @public
 */
export async function appendStepSummary(path: string, report: Report, localUpdate?: LocalUpdate): Promise<void> {
  // GitHub gives each step its own summary file, so nothing else appends between the size check and the write.
  const existingBytes = await sizeOf(path)
  const start = existingBytes === 0 ? '' : separator
  const summary = stepSummaryOf(report, stepLimitBytes - actionBytes - existingBytes - byteLengthOf(start), localUpdate)

  if (summary === '') {
    return
  }

  try {
    await appendFile(path, `${start}${summary}`)
  } catch (error) {
    throw new StepSummaryError(path, error)
  }
}

/**
 * Gives the size of the file at `path` in bytes, `0` when it doesn't exist.
 *
 * @throws {StepSummaryError} When the file can't be read for another reason.
 */
async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0
    }

    throw new StepSummaryError(path, error)
  }
}
