/**
 * How many levels of objects and arrays the page encodes in a story's options. One nested deeper is encoded as an
 * instance named `Deep`.
 */
const encodedLevels = 16

/**
 * How many values the page encodes of one story's options at most, so options of any size, such as a sparse array
 * with a huge length or one object shared many times over, can't stall the page. Once none are left, a value is
 * encoded as an instance named `Large`, and so is an array or object with more items than are left.
 */
const encodedValuesLimit = 10_000

/**
 * A value as the page encodes it to cross to Node, by `optionsEncoderSource`.
 */
export type Encoded =
  | {
      /**
       * `null`.
       */
      kind: 'null'
    }
  | {
      /**
       * `undefined`.
       */
      kind: 'undefined'
    }
  | {
      /**
       * `true` or `false`.
       */
      kind: 'boolean'
      /**
       * The boolean.
       */
      value: boolean
    }
  | {
      /**
       * A string.
       */
      kind: 'string'
      /**
       * The string.
       */
      value: string
    }
  | {
      /**
       * A finite number.
       */
      kind: 'number'
      /**
       * The number.
       */
      value: number
    }
  | {
      /**
       * A number that isn't finite, which JSON can't carry.
       */
      kind: 'number'
      /**
       * The number as text.
       */
      text: 'NaN' | 'Infinity' | '-Infinity'
    }
  | {
      /**
       * A bigint, which JSON can't carry.
       */
      kind: 'bigint'
      /**
       * The bigint in decimal digits.
       */
      text: string
    }
  | {
      /**
       * A symbol.
       */
      kind: 'symbol'
      /**
       * Its description, empty when it has none.
       */
      text: string
    }
  | {
      /**
       * Any function, class or method, which can't cross to Node.
       */
      kind: 'function'
    }
  | {
      /**
       * A regular expression, from any realm, which JSON can't carry.
       */
      kind: 'regexp'
      /**
       * Its source.
       */
      source: string
      /**
       * Its flags.
       */
      flags: string
    }
  | {
      /**
       * An array.
       */
      kind: 'array'
      /**
       * Its items, each encoded.
       */
      items: Encoded[]
    }
  | {
      /**
       * A plain object: one whose prototype is `Object.prototype` or `null`.
       */
      kind: 'object'
      /**
       * Its own enumerable string keys in order, each with its value encoded.
       */
      entries: [key: string, value: Encoded][]
    }
  | {
      /**
       * Any other object, or one the page didn't encode in full: met again inside itself, nested too deep, past the
       * limit of values, or unreadable.
       */
      kind: 'instance'
      /**
       * The name of its constructor, empty when it has none, or `Circular`, `Deep`, `Large` or `Unreadable`.
       */
      name: string
    }

/**
 * The source of the function the page encodes a story's options with, so they cross to Node as JSON and validation
 * still sees what they were. It encodes `null`, `undefined`, booleans, strings and finite numbers as they are, `NaN`,
 * `Infinity` and `-Infinity`, bigints and symbols by their text, and any function as a function. It encodes an array
 * item by item, and a plain object, one whose prototype is `Object.prototype` or `null`, by its own enumerable string
 * keys in order. It encodes a regular expression, from any realm, by its source and flags. Any other object is an
 * instance, named by its constructor, or with an empty name when it has none. An object met again inside itself is the
 * instance `Circular`, one nested more than 16 levels deep is `Deep`, a value past the limit of 10 000 is `Large`, and
 * an object or a property that can't be read is `Unreadable`. It never throws.
 *
 * The page runs it as part of its script, and a test fixture evaluates the same source in Node.
 */
export const optionsEncoderSource = `(value) => {
  let valuesLeft = ${encodedValuesLimit}

  const instance = (name) => ({ kind: 'instance', name })

  const primitives = {
    __proto__: null,
    undefined: () => ({ kind: 'undefined' }),
    boolean: (primitive) => ({ kind: 'boolean', value: primitive }),
    string: (primitive) => ({ kind: 'string', value: primitive }),
    number: (primitive) =>
      Number.isFinite(primitive) ? { kind: 'number', value: primitive } : { kind: 'number', text: String(primitive) },
    bigint: (primitive) => ({ kind: 'bigint', text: String(primitive) }),
    symbol: (primitive) => ({ kind: 'symbol', text: primitive.description ?? '' }),
    function: () => ({ kind: 'function' }),
  }

  const classNameOf = (prototype) => {
    const constructorFunction = prototype.constructor
    const name = typeof constructorFunction === 'function' ? constructorFunction.name : undefined
    return typeof name === 'string' ? name : ''
  }

  const isRegExp = (object) =>
    Object.prototype.toString.call(object) === '[object RegExp]' &&
    typeof object.source === 'string' &&
    typeof object.flags === 'string'

  const encodeProperty = (container, key, ancestors) => {
    let property
    try {
      property = container[key]
    } catch {
      return instance('Unreadable')
    }
    return encode(property, ancestors)
  }

  const encodeArray = (array, ancestors) => {
    const length = array.length
    if (length > valuesLeft) {
      return instance('Large')
    }
    const items = []
    for (let index = 0; index < length; index += 1) {
      items.push(encodeProperty(array, index, ancestors))
    }
    return { kind: 'array', items }
  }

  const encodePlainObject = (object, ancestors) => {
    const keys = Object.keys(object)
    if (keys.length > valuesLeft) {
      return instance('Large')
    }
    return { kind: 'object', entries: keys.map((key) => [key, encodeProperty(object, key, ancestors)]) }
  }

  const encodeObject = (object, ancestors) => {
    if (ancestors.includes(object)) {
      return instance('Circular')
    }
    if (ancestors.length >= ${encodedLevels}) {
      return instance('Deep')
    }
    const inner = [...ancestors, object]
    try {
      if (Array.isArray(object)) {
        return encodeArray(object, inner)
      }
      if (isRegExp(object)) {
        return { kind: 'regexp', source: object.source, flags: object.flags }
      }
      const prototype = Object.getPrototypeOf(object)
      if (prototype !== Object.prototype && prototype !== null) {
        return instance(classNameOf(prototype))
      }
      return encodePlainObject(object, inner)
    } catch {
      return instance('Unreadable')
    }
  }

  const encode = (value, ancestors) => {
    if (valuesLeft <= 0) {
      return instance('Large')
    }
    valuesLeft -= 1
    if (value === null) {
      return { kind: 'null' }
    }
    const primitive = primitives[typeof value]
    return primitive === undefined ? encodeObject(value, ancestors) : primitive(value)
  }

  try {
    return encode(value, [])
  } catch {
    return instance('Unreadable')
  }
}`
