import { FakeImageCopy, type FakeImageFile, fakeCreateElement } from './media.fixture.js'

/**
 * Storybook's origin in a fake page: the top document's, and a same-origin frame's.
 */
export const storybookOrigin = 'http://localhost:6006'

/**
 * The SVG namespace.
 */
const svgNamespace = 'http://www.w3.org/2000/svg'

/**
 * The HTML namespace.
 */
const htmlNamespace = 'http://www.w3.org/1999/xhtml'

/**
 * A box in CSS pixels, in its document's viewport: where a fake element is, or where the search says remote content is,
 * in the top document.
 */
export interface FakeBox {
  /**
   * The box's left edge.
   */
  x: number
  /**
   * The box's top edge.
   */
  y: number
  /**
   * The box's width.
   */
  width: number
  /**
   * The box's height.
   */
  height: number
}

/**
 * Computed style values, by property name, such as `background-image`. A property not listed is `none`, a padding
 * `0px`, `visibility` `visible` on an element and its element's on a pseudo-element, which inherits it, and `content`
 * `normal` on an element and `none` on a pseudo-element, as the browser computes them by default.
 */
type FakeStyles = Record<string, string>

/**
 * How a fake element is set up. Each part has a default, given with it.
 */
interface FakeElementParts {
  /**
   * The element's border box: 10, 20, 100 × 50 by default.
   */
  box?: FakeBox | undefined
  /**
   * The element's namespace: HTML by default.
   */
  namespaceURI?: string
  /**
   * The element's attributes: none by default.
   */
  attributes?: Record<string, string>
  /**
   * The element's computed style: the defaults by default.
   */
  styles?: FakeStyles
  /**
   * The computed style of the element's `::before`: the defaults by default, so it isn't generated.
   */
  before?: FakeStyles
  /**
   * The computed style of the element's `::after`: the defaults by default, so it isn't generated.
   */
  after?: FakeStyles
  /**
   * Whether reading the element's computed style throws: no by default.
   */
  stylesThrow?: boolean
  /**
   * The element's open shadow root: none by default.
   */
  shadowRoot?: object
  /**
   * What else the element has, such as `src`, `currentSrc`, `poster` or `contentDocument`: nothing by default.
   */
  properties?: Record<string, unknown>
}

/**
 * The computed styles of each fake element, by pseudo-element: `element`, `::before` and `::after`. Elements whose
 * computed style throws hold `undefined`.
 */
const computedStyles = new WeakMap<object, Record<string, FakeStyles> | undefined>()

/**
 * Builds a fake element with this tag name, set up as `parts` says.
 */
export function fakeElement(localName: string, parts: FakeElementParts = {}): object {
  const {
    box = { x: 10, y: 20, width: 100, height: 50 },
    namespaceURI = htmlNamespace,
    attributes = {},
    styles = {},
    before = {},
    after = {},
    stylesThrow = false,
    shadowRoot = null,
    properties = {},
  } = parts
  const element = {
    localName,
    namespaceURI,
    shadowRoot,
    getBoundingClientRect: () => ({
      ...box,
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
    }),
    hasAttribute: (name: string) => name in attributes,
    getAttribute: (name: string) => attributes[name] ?? null,
    ...properties,
  }

  computedStyles.set(element, stylesThrow ? undefined : { element: styles, '::before': before, '::after': after })

  return element
}

/**
 * How a fake `<img>` starts. Each part has a default, given with it.
 */
interface FakeImgOptions {
  /**
   * The image's `src`, as the browser resolves it.
   */
  src: string
  /**
   * The source the browser picked from the `srcset`, a `<picture>`'s `<source>` or `src`: `src` by default.
   */
  currentSrc?: string
  /**
   * Whether the image finished loading: yes by default.
   */
  complete?: boolean
  /**
   * The image's natural width: 40 by default, 0 for a broken image.
   */
  naturalWidth?: number
  /**
   * The image's `crossorigin` attribute: none by default.
   */
  crossorigin?: string
  /**
   * Whether a service worker made the response the image shows, so drawing it doesn't taint a canvas: no by default,
   * it came through as an opaque response.
   */
  mocked?: boolean
  /**
   * The image's border box: 10, 20, 100 × 50 by default.
   */
  box?: FakeBox
  /**
   * The image's computed `visibility`: `visible` by default.
   */
  visibility?: string
}

