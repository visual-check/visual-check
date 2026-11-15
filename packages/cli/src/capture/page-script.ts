import { storybookPageScript } from '../storybook/preview-script.js'

/**
 * The non-enumerable global the page script keeps its state under, in every document of a page.
 */
const stateGlobal = '__visualCheck'

/**
 * How many console messages and errors the page keeps: the latest ones.
 */
const keptMessages = 50

/**
 * How many characters the page keeps of each console message or error.
 */
const keptCharacters = 500

/**
 * The script that runs at the start of every document of a page, before the page's own scripts, in every driver. It
 * changes no styles, and only the Storybook adapter's part reads the document, once the story finished. It does only
 * this, keeping its own state under one non-enumerable global:
 *
 * - wraps `Element.prototype.attachShadow` to record every shadow root it creates, closed ones included, in
 *   `shadowRoots`;
 * - records console messages of every level, uncaught errors and unhandled rejections in `messages`, each as `kind`
 *   and `text`: the last 50, each cut to 500 characters. An error is described by its stack. Any other object is
 *   sketched like JSON from its own enumerable data fields, three levels deep, stopping at 500 characters: an array
 *   or typed array by index, without listing all its keys, and each string cut first. So the page's getters and
 *   `toJSON` never run and a huge array costs little. A Proxy's traps can still run: `ownKeys`,
 *   `getOwnPropertyDescriptor`, `getPrototypeOf`, and `get` for an array's `length`;
 * - runs the Storybook adapter's script, which watches Storybook's preview for the story wait and keeps its state
 *   under a global of its own.
 *
 * The adapter's script runs first, so a failure in the rest can't keep the story wait from running and show as a
 * page script that didn't run.
 */
export const pageInitScript = `${storybookPageScript};
(() => {
  if (Object.prototype.hasOwnProperty.call(globalThis, '${stateGlobal}')) {
    return
  }

  const shadowRoots = []
  const messages = []

  const isError = typeof Error.isError === 'function' ? Error.isError : (value) => value instanceof Error

  const kindOf = (value) => {
    try {
      return Object.prototype.toString.call(value)
    } catch {
      return '[unprintable]'
    }
  }

  const sketch = (value, depth) => {
    if (typeof value === 'string') {
      return JSON.stringify(value.slice(0, ${keptCharacters}))
    }
    if (typeof value === 'function') {
      return '[function]'
    }
    if (typeof value !== 'object' || value === null || isError(value)) {
      return String(value)
    }
    const array = Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))
    if (depth === 0) {
      return array ? '[…]' : '{…}'
    }
    const keys = array ? [] : Reflect.ownKeys(value)
    const count = array ? value.length : keys.length
    const parts = []
    let length = 0
    for (let index = 0; index < count && length < ${keptCharacters}; index += 1) {
      const key = array ? String(index) : keys[index]
      const property = typeof key === 'string' ? Reflect.getOwnPropertyDescriptor(value, key) : undefined
      if (!array && (property === undefined || !property.enumerable)) {
        continue
      }
      const text = property === undefined ? 'undefined' : 'value' in property ? sketch(property.value, depth - 1) : '[getter]'
      const part = array ? text : JSON.stringify(key) + ':' + text
      parts.push(part)
      length += part.length + 1
    }
    if (!array && parts.length === 0 && ![Object.prototype, null].includes(Reflect.getPrototypeOf(value))) {
      return kindOf(value)
    }
    return array ? '[' + parts.join(',') + ']' : '{' + parts.join(',') + '}'
  }

  const describe = (value) => {
    try {
      if (typeof value === 'string') {
        return value.slice(0, ${keptCharacters})
      }
      if (isError(value)) {
        return typeof value.stack === 'string' ? value.stack : String(value)
      }
      return typeof value === 'object' && value !== null ? sketch(value, 3) : String(value)
    } catch {
      return kindOf(value)
    }
  }

  const record = (kind, values) => {
    try {
      messages.push({ kind, text: values.map(describe).join(' ').slice(0, ${keptCharacters}) })
      if (messages.length > ${keptMessages}) {
        messages.splice(0, messages.length - ${keptMessages})
      }
    } catch {}
  }

  for (const level of ['debug', 'info', 'log', 'warn', 'error']) {
    const original = console[level]
    if (typeof original === 'function') {
      console[level] = function (...values) {
        record('console.' + level, values)
        return Reflect.apply(original, this, values)
      }
    }
  }

  globalThis.addEventListener('error', (event) => {
    record('error', [event.error !== undefined && event.error !== null ? event.error : event.message])
  })
  globalThis.addEventListener('unhandledrejection', (event) => {
    record('unhandledrejection', [event.reason])
  })

  if (typeof Element === 'function' && typeof Element.prototype.attachShadow === 'function') {
    const original = Element.prototype.attachShadow
    Element.prototype.attachShadow = function attachShadow(init) {
      const root = Reflect.apply(original, this, arguments)
      shadowRoots.push(root)
      return root
    }
  }

  Object.defineProperty(globalThis, '${stateGlobal}', { value: Object.freeze({ shadowRoots, messages }) })
})()`
