import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, type Mock, vi } from 'vitest'
import { type FakeSheet, fakeCaptureDocument } from './prepare-capture.fixture.js'
import { type CapturePrepRequest, prepareCaptureFunction, readCapturePrep } from './prepare-capture.js'
import { type FakeBox, type FakeShadowRoot, fakeElement, fakeShadowRoot } from './remote-content.fixture.js'

/**
 * The capture preparation created in a fake page, as the page script creates it.
 */
interface PreparationPage {
  /**
   * The remote content search, as the page script gives it.
   */
  findRemoteContent: Mock<(timeoutMs: number) => Promise<unknown>>
  /**
   * Prepares the capture with this request and a time limit of 5 s, and promises its answer as the driver gives it:
   * passed through JSON.
   */
  prepare: (request: Partial<CapturePrepRequest>) => Promise<unknown>
}

/**
 * What a fake page for the capture preparation has besides its `document`. Each part has a default, given with it.
 */
interface PreparationPageParts {
  /**
   * The shadow roots the page script recorded: none by default.
   */
  shadowRoots?: object[]
  /**
   * What the remote content search answers: no remote content by default.
   */
  remoteContent?: () => Promise<unknown>
}

/**
 * The rule the capture preparation hides the caret with.
 */
const caretRule = '*, *::before, *::after { caret-color: transparent !important; }'

/**
 * Builds the inline style of the element that holds the painted masks, the size of a document's scrollable area,
 * 800 × 600 unless told otherwise, clipping what's past it.
 */
function hostStyleOf(width = 800, height = 600): string {
  return (
    'all: initial !important; display: block !important; position: absolute !important; left: 0 !important; ' +
    `top: 0 !important; width: ${width}px !important; height: ${height}px !important; margin: 0 !important; ` +
    'padding: 0 !important; border: 0 !important; overflow: clip !important; background: transparent !important; ' +
    'pointer-events: none !important'
  )
}

/**
 * Builds a fake page whose `document` is this one, and creates the capture preparation in it.
 */
function openPreparation(document: object, parts: PreparationPageParts = {}): PreparationPage {
  const { shadowRoots = [], remoteContent = async () => ({ outcome: 'found', items: [] }) } = parts
  const context = createContext({ document })
  const create = runInContext(prepareCaptureFunction, context) as (
    context: object,
  ) => (request: CapturePrepRequest, timeoutMs: number) => Promise<unknown>
  const findRemoteContent = vi.fn(remoteContent)
  const prepare = create({ shadowRoots, findRemoteContent, stateGlobal: '__visualCheck' })

  return {
    findRemoteContent,
    prepare: async (request) => {
      const whole = { element: null, masks: [], maskColor: '#FF00FF', ...request }

      return JSON.parse(JSON.stringify(await prepare(whole, 5000)))
    },
  }
}

/**
 * Builds a `div` whose border box is `box`.
 */
function boxed(box: FakeBox): object {
  return fakeElement('div', { box })
}

/**
 * Builds the inline style of a painted box at these document coordinates, in `#FF00FF` unless told otherwise.
 */
function maskStyle(box: FakeBox, maskColor = '#FF00FF'): string {
  return (
    'all: initial !important; display: block !important; position: absolute !important; ' +
    `left: ${box.x}px !important; top: ${box.y}px !important; width: ${box.width}px !important; ` +
    `height: ${box.height}px !important; background: ${maskColor} !important`
  )
}

/**
 * Gives the text of each stylesheet a root adopted, with the window that made it.
 */
function sheetsOf(root: FakeShadowRoot): FakeSheet[] {
  return root.adoptedStyleSheets.map((sheet) => ({
    madeBy: String(Reflect.get(sheet, 'madeBy')),
    text: String(Reflect.get(sheet, 'text')),
  }))
}

/**
 * Builds a remote content item from `host`, whose name is `host` without its port, in `box`.
 */
function item(host: string, box: FakeBox): Record<string, unknown> {
  return { host, hostname: host.replace(/:\d+$/, ''), ...box }
}

