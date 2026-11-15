import { parkedByStorybookSource, storybookPageScript } from '../storybook/preview-script.js'
import { endStateFunction } from './end-state.js'
import { type CapturePrepRequest, prepareCaptureFunction } from './prepare-capture.js'
import { remoteContentFunction } from './remote-content.js'

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
 * The script that runs at the start of every document of a page, before the page's own scripts, in every driver. Until
 * capture, it changes no styles except emptying Storybook 9.1 and 10's pause stylesheets. It reads the document only
 * once the story finished: in the Storybook adapter's part, in the wait for images and fonts, which also makes lazy
 * images eager, in the end state, in the remote content search and in the capture preparation, which paints the masks
 * and hides the caret. It does only this, keeping its own state under one non-enumerable global:
 *
 * - wraps `Element.prototype.attachShadow` to record every shadow root it creates, closed ones included, in
 *   `shadowRoots`;
 * - wraps `Animation.prototype.finish`, through the end state, to note when the end events of an animation finished
 *   by a call are still to come, passing everything through;
 * - records console messages of every level, uncaught errors and unhandled rejections in `messages`, each as `kind`
 *   and `text`: the last 50, each cut to 500 characters. An error is described by its stack. Any other object is
 *   sketched like JSON from its own enumerable data fields, three levels deep, stopping at 500 characters: an array
 *   or typed array by index, without listing all its keys, and each string cut first. So the page's getters and
 *   `toJSON` never run and a huge array costs little. A Proxy's traps can still run: `ownKeys`,
 *   `getOwnPropertyDescriptor`, `getPrototypeOf`, and `get` for an array's `length`;
 * - runs the Storybook adapter's script, which watches Storybook's preview for the story wait, empties Storybook 9.1
 *   and 10's pause stylesheets, and keeps its state under a global of its own;
 * - gives `waitForAssets`, which the wait for images and fonts expression calls. It takes the images in the document,
 *   outside shadow roots and in every recorded one, skipping those no longer in it. It sets each lazy one's `loading`
 *   to `eager` and decodes them all. A placeholder swapped for the full image leaves the image incomplete: its
 *   decoding fails when the `src` changes meanwhile, and its `load` handler can swap it just after its decoding
 *   resolved, as Chromium resolves an SVG's before the handler runs. So, a task after each round, it decodes again
 *   the images still in the document and incomplete, until none are left. A broken image is complete, so it isn't
 *   decoded again. Then it forces layout, so the fonts the layout needs start loading, and waits for
 *   `document.fonts.ready`. One time limit covers both. A page without an API it uses, such as `document.fonts`, has
 *   nothing to wait for there;
 * - gives `bringToEndState`, which the end state expression calls at capture. It brings every animation in the
 *   document and in every shadow root to its end state, then freezes their videos, inline SVGs and GIFs, then brings
 *   the animations that freezing them started to their end state too, as `endStateFunction` says, telling the
 *   animations Storybook 11 parked apart with the Storybook adapter's predicate;
 * - gives `findRemoteContent`, which finds the remote content the page shows: images, CSS images and cross-origin
 *   frames from an origin other than Storybook's, in the document, in every shadow root and in same-origin frames, as
 *   `remoteContentFunction` says;
 * - gives `prepareCapture`, which the capture preparation expression calls at capture, after the end state. It measures
 *   the element to capture, paints the masks over the page in the top layer, the host masks by what `findRemoteContent`
 *   finds, and hides the text caret in the document, in every shadow root and in same-origin frames, as
 *   `prepareCaptureFunction` says.
 *
 * It keeps the browser's own `setTimeout`, `clearTimeout` and `requestAnimationFrame`, so a story that fakes or
 * replaces timers or frames doesn't stall the wait, the end state or the remote content search. The adapter's script
 * runs first, so a failure in the rest can't keep the story wait from running and show as a page script that didn't
 * run.
 */