/**
 * Builds a fake `<img>`, complete and showing an opaque response unless `options` says otherwise.
 */
export function fakeImg({
  src,
  currentSrc = src,
  complete = true,
  naturalWidth = 40,
  crossorigin,
  mocked = false,
  box,
  visibility = 'visible',
}: FakeImgOptions): object {
  return fakeElement('img', {
    box,
    styles: { visibility },
    attributes: crossorigin === undefined ? {} : { crossorigin },
    properties: { src, currentSrc, complete, naturalWidth, tainted: !mocked },
  })
}

/**
 * How a fake SVG `<image>` starts. Each part has a default, given with it.
 */
interface FakeSvgImageOptions {
  /**
   * The image's `href` attribute, as `href.baseVal` gives it: empty by default.
   */
  href?: string
  /**
   * The image's `xlink:href` attribute: none by default.
   */
  xlinkHref?: string
  /**
   * The base URL the image's URLs resolve against: Storybook's preview by default.
   */
  baseURI?: string
}

/**
 * Builds a fake SVG `<image>`, with neither `href` nor `xlink:href` unless `options` says otherwise.
 */
export function fakeSvgImage({
  href = '',
  xlinkHref,
  baseURI = `${storybookOrigin}/iframe.html`,
}: FakeSvgImageOptions): object {
  return fakeElement('image', {
    namespaceURI: svgNamespace,
    attributes: xlinkHref === undefined ? {} : { 'xlink:href': xlinkHref },
    properties: { href: { baseVal: href }, baseURI },
  })
}

/**
 * How a fake `<iframe>` or `<frame>` starts. Each part has a default, given with it.
 */
interface FakeFrameOptions {
  /**
   * The frame's document when it's reachable, as a same-origin or `srcdoc` one is: `null` by default, as a cross-origin
   * one gives.
   */
  contentDocument?: object | null
  /**
   * The frame's `src`, as the browser resolves it: empty by default.
   */
  src?: string
  /**
   * The frame's border box: 10, 20, 100 × 50 by default.
   */
  box?: FakeBox
  /**
   * The width of the frame's border on every side, in CSS pixels: 0 by default.
   */
  border?: number
  /**
   * The frame's padding on every side, in CSS pixels: 0 by default.
   */
  padding?: number
  /**
   * The frame's tag name: `iframe` by default.
   */
  localName?: string
  /**
   * The frame's computed `visibility`: `visible` by default.
   */
  visibility?: string
}

/**
 * Builds a fake `<iframe>`, cross-origin, without border or padding, unless `options` says otherwise.
 */
export function fakeFrame({
  contentDocument = null,
  src = '',
  box = { x: 10, y: 20, width: 100, height: 50 },
  border = 0,
  padding = 0,
  localName = 'iframe',
  visibility = 'visible',
}: FakeFrameOptions): object {
  const paddings = ['left', 'top', 'right', 'bottom'].map((side) => [`padding-${side}`, `${padding}px`])

  return fakeElement(localName, {
    box,
    styles: { ...Object.fromEntries(paddings), visibility },
    properties: {
      contentDocument,
      src,
      clientLeft: border,
      clientTop: border,
      clientWidth: box.width - 2 * border,
      clientHeight: box.height - 2 * border,
    },
  })
}

/**
 * A fake shadow root: the stylesheets it adopted.
 */
export interface FakeShadowRoot {
  /**
   * The stylesheets the root adopted, in order: none until a script adopts some.
   */
  adoptedStyleSheets: object[]
}

/**
 * Gives the elements of a root that a selector matches: every one for `*`, its frames for `iframe, frame`, and none
 * for any other selector.
 */
export function elementsMatching(elements: object[], selector: string): object[] {
  if (selector === '*') {
    return elements
  }

  if (selector !== 'iframe, frame') {
    return []
  }

  return elements.filter((element) => ['iframe', 'frame'].includes(String(Reflect.get(element, 'localName'))))
}

/**
 * Builds a fake shadow root holding these elements, which adopted no stylesheet yet. It answers `*` and
 * `iframe, frame` as `elementsMatching` says.
 */
