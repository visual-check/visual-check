import type { AddonSnapshot } from '@visual-check/cli/internal/addon-protocol'

/**
 * A broken story's details.
 */
type BrokenDetails = NonNullable<AddonSnapshot['details']>

/**
 * A snapshot as the panel shows it.
 */
export interface SnapshotRow {
  /**
   * The snapshot's key, unique among the story's.
   */
  key: string
  /**
   * The mode's name, or `Default` for the default capture.
   */
  label: string
  /**
   * What the snapshot came to.
   */
  status: 'passed' | 'differs' | 'missing' | 'broken'
  /**
   * The status for people.
   */
  statusText: 'Passed' | 'Visual diff' | 'Missing baseline' | 'Broken story'
  /**
   * Whether it's a flaky snapshot.
   */
  flaky: boolean
  /**
   * One line for people.
   */
  message: string
  /**
   * The code of why it differs or its story is broken, otherwise `null`.
   */
  reason: string | null
  /**
   * The lines of a broken story's details.
   */
  details: string[]
  /**
   * The hints on a failure.
   */
  hints: string[]
  /**
   * The paths of its images, `null` for one it has none of.
   */
  images: AddonSnapshot['images']
}

/**
 * The row a person picked.
 */
export interface PickedRow {
  /**
   * The row's key.
   */
  key: string
  /**
   * The ID of the result it was picked in.
   */
  resultId: string
}

/**
 * Each status for people.
 */
const statusTexts = {
  passed: 'Passed',
  differs: 'Visual diff',
  missing: 'Missing baseline',
  broken: 'Broken story',
} as const

/**
 * Gives the lines of each of a broken story's details.
 */
const detailLines: { [Key in keyof Required<BrokenDetails>]: (value: Required<BrokenDetails>[Key]) => string[] } = {
  url: (url) => [`URL: ${url}`],
  play: ({ message, stack }) => [message, ...stack],
  timeoutMs: (timeoutMs) => [`Timeout: ${timeoutMs} ms`],
  size: ([width, height]) => [`Page size: ${width} × ${height} device pixels`],
  pendingFonts: (faces) => [`Pending fonts: ${faces.join(', ')}`],
  grid: ({ width, viewportWidth }) => [`Grid width: ${width} px, viewport width: ${viewportWidth} px`],
  overflow: ({ area, top, right, bottom, left, viewportWidth }) => {
    const sides = { top, right, bottom, left }
    const reaches = Object.entries(sides).flatMap(([side, pixels]) => (pixels > 0 ? [`${side} ${pixels} px`] : []))
    const label = area === 'full-page' ? 'Full-page overflow' : 'Element overflow'

    return [`${label}: ${[...reaches, `viewport width: ${viewportWidth} px`].join(', ')}`]
  },
  loadError: (error) => error.split('\n'),
}

/**
 * Gives the lines of one of a broken story's details, none when it doesn't have it.
 */
function linesOfDetail<Key extends keyof BrokenDetails>(details: BrokenDetails, key: Key): string[] {
  const value = details[key]

  return value === undefined ? [] : detailLines[key](value as Required<BrokenDetails>[Key])
}

/**
 * Gives the lines of a broken story's details, none for a snapshot without any.
 */
export function detailLinesOf(details: AddonSnapshot['details']): string[] {
  const keys = Object.keys(detailLines) as (keyof BrokenDetails)[]

  return details === null ? [] : keys.flatMap((key) => linesOfDetail(details, key))
}

/**
 * Gives a snapshot as the panel shows it.
 */
export function rowOf(snapshot: AddonSnapshot): SnapshotRow {
  // A check of one story lists no orphan, which the report's shape has a status for.
  const status = snapshot.status === 'orphan' ? 'missing' : snapshot.status

  return {
    key: snapshot.id,
    label: snapshot.mode ?? 'Default',
    status,
    statusText: statusTexts[status],
    flaky: snapshot.flaky,
    message: snapshot.message,
    reason: snapshot.reason,
    details: detailLinesOf(snapshot.details),
    hints: snapshot.hints.map(({ message }) => message),
    images: snapshot.images,
  }
}

/**
 * Gives the row whose images show: the picked one, else the first that isn't passed, else the first. One picked in an
 * earlier result counts only while it isn't passed, so a check that mends it goes on to what is left.
 */
export function selectedRowOf(rows: SnapshotRow[], resultId: string, picked?: PickedRow): SnapshotRow | undefined {
  const failed = rows.filter(({ status }) => status !== 'passed')
  const pickable = picked?.resultId === resultId ? rows : failed

  return pickable.find(({ key }) => key === picked?.key) ?? failed[0] ?? rows[0]
}