describe('the element', () => {
  it("gives its box in document coordinates, with the page's scroll, out to whole pixels", async () => {
    const element = boxed({ x: 10.6, y: 20.6, width: 100.2, height: 50.1 })
    const { document } = fakeCaptureDocument({ matches: { '#card': [element] }, scroll: { x: 5, y: 300 } })

    expect(await openPreparation(document).prepare({ element: '#card' })).toEqual({
      outcome: 'ready',
      box: { x: 15, y: 320, width: 101, height: 51 },
    })
  })

  it('keeps the left and top edges at 0 or more', async () => {
    const element = boxed({ x: -20.5, y: -10, width: 50, height: 30 })
    const { document } = fakeCaptureDocument({ matches: { '#card': [element] } })

    expect(await openPreparation(document).prepare({ element: '#card' })).toEqual({
      outcome: 'ready',
      box: { x: 0, y: 0, width: 30, height: 20 },
    })
  })

  it("keeps the right and bottom edges within the document's scrollable area", async () => {
    const element = boxed({ x: 700.5, y: 500, width: 300, height: 200.5 })
    const { document } = fakeCaptureDocument({
      matches: { '#card': [element] },
      size: { width: 800, height: 600 },
    })

    expect(await openPreparation(document).prepare({ element: '#card' })).toEqual({
      outcome: 'ready',
      box: { x: 700, y: 500, width: 100, height: 100 },
    })
  })

  it("keeps the right and bottom edges as they are when the document's size cannot be read", async () => {
    const element = boxed({ x: 700, y: 500, width: 300, height: 200 })
    const { document } = fakeCaptureDocument({ matches: { '#card': [element] } })

    Object.defineProperty(Reflect.get(document, 'documentElement'), 'scrollWidth', {
      get: () => {
        throw new Error('TypeError: Illegal invocation.')
      },
    })
    expect(await openPreparation(document).prepare({ element: '#card' })).toEqual({
      outcome: 'ready',
      box: { x: 700, y: 500, width: 300, height: 200 },
    })
  })

  it('takes the first element the selector matches', async () => {
    const first = boxed({ x: 1, y: 2, width: 3, height: 4 })
    const { document } = fakeCaptureDocument({
      matches: { '.card': [first, boxed({ x: 50, y: 50, width: 9, height: 9 })] },
    })

    expect(await openPreparation(document).prepare({ element: '.card' })).toEqual({
      outcome: 'ready',
      box: { x: 1, y: 2, width: 3, height: 4 },
    })
  })

  it('gives no box for the full page', async () => {
    const { document } = fakeCaptureDocument()

    expect(await openPreparation(document).prepare({ element: null })).toEqual({ outcome: 'ready', box: null })
  })

  it.each([
    ['matches nothing', {}, { outcome: 'element-missing', found: 'nothing' }],
    ['matches an element of zero width', { '#card': [boxed({ x: 1, y: 1, width: 0, height: 10 })] }, undefined],
    ['matches an element of zero height', { '#card': [boxed({ x: 1, y: 1, width: 10, height: 0 })] }, undefined],
    [
      'matches an element whose box clamps to zero',
      { '#card': [boxed({ x: -50, y: 0, width: 30, height: 10 })] },
      undefined,
    ],
    [
      'matches an element past the right edge of the document',
      { '#card': [boxed({ x: 800, y: 0, width: 30, height: 10 })] },
      undefined,
    ],
    [
      'matches an element past the bottom edge of the document',
      { '#card': [boxed({ x: 0, y: 600.5, width: 30, height: 10 })] },
      undefined,
    ],
    [
      'matches an element whose box cannot be read',
      {
        '#card': [
          fakeElement('div', {
            properties: {
              getBoundingClientRect: () => {
                throw new Error('TypeError: Illegal invocation.')
              },
            },
          }),
        ],
      },
      undefined,
    ],
  ])('is missing when the selector %s, painting nothing and hiding no caret', async (_what, matches, answer) => {
    const covered = boxed({ x: 0, y: 0, width: 10, height: 10 })
    const { document, created } = fakeCaptureDocument({ matches: { ...matches, '.ad': [covered] } })

    expect(
      await openPreparation(document).prepare({ element: '#card', masks: [{ name: 'ad', selector: '.ad' }] }),
    ).toEqual(answer ?? { outcome: 'element-missing', found: 'zero-size' })
    expect(created).toEqual([])
    expect(document.adoptedStyleSheets).toEqual([])
  })

  it('is an invalid selector when the selector throws, painting nothing and hiding no caret', async () => {
    const covered = boxed({ x: 0, y: 0, width: 10, height: 10 })
    const { document, created } = fakeCaptureDocument({ invalid: ['#card['], matches: { '.ad': [covered] } })

    expect(
      await openPreparation(document).prepare({ element: '#card[', masks: [{ name: 'ad', selector: '.ad' }] }),
    ).toEqual({
      outcome: 'invalid-selector',
      of: 'element',
      message: "Failed to execute 'querySelectorAll' on 'Document': '#card[' is not a valid selector.",
    })
    expect(created).toEqual([])
    expect(document.adoptedStyleSheets).toEqual([])
  })
})