export function fakeShadowRoot(elements: object[] = []): FakeShadowRoot {
  const root = {
    adoptedStyleSheets: [],
    querySelectorAll: (selector: string) => elementsMatching(elements, selector),
  }

  return root
}

/**
 * How the server, through a service worker, gives an image a fresh `Image` loads: the worker passes the request
 * through and the cross-origin image comes as an opaque response, or the worker makes the response itself, or the
 * image fails to load, or it never comes.
 */
type FakeResponse = 'passthrough' | 'mocked' | 'fails' | 'stalls'

/**
 * The image file a fake response stands for.
 */
const responseFiles: Record<FakeResponse, FakeImageFile> = {
  passthrough: { origin: 'cross-origin-without-cors' },
  mocked: { origin: 'same-origin' },
  fails: { arrival: 'fails' },
  stalls: { arrival: 'stalls' },
}

/**
 * What a fake page document holds. Each part has a default, given with it.
 */
interface FakePageDocumentParts {
  /**
   * The document's elements, outside shadow roots: none by default.
   */
  elements?: object[]
  /**
   * The origin of the document's location: Storybook's by default.
   */
  origin?: string
  /**
   * How far the document is scrolled, in CSS pixels: not at all by default.
   */
  scroll?: { x: number; y: number }
  /**
   * Whether a service worker controls the document: no by default.
   */
  controlled?: boolean
  /**
   * How each image a fresh `Image` loads comes, by URL: an image not listed comes as a response the worker made.
   */
  responses?: Record<string, FakeResponse>
}

/**
 * A fake document for the remote content search, and what the search did in it.
 */
export interface FakePageDocument {
  /**
   * The document, to set as the page's `document` global or as a frame's `contentDocument`.
   */
  readonly document: object
  /**
   * How many canvases the document created.
   */
  readonly canvases: () => number
  /**
   * The URLs the fresh images of the document's window loaded, in order.
   */
  readonly loads: () => string[]
}

/**
 * Builds a fake document holding these elements, with its window: its location's origin, its scroll position, its
 * computed styles, its `Image` class and whether a service worker controls it.
 */
export function fakePageDocument({
  elements = [],
  origin = storybookOrigin,
  scroll = { x: 0, y: 0 },
  controlled = false,
  responses = {},
}: FakePageDocumentParts = {}): FakePageDocument {
  const files = Object.fromEntries(Object.entries(responses).map(([url, response]) => [url, responseFiles[response]]))
  const createElement = fakeCreateElement(files)
  const images: FakeImageCopy[] = []
  let canvases = 0
  const view = {
    location: { origin },
    scrollX: scroll.x,
    scrollY: scroll.y,
    navigator: { serviceWorker: { controller: controlled ? {} : null } },
    getComputedStyle: (element: object, pseudoElement?: string | null) => {
      const styles = computedStyles.get(element)

      if (styles === undefined) {
        throw new Error('TypeError: not an element.')
      }

      const key = pseudoElement ?? 'element'
      const own = styles[key] ?? {}
      const inherited: FakeStyles =
        key === 'element' || styles.element?.visibility === undefined ? {} : { visibility: styles.element.visibility }

      return {
        getPropertyValue: (name: string) => own[name] ?? inherited[name] ?? defaultStyle(name, key),
      }
    },
    Image: class extends FakeImageCopy {
      /**
       * Builds an image of the document's window, which loads files as `responses` says.
       */
      constructor() {
        super(files)
        images.push(this)
      }
    },
  }
  const document = {
    defaultView: view,
    querySelectorAll: (selector: string) => elementsMatching(elements, selector),
    createElement: (localName: string) => {
      if (localName === 'canvas') {
        canvases += 1
      }

      return createElement(localName)
    },
  }

  return { document, canvases: () => canvases, loads: () => images.map((image) => image.src) }
}

/**
 * Gives the value the browser computes for `name` by default on an element or on its `::before` or `::after`.
 */
function defaultStyle(name: string, pseudoElement: string): string {
  if (name === 'content') {
    return pseudoElement === 'element' ? 'normal' : 'none'
  }

  if (name === 'visibility') {
    return 'visible'
  }

  return name.startsWith('padding-') ? '0px' : 'none'
}
