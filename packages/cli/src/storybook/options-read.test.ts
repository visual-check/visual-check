import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { optionsReadAnswer } from './options-read.fixture.js'
import { type OptionsRead, optionsReadExpression, readOptionsAnswer, type StoriesFile } from './options-read.js'

/**
 * Two stories files, one with two stories.
 */
const files: StoriesFile[] = [
  { importPath: './button.stories.tsx', storyIds: ['button--primary', 'button--secondary'] },
  { importPath: './card.stories.tsx', storyIds: ['card--default'] },
]

/**
 * Runs the options read expression in a page whose adapter's script gives this stand-in as `readOptions`, and gives
 * back what the expression evaluates to, awaited.
 */
async function runExpression(expression: string, readOptions: (...args: unknown[]) => unknown): Promise<unknown> {
  return await runInNewContext(expression, { __visualCheckStorybook: { readOptions } })
}

/**
 * The arguments each call of a stand-in for `readOptions` got, passed through JSON as the page gets them.
 */
function callsOf(readOptions: { mock: { calls: unknown[][] } }): unknown {
  return JSON.parse(JSON.stringify(readOptions.mock.calls))
}

describe('optionsReadExpression', () => {
  it("asks the adapter's script in the page to read the options of these files, and gives its answer", async () => {
    const readOptions = vi.fn(() => 'answer')

    expect(await runExpression(optionsReadExpression(files, 1000), readOptions)).toBe('answer')
    expect(callsOf(readOptions)).toEqual([[files, 1000]])
  })

  it.each([
    [999.2, 1000],
    [1000, 1000],
    [-5, 0],
  ])('gives a time limit of %s ms as %s whole ms', async (timeoutMs, limit) => {
    const readOptions = vi.fn()

    await runExpression(optionsReadExpression(files, timeoutMs), readOptions)
    expect(callsOf(readOptions)).toEqual([[files, limit]])
  })

  it('embeds import paths and story IDs with quotes, backslashes and line separators as they are', async () => {
    const odd = [{ importPath: './a"b\'c\\d .stories.tsx', storyIds: ['quotes--a"b\'c\\d</script> '] }]
    const readOptions = vi.fn()

    await runExpression(optionsReadExpression(odd, 1000), readOptions)
    expect(callsOf(readOptions)).toEqual([[odd, 1000]])
  })

  it("says when the adapter's script didn't run in the page", async () => {
    expect(JSON.parse(JSON.stringify(await runInNewContext(optionsReadExpression(files, 1000), {})))).toEqual({
      outcome: 'script-missing',
    })
  })
})

/**
 * Gives the options of the first story of the first file of an answer that read it as loaded.
 */
function firstOptions(answer: OptionsRead): unknown {
  if (answer.outcome !== 'read' || answer.files[0]?.outcome !== 'loaded') {
    return expect.fail(`The answer wasn't read as a loaded file: ${JSON.stringify(answer)}`)
  }

  return answer.files[0].stories[0]?.options
}

/**
 * Gives back one story's options as `readOptionsAnswer` decodes them, after the page encoded them.
 */
function decoded(options: unknown): unknown {
  return firstOptions(
    readOptionsAnswer(optionsReadAnswer([{ importPath: './a.stories.tsx', stories: [{ id: 'a--one', options }] }])),
  )
}

/**
 * The name of the class of a value's prototype, as validation names an instance.
 */
function className(value: unknown): unknown {
  return Object.getPrototypeOf(value)?.constructor?.name
}

/**
 * An answer that read one file whose one story has these encoded options.
 */
function loadedWith(options: unknown): Record<string, unknown> {
  return storyWith({ id: 'a--one', options, pinnedGlobals: [] })
}

/**
 * An answer that read one file with this one story.
 */
function storyWith(story: unknown): Record<string, unknown> {
  return readWith({ importPath: './a.stories.tsx', outcome: 'loaded', stories: [story] })
}

/**
 * An answer that read this one file, in a Storybook whose declared globals can't be read.
 */
function readWith(file: unknown): Record<string, unknown> {
  return { outcome: 'read', declaredGlobals: null, files: [file] }
}

