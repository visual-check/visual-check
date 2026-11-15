import type { Encoded } from './options-encoding.js'
import { stateCallExpression } from './preview-script.js'

/**
 * The most characters of an answer visual-check doesn't know an error message quotes.
 */
const quotedLengthLimit = 500

/**
 * What the page gives for a number that isn't finite, as text.
 */
const nonFiniteTexts: ReadonlySet<unknown> = new Set(['NaN', 'Infinity', '-Infinity'])

/**
 * The stories of one stories file whose options the page reads.
 *
 * @public
 */
export interface StoriesFile {
  /**
   * The path of the stories file, as Storybook's index gives it.
   */
  importPath: string
  /**
   * The IDs of the file's stories to read the options of.
   */
  storyIds: string[]
}

/**
 * Where the options read was when its time limit passed: Storybook's preview hadn't started, or had started and
 * wasn't ready.
 */
type PreviewStep = 'preview-start' | 'preview-ready'

/**
 * One story's options, as the page read them.
 */
interface StoryOptionsRead {
  /**
   * The story's ID.
   */
  id: string
  /**
   * The story's merged `parameters.visualCheck`, as JS values again: a function stands for a function, and an object
   * that wasn't plain is an instance of a class with the name of the original's class.
   */
  options: unknown
}

/**
 * What the page read of one stories file.
 *
 * @public
 */
export type FileOptions =
  | {
      /**
       * The path of the stories file.
       */
      importPath: string
      /**
       * Every story of the file loaded.
       */
      outcome: 'loaded'
      /**
       * Each story's options, in the order of the story IDs asked for.
       */
      stories: StoryOptionsRead[]
    }
  | {
      /**
       * The path of the stories file.
       */
      importPath: string
      /**
       * A story of the file failed to load, such as when the file throws as it's imported.
       */
      outcome: 'failed'
      /**
       * One line for people saying what went wrong, from the first failure. It's empty when that failure has neither a
       * name nor a message.
       */
      message: string
    }
  | {
      /**
       * The path of the stories file.
       */
      importPath: string
      /**
       * The time limit passed before every story of the file loaded.
       */
      outcome: 'timed-out'
    }

/**
 * What the options read found in the page, in visual-check's own terms.
 *
 * @public
 */
export type OptionsRead =
  | {
      /**
       * The preview was ready and loaded or failed each stories file.
       */
      outcome: 'read'
      /**
       * Each stories file, in the order asked for.
       */
      files: FileOptions[]
    }
  | {
      /**
       * The time limit passed before the preview was ready.
       */
      outcome: 'timed-out'
      /**
       * Where the preview was when the time ran out.
       */
      step: PreviewStep
    }
  | {
      /**
       * The preview's `ready()` failed, such as when its index can't be read.
       */
      outcome: 'preview-failed'
      /**
       * One line for people saying what went wrong. It's empty when the failure has neither a name nor a message.
       */
      message: string
    }
  | {
      /**
       * The preview has no `loadStory`, so this Storybook can't give its stories' options.
       */
      outcome: 'unsupported'
    }
  | {
      /**
       * The adapter's script hadn't run in the page, so there was nothing to read with.
       */
      outcome: 'script-missing'
    }

/**
 * Builds the expression that reads the options of every story of these stories files in the page, through Storybook's
 * preview, within `timeoutMs`, rounded up to whole ms, for the preview to become ready, and again for each file to
 * load. Its value is the page's answer, which `readOptionsAnswer` reads.
 *
 * @public
 */
export function optionsReadExpression(files: readonly StoriesFile[], timeoutMs: number): string {
  return stateCallExpression('readOptions', [files], timeoutMs)
}

/**
 * Throws, to say a value isn't part of an answer the page gives.
 *
 * @throws {Error} Always.
 */
function unknownShape(): never {
  throw new Error('The value is not part of an answer the page gives.')
}

/**
 * Whether a value is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Gives a value that is a non-null object, or throws.
 */
function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : unknownShape()
}

/**
 * Gives a value that is an array, or throws.
 */
function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : unknownShape()
}

/**
 * Gives a value that is a string, or throws.
 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : unknownShape()
}

/**
 * Gives a record's own value under a key, or throws when the key isn't a string the record holds as its own.
 */
function ownValueOf<Value>(record: Readonly<Record<string, Value>>, key: unknown): Value {
  const value = typeof key === 'string' && Object.hasOwn(record, key) ? record[key] : undefined

  return value ?? unknownShape()
}

/**
 * Decodes a number: a finite one from its value, any other from its text.
 */
function decodeNumber({ value, text }: Record<string, unknown>): number {
  if (typeof value === 'number') {
    return value
  }

  return nonFiniteTexts.has(text) ? Number(text) : unknownShape()
}