describe('the scroll', () => {
  it('is read once per preparation, for the element and every mask', async () => {
    const elements = [boxed({ x: 1, y: 2, width: 3, height: 4 }), boxed({ x: 5, y: 6, width: 7, height: 8 })]
    const { document } = fakeCaptureDocument({ matches: { '#card': [elements[0] ?? {}], '.ad': elements } })
    let reads = 0

    Object.defineProperty(Reflect.get(document, 'defaultView'), 'scrollY', {
      get: () => {
        reads += 1

        return 10
      },
    })
    await openPreparation(document).prepare({ element: '#card', masks: [{ name: 'ads', selector: '.ad' }] })
    expect(reads).toBe(1)
  })
})

describe('selector masks', () => {
  it("cover each matching element with an area by its box, with the page's scroll, not rounded", async () => {
    const elements = [
      boxed({ x: 10.5, y: 20.25, width: 30.5, height: 40 }),
      boxed({ x: 0, y: 0, width: 0, height: 10 }),
      boxed({ x: 1, y: 2, width: 3, height: 4 }),
    ]
    const { document, created } = fakeCaptureDocument({ matches: { '.ad': elements }, scroll: { x: 0, y: 100 } })

    expect(await openPreparation(document).prepare({ masks: [{ name: 'ads', selector: '.ad' }] })).toEqual({
      outcome: 'ready',
      box: null,
    })
    expect(created[0]?.children.map((mask) => mask.style.cssText)).toEqual([
      maskStyle({ x: 10.5, y: 120.25, width: 30.5, height: 40 }),
      maskStyle({ x: 1, y: 102, width: 3, height: 4 }),
    ])
  })

  it('skip an element whose box cannot be read', async () => {
    const unreadable = fakeElement('div', {
      properties: {
        getBoundingClientRect: () => {
          throw new Error('TypeError: Illegal invocation.')
        },
      },
    })
    const { document, created } = fakeCaptureDocument({
      matches: { '.ad': [unreadable, boxed({ x: 1, y: 2, width: 3, height: 4 })] },
    })

    expect(await openPreparation(document).prepare({ masks: [{ name: 'ads', selector: '.ad' }] })).toEqual({
      outcome: 'ready',
      box: null,
    })
    expect(created[0]?.children.map((mask) => mask.style.cssText)).toEqual([
      maskStyle({ x: 1, y: 2, width: 3, height: 4 }),
    ])
  })

  it('give an invalid selector, naming the mask, painting nothing, hiding no caret and searching nothing', async () => {
    const { document, created } = fakeCaptureDocument({
      invalid: ['.ad['],
      matches: { '.clock': [boxed({ x: 1, y: 2, width: 3, height: 4 })] },
    })
    const page = openPreparation(document)

    expect(
      await page.prepare({
        masks: [
          { name: 'clock', selector: '.clock' },
          { name: 'images', host: 'images.example.com' },
          { name: 'ads', selector: '.ad[' },
        ],
      }),
    ).toEqual({
      outcome: 'invalid-selector',
      of: 'mask',
      name: 'ads',
      message: "Failed to execute 'querySelectorAll' on 'Document': '.ad[' is not a valid selector.",
    })
    expect(created).toEqual([])
    expect(document.adoptedStyleSheets).toEqual([])
    expect(page.findRemoteContent).not.toHaveBeenCalled()
  })
})

