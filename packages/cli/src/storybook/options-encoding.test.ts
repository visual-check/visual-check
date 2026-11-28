import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { optionsEncoderSource } from './options-encoding.js'

/**
 * Encodes what `expression` evaluates to with the page's encoder, both run in one fresh realm, as the page's script
 * and its stories are, and gives the encoding passed through JSON, as it crosses to Node.
 */
function encoded(expression: string): unknown {
  return JSON.parse(JSON.stringify(runInNewContext(`(${optionsEncoderSource})(${expression})`)))
}

/**
 * Counts the values in an encoding: those encoded in full, and those past the limit of values, encoded as `Large`.
 */
function countValues(encoding: unknown): { full: number; large: number } {
  const node = encoding as { kind: string; name?: string; items?: unknown[]; entries?: [string, unknown][] }
  const children = [...(node.items ?? []), ...(node.entries ?? []).map(([, value]) => value)]
  const own = node.kind === 'instance' && node.name === 'Large' ? { full: 0, large: 1 } : { full: 1, large: 0 }

  return children
    .map(countValues)
    .reduce((total, count) => ({ full: total.full + count.full, large: total.large + count.large }), own)
}

/**
 * How the page encodes a finite number.
 */
function encodedNumber(value: number): Record<string, unknown> {
  return { kind: 'number', value }
}

/**
 * How the page encodes an object that isn't plain, by its name.
 */
function encodedInstance(name: string): Record<string, unknown> {
  return { kind: 'instance', name }
}

/**
 * The expression of `levels` objects nested in each other's `a`, the innermost one empty.
 */
function nestedExpression(levels: number): string {
  return `${'{ a: '.repeat(levels - 1)}{}${' }'.repeat(levels - 1)}`
}

/**
 * How the page encodes `levels` objects nested in each other's `a`, with `innermost` as the innermost one.
 */
function nestedEncoding(levels: number, innermost: unknown): unknown {
  let encoded = innermost

  for (let level = 1; level < levels; level += 1) {
    encoded = { kind: 'object', entries: [['a', encoded]] }
  }

  return encoded
}