/**
 * Decodes a bigint from its text, which the page gives in whole decimal digits.
 */
function decodeBigint({ text }: Record<string, unknown>): bigint {
  return typeof text === 'string' && /^-?\d+$/.test(text) ? BigInt(text) : unknownShape()
}

/**
 * Decodes one entry of a plain object as a key and its value.
 */
function decodeEntry(entry: unknown): [string, unknown] {
  const [key, value, ...rest] = listOf(entry)

  return rest.length === 0 && typeof key === 'string' ? [key, decode(value)] : unknownShape()
}

/**
 * Builds an instance of a fresh class with this name, so validation names it as it would the original.
 */
function instanceNamed(name: string): object {
  const Named = class {}

  Object.defineProperty(Named, 'name', { value: name })

  return new Named()
}

/**
 * Turns each kind of encoded value back into a JS value, from its other fields. Each throws when those fields aren't
 * what the page gives. A plain object is built with `Object.fromEntries`, so a `__proto__` key is an own property and
 * never changes a prototype.
 */
const decoders: Record<Encoded['kind'], (encoded: Record<string, unknown>) => unknown> = {
  null: () => null,
  undefined: () => undefined,
  boolean: ({ value }) => (typeof value === 'boolean' ? value : unknownShape()),
  string: ({ value }) => textOf(value),
  number: decodeNumber,
  bigint: decodeBigint,
  symbol: ({ text }) => Symbol(textOf(text)),
  function: () => () => undefined,
  array: ({ items }) => listOf(items).map(decode),
  object: ({ entries }) => Object.fromEntries(listOf(entries).map(decodeEntry)),
  instance: ({ name }) => instanceNamed(textOf(name)),
}

/**
 * Decodes a value the page encoded.
 */
function decode(value: unknown): unknown {
  const encoded = recordOf(value)

  return ownValueOf(decoders, encoded.kind)(encoded)
}

/**
 * Reads one story's options.
 */
function readStory(value: unknown): StoryOptionsRead {
  const story = recordOf(value)

  return { id: textOf(story.id), options: decode(story.options) }
}

/**
 * Reads what the page read of one stories file, from its path and the rest of its fields.
 */
type FileReader = (importPath: string, file: Record<string, unknown>) => FileOptions

/**
 * Reads what the page read of one stories file, by how it went.
 */
const fileReaders: Record<FileOptions['outcome'], FileReader> = {
  loaded: (importPath, { stories }) => ({ importPath, outcome: 'loaded', stories: listOf(stories).map(readStory) }),
  failed: (importPath, { message }) => ({ importPath, outcome: 'failed', message: textOf(message) }),
  'timed-out': (importPath) => ({ importPath, outcome: 'timed-out' }),
}

/**
 * Reads what the page read of one stories file.
 */
function readFileOptions(value: unknown): FileOptions {
  const file = recordOf(value)

  return ownValueOf(fileReaders, file.outcome)(textOf(file.importPath), file)
}

/**
 * Whether a value is a step the options read can time out in.
 */
function isPreviewStep(value: unknown): value is PreviewStep {
  return value === 'preview-start' || value === 'preview-ready'
}

/**
 * Reads the page's answer by its outcome, from the rest of its fields.
 */
const answerReaders: Record<OptionsRead['outcome'], (answer: Record<string, unknown>) => OptionsRead> = {
  read: ({ files }) => ({ outcome: 'read', files: listOf(files).map(readFileOptions) }),
  'timed-out': ({ step }) => ({ outcome: 'timed-out', step: isPreviewStep(step) ? step : unknownShape() }),
  'preview-failed': ({ message }) => ({ outcome: 'preview-failed', message: textOf(message) }),
  unsupported: () => ({ outcome: 'unsupported' }),
  'script-missing': () => ({ outcome: 'script-missing' }),
}

/**
 * Quotes a value for an error message: as JSON when it can be, else as text, cut to a limit.
 */
function quoted(value: unknown): string {
  let text: string

  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }

  return text.length > quotedLengthLimit ? `${text.slice(0, quotedLengthLimit)}…` : text
}

/**
 * Reads the value the options read expression gave, and says what it comes to, with each story's options decoded
 * back into JS values. Throws, quoting the value, when it's not an answer the page gives.
 *
 * @public
 */
export function readOptionsAnswer(value: unknown): OptionsRead {
  try {
    const answer = recordOf(value)

    return ownValueOf(answerReaders, answer.outcome)(answer)
  } catch {
    throw new Error(`The options read in the page gave an answer visual-check doesn't know: ${quoted(value)}.`)
  }
}