describe('host masks', () => {
  it('run no remote content search when there is none', async () => {
    const { document } = fakeCaptureDocument({ matches: { '.ad': [boxed({ x: 1, y: 2, width: 3, height: 4 })] } })
    const page = openPreparation(document)

    await page.prepare({ masks: [{ name: 'ads', selector: '.ad' }] })
    expect(page.findRemoteContent).not.toHaveBeenCalled()
  })

  it('search once with the time limit, covering items whose host or hostname is the lowercase mask host', async () => {
    const items = [
      item('images.example.com:8443', { x: 1, y: 2, width: 3, height: 4 }),
      item('cdn.example.com', { x: 10.5, y: 20, width: 30, height: 40 }),
      item('other.example.com', { x: 50, y: 50, width: 5, height: 5 }),
      item('images.example.com', { x: 5, y: 6, width: 7, height: 8 }),
    ]
    const { document, created } = fakeCaptureDocument()
    const page = openPreparation(document, { remoteContent: async () => ({ outcome: 'found', items }) })

    expect(
      await page.prepare({
        masks: [
          { name: 'images', host: 'Images.Example.com' },
          { name: 'cdn', host: 'CDN.example.com' },
          { name: 'images on 8443', host: 'images.example.com:8443' },
        ],
      }),
    ).toEqual({ outcome: 'ready', box: null })
    expect(page.findRemoteContent.mock.calls).toEqual([[5000]])
    expect(created[0]?.children.map((mask) => mask.style.cssText)).toEqual([
      maskStyle({ x: 1, y: 2, width: 3, height: 4 }),
      maskStyle({ x: 5, y: 6, width: 7, height: 8 }),
      maskStyle({ x: 10.5, y: 20, width: 30, height: 40 }),
      maskStyle({ x: 1, y: 2, width: 3, height: 4 }),
    ])
  })

  it('pass a search that timed out through, painting nothing and hiding no caret', async () => {
    const { document, created } = fakeCaptureDocument({
      matches: { '.ad': [boxed({ x: 1, y: 2, width: 3, height: 4 })] },
    })
    const page = openPreparation(document, { remoteContent: async () => ({ outcome: 'timed-out' }) })

    expect(
      await page.prepare({
        masks: [
          { name: 'ads', selector: '.ad' },
          { name: 'images', host: 'images.example.com' },
        ],
      }),
    ).toEqual({ outcome: 'timed-out' })
    expect(created).toEqual([])
    expect(document.adoptedStyleSheets).toEqual([])
  })

  it('fail to paint when the search rejects, which it never does, hiding no caret', async () => {
    const { document, created } = fakeCaptureDocument()
    const page = openPreparation(document, {
      remoteContent: async () => {
        throw new Error('The search failed.')
      },
    })

    expect(await page.prepare({ masks: [{ name: 'images', host: 'images.example.com' }] })).toEqual({
      outcome: 'paint-failed',
      message: 'The search failed.',
    })
    expect(created).toEqual([])
    expect(document.adoptedStyleSheets).toEqual([])
  })
})

