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
 * changes no styles and never touches the document. It does only this, keeping its state under one non-enumerable
 * global:
 *
 * - wraps `Element.prototype.attachShadow` to record every shadow root it creates, closed ones included, in
 *   `shadowRoots`;
 * - records console messages of every level, uncaught errors and unhandled rejections in `messages`, each as `kind`
 *   and `text`: the last 50, each cut to 500 characters. An error is described by its stack. Any other object is
 *   sketched like JSON from its own enumerable data fields, three levels deep, stopping at 500 characters: an array
 *   or typed array by index, without listing all its keys, and each string cut first. So the page's getters and
 *   `toJSON` never run and a huge array costs little. A Proxy's traps can still run: `ownKeys`,
 *   `getOwnPropertyDescriptor`, `getPrototypeOf`, and `get` for an array's `length`;
 * - hooks Storybook's channel when the preview sets `__STORYBOOK_ADDONS_CHANNEL__`, to note each `storyFinished` with
 *   its story ID and status, for `waitForStory`, which the readiness expression calls.
 *
 * It keeps the browser's own `setTimeout` and `clearTimeout`, so a story that fakes or replaces timers doesn't stall
 * the readiness wait. A value the page sets as the channel never makes Storybook's own assignment throw.
 */
export const pageInitScript = `(() => {
  if (Object.prototype.hasOwnProperty.call(globalThis, '${stateGlobal}')) {
    return
  }

  const setTimer = globalThis.setTimeout.bind(globalThis)
  const clearTimer = globalThis.clearTimeout.bind(globalThis)
  const shadowRoots = []
  const messages = []
  const finished = new Map()
  const waiters = new Set()
  const channels = new WeakSet()
  let channelSet = false

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

  const finish = (event) => {
    if (typeof event !== 'object' || event === null || typeof event.storyId !== 'string') {
      return
    }
    const status = typeof event.status === 'string' ? event.status : 'unknown'
    finished.set(event.storyId, status)
    for (const waiter of [...waiters]) {
      waiter(event.storyId, status)
    }
  }

  const listen = (channel) => {
    try {
      if (typeof channel !== 'object' || channel === null || channels.has(channel) || typeof channel.on !== 'function') {
        return
      }
      channel.on('storyFinished', finish)
      channels.add(channel)
      channelSet = true
    } catch {}
  }

  let channel = globalThis.__STORYBOOK_ADDONS_CHANNEL__
  listen(channel)
  try {
    Object.defineProperty(globalThis, '__STORYBOOK_ADDONS_CHANNEL__', {
      configurable: true,
      enumerable: true,
      get: () => channel,
      set: (value) => {
        channel = value
        listen(value)
      },
    })
  } catch {}

  const waitForStory = (storyId, timeoutMs) => new Promise((resolve) => {
    if (finished.has(storyId)) {
      resolve({ outcome: 'finished', status: finished.get(storyId) })
      return
    }
    const waiter = (finishedId, status) => {
      if (finishedId === storyId) {
        waiters.delete(waiter)
        clearTimer(timer)
        resolve({ outcome: 'finished', status })
      }
    }
    const timer = setTimer(() => {
      waiters.delete(waiter)
      resolve({ outcome: 'timed-out', channel: channelSet })
    }, timeoutMs)
    waiters.add(waiter)
  })

  Object.defineProperty(globalThis, '${stateGlobal}', { value: Object.freeze({ shadowRoots, messages, waitForStory }) })
})()`

/**
 * What the readiness wait found in the page:
 *
 * - `finished`: Storybook reported the story finished, with this status, such as `success` or `error`;
 * - `timed-out`: the time limit passed first, and `channel` says whether Storybook's preview set its channel at all;
 * - `script-missing`: the page script hadn't run in the page, so there was nothing to wait with.
 */
export type StoryReadiness =
  | { outcome: 'finished'; status: string }
  | { outcome: 'timed-out'; channel: boolean }
  | { outcome: 'script-missing' }

/**
 * Builds the expression that waits in the page until Storybook reports this story finished, or `timeoutMs` passes. It
 * gives a `StoryReadiness`. A `storyFinished` for another story doesn't count, and one that came before the wait
 * started does.
 */
export function storyReadinessExpression(storyId: string, timeoutMs: number): string {
  const limit = Math.max(0, Math.ceil(timeoutMs))

  return `(async () => {
  const state = globalThis.${stateGlobal}
  return state === undefined ? { outcome: 'script-missing' } : state.waitForStory(${JSON.stringify(storyId)}, ${limit})
})()`
}

/**
 * Reads the value the readiness expression gave. Throws, quoting the value, when it's not a `StoryReadiness`.
 */
export function readStoryReadiness(value: unknown): StoryReadiness {
  const answer: Record<string, unknown> = typeof value === 'object' && value !== null ? { ...value } : {}

  if (answer.outcome === 'finished' && typeof answer.status === 'string') {
    return { outcome: 'finished', status: answer.status }
  }

  if (answer.outcome === 'timed-out' && typeof answer.channel === 'boolean') {
    return { outcome: 'timed-out', channel: answer.channel }
  }

  if (answer.outcome === 'script-missing') {
    return { outcome: 'script-missing' }
  }

  throw new Error(`The readiness wait in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`)
}
