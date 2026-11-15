import { type Context, createContext, runInContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { animationClasses, fakeAnimation, restoreFinish } from '../storybook/preview-script.fixture.js'
import { readStoryWait, storyWaitExpression } from '../storybook/preview-script.js'
import { animationsTimedOutAnswer, FakeFrames, fakeDocument, settledAnswer } from './end-state.fixture.js'
import { fontsTimedOutAnswer, imagesTimedOutAnswer, readyAnswer } from './page-script.fixture.js'
import {
  assetsReadyExpression,
  endStateExpression,
  pageInitScript,
  prepareCaptureExpression,
  readAssetsReadiness,
} from './page-script.js'
import { fakeCaptureDocument } from './prepare-capture.fixture.js'
import { fakeElement, fakeFrame, fakeImg, fakePageDocument, fakeShadowRoot } from './remote-content.fixture.js'

/**
 * The console methods the fake page has, each a mock standing for the browser's own.
 */
interface FakeConsole {
  /**
   * The browser's `console.debug`.
   */
  debug: Mock
  /**
   * The browser's `console.info`.
   */
  info: Mock
  /**
   * The browser's `console.log`.
   */
  log: Mock
  /**
   * The browser's `console.warn`.
   */
  warn: Mock
  /**
   * The browser's `console.error`.
   */
  error: Mock
}

/**
 * A fake page: a `vm` context with the few globals the page script uses, and ways to act in it as the page would.
 */
interface FakePage {
  /**
   * The browser's own console, which the page script wraps.
   */
  console: FakeConsole
  /**
   * The page's `Element` class.
   */
  Element: new () => { attachShadow: (init: { mode: string }) => object }
  /**
   * How many times anything read the page's `document`.
   */
  documentReads: () => number
  /**
   * Runs JavaScript in the page and gives back what it evaluates to.
   */
  run: (code: string) => unknown
  /**
   * Sets a global from inside the page, as the page's own scripts do.
   */
  setGlobal: (name: string, value: unknown) => void
  /**
   * Dispatches an event on the page's window.
   */
  dispatch: (event: Event) => void
  /**
   * Evaluates an expression in the page and gives back its value as the driver does: awaited and passed through JSON.
   */
  evaluate: (expression: string) => Promise<unknown>
}

/**
 * Builds a fake page with these globals already set, in place of its own, without the page script. Its `document` is
 * the one given as a global, or an empty object.
 */
function blankPage(globals: Record<string, unknown> = {}): FakePage {
  const document = 'document' in globals ? globals.document : {}
  const window = new EventTarget()
  const browserConsole: FakeConsole = { debug: vi.fn(), info: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() }
  let documentReads = 0
  const Element = class Element {
    attachShadow(init: { mode: string }): object {
      return { mode: init.mode, host: this }
    }
  }
  const sandbox: Record<string, unknown> = {
    console: { ...browserConsole },
    Element,
    setTimeout,
    clearTimeout,
    performance,
    addEventListener: window.addEventListener.bind(window),
    ...globals,
  }

  Object.defineProperty(sandbox, 'document', {
    get: () => {
      documentReads += 1

      return document
    },
  })

  const context: Context = createContext(sandbox)
  const run = (code: string): unknown => runInContext(code, context)
  const setGlobal = run('(name, value) => { globalThis[name] = value }') as (name: string, value: unknown) => void

  return {
    console: { ...browserConsole },
    Element,
    documentReads: () => documentReads,
    run,
    setGlobal,
    dispatch: (event) => window.dispatchEvent(event),
    evaluate: async (expression) => JSON.parse(JSON.stringify(await run(expression))),
  }
}

/**
 * Builds a fake page with these globals already set, and runs the page script in it.
 */
function openPage(globals: Record<string, unknown> = {}): FakePage {
  const page = blankPage(globals)

  page.run(pageInitScript)

  return page
}

/**
 * Reads what the page script recorded of the page's console messages and errors.
 */
function messages(page: FakePage): unknown {
  return JSON.parse(JSON.stringify(page.run('globalThis.__visualCheck.messages')))
}

/**
 * A fake `<img>` element: what the wait for images and fonts reads and sets on it.
 */
interface FakeAssetImage {
  /**
   * The image's `loading` attribute.
   */
  loading: string
  /**
   * Whether the image finished loading.
   */
  complete: boolean
  /**
   * Whether the image is in the document, directly or in a shadow root of an element in it.
   */
  isConnected: boolean
  /**
   * Decodes the image, settling once it's decoded.
   */
  decode: () => Promise<void>
}

/**
 * Builds a fake image for the wait for images and fonts, eager, complete and in the document, whose decoding resolves
 * at once, unless `image` says otherwise.
 */
function fakeAssetImage(image: Partial<FakeAssetImage> = {}): FakeAssetImage {
  return { loading: 'eager', complete: true, isConnected: true, decode: async () => undefined, ...image }
}

/**
 * Gives a promise that resolves after `ms` on the test's clock, as a decoding or font load that takes that long.
 */
function resolvesAfter(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Gives a promise that never settles, as a decoding or font load that never ends.
 */
function never(): Promise<void> {
  return new Promise(() => undefined)
}

/**
 * A fake font face, as `document.fonts` lists it.
 */
interface FakeFace {
  /**
   * The face's family, as the page declared it, quotes included.
   */
  family: string
  /**
   * The face's weight, such as `400`.
   */
  weight: string
  /**
   * The face's style, such as `normal`.
   */
  style: string
  /**
   * Where the face's loading is, such as `loading` or `loaded`.
   */
  status: string
}

/**
 * Builds a fake font face of this family and status, of weight 400 and style normal unless `face` says otherwise.
 */
function fakeFace(family: string, status: string, face: Partial<FakeFace> = {}): FakeFace {
  return { family, weight: '400', style: 'normal', status, ...face }
}

/**
 * What a fake document for the wait for images and fonts holds.
 */
interface FakeAssetDocumentParts {
  /**
   * The document's images, outside shadow roots. An image can lack parts of a fake image, to test how the wait copes.
   */
  images?: object[]
  /**
   * The font faces `document.fonts` lists, or `null` for a document without `document.fonts`.
   */
  faces?: FakeFace[] | null
  /**
   * What `document.fonts.ready` gives. It resolves at once by default.
   */
  fontsReady?: Promise<void>
}

/**
 * A fake document, and what the wait for images and fonts did in it.
 */
interface FakeAssetDocument {
  /**
   * The document, to set as the page's `document` global.
   */
  document: unknown
  /**
   * What the wait did in the document, in order: `layout` when it forced layout, `fonts.ready` when it read
   * `document.fonts.ready`.
   */
  events: string[]
}

/**
 * Builds a fake document for the wait for images and fonts, with these images and font faces.
 */
function fakeAssetDocument({
  images = [],
  faces = [],
  fontsReady = Promise.resolve(),
}: FakeAssetDocumentParts = {}): FakeAssetDocument {
  const events: string[] = []
  const fonts =
    faces === null
      ? undefined
      : Object.defineProperty([...faces], 'ready', {
          get: () => {
            events.push('fonts.ready')

            return fontsReady
          },
        })
  const documentElement = {
    getBoundingClientRect: () => {
      events.push('layout')

      return {}
    },
  }

  return {
    document: { querySelectorAll: (selector: string) => (selector === 'img' ? images : []), documentElement, fonts },
    events,
  }
}

/**
 * The wait for images and fonts, started in a fake page.
 */
interface AssetsWait {
  /**
   * The page's answer, as the driver gives it.
   */
  answer: Promise<unknown>
  /**
   * Whether the page has answered.
   */
  settled: () => boolean
}

/**
 * Starts the wait for images and fonts in the page, with this time limit.
 */
function waitForAssets(page: FakePage, timeoutMs: number): AssetsWait {
  let settled = false
  const answer = page.evaluate(assetsReadyExpression(timeoutMs)).finally(() => {
    settled = true
  })

  return { answer, settled: () => settled }
}

/**
 * Runs the page's timers until the wait answers, and gives its answer. The wait yields a task after each round of
 * decoding, on the test's fake timers.
 */
async function finish(wait: AssetsWait): Promise<unknown> {
  await vi.runAllTimersAsync()

  return await wait.answer
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  restoreFinish()
})

describe('the shadow root record', () => {
  it('records every shadow root attachShadow creates, closed ones included', () => {
    const page = openPage()
    const open = new page.Element().attachShadow({ mode: 'open' })
    const closed = new page.Element().attachShadow({ mode: 'closed' })
    const recorded = page.run('globalThis.__visualCheck.shadowRoots') as unknown[]

    expect(recorded).toHaveLength(2)
    expect(recorded[0]).toBe(open)
    expect(recorded[1]).toBe(closed)
  })

  it('returns the shadow root the browser created', () => {
    const page = openPage()
    const host = new page.Element()

    expect(host.attachShadow({ mode: 'closed' })).toEqual({ mode: 'closed', host })
  })
})

describe('the message record', () => {
  it('records console messages of every level, in order', () => {
    const page = openPage()

    page.run(`
      console.debug('a debug line')
      console.info('an info line')
      console.log('a log line', 42, { a: 1 })
      console.warn('a warning')
      console.error('an error')
    `)
    expect(messages(page)).toEqual([
      { kind: 'console.debug', text: 'a debug line' },
      { kind: 'console.info', text: 'an info line' },
      { kind: 'console.log', text: 'a log line 42 {"a":1}' },
      { kind: 'console.warn', text: 'a warning' },
      { kind: 'console.error', text: 'an error' },
    ])
  })

  it("passes console messages on to the browser's console", () => {
    const page = openPage()

    page.run("console.warn('a warning', 42)")
    expect(page.console.warn).toHaveBeenCalledWith('a warning', 42)
  })

  it('records an error by its stack', () => {
    const page = openPage()

    page.run("console.error(new Error('boom'))")
    expect(messages(page)).toEqual([{ kind: 'console.error', text: expect.stringMatching(/^Error: boom\n\s+at /) }])
  })

  it('records a value it cannot look into by its kind', () => {
    const page = openPage()

    page.run(`
      const value = new Proxy({}, { ownKeys: () => { throw new Error('no keys') } })
      console.log(value, 1n, Symbol('s'))
    `)
    expect(messages(page)).toEqual([{ kind: 'console.log', text: '[object Object] 1 Symbol(s)' }])
  })

  it("sketches an object from its own data fields, three levels deep, without running the page's getters or toJSON", () => {
    const page = openPage()

    page.run(`
      globalThis.ran = []
      console.log({
        a: 1,
        get b() { ran.push('b') },
        toJSON() { ran.push('toJSON') },
        nested: { deep: { deeper: { deepest: 1 } } },
        list: [1, 'two', null, undefined],
      })
    `)
    expect(messages(page)).toEqual([
      {
        kind: 'console.log',
        text: '{"a":1,"b":[getter],"toJSON":[function],"nested":{"deep":{"deeper":{…}}},"list":[1,"two",null,undefined]}',
      },
    ])
    expect(page.run('ran.length')).toBe(0)
  })

  it('names an object with no fields of its own by its kind', () => {
    const page = openPage()

    page.run('console.log(new Date(0), new Map(), new DataView(new ArrayBuffer(8)), {}, [])')
    expect(messages(page)).toEqual([
      { kind: 'console.log', text: '[object Date] [object Map] [object DataView] {} []' },
    ])
  })

  it('sketches a typed array by index, without listing all its keys', () => {
    const page = openPage()

    page.run(`
      const ownKeys = Reflect.ownKeys
      globalThis.listings = 0
      Reflect.ownKeys = (target) => {
        listings += 1
        return ownKeys(target)
      }
      console.log(new Uint8ClampedArray(1280 * 720 * 4))
    `)
    expect(messages(page)).toEqual([{ kind: 'console.log', text: `[${'0,'.repeat(249)}0` }])
    expect(page.run('listings')).toBe(0)
  })

  it('cuts a long string inside an object', () => {
    const page = openPage()

    page.run("console.log({ text: 'x'.repeat(10000) })")
    expect(messages(page)).toEqual([{ kind: 'console.log', text: `{"text":"${'x'.repeat(491)}` }])
  })

  it('stops looking into a large object once it has 500 characters', () => {
    const page = openPage()

    page.run(`
      globalThis.looks = 0
      const looking = { getOwnPropertyDescriptor: (target, key) => { looks += 1; return Reflect.getOwnPropertyDescriptor(target, key) } }
      console.log(new Proxy(new Array(100000).fill(1), looking))
    `)
    expect(messages(page)).toEqual([{ kind: 'console.log', text: `[${'1,'.repeat(249)}1` }])
    expect(page.run('looks')).toBeLessThan(300)
  })

  it('keeps only the last 50 messages', () => {
    const page = openPage()

    page.run("for (let index = 1; index <= 60; index += 1) { console.log('line ' + index) }")

    const kept = messages(page) as { text: string }[]

    expect(kept).toHaveLength(50)
    expect(kept[0]?.text).toBe('line 11')
    expect(kept[49]?.text).toBe('line 60')
  })

  it('cuts each message to 500 characters', () => {
    const page = openPage()

    page.run("console.log('x'.repeat(600))")
    expect(messages(page)).toEqual([{ kind: 'console.log', text: 'x'.repeat(500) }])
  })

  it('records uncaught errors', () => {
    const page = openPage()
    const error = page.run("Object.assign(new Error('boom'), { stack: 'Error: boom\\n    at story.js:1:1' })")

    page.dispatch(Object.assign(new Event('error'), { error, message: 'Uncaught Error: boom' }))
    expect(messages(page)).toEqual([{ kind: 'error', text: 'Error: boom\n    at story.js:1:1' }])
  })

  it('records an uncaught error by its message when it carries no error', () => {
    const page = openPage()

    page.dispatch(Object.assign(new Event('error'), { error: null, message: 'Script error.' }))
    expect(messages(page)).toEqual([{ kind: 'error', text: 'Script error.' }])
  })

  it('records unhandled rejections', () => {
    const page = openPage()

    page.dispatch(Object.assign(new Event('unhandledrejection'), { reason: 'nope' }))
    expect(messages(page)).toEqual([{ kind: 'unhandledrejection', text: 'nope' }])
  })
})

describe('the page script', () => {
  it("never reads the page's document while the story runs, so it changes no styles", async () => {
    const { Animation } = animationClasses
    const ownFinish = Animation.prototype.finish
    const page = openPage({ Animation })

    page.run("console.log('a line')")
    new page.Element().attachShadow({ mode: 'open' })
    fakeAnimation().finish()

    const wait = page.evaluate(storyWaitExpression('button--primary', 1000))

    await vi.advanceTimersByTimeAsync(1000)
    await wait
    expect(Animation.prototype.finish).not.toBe(ownFinish)
    expect(page.documentReads()).toBe(0)
  })

  it("runs the Storybook adapter's script, so the story wait can run", async () => {
    const page = openPage()
    const wait = page.evaluate(storyWaitExpression('button--primary', 0))

    await vi.advanceTimersByTimeAsync(0)
    expect(readStoryWait(await wait)).toHaveProperty('outcome', 'timed-out')
  })

  it("runs the Storybook adapter's script even when the rest of it fails", async () => {
    const page = blankPage({ addEventListener: undefined })

    expect(() => page.run(pageInitScript)).toThrow('addEventListener is not a function')

    const wait = page.evaluate(storyWaitExpression('button--primary', 0))

    await vi.advanceTimersByTimeAsync(0)
    expect(readStoryWait(await wait)).toHaveProperty('outcome', 'timed-out')
  })

  it('keeps its state out of enumeration, frozen, with the end state, the search and the capture preparation in it', () => {
    const page = openPage()

    expect(page.run("Object.keys(globalThis).includes('__visualCheck')")).toBe(false)
    expect(page.run('Object.isFrozen(globalThis.__visualCheck)')).toBe(true)
    expect(page.run('typeof globalThis.__visualCheck.bringToEndState')).toBe('function')
    expect(page.run('typeof globalThis.__visualCheck.findRemoteContent')).toBe('function')
    expect(page.run('typeof globalThis.__visualCheck.prepareCapture')).toBe('function')
  })

  it('creates the capture preparation without reading the document, which it prepares once called', async () => {
    const { document } = fakeCaptureDocument()
    const page = openPage({ document })

    expect(page.documentReads()).toBe(0)
    expect(
      await page.evaluate(prepareCaptureExpression({ element: null, masks: [], maskColor: '#FF00FF' }, 1000)),
    ).toEqual({ outcome: 'ready', box: null })
    expect(page.documentReads()).toBeGreaterThan(0)
  })

  it('creates the remote content search without reading the document, which it searches once called', async () => {
    const { document } = fakePageDocument({ elements: [fakeImg({ src: 'https://images.example.com/a.jpg' })] })
    const page = openPage({ document, URL })

    expect(page.documentReads()).toBe(0)
    expect(await page.evaluate('globalThis.__visualCheck.findRemoteContent(1000)')).toEqual({
      outcome: 'found',
      items: [{ host: 'images.example.com', hostname: 'images.example.com', x: 10, y: 20, width: 100, height: 50 }],
    })
    expect(page.documentReads()).toBeGreaterThan(0)
  })

  it("lets the remote content search reach the closed shadow roots a same-origin frame's page script recorded", async () => {
    const image = fakeImg({ src: 'https://images.example.com/a.jpg', box: { x: 0, y: 0, width: 10, height: 10 } })
    const frame = fakeFrame({
      contentDocument: fakePageDocument().document,
      contentWindow: { __visualCheck: { shadowRoots: [fakeShadowRoot([image])] } },
      box: { x: 30, y: 40, width: 100, height: 100 },
    })
    const { document } = fakePageDocument({ elements: [frame] })
    const page = openPage({ document, URL })

    expect(await page.evaluate('globalThis.__visualCheck.findRemoteContent(1000)')).toEqual({
      outcome: 'found',
      items: [{ host: 'images.example.com', hostname: 'images.example.com', x: 30, y: 40, width: 10, height: 10 }],
    })
  })

  it('does nothing when it runs again in the same page', () => {
    const page = openPage()

    page.run(pageInitScript)
    page.run("console.log('a line')")
    expect(messages(page)).toEqual([{ kind: 'console.log', text: 'a line' }])
    expect(page.console.log).toHaveBeenCalledTimes(1)
  })
})

describe('the wait for images and fonts', () => {
  it('is ready once every image decoded', async () => {
    const { document } = fakeAssetDocument({
      images: [fakeAssetImage({ decode: () => resolvesAfter(300) }), fakeAssetImage()],
    })
    const wait = waitForAssets(openPage({ document }), 1000)

    await vi.advanceTimersByTimeAsync(299)
    expect(wait.settled()).toBe(false)
    expect(await finish(wait)).toEqual(readyAnswer())
  })

  it('is ready once the fonts loaded', async () => {
    const { document } = fakeAssetDocument({ fontsReady: resolvesAfter(500) })
    const wait = waitForAssets(openPage({ document }), 1000)

    await vi.advanceTimersByTimeAsync(499)
    expect(wait.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await wait.answer).toEqual(readyAnswer())
  })

  it("makes lazy images eager before decoding them, and leaves other images' loading alone", async () => {
    const lazy = fakeAssetImage({ loading: 'lazy' })
    const others = [fakeAssetImage({ loading: 'eager' }), fakeAssetImage({ loading: 'auto' })]
    const decodedAs: string[] = []
    const { document } = fakeAssetDocument({ images: [lazy, ...others] })

    lazy.decode = async () => {
      decodedAs.push(lazy.loading)
    }

    expect(await finish(waitForAssets(openPage({ document }), 1000))).toEqual(readyAnswer())
    expect([lazy, ...others].map((image) => image.loading)).toEqual(['eager', 'eager', 'auto'])
    expect(decodedAs).toEqual(['eager'])
  })

  it('decodes a broken image once: its decoding fails, and it is complete', async () => {
    const decode = vi.fn(() => Promise.reject(new Error('EncodingError')))
    const { document } = fakeAssetDocument({ images: [fakeAssetImage({ decode })] })

    expect(await finish(waitForAssets(openPage({ document }), 1000))).toEqual(readyAnswer())
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('decodes an image again when its decoding failed and left it incomplete, as a swapped placeholder does', async () => {
    const image = fakeAssetImage()
    const completeAtDecoding: boolean[] = []
    const { document } = fakeAssetDocument({ images: [image] })

    image.decode = async () => {
      completeAtDecoding.push(image.complete)

      if (completeAtDecoding.length === 1) {
        image.complete = false

        throw new Error('EncodingError: the source changed')
      }

      await resolvesAfter(300)
      image.complete = true
    }

    const wait = waitForAssets(openPage({ document }), 1000)

    await vi.advanceTimersByTimeAsync(200)
    expect(wait.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(await wait.answer).toEqual(readyAnswer())
    expect(completeAtDecoding).toEqual([true, false])
  })

  it('decodes an image again when its load handler swaps its source just after its decoding resolved', async () => {
    const image = fakeAssetImage()
    let decodings = 0
    const { document } = fakeAssetDocument({ images: [image] })

    image.decode = async () => {
      decodings += 1

      if (decodings === 1) {
        // As Chromium does for an SVG placeholder: decoding resolves, then the load handler swaps in the full image.
        setTimeout(() => {
          image.complete = false
        }, 0)

        return
      }

      await resolvesAfter(300)
      image.complete = true
    }

    const wait = waitForAssets(openPage({ document }), 1000)

    await vi.advanceTimersByTimeAsync(200)
    expect(wait.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(await wait.answer).toEqual(readyAnswer())
    expect(decodings).toBe(2)
  })

  it('times out on time with an image that stays incomplete while its decoding fails at once', async () => {
    const image = fakeAssetImage({ complete: false, decode: () => Promise.reject(new Error('EncodingError')) })
    const { document } = fakeAssetDocument({ images: [image] })
    const wait = waitForAssets(openPage({ document }), 1000)

    await vi.advanceTimersByTimeAsync(999)
    expect(wait.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await wait.answer).toEqual(imagesTimedOutAnswer(1))
  })

  it('skips images no longer in the document, such as those in the shadow root of a removed element', async () => {
    const detached = (): FakeAssetImage =>
      fakeAssetImage({ loading: 'lazy', complete: false, isConnected: false, decode: never })
    const { document } = fakeAssetDocument({ images: [detached()] })
    const page = openPage({ document })
    const root = new page.Element().attachShadow({ mode: 'open' })

    Object.assign(root, { querySelectorAll: () => [detached()] })
    expect(await waitForAssets(page, 1000).answer).toEqual(readyAnswer())
  })

  it('treats an image without decode, or whose decode throws, as decoded', async () => {
    const withoutDecode = { loading: 'eager', complete: true, isConnected: true }
    const throwing = fakeAssetImage({
      decode: () => {
        throw new Error('decode is not supported')
      },
    })
    const { document } = fakeAssetDocument({ images: [withoutDecode, throwing] })

    expect(await finish(waitForAssets(openPage({ document }), 1000))).toEqual(readyAnswer())
  })

  it('is ready when document.fonts.ready rejects', async () => {
    const { document } = fakeAssetDocument({ fontsReady: Promise.reject(new Error('fonts failed')) })

    expect(await waitForAssets(openPage({ document }), 1000).answer).toEqual(readyAnswer())
  })

  it('is ready with a limit of 0 when there is nothing to wait for', async () => {
    const { document } = fakeAssetDocument()

    expect(await waitForAssets(openPage({ document }), 0).answer).toEqual(readyAnswer())
  })

  it('times out at once with a limit of 0 on an image still loading', async () => {
    const { document } = fakeAssetDocument({ images: [fakeAssetImage({ complete: false, decode: never })] })
    const wait = waitForAssets(openPage({ document }), 0)

    await vi.advanceTimersByTimeAsync(0)
    expect(await wait.answer).toEqual(imagesTimedOutAnswer(1))
  })

  it('times out while images decode, counting the images not yet complete', async () => {
    const images = [
      fakeAssetImage({ decode: never }),
      fakeAssetImage({ complete: false, decode: never }),
      fakeAssetImage({ complete: false, decode: never }),
      fakeAssetImage(),
    ]
    const { document } = fakeAssetDocument({ images })
    const wait = waitForAssets(openPage({ document }), 1000)

    await vi.advanceTimersByTimeAsync(999)
    expect(wait.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await wait.answer).toEqual(imagesTimedOutAnswer(2))
  })

  it('rounds its time limit up to whole ms', async () => {
    const { document } = fakeAssetDocument({ images: [fakeAssetImage({ decode: never })] })
    const wait = waitForAssets(openPage({ document }), 999.2)

    await vi.advanceTimersByTimeAsync(999)
    expect(wait.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await wait.answer).toEqual(imagesTimedOutAnswer(0))
  })

  it('forces layout before it reads document.fonts.ready, so the fonts the layout needs start loading', async () => {
    const { document, events } = fakeAssetDocument()

    await waitForAssets(openPage({ document }), 1000).answer
    expect(events).toEqual(['layout', 'fonts.ready'])
  })

  it('times out while fonts load, naming each face still loading once, without quotes around its family', async () => {
    const faces = [
      fakeFace('"Never Loads"', 'loading'),
      fakeFace('Loaded', 'loaded'),
      fakeFace("'Never Loads'", 'loading'),
      fakeFace('Slow', 'loading', { weight: '700', style: 'italic' }),
      fakeFace('Unused', 'unloaded'),
      fakeFace('Broken', 'error'),
    ]
    const { document } = fakeAssetDocument({ faces, fontsReady: never() })
    const wait = waitForAssets(openPage({ document }), 1000)

    await vi.advanceTimersByTimeAsync(1000)
    expect(await wait.answer).toEqual(fontsTimedOutAnswer(['Never Loads 400 normal', 'Slow 700 italic']))
  })

  it('gives the fonts only what the images left of the time limit', async () => {
    const { document } = fakeAssetDocument({
      images: [fakeAssetImage({ decode: () => resolvesAfter(400) })],
      fontsReady: never(),
    })
    const wait = waitForAssets(openPage({ document }), 1000)

    await vi.advanceTimersByTimeAsync(999)
    expect(wait.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await wait.answer).toEqual(fontsTimedOutAnswer([]))
  })

  it('is ready after the images in a document without document.fonts', async () => {
    const { document } = fakeAssetDocument({
      images: [fakeAssetImage({ decode: () => resolvesAfter(300) })],
      faces: null,
    })

    expect(await finish(waitForAssets(openPage({ document }), 1000))).toEqual(readyAnswer())
  })

  it('includes the images in every shadow root the page script recorded', async () => {
    const image = fakeAssetImage({ loading: 'lazy', complete: false, decode: never })
    const { document } = fakeAssetDocument()
    const page = openPage({ document })
    const root = new page.Element().attachShadow({ mode: 'closed' })

    Object.assign(root, { querySelectorAll: (selector: string) => (selector === 'img' ? [image] : []) })

    const wait = waitForAssets(page, 1000)

    await vi.advanceTimersByTimeAsync(1000)
    expect(await wait.answer).toEqual(imagesTimedOutAnswer(1))
    expect(image.loading).toBe('eager')
  })

  it("times out on time when the story replaced the page's timers", async () => {
    const { document } = fakeAssetDocument({ images: [fakeAssetImage({ decode: never })] })
    const page = openPage({ document })

    page.run('globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => undefined')

    const wait = waitForAssets(page, 1000)

    await vi.advanceTimersByTimeAsync(1000)
    expect(await wait.answer).toEqual(imagesTimedOutAnswer(0))
  })

  it('leaves no timer behind once ready', async () => {
    const { document } = fakeAssetDocument()

    await waitForAssets(openPage({ document }), 1000).answer
    expect(vi.getTimerCount()).toBe(0)
  })

  it("gives script-missing in a page where the page script didn't run", async () => {
    expect(await blankPage().evaluate(assetsReadyExpression(1000))).toEqual({ outcome: 'script-missing' })
  })
})

describe('readAssetsReadiness', () => {
  it('reads images and fonts that are ready', () => {
    expect(readAssetsReadiness(readyAnswer())).toEqual({ outcome: 'ready' })
  })

  it('reads a timeout while images decoded, with the images not yet complete', () => {
    expect(readAssetsReadiness(imagesTimedOutAnswer(2))).toEqual({ outcome: 'timed-out', step: 'images', pending: 2 })
  })

  it('reads a timeout while fonts loaded, with the faces still loading', () => {
    expect(readAssetsReadiness(fontsTimedOutAnswer(['Inter 400 normal']))).toEqual({
      outcome: 'timed-out',
      step: 'fonts',
      pendingFaces: ['Inter 400 normal'],
    })
  })

  it('reads a missing page script', () => {
    expect(readAssetsReadiness({ outcome: 'script-missing' })).toEqual({ outcome: 'script-missing' })
  })

  it.each([
    ['a number', 42],
    ['null', null],
    ['a timeout without a step', { outcome: 'timed-out' }],
    ['a timeout in another step', { outcome: 'timed-out', step: 'layout' }],
    ['a count of images other than a number', imagesTimedOutAnswer('2')],
    ['a count of images below zero', imagesTimedOutAnswer(-1)],
    ['a count of images that is not whole', imagesTimedOutAnswer(1.5)],
    ['faces other than a list', fontsTimedOutAnswer('Inter 400 normal')],
    ['a face other than text', fontsTimedOutAnswer([42])],
  ])('throws on %s, quoting it', (_what, value) => {
    expect(() => readAssetsReadiness(value)).toThrow(
      `The wait for images and fonts in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`,
    )
  })
})

describe('the end state', () => {
  it('brings the animations in the document and in every recorded shadow root to their end state', async () => {
    const frames = new FakeFrames()
    const running = fakeAnimation()
    const parkedByStorybook = fakeAnimation({ kind: 'css-animation', playState: 'paused' })
    const document = fakeDocument({ animations: [running] })
    const page = openPage({ ...animationClasses, document, requestAnimationFrame: frames.requestFrame })
    const root = new page.Element().attachShadow({ mode: 'closed' })

    Object.assign(root, { getAnimations: () => [parkedByStorybook], querySelectorAll: () => [] })

    const answer = page.evaluate(endStateExpression(1000))

    await vi.runAllTimersAsync()
    expect(await answer).toEqual(settledAnswer(true))
    expect(running.actions).toEqual(['finish'])
    expect(parkedByStorybook.actions).toEqual(['commitStyles', 'cancel'])
    expect(frames.requestFrame).toHaveBeenCalled()
  })

  it('rounds its time limit up to whole ms', async () => {
    const document = fakeDocument({ animations: [fakeAnimation()] })
    const page = openPage({ ...animationClasses, document, requestAnimationFrame: () => 0 })
    let settled = false
    const answer = page.evaluate(endStateExpression(999.2)).finally(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await answer).toEqual(animationsTimedOutAnswer())
  })

  it("keeps the browser's own frames and timers when the story replaced them", async () => {
    const frames = new FakeFrames()
    const document = fakeDocument({ animations: [fakeAnimation()] })
    const page = openPage({ ...animationClasses, document, requestAnimationFrame: frames.requestFrame })

    page.run('globalThis.requestAnimationFrame = () => 0')
    page.run('globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => undefined')

    const answer = page.evaluate(endStateExpression(1000))

    await vi.runAllTimersAsync()
    expect(await answer).toEqual(settledAnswer(true))
  })

  it("gives script-missing in a page where the page script didn't run", async () => {
    expect(await blankPage().evaluate(endStateExpression(1000))).toEqual({ outcome: 'script-missing' })
  })
})

describe('the capture preparation', () => {
  it('passes the request into the page, so a selector with quotes and backslashes survives', async () => {
    const selector = `[data-label="it's \\"odd\\""] .a\\:b`
    const element = fakeElement('div', { box: { x: 10, y: 20, width: 30, height: 40 } })
    const { document } = fakeCaptureDocument({ matches: { [selector]: [element] } })
    const page = openPage({ document })

    expect(
      await page.evaluate(prepareCaptureExpression({ element: selector, masks: [], maskColor: '#FF00FF' }, 1000)),
    ).toEqual({ outcome: 'ready', box: { x: 10, y: 20, width: 30, height: 40 } })
  })

  it("gives the host masks' search its time limit, rounded up to whole ms", async () => {
    const image = fakeImg({ src: 'https://images.example.com/a.jpg', complete: false })
    const { document } = fakePageDocument({
      elements: [image],
      controlled: true,
      responses: { 'https://images.example.com/a.jpg': 'stalls' },
    })
    const page = openPage({ document, URL })
    const request = { element: null, masks: [{ name: 'images', host: 'images.example.com' }], maskColor: '#FF00FF' }
    let settled = false
    const answer = page.evaluate(prepareCaptureExpression(request, 999.2)).finally(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await answer).toEqual({ outcome: 'timed-out' })
  })

  it("gives script-missing in a page where the page script didn't run", async () => {
    const request = { element: '#card', masks: [], maskColor: '#FF00FF' }

    expect(await blankPage().evaluate(prepareCaptureExpression(request, 1000))).toEqual({ outcome: 'script-missing' })
  })
})