describe('painting', () => {
  it("puts the boxes, in maskColor, in a manual popover under the root element, shown once they're in", async () => {
    const { document, created, events } = fakeCaptureDocument({
      matches: { '.ad': [boxed({ x: 1, y: 2, width: 3, height: 4 }), boxed({ x: 5, y: 6, width: 7, height: 8 })] },
    })

    await openPreparation(document).prepare({ masks: [{ name: 'ads', selector: '.ad' }], maskColor: '#0F0' })
    expect(created.map((element) => element.localName)).toEqual(['visual-check-masks', 'div', 'div'])
    expect(created[0]?.attributes).toEqual({ popover: 'manual' })
    expect(created[0]?.style.cssText).toBe(hostStyleOf())
    expect(created[0]?.children.map((mask) => mask.style.cssText)).toEqual([
      maskStyle({ x: 1, y: 2, width: 3, height: 4 }, '#0F0'),
      maskStyle({ x: 5, y: 6, width: 7, height: 8 }, '#0F0'),
    ])
    expect(events).toEqual([
      'append div to visual-check-masks',
      'append div to visual-check-masks',
      'append visual-check-masks to html',
      'showPopover visual-check-masks',
    ])
  })

  it.each([
    ['throws', 'throws'],
    ['is missing', 'missing'],
  ] as const)('puts the host over the page by z-index when showPopover %s', async (_what, popover) => {
    const { document, created } = fakeCaptureDocument({
      matches: { '.ad': [boxed({ x: 1, y: 2, width: 3, height: 4 })] },
      popover,
    })

    expect(await openPreparation(document).prepare({ masks: [{ name: 'ads', selector: '.ad' }] })).toEqual({
      outcome: 'ready',
      box: null,
    })
    expect(created[0]?.style.cssText).toBe(`${hostStyleOf()}; z-index: 2147483647 !important`)
  })

  it("sizes the host to the scrollable area, clipping boxes past the document's edge so it can't grow", async () => {
    const { document, created } = fakeCaptureDocument({
      matches: { '.ad': [boxed({ x: 1200, y: 1900, width: 300, height: 400 })] },
      size: { width: 1280, height: 2000.5 },
    })

    await openPreparation(document).prepare({ masks: [{ name: 'ads', selector: '.ad' }] })
    expect(created[0]?.style.cssText).toBe(hostStyleOf(1280, 2000.5))
  })

  it.each([
    ['cannot be read', undefined],
    ['is not a number', { scrollWidth: '1280px', scrollHeight: 2000 }],
  ])("lets the boxes show past the host when the document's size %s", async (_what, root) => {
    const { document, created } = fakeCaptureDocument({
      matches: { '.ad': [boxed({ x: 1, y: 2, width: 3, height: 4 })] },
    })
    const documentElement = Reflect.get(document, 'documentElement')

    Object.defineProperties(documentElement, {
      scrollWidth: {
        get: () => {
          if (root === undefined) {
            throw new Error('TypeError: Illegal invocation.')
          }

          return root.scrollWidth
        },
      },
      scrollHeight: { get: () => root?.scrollHeight },
    })
    await openPreparation(document).prepare({ masks: [{ name: 'ads', selector: '.ad' }] })
    expect(created[0]?.style.cssText).toBe(hostStyleOf(0, 0).replace('overflow: clip', 'overflow: visible'))
  })

  it('creates nothing when no mask covers anything', async () => {
    const { document, created } = fakeCaptureDocument()

    expect(
      await openPreparation(document).prepare({
        masks: [
          { name: 'ads', selector: '.ad' },
          { name: 'images', host: 'images.example.com' },
        ],
      }),
    ).toEqual({ outcome: 'ready', box: null })
    expect(created).toEqual([])
  })

  it('fails to paint, hiding no caret, when creating an element throws', async () => {
    const { document } = fakeCaptureDocument({
      matches: {
        '.ad': [boxed({ x: 1, y: 2, width: 3, height: 4 })],
        '#card': [boxed({ x: 0, y: 0, width: 9, height: 9 })],
      },
    })

    Object.assign(document, {
      createElement: () => {
        throw new Error('NotSupportedError: no elements.')
      },
    })
    expect(
      await openPreparation(document).prepare({ element: '#card', masks: [{ name: 'ads', selector: '.ad' }] }),
    ).toEqual({ outcome: 'paint-failed', message: 'NotSupportedError: no elements.' })
    expect(document.adoptedStyleSheets).toEqual([])
  })

  it('answers ready, creating nothing, when creating an element would throw but no mask covers anything', async () => {
    const { document } = fakeCaptureDocument()

    Object.assign(document, {
      createElement: () => {
        throw new Error('NotSupportedError: no elements.')
      },
    })
    expect(await openPreparation(document).prepare({ masks: [{ name: 'ads', selector: '.ad' }] })).toEqual({
      outcome: 'ready',
      box: null,
    })
    expect(sheetsOf(document)).toEqual([{ madeBy: 'top', text: caretRule }])
  })
})

