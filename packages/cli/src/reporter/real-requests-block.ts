import type { ReportRealRequest } from '../report/report-document.js'

/**
 * How many of a snapshot's hosts the block lists.
 */
const listedHostCount = 5

/**
 * A snapshot's real network requests, with the name the block lists it by.
 *
 * @public
 */
export interface NamedRealRequests {
  /**
   * The snapshot's name, such as `web  button--primary  dark`.
   */
  name: string
  /**
   * The hosts its pages sent real network requests to, which `silenceHosts` doesn't match, each with its severity.
   */
  realRequests: readonly ReportRealRequest[]
}

/**
 * Counts the snapshots with real network requests in words, and how many of them have a host that fails the run: all
 * of them, some, or none, such as `3 snapshots with real network requests, 2 of which fail the run`. Snapshots with
 * none aren't counted.
 *
 * @public
 */
export function realRequestCountsOf(snapshots: readonly Pick<NamedRealRequests, 'realRequests'>[]): string {
  const withRequests = snapshots.filter(({ realRequests }) => realRequests.length > 0)
  const count = withRequests.length
  const failing = withRequests.filter(({ realRequests }) => realRequests.some(({ severity }) => severity === 'fail'))
  const counted = `${count} ${count === 1 ? 'snapshot' : 'snapshots'} with real network requests`
  const fail = failing.length === 1 ? 'fails' : 'fail'

  if (failing.length === 0) {
    return counted
  }

  return failing.length === count
    ? `${counted}, which ${fail} the run`
    : `${counted}, ${failing.length} of which ${fail} the run`
}

/**
 * Gives a snapshot's lines: its name, then indented by two spaces its first 5 hosts, each with its severity, and how
 * many more it has.
 */
function snapshotLinesOf({ name, realRequests }: NamedRealRequests): string[] {
  const more = realRequests.length - listedHostCount
  const details = [
    ...realRequests
      .slice(0, listedHostCount)
      .map(({ host, severity }) => `real network request (${severity}): ${host}`),
    ...(more > 0 ? [`…and ${more} more ${more === 1 ? 'host' : 'hosts'}`] : []),
  ]

  return [name, ...details.map((line) => `  ${line}`)]
}

/**
 * Lists the snapshots that have real network requests, in the order given, under a heading that counts them and says
 * how many fail the run: each by its name, then indented its first 5 hosts with their severity and how many more it
 * has. Gives no line when none has any.
 *
 * @public
 */
export function realRequestsBlockOf(snapshots: readonly NamedRealRequests[]): string[] {
  const listed = snapshots.filter(({ realRequests }) => realRequests.length > 0)

  if (listed.length === 0) {
    return []
  }

  return [`── ${realRequestCountsOf(listed)} ──`, ...listed.flatMap(snapshotLinesOf)]
}