export const pageInitScript = `${storybookPageScript};
(() => {
  if (Object.prototype.hasOwnProperty.call(globalThis, '${stateGlobal}')) {
    return
  }

  const setTimer = globalThis.setTimeout.bind(globalThis)
  const clearTimer = globalThis.clearTimeout.bind(globalThis)
  const requestFrame =
    typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : undefined
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

  // The wait for images and fonts: every image decoded, then the fonts the layout needs loaded, never throwing.

  const timedOut = Symbol('timed out')

  const imagesIn = (root) => {
    try {
      return Array.from(root.querySelectorAll('img'))
    } catch {
      return []
    }
  }

  const makeEager = (image) => {
    try {
      if (image.loading === 'lazy') {
        image.loading = 'eager'
      }
    } catch {}
  }

  const decode = (image) => {
    try {
      return Promise.resolve(image.decode()).catch(() => undefined)
    } catch {
      return undefined
    }
  }

  const isConnected = (image) => {
    try {
      return image.isConnected === true
    } catch {
      return false
    }
  }

  const isLoading = (image) => {
    try {
      return image.isConnected === true && image.complete !== true
    } catch {
      return false
    }
  }

  const nextTask = () =>
    new Promise((resolve) => {
      setTimer(resolve, 0)
    })

  const forceLayout = () => {
    try {
      document.documentElement.getBoundingClientRect()
    } catch {}
  }

  const fontsOf = () => {
    try {
      const fonts = document.fonts
      return typeof fonts === 'object' && fonts !== null ? fonts : undefined
    } catch {
      return undefined
    }
  }

  const fontsLoaded = (fonts) => {
    try {
      return Promise.resolve(fonts === undefined ? undefined : fonts.ready).catch(() => undefined)
    } catch {
      return undefined
    }
  }

  const loadingFaces = (fonts) => {
    const faces = []
    try {
      for (const face of fonts) {
        if (face.status !== 'loading') {
          continue
        }
        const family = String(face.family).replace(/^(["'])(.*)\\1$/, '$2')
        const description = family + ' ' + face.weight + ' ' + face.style
        if (!faces.includes(description)) {
          faces.push(description)
        }
      }
    } catch {}
    return faces
  }

  const waitForAssets = async (timeoutMs) => {
    let timer
    const deadline = new Promise((resolve) => {
      timer = setTimer(() => resolve(timedOut), timeoutMs)
    })
    try {
      let images = [document, ...shadowRoots].flatMap(imagesIn).filter(isConnected)
      for (const image of images) {
        makeEager(image)
      }
      while (images.length > 0) {
        if ((await Promise.race([Promise.all(images.map(decode)), deadline])) === timedOut) {
          return { outcome: 'timed-out', step: 'images', pending: images.filter(isLoading).length }
        }
        await nextTask()
        images = images.filter(isLoading)
      }
      forceLayout()
      const fonts = fontsOf()
      if ((await Promise.race([fontsLoaded(fonts), deadline])) === timedOut) {
        return { outcome: 'timed-out', step: 'fonts', pendingFaces: loadingFaces(fonts) }
      }
      return { outcome: 'ready' }
    } finally {
      clearTimer(timer)
    }
  }

  // The end state, brought about only at capture.

  const bringToEndState = (${endStateFunction})({
    shadowRoots,
    setTimer,
    clearTimer,
    requestFrame,
    parkedByStorybook: ${parkedByStorybookSource},
  })

  // The remote content search, run only when a step needs it.

  const findRemoteContent = (${remoteContentFunction})({ shadowRoots, setTimer, clearTimer })

  // The capture preparation: masks painted and the caret hidden, only at capture.

  const prepareCapture = (${prepareCaptureFunction})({
    shadowRoots,
    findRemoteContent,
    stateGlobal: '${stateGlobal}',
  })

  Object.defineProperty(globalThis, '${stateGlobal}', {
    value: Object.freeze({ shadowRoots, messages, waitForAssets, bringToEndState, findRemoteContent, prepareCapture }),
  })
})()`