describe('the caret', () => {
  it('is hidden in the document, recorded and open shadow roots and same-origin frames, with no masks', async () => {
    const nestedRoot = fakeShadowRoot()
    const openRoot = fakeShadowRoot([fakeElement('span', { shadowRoot: nestedRoot })])
    const recordedRoot = fakeShadowRoot()
    const innerFrame = fakeCaptureDocument({ name: 'inner' })
    const frameRoot = fakeShadowRoot()
    const frame = fakeCaptureDocument({
      name: 'frame',
      elements: [
        fakeElement('div', { shadowRoot: frameRoot }),
        fakeElement('frame', { properties: { contentDocument: innerFrame.document } }),
      ],
    })
    const { document } = fakeCaptureDocument({
      elements: [
        fakeElement('div', { shadowRoot: openRoot }),
        fakeElement('iframe', { properties: { contentDocument: frame.document } }),
        fakeElement('iframe', { properties: { contentDocument: null } }),
      ],
    })

    expect(await openPreparation(document, { shadowRoots: [recordedRoot] }).prepare({})).toEqual({
      outcome: 'ready',
      box: null,
    })

    const top = { madeBy: 'top', text: caretRule }

    expect([document, recordedRoot, openRoot, nestedRoot].map(sheetsOf)).toEqual([[top], [top], [top], [top]])
    expect([frame.document, frameRoot].map(sheetsOf)).toEqual([
      [{ madeBy: 'frame', text: caretRule }],
      [{ madeBy: 'frame', text: caretRule }],
    ])
    expect(sheetsOf(innerFrame.document)).toEqual([{ madeBy: 'inner', text: caretRule }])
  })

  it("is hidden in the closed shadow roots a same-origin frame's page script recorded", async () => {
    const closedRoot = fakeShadowRoot()
    const frame = fakeCaptureDocument({ name: 'frame' })
    const { document } = fakeCaptureDocument({
      elements: [
        fakeElement('iframe', {
          properties: {
            contentDocument: frame.document,
            contentWindow: { __visualCheck: { shadowRoots: [closedRoot] } },
          },
        }),
        fakeElement('iframe', {
          properties: { contentDocument: fakeCaptureDocument({ name: 'bare' }).document, contentWindow: {} },
        }),
      ],
    })

    await openPreparation(document).prepare({})
    expect([frame.document, closedRoot].map(sheetsOf)).toEqual([
      [{ madeBy: 'frame', text: caretRule }],
      [{ madeBy: 'frame', text: caretRule }],
    ])
  })

  it("keeps the stylesheets a root adopted, adding the caret's after them", async () => {
    const own = { madeBy: 'page', text: 'p { color: red; }' }
    const { document } = fakeCaptureDocument()

    document.adoptedStyleSheets = [own]
    await openPreparation(document).prepare({})
    expect(sheetsOf(document)).toEqual([own, { madeBy: 'top', text: caretRule }])
  })

  it('is hidden in the other roots when one cannot adopt the stylesheet', async () => {
    const stubborn = fakeShadowRoot()
    const recordedRoot = fakeShadowRoot()
    const { document } = fakeCaptureDocument()

    Object.defineProperty(stubborn, 'adoptedStyleSheets', {
      get: () => [],
      set: () => {
        throw new Error('NotAllowedError: not this sheet.')
      },
    })
    expect(await openPreparation(document, { shadowRoots: [stubborn, recordedRoot] }).prepare({})).toEqual({
      outcome: 'ready',
      box: null,
    })
    expect([document, recordedRoot].map(sheetsOf)).toEqual([
      [{ madeBy: 'top', text: caretRule }],
      [{ madeBy: 'top', text: caretRule }],
    ])
  })

  it.each([
    ['has no CSSStyleSheet', { scrollX: 0, scrollY: 0 }],
    ['cannot be read', undefined],
  ])("is left alone when the document's window %s, still answering ready", async (_what, view) => {
    const element = boxed({ x: 10, y: 20, width: 30, height: 40 })
    const { document } = fakeCaptureDocument({ matches: { '#card': [element] } })

    Object.defineProperty(document, 'defaultView', {
      get: () => {
        if (view === undefined) {
          throw new Error('SecurityError: no window.')
        }

        return view
      },
    })
    expect(await openPreparation(document).prepare({ element: '#card' })).toEqual({
      outcome: 'ready',
      box: { x: 10, y: 20, width: 30, height: 40 },
    })
    expect(document.adoptedStyleSheets).toEqual([])
  })
})