describe('readOptionsAnswer', () => {
  it('reads each stories file in order, with how it went', () => {
    const answer = optionsReadAnswer([
      {
        importPath: './button.stories.tsx',
        stories: [
          { id: 'button--primary', options: { tolerance: 0.1 } },
          { id: 'button--secondary', options: undefined },
        ],
      },
      { importPath: './card.stories.tsx', outcome: 'failed', message: 'SyntaxError: Unexpected token' },
      { importPath: './list.stories.tsx', outcome: 'timed-out' },
    ])

    expect(readOptionsAnswer(answer)).toEqual({
      outcome: 'read',
      declaredGlobals: null,
      files: [
        {
          importPath: './button.stories.tsx',
          outcome: 'loaded',
          stories: [
            { id: 'button--primary', options: { tolerance: 0.1 }, pinnedGlobals: [] },
            { id: 'button--secondary', options: undefined, pinnedGlobals: [] },
          ],
        },
        { importPath: './card.stories.tsx', outcome: 'failed', message: 'SyntaxError: Unexpected token' },
        { importPath: './list.stories.tsx', outcome: 'timed-out' },
      ],
    })
  })

  it("reads the Storybook's declared globals and the globals each story pins", () => {
    const answer = optionsReadAnswer(
      [
        {
          importPath: './button.stories.tsx',
          stories: [
            { id: 'button--primary', options: undefined, pinnedGlobals: ['theme', 'locale'] },
            { id: 'button--secondary', options: undefined },
          ],
        },
      ],
      ['theme', 'locale', 'density'],
    )

    expect(readOptionsAnswer(answer)).toEqual({
      outcome: 'read',
      declaredGlobals: ['theme', 'locale', 'density'],
      files: [
        {
          importPath: './button.stories.tsx',
          outcome: 'loaded',
          stories: [
            { id: 'button--primary', options: undefined, pinnedGlobals: ['theme', 'locale'] },
            { id: 'button--secondary', options: undefined, pinnedGlobals: [] },
          ],
        },
      ],
    })
  })

  it('reads a Storybook that declares no globals', () => {
    expect(readOptionsAnswer(optionsReadAnswer([], []))).toEqual({ outcome: 'read', declaredGlobals: [], files: [] })
  })

  it.each(['preview-start', 'preview-ready'])('reads a timeout in the %s step', (step) => {
    expect(readOptionsAnswer({ outcome: 'timed-out', step })).toEqual({ outcome: 'timed-out', step })
  })

  it('reads a preview that failed', () => {
    expect(readOptionsAnswer({ outcome: 'preview-failed', message: 'Error: The index failed.' })).toEqual({
      outcome: 'preview-failed',
      message: 'Error: The index failed.',
    })
  })

  it('reads a preview without loadStory()', () => {
    expect(readOptionsAnswer({ outcome: 'unsupported' })).toEqual({ outcome: 'unsupported' })
  })

  it("reads a missing adapter's script", () => {
    expect(readOptionsAnswer({ outcome: 'script-missing' })).toEqual({ outcome: 'script-missing' })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['true', true],
    ['false', false],
    ['a string', 'dark'],
    ['a finite number', 1.5],
    ['a negative number', -2],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a bigint', 12n],
    ['a negative bigint', -3n],
  ])('gives back %s as it was', (_what, value) => {
    expect(decoded(value)).toBe(value)
  })

  it('gives back arrays and plain objects, nested', () => {
    const options = { modes: [{ name: 'mobile', width: 320 }], tolerance: { pixels: 0 }, disable: false }

    expect(decoded(options)).toEqual(options)
  })

  it('gives back an object without a prototype as a plain object', () => {
    const value = decoded(Object.assign(Object.create(null), { a: 1 }))

    expect(value).toEqual({ a: 1 })
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
  })

  it('gives back a symbol with its description', () => {
    const value = decoded(Symbol('mask'))

    expect(typeof value).toBe('symbol')
    expect((value as symbol).description).toBe('mask')
  })

  it('gives back a function as one that does nothing', () => {
    const value = decoded(() => 'something')

    expect(typeof value).toBe('function')
    expect((value as () => unknown)()).toBeUndefined()
  })

  it('gives back an instance as one of a class with the same name, as validation names it', () => {
    const value = decoded(new Date(0))

    expect(typeof value).toBe('object')
    expect(value).not.toBeInstanceOf(Date)
    expect(className(value)).toBe('Date')
  })

  it('gives back an instance of a class with an empty name as one of a class with an empty name', () => {
    expect(className(decoded(new (class {})()))).toBe('')
  })

  it('gives back an object met inside itself as an instance named Circular', () => {
    const value: Record<string, unknown> = { a: 1 }

    value.self = value
    expect(className((decoded(value) as Record<string, unknown>).self)).toBe('Circular')
  })

  it('gives back the options validation reads: a wait function and an instance by its class', () => {
    const value = decoded({ wait: async () => undefined, capture: new Date(0) }) as Record<string, unknown>

    expect(typeof value.wait).toBe('function')
    expect(className(value.capture)).toBe('Date')
  })

  it('keeps a __proto__ key as an own property, leaving the prototype alone', () => {
    const value = decoded(JSON.parse('{ "__proto__": { "polluted": true } }')) as Record<string, unknown>

    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(value.polluted).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(value, '__proto__')?.value).toEqual({ polluted: true })
  })

  it('gives back an instance named __proto__ as one of a class with that name', () => {
    expect(className(firstOptions(readOptionsAnswer(loadedWith({ kind: 'instance', name: '__proto__' }))))).toBe(
      '__proto__',
    )
  })

  it.each([
    ['a number', 42],
    ['null', null],
    ['an answer of another outcome', { outcome: 'done' }],
    ['an outcome every object inherits', { outcome: 'toString' }],
    ['a read without files', { outcome: 'read', declaredGlobals: null }],
    ['a read without declared globals', { outcome: 'read', files: [] }],
    ['declared globals that are not a list', { outcome: 'read', declaredGlobals: 'theme', files: [] }],
    ['a declared global that is not text', { outcome: 'read', declaredGlobals: ['theme', 1], files: [] }],
    ['a timeout in the story step', { outcome: 'timed-out', step: 'story' }],
    ['a failed preview without a message', { outcome: 'preview-failed' }],
    ['a file without an import path', readWith({ outcome: 'timed-out' })],
    ['a file of another outcome', readWith({ importPath: './a.stories.tsx', outcome: 'skipped' })],
    ['a failed file without a message', readWith({ importPath: './a.stories.tsx', outcome: 'failed' })],
    ['a loaded file without stories', readWith({ importPath: './a.stories.tsx', outcome: 'loaded' })],
    ['a story without an ID', storyWith({ options: { kind: 'null' }, pinnedGlobals: [] })],
    ['a story without options', storyWith({ id: 'a', pinnedGlobals: [] })],
    ['a story without pinned globals', storyWith({ id: 'a', options: { kind: 'null' } })],
    ['pinned globals that are null', storyWith({ id: 'a', options: { kind: 'null' }, pinnedGlobals: null })],
    ['a pinned global that is not text', storyWith({ id: 'a', options: { kind: 'null' }, pinnedGlobals: [null] })],
    ['options of another kind', loadedWith({ kind: 'date' })],
    ['options of a kind every object inherits', loadedWith({ kind: 'constructor' })],
    ['options without a kind', loadedWith({})],
    ['a boolean that is neither true nor false', loadedWith({ kind: 'boolean', value: 'yes' })],
    ['a string that is not text', loadedWith({ kind: 'string', value: 1 })],
    ['a number without a value or text', loadedWith({ kind: 'number' })],
    ['a number of another text', loadedWith({ kind: 'number', text: '1e3' })],
    ['a bigint that is not whole', loadedWith({ kind: 'bigint', text: '1.5' })],
    ['a bigint without digits', loadedWith({ kind: 'bigint', text: '' })],
    ['a bigint in hexadecimal', loadedWith({ kind: 'bigint', text: '0x1f' })],
    ['a symbol without text', loadedWith({ kind: 'symbol' })],
    ['an array without items', loadedWith({ kind: 'array' })],
    ['an array with an item of another kind', loadedWith({ kind: 'array', items: [{ kind: 'date' }] })],
    ['an object whose entries are not pairs', loadedWith({ kind: 'object', entries: [['a']] })],
    ['an object with a key that is not text', loadedWith({ kind: 'object', entries: [[1, { kind: 'null' }]] })],
    ['an instance without a name', loadedWith({ kind: 'instance' })],
  ])('throws on %s, quoting it', (_what, value) => {
    expect(() => readOptionsAnswer(value)).toThrow(
      `The options read in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`,
    )
  })

  it('quotes at most 500 characters of an answer it does not know', () => {
    const value = { outcome: 'x'.repeat(600) }

    expect(() => readOptionsAnswer(value)).toThrow(
      `The options read in the page gave an answer visual-check doesn't know: ${JSON.stringify(value).slice(0, 500)}….`,
    )
  })
})