/**
 * What the wait for images and fonts found in the page.
 */
export type AssetsReadiness =
  | {
      /**
       * Every image decoded or failed to, and the fonts loaded.
       */
      outcome: 'ready'
    }
  | {
      /**
       * The time limit passed while images decoded.
       */
      outcome: 'timed-out'
      /**
       * The wait was decoding images.
       */
      step: 'images'
      /**
       * How many images still in the document hadn't finished loading. It's 0 when every image had loaded and some
       * were still decoding.
       */
      pending: number
    }
  | {
      /**
       * The time limit passed while fonts loaded.
       */
      outcome: 'timed-out'
      /**
       * The wait was loading fonts.
       */
      step: 'fonts'
      /**
       * The font faces still loading, each once, as its family, weight and style. The weight and style are as declared,
       * such as `Inter normal normal` or `Inter 100 900 normal`.
       */
      pendingFaces: string[]
    }
  | {
      /**
       * The page script hadn't run in the page, so there was nothing to wait with.
       */
      outcome: 'script-missing'
    }

/**
 * Builds the expression that waits in the page until every image decoded and the fonts loaded, or `timeoutMs` passes,
 * rounded up to whole ms. Its value is the page's answer, which `readAssetsReadiness` reads.
 */
export function assetsReadyExpression(timeoutMs: number): string {
  const limit = Math.max(0, Math.ceil(timeoutMs))

  return `(async () => {
  const state = globalThis.${stateGlobal}
  return state === undefined ? { outcome: 'script-missing' } : state.waitForAssets(${limit})
})()`
}

/**
 * Builds the expression that brings the page to its end state at capture, or gives up once `timeoutMs` passes, rounded
 * up to whole ms. Its value is the page's answer, which `readEndState` reads.
 */
export function endStateExpression(timeoutMs: number): string {
  const limit = Math.max(0, Math.ceil(timeoutMs))

  return `(async () => {
  const state = globalThis.${stateGlobal}
  return state === undefined ? { outcome: 'script-missing' } : state.bringToEndState(${limit})
})()`
}

/**
 * Builds the expression that prepares the page for its capture as `request` says, at capture, after the end state: it
 * measures the element, paints the masks and hides the caret. The host masks' remote content search gives up once
 * `timeoutMs` passes, rounded up to whole ms. The request goes into the expression as JSON, so any selector survives.
 * Its value is the page's answer, which `readCapturePrep` reads.
 */
export function prepareCaptureExpression(request: CapturePrepRequest, timeoutMs: number): string {
  const limit = Math.max(0, Math.ceil(timeoutMs))

  return `(async () => {
  const state = globalThis.${stateGlobal}
  return state === undefined
    ? { outcome: 'script-missing' }
    : state.prepareCapture(${JSON.stringify(request)}, ${limit})
})()`
}

/**
 * Reads the value the wait for images and fonts expression gave. Throws, quoting the value, when it's not an answer
 * the page gives.
 */
export function readAssetsReadiness(value: unknown): AssetsReadiness {
  const answer: Record<string, unknown> = typeof value === 'object' && value !== null ? { ...value } : {}
  const { pending, pendingFaces } = answer

  if (answer.outcome === 'ready' || answer.outcome === 'script-missing') {
    return { outcome: answer.outcome }
  }

  if (
    answer.outcome === 'timed-out' &&
    answer.step === 'images' &&
    typeof pending === 'number' &&
    Number.isInteger(pending) &&
    pending >= 0
  ) {
    return { outcome: 'timed-out', step: 'images', pending }
  }

  if (
    answer.outcome === 'timed-out' &&
    answer.step === 'fonts' &&
    Array.isArray(pendingFaces) &&
    pendingFaces.every((face) => typeof face === 'string')
  ) {
    return { outcome: 'timed-out', step: 'fonts', pendingFaces: [...pendingFaces] }
  }

  throw new Error(
    `The wait for images and fonts in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`,
  )
}