describe('readCapturePrep', () => {
  it('reads a capture ready for the full page', () => {
    expect(readCapturePrep({ outcome: 'ready', box: null })).toEqual({ outcome: 'ready', box: null })
  })

  it("reads a capture ready for the element's box, keeping only its sides", () => {
    expect(readCapturePrep({ outcome: 'ready', box: { x: 0, y: 5, width: 10, height: 20, extra: true } })).toEqual({
      outcome: 'ready',
      box: { x: 0, y: 5, width: 10, height: 20 },
    })
  })

  it.each(['nothing', 'zero-size'])('reads an element that is missing, having found %s', (found) => {
    expect(readCapturePrep({ outcome: 'element-missing', found })).toEqual({ outcome: 'element-missing', found })
  })

  it("reads an invalid element selector, with the browser's message", () => {
    const answer = { outcome: 'invalid-selector', of: 'element', message: "'a[' is not a valid selector." }

    expect(readCapturePrep(answer)).toEqual(answer)
  })

  it("reads an invalid mask selector, with the mask's name and the browser's message", () => {
    const answer = { outcome: 'invalid-selector', of: 'mask', name: 'ads', message: "'a[' is not a valid selector." }

    expect(readCapturePrep(answer)).toEqual(answer)
  })

  it.each(['timed-out', 'script-missing'])('reads %s', (outcome) => {
    expect(readCapturePrep({ outcome })).toEqual({ outcome })
  })

  it("reads masks that couldn't be painted, with what was thrown", () => {
    const answer = { outcome: 'paint-failed', message: 'NotSupportedError: no elements.' }

    expect(readCapturePrep(answer)).toEqual(answer)
  })

  it.each([
    ['a number', 42],
    ['null', null],
    ['ready without a box', { outcome: 'ready' }],
    ['a box that is not an object', { outcome: 'ready', box: 'full-page' }],
    ['a box with a side missing', { outcome: 'ready', box: { x: 0, y: 0, width: 10 } }],
    ['a box with a side that is not whole', { outcome: 'ready', box: { x: 0.5, y: 0, width: 10, height: 10 } }],
    ['a box with a side that is not finite', { outcome: 'ready', box: { x: 0, y: 0, width: Infinity, height: 10 } }],
    ['a box with a side that is text', { outcome: 'ready', box: { x: '0', y: 0, width: 10, height: 10 } }],
    ['a box left of the document', { outcome: 'ready', box: { x: -1, y: 0, width: 10, height: 10 } }],
    ['a box above the document', { outcome: 'ready', box: { x: 0, y: -1, width: 10, height: 10 } }],
    ['a box of zero width', { outcome: 'ready', box: { x: 0, y: 0, width: 0, height: 10 } }],
    ['a box of zero height', { outcome: 'ready', box: { x: 0, y: 0, width: 10, height: 0 } }],
    ['a missing element that found something else', { outcome: 'element-missing', found: 'hidden' }],
    ['an invalid selector of something else', { outcome: 'invalid-selector', of: 'story', message: 'bad' }],
    ['an invalid element selector without a message', { outcome: 'invalid-selector', of: 'element' }],
    ['an invalid mask selector without a name', { outcome: 'invalid-selector', of: 'mask', message: 'bad' }],
    ['masks that could not be painted without a message', { outcome: 'paint-failed' }],
    ['an unknown outcome', { outcome: 'painted' }],
  ])('throws on %s, quoting it', (_what, value) => {
    expect(() => readCapturePrep(value)).toThrow(
      `Preparing the capture in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`,
    )
  })
})