describe('optionsEncoderSource', () => {
  it.each([
    ['null', 'null', { kind: 'null' }],
    ['undefined', 'undefined', { kind: 'undefined' }],
    ['true', 'true', { kind: 'boolean', value: true }],
    ['false', 'false', { kind: 'boolean', value: false }],
    ['a string', "'dark'", { kind: 'string', value: 'dark' }],
    ['a finite number', '1.5', encodedNumber(1.5)],
    ['a negative number', '-2', encodedNumber(-2)],
    ['NaN', 'NaN', { kind: 'number', text: 'NaN' }],
    ['Infinity', 'Infinity', { kind: 'number', text: 'Infinity' }],
    ['-Infinity', '-Infinity', { kind: 'number', text: '-Infinity' }],
    ['a bigint', '12n', { kind: 'bigint', text: '12' }],
    ['a negative bigint', '-3n', { kind: 'bigint', text: '-3' }],
    ['a symbol', "Symbol('mask')", { kind: 'symbol', text: 'mask' }],
    ['a symbol without a description', 'Symbol()', { kind: 'symbol', text: '' }],
    ['a function', '() => undefined', { kind: 'function' }],
    ['an async function', 'async () => undefined', { kind: 'function' }],
    ['a class', 'class Wait {}', { kind: 'function' }],
    [
      'an array, item by item',
      "[1, 'a', [true]]",
      {
        kind: 'array',
        items: [
          encodedNumber(1),
          { kind: 'string', value: 'a' },
          { kind: 'array', items: [{ kind: 'boolean', value: true }] },
        ],
      },
    ],
    [
      'a plain object, in the order of its keys',
      '{ b: 1, a: { c: null } }',
      {
        kind: 'object',
        entries: [
          ['b', encodedNumber(1)],
          ['a', { kind: 'object', entries: [['c', { kind: 'null' }]] }],
        ],
      },
    ],
    [
      'an object without a prototype as a plain object',
      'Object.assign(Object.create(null), { a: 1 })',
      { kind: 'object', entries: [['a', encodedNumber(1)]] },
    ],
    [
      'only the own enumerable string keys of a plain object',
      "Object.defineProperty({ a: 1, [Symbol('s')]: 2 }, 'hidden', { value: 3 })",
      { kind: 'object', entries: [['a', encodedNumber(1)]] },
    ],
    ['a Date by its class', 'new Date(0)', encodedInstance('Date')],
    ['a class instance by its class', 'new (class Mask {})()', encodedInstance('Mask')],
    ['a Map by its class', 'new Map()', encodedInstance('Map')],
    ['a regular expression by its source and flags', '/a\\/b+/gi', { kind: 'regexp', source: 'a\\/b+', flags: 'gi' }],
    ['a regular expression without flags', 'new RegExp("x")', { kind: 'regexp', source: 'x', flags: '' }],
    [
      'an instance of a class that extends RegExp as a regular expression',
      'new (class Pattern extends RegExp {})("x", "y")',
      { kind: 'regexp', source: 'x', flags: 'y' },
    ],
    [
      'an object that only names itself a RegExp as a plain object',
      "({ [Symbol.toStringTag]: 'RegExp' })",
      { kind: 'object', entries: [] },
    ],
    [
      'regular expressions in an array',
      "['Failed to fetch', /timeout/]",
      {
        kind: 'array',
        items: [
          { kind: 'string', value: 'Failed to fetch' },
          { kind: 'regexp', source: 'timeout', flags: '' },
        ],
      },
    ],
    ['an instance of an anonymous class with an empty name', 'new (class {})()', encodedInstance('')],
    [
      'an object whose prototype has no constructor with an empty name',
      'Object.create(Object.create(null))',
      encodedInstance(''),
    ],
  ])('encodes %s', (_what, options, encoding) => {
    expect(encoded(options)).toEqual(encoding)
  })

  it('encodes a regular expression from another realm by its source and flags', () => {
    const encode = runInNewContext(`(${optionsEncoderSource})`) as (value: unknown) => unknown

    expect(encode(/x/m)).toEqual({ kind: 'regexp', source: 'x', flags: 'm' })
  })

  it('encodes an object or array met again inside itself as Circular', () => {
    expect(encoded('(() => { const value = { a: 1 }; value.self = value; return value })()')).toEqual({
      kind: 'object',
      entries: [
        ['a', encodedNumber(1)],
        ['self', encodedInstance('Circular')],
      ],
    })
    expect(encoded('(() => { const list = [1]; list.push([list]); return list })()')).toEqual({
      kind: 'array',
      items: [encodedNumber(1), { kind: 'array', items: [encodedInstance('Circular')] }],
    })
  })

  it('encodes an object met twice, but never inside itself, in full both times', () => {
    const shared = { kind: 'object', entries: [['a', encodedNumber(1)]] }

    expect(encoded('(() => { const shared = { a: 1 }; return [shared, shared] })()')).toEqual({
      kind: 'array',
      items: [shared, shared],
    })
  })

  it('encodes 16 levels of objects in full', () => {
    expect(encoded(nestedExpression(16))).toEqual(nestedEncoding(16, { kind: 'object', entries: [] }))
  })

  it('encodes an object deeper than 16 levels as Deep', () => {
    expect(encoded(nestedExpression(17))).toEqual(nestedEncoding(17, encodedInstance('Deep')))
  })

  it('encodes a property whose getter throws as Unreadable, and reads the rest', () => {
    expect(encoded("{ ok: 1, get broken() { throw new Error('hostile') } }")).toEqual({
      kind: 'object',
      entries: [
        ['ok', encodedNumber(1)],
        ['broken', encodedInstance('Unreadable')],
      ],
    })
  })

  it.each([
    ['a revoked proxy', '(() => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy })()'],
    ['an object whose keys cannot be listed', "new Proxy({}, { ownKeys() { throw new Error('hostile') } })"],
    [
      'an array whose length cannot be read',
      "new Proxy([], { get(target, key) { if (key === 'length') { throw new Error('hostile') } return target[key] } })",
    ],
  ])('encodes %s as Unreadable', (_what, options) => {
    expect(encoded(options)).toEqual(encodedInstance('Unreadable'))
  })

  it('encodes the value as Unreadable, rather than throw, when the page broke a built-in the encoding uses', () => {
    const options = "(() => { Array.prototype.includes = () => { throw new Error('hostile') }; return { a: 1 } })()"

    expect(encoded(options)).toEqual(encodedInstance('Unreadable'))
  })

  it('encodes up to 10 000 values in full', () => {
    expect(encoded('new Array(9999).fill(0)')).toEqual({
      kind: 'array',
      items: new Array(9999).fill(encodedNumber(0)),
    })
  })

  it.each([
    ['an array with more items than values left', 'new Array(10000).fill(0)'],
    ['a sparse array with a huge length, at once', 'new Array(1e9)'],
    [
      'a plain object with more keys than values left',
      "Object.fromEntries(Array.from({ length: 10000 }, (_, index) => ['key' + index, 0]))",
    ],
  ])('encodes %s as Large', (_what, options) => {
    expect(encoded(options)).toEqual(encodedInstance('Large'))
  })

  it('encodes an object shared many times over within the limit, and the rest as Large', () => {
    const fanOut =
      '(() => { let value = {}; for (let level = 1; level < 16; level += 1) { value = { a: value, b: value, c: value } } return value })()'
    const { full, large } = countValues(encoded(fanOut))

    expect(full).toBeLessThanOrEqual(10_000)
    expect(large).toBeGreaterThan(0)
    expect(full + large).toBeLessThan(10_100)
  })

  it('gives each value it encodes a limit of its own', () => {
    const encodings = runInNewContext(
      `(() => { const encode = ${optionsEncoderSource}; return [encode(new Array(9999).fill(0)), encode(new Array(9999).fill(0))] })()`,
    )

    expect(JSON.parse(JSON.stringify(encodings))).toEqual([
      { kind: 'array', items: new Array(9999).fill(encodedNumber(0)) },
      { kind: 'array', items: new Array(9999).fill(encodedNumber(0)) },
    ])
  })
})
