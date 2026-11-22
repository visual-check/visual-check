import type { AddonMessage, AddonOutcome, AddonProgress } from '@visual-check/cli/internal/addon-protocol'

/**
 * The fields of an object, which may hold anything.
 */
type Fields = Partial<Record<string, unknown>>

/**
 * How a check ends whose outcome can't be read.
 */
const unreadableOutcome: AddonOutcome = {
  result: 'stopped',
  cause: 'run',
  message:
    "The Storybook addon can't read the result of visual-check's process. " +
    'Install the same version of @visual-check/cli and @visual-check/storybook-addon, then restart Storybook.',
  notices: [],
}

/**
 * Whether a value is an object.
 */
function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null
}

/**
 * Whether a value is a list of strings.
 */
function isTexts(value: unknown): boolean {
  return Array.isArray(value) && value.every((text) => typeof text === 'string')
}

/**
 * Whether a value is a snapshot whose images are paths or `null`.
 */
function isSnapshot(value: unknown): boolean {
  return (
    isObject(value) &&
    isObject(value.images) &&
    Object.values(value.images).every((path) => path === null || typeof path === 'string')
  )
}

/**
 * Whether a value is a list of snapshots.
 */
function isSnapshots(value: unknown): boolean {
  return Array.isArray(value) && value.every(isSnapshot)
}

/**
 * Whether the fields are the progress of a step this addon knows.
 */
function isProgress(value: unknown): value is AddonProgress {
  if (!isObject(value)) {
    return false
  }

  const { step, text, finished, total } = value

  switch (step) {
    case 'preparing':
      return true
    case 'browser':
      return typeof text === 'string'
    case 'capturing':
      return Number.isInteger(finished) && Number.isInteger(total)
    default:
      return false
  }
}

/**
 * Whether the fields are those of a check that finished.
 */
function isChecked({ storybook, imagesFolder, snapshots, disabled, notices }: Fields): boolean {
  return (
    typeof storybook === 'string' &&
    typeof imagesFolder === 'string' &&
    typeof disabled === 'boolean' &&
    isSnapshots(snapshots) &&
    isTexts(notices)
  )
}

/**
 * Whether the fields are those of a check that a problem stopped.
 */
function isStopped({ cause, message, notices }: Fields): boolean {
  return (cause === 'config' || cause === 'run') && typeof message === 'string' && isTexts(notices)
}

/**
 * Whether a value is an outcome this addon knows.
 */
function isOutcome(value: unknown): value is AddonOutcome {
  if (!isObject(value)) {
    return false
  }

  switch (value.result) {
    case 'checked':
      return isChecked(value)
    case 'stopped':
      return isStopped(value)
    default:
      return value.result === 'cancelled'
  }
}

/**
 * Reads a message about a check. One that says it ended always ends it.
 */
function readCheckMessage({ kind, id, progress, outcome }: Fields): AddonMessage | undefined {
  if (typeof id !== 'string') {
    return undefined
  }

  if (kind === 'finished') {
    return { kind, id, outcome: isOutcome(outcome) ? outcome : unreadableOutcome }
  }

  return kind === 'progress' && isProgress(progress) ? { kind, id, progress } : undefined
}

/**
 * Reads a message from the child process, which may be of another version. Gives `undefined` for anything else than a
 * message it knows: an unknown `kind`, or progress that can't be read. An end whose outcome can't be read gives a
 * stopped check.
 */
export function readAddonMessage(message: unknown): AddonMessage | undefined {
  if (!isObject(message)) {
    return undefined
  }

  const { kind, protocol, version } = message

  if (kind === 'ready') {
    return protocol === 1 && typeof version === 'string' ? { kind, protocol, version } : undefined
  }

  return readCheckMessage(message)
}
