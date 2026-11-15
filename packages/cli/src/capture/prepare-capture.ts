import type { CaptureBox } from './driver/driver.js'
import { pageRootsFunction } from './page-roots.js'

/**
 * A mask of a story: an opaque box painted over part of it just before capture.
 *
 * @public
 */
export type StoryMask =
  | {
      /**
       * The mask's name, as the story's options give it.
       */
      name: string
      /**
       * The CSS selector of the elements it covers, each by its box.
       */
      selector: string
    }
  | {
      /**
       * The mask's name, as the story's options give it.
       */
      name: string
      /**
       * The host whose remote content it covers, such as `images.example.com`, with its port when the URL has one.
       */
      host: string
    }

/**
 * What the page prepares a capture with.
 */
export interface CapturePrepRequest {
  /**
   * The CSS selector of the element whose box is captured, or `null` for the full page.
   */
  element: string | null
  /**
   * The masks to paint, in order.
   */
  masks: readonly StoryMask[]
  /**
   * The colour the masks are painted in: `#RGB` or `#RRGGBB`.
   */
  maskColor: string
}

/**
 * The source of a function, evaluated in the page as part of the page script, that creates the capture preparation.
 * It takes what the page script kept at document start: `shadowRoots`, `findRemoteContent`, the remote content search,
 * and `stateGlobal`, the name of the global it keeps its state under in every document. It gives a function that takes
 * a request, `{ element, masks, maskColor }`, and a time limit in ms, and prepares the page for its capture. Creating
 * it reads nothing in the page. It reads the page's scroll once.
 *
 * 1. Measures the element, when `element` isn't `null`: the first match of the selector in the top document. A
 *    selector that throws gives `{ outcome: 'invalid-selector', of: 'element', message }`. No match gives
 *    `{ outcome: 'element-missing', found: 'nothing' }`. Its box is the border box, with the page's scroll, out to
 *    whole pixels: the left and top edges rounded down and kept at 0 or more, the right and bottom edges rounded up. A
 *    box of zero width or height, before or after that, or one that can't be read, gives `found: 'zero-size'`.
 * 2. Finds the masks' boxes. A selector mask covers each element of the top document that matches it and has an
 *    area, by its border box, with the page's scroll, not rounded. A selector that throws gives
 *    `{ outcome: 'invalid-selector', of: 'mask', name, message }`. Host masks run the remote content search once, only
 *    when there's at least one, with the same time limit. Each item whose `host` or `hostname` is the mask's host, in
 *    lowercase, gives its box. A search that timed out gives `{ outcome: 'timed-out' }`.
 * 3. Paints the boxes, when there's at least one: one `visual-check-masks` element holding one `div` per box, in
 *    `maskColor`, appended to the top document's root element. Inline styles with `!important` keep the page's own
 *    styles off them. It's a manual popover, shown at once, so it sits in the top layer, over every dialog and popover
 *    opened before it. In the top layer, an absolutely positioned box's containing block is the initial containing
 *    block, so the host sits at the document's origin and each box lands at its document coordinates. When
 *    `showPopover()` throws or is missing, the host gets the highest `z-index` instead. The host takes the size of the
 *    document's scrollable area, read from its root element's `scrollWidth` and `scrollHeight` before painting, and
 *    clips what's past it. So a box past the document's edge, such as one of an element an ancestor's `overflow`
 *    clips, doesn't make the full page larger. When that size can't be read, the host has no size and clips nothing.
 *    Showing the popover fires `beforetoggle` and `toggle`, and appending under the root element reaches the page's
 *    MutationObservers. Nothing checks the page again after that, so a page reacting to them could change before the
 *    capture.
 * 4. Hides the text caret, which blinks: a constructed stylesheet that makes `caret-color` transparent on every
 *    element and its `::before` and `::after`. It's adopted by the top document, by the shadow roots the page script
 *    recorded, closed ones included, by every open shadow root, and by the document of every reachable frame, as a
 *    same-origin or `srcdoc` one's is, with the closed shadow roots the frame's own page script recorded, its open
 *    shadow roots and the frames in it. Each document gets a sheet made by its own window, as a constructed sheet can
 *    only be adopted in the document that made it.
 *
 * It answers `{ outcome: 'ready', box }`, where `box` is the element's box, or `null` for the full page. When the
 * element is missing, a selector is invalid or the search timed out, it paints nothing and hides no caret. It never
 * throws: painting and hiding the caret are best effort, so anything else that throws once the element was measured,
 * such as a mask element whose box can't be read or a root that can't adopt the sheet, leaves that part out and still
 * answers `ready`.
 */
export const prepareCaptureFunction = `(context) => {
  const { shadowRoots, findRemoteContent, stateGlobal } = context
  const { elementsOf, rootsOf, read, isObject, scrollOf } = (${pageRootsFunction})()

  // The tag name of the element that holds the painted masks. An unknown name with a hyphen gives an HTMLElement.
  const masksTagName = 'visual-check-masks'

  // The highest z-index, for a host that couldn't go in the top layer.
  const topZIndex = 2147483647

  // The rule that hides the text caret on every element of a root.
  const caretRule = '*, *::before, *::after { caret-color: transparent !important; }'

  // The message of what a selector threw.
  const messageOf = (error) =>
    read(() => (isObject(error) && typeof error.message === 'string' ? error.message : String(error)), 'It threw.')

  // How far the top document is scrolled, 0 along an axis that can't be read.
  const pageScrollOf = () => {
    const view = read(() => document.defaultView, undefined)
    return { x: scrollOf(view, 'scrollX'), y: scrollOf(view, 'scrollY') }
  }

  // The size of the top document's scrollable area, or undefined when it can't be read.
  const documentSizeOf = () => {
    const width = read(() => document.documentElement.scrollWidth, undefined)
    const height = read(() => document.documentElement.scrollHeight, undefined)
    const valid = (side) => typeof side === 'number' && Number.isFinite(side) && side >= 0
    return valid(width) && valid(height) ? { width, height } : undefined
  }

  // An element's border box, with the page's scroll, or undefined when it has no area or can't be read.
  const documentBoxOf = (element, scroll) => {
    const rect = read(() => element.getBoundingClientRect(), undefined)
    const sides = read(() => [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height], [])
    if (sides.length === 0 || !sides.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
      return undefined
    }
    return {
      left: rect.left + scroll.x,
      top: rect.top + scroll.y,
      right: rect.right + scroll.x,
      bottom: rect.bottom + scroll.y,
    }
  }

  // The box of the element the selector matches first, out to whole pixels, or why there's none.
  const elementBoxOf = (selector, scroll) => {
    let element
    try {
      element = document.querySelector(selector)
    } catch (error) {
      return { outcome: 'invalid-selector', of: 'element', message: messageOf(error) }
    }
    if (!isObject(element)) {
      return { outcome: 'element-missing', found: 'nothing' }
    }
    const box = documentBoxOf(element, scroll)
    if (box === undefined) {
      return { outcome: 'element-missing', found: 'zero-size' }
    }
    const x = Math.max(0, Math.floor(box.left))
    const y = Math.max(0, Math.floor(box.top))
    const width = Math.ceil(box.right) - x
    const height = Math.ceil(box.bottom) - y
    if (width <= 0 || height <= 0) {
      return { outcome: 'element-missing', found: 'zero-size' }
    }
    return { box: { x, y, width, height } }
  }

  // The boxes of the elements a selector mask covers, or why there are none.
  const selectorBoxesOf = (mask, scroll) => {
    let elements
    try {
      elements = Array.from(document.querySelectorAll(mask.selector))
    } catch (error) {
      return { outcome: 'invalid-selector', of: 'mask', name: mask.name, message: messageOf(error) }
    }
    return { boxes: elements.map((element) => documentBoxOf(element, scroll)).filter((box) => box !== undefined) }
  }

  // The boxes of the remote content the host masks cover, searching only when there's one.
  const hostBoxesOf = async (hostMasks, timeoutMs) => {
    if (hostMasks.length === 0) {
      return { boxes: [] }
    }
    const search = await findRemoteContent(timeoutMs)
    if (search.outcome === 'timed-out') {
      return { outcome: 'timed-out' }
    }
    const boxes = []
    for (const mask of hostMasks) {
      const host = mask.host.toLowerCase()
      for (const item of search.items) {
        if (item.host === host || item.hostname === host) {
          boxes.push({ left: item.x, top: item.y, right: item.x + item.width, bottom: item.y + item.height })
        }
      }
    }
    return { boxes }
  }

  // The boxes of every mask, selector masks first, or why there are none.
  const maskBoxesOf = async (masks, scroll, timeoutMs) => {
    const boxes = []
    for (const mask of masks) {
      if (typeof mask.selector === 'string') {
        const found = selectorBoxesOf(mask, scroll)
        if (found.outcome !== undefined) {
          return found
        }
        boxes.push(...found.boxes)
      }
    }
    const found = await hostBoxesOf(
      masks.filter((mask) => typeof mask.host === 'string'),
      timeoutMs,
    )
    return found.outcome === undefined ? { boxes: [...boxes, ...found.boxes] } : found
  }

  // The inline style of the element that holds the masks: a box at the document's origin, the size of its scrollable
  // area, clipping what's past it, or an empty box clipping nothing when that size can't be read.
  const hostStyleOf = (size) =>
    [
      'all: initial !important',
      'display: block !important',
      'position: absolute !important',
      'left: 0 !important',
      'top: 0 !important',
      'width: ' + (size === undefined ? 0 : size.width) + 'px !important',
      'height: ' + (size === undefined ? 0 : size.height) + 'px !important',
      'margin: 0 !important',
      'padding: 0 !important',
      'border: 0 !important',
      'overflow: ' + (size === undefined ? 'visible' : 'clip') + ' !important',
      'background: transparent !important',
      'pointer-events: none !important',
    ].join('; ')

  // The inline style of a painted box.
  const maskStyleOf = (box, maskColor) =>
    [
      'all: initial !important',
      'display: block !important',
      'position: absolute !important',
      'left: ' + box.left + 'px !important',
      'top: ' + box.top + 'px !important',
      'width: ' + (box.right - box.left) + 'px !important',
      'height: ' + (box.bottom - box.top) + 'px !important',
      'background: ' + maskColor + ' !important',
    ].join('; ')

  // Paints the boxes in a manual popover, so they sit in the top layer, or over the page by z-index when it can't.
  const paint = (boxes, maskColor) => {
    if (boxes.length === 0) {
      return
    }
    const hostStyle = hostStyleOf(documentSizeOf())
    const host = document.createElement(masksTagName)
    host.setAttribute('popover', 'manual')
    host.style.cssText = hostStyle
    for (const box of boxes) {
      const mask = document.createElement('div')
      mask.style.cssText = maskStyleOf(box, maskColor)
      host.appendChild(mask)
    }
    document.documentElement.appendChild(host)
    try {
      host.showPopover()
    } catch {
      host.style.cssText = hostStyle + '; z-index: ' + topZIndex + ' !important'
    }
  }

  // The shadow roots a frame's own page script recorded, closed ones included, or none when they can't be read.
  const recordedRootsOf = (frame) => {
    const recorded = read(() => frame.contentWindow[stateGlobal].shadowRoots, undefined)
    return Array.isArray(recorded) ? recorded : []
  }

  // Hides the caret in a document's roots with a sheet its own window made, then in the documents of its frames.
  const hideCaretIn = (hidden, recordedRoots) => {
    let sheet
    try {
      sheet = new hidden.defaultView.CSSStyleSheet()
      sheet.replaceSync(caretRule)
    } catch {
      return
    }
    for (const root of rootsOf(hidden, recordedRoots)) {
      try {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
      } catch {}
      for (const frame of elementsOf(root, 'iframe, frame')) {
        const frameDocument = read(() => frame.contentDocument, null)
        if (isObject(frameDocument)) {
          hideCaretIn(frameDocument, recordedRootsOf(frame))
        }
      }
    }
  }

  return async (request, timeoutMs) => {
    const { element, masks, maskColor } = request
    const scroll = pageScrollOf()
    const measured = element === null ? { box: null } : elementBoxOf(element, scroll)
    if (measured.outcome !== undefined) {
      return measured
    }
    try {
      const found = await maskBoxesOf(masks, scroll, timeoutMs)
      if (found.outcome !== undefined) {
        return found
      }
      paint(found.boxes, maskColor)
    } catch {}
    try {
      hideCaretIn(document, shadowRoots)
    } catch {}
    return { outcome: 'ready', box: measured.box }
  }
}`

/**
 * What preparing the page for its capture found.
 */
export type CapturePrep =
  | {
      /**
       * The masks are painted and the caret hidden, as far as the page let them be.
       */
      outcome: 'ready'
      /**
       * The element's box to capture, or `null` for the full page.
       */
      box: CaptureBox | null
    }
  | {
      /**
       * The element selector matched no element with an area.
       */
      outcome: 'element-missing'
      /**
       * What it found: no element at all, or one whose box has zero width or height.
       */
      found: 'nothing' | 'zero-size'
    }
  | {
      /**
       * The element selector isn't valid CSS.
       */
      outcome: 'invalid-selector'
      /**
       * Whose selector it is: the element's.
       */
      of: 'element'
      /**
       * What the browser said about it.
       */
      message: string
    }
  | {
      /**
       * A mask's selector isn't valid CSS.
       */
      outcome: 'invalid-selector'
      /**
       * Whose selector it is: a mask's.
       */
      of: 'mask'
      /**
       * The mask's name.
       */
      name: string
      /**
       * What the browser said about it.
       */
      message: string
    }
  | {
      /**
       * The time limit passed while the remote content search ran, for the host masks.
       */
      outcome: 'timed-out'
    }
  | {
      /**
       * The page script hadn't run in the page, so there was nothing to paint the masks with.
       */
      outcome: 'script-missing'
    }

/**
 * Whether a value is a box the page gives: whole numbers, `x` and `y` at least 0, and `width` and `height` over 0.
 */
function isCaptureBox(value: unknown): value is CaptureBox {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const { x, y, width, height }: Record<string, unknown> = { ...value }
  const sides = [x, y, width, height]

  if (!sides.every((side) => typeof side === 'number' && Number.isInteger(side))) {
    return false
  }

  return Number(x) >= 0 && Number(y) >= 0 && Number(width) > 0 && Number(height) > 0
}

/**
 * Reads an answer of the page that's ready, with the element's box or none. Gives `undefined` for any other answer.
 */
function readReady(answer: Record<string, unknown>): CapturePrep | undefined {
  const { box } = answer

  if (answer.outcome !== 'ready') {
    return undefined
  }

  if (box === null) {
    return { outcome: 'ready', box: null }
  }

  return isCaptureBox(box)
    ? { outcome: 'ready', box: { x: box.x, y: box.y, width: box.width, height: box.height } }
    : undefined
}

/**
 * Reads an answer of the page that says the element is missing, the search timed out or the page script didn't run.
 * Gives `undefined` for any other answer.
 */
function readNotReady(answer: Record<string, unknown>): CapturePrep | undefined {
  const { found } = answer

  if (answer.outcome === 'element-missing' && (found === 'nothing' || found === 'zero-size')) {
    return { outcome: 'element-missing', found }
  }

  if (answer.outcome === 'timed-out' || answer.outcome === 'script-missing') {
    return { outcome: answer.outcome }
  }

  return undefined
}

/**
 * Reads an answer of the page that says a selector isn't valid CSS. Gives `undefined` for any other answer.
 */
function readInvalidSelector(answer: Record<string, unknown>): CapturePrep | undefined {
  const { message, name } = answer

  if (answer.outcome !== 'invalid-selector' || typeof message !== 'string') {
    return undefined
  }

  if (answer.of === 'element') {
    return { outcome: 'invalid-selector', of: 'element', message }
  }

  return answer.of === 'mask' && typeof name === 'string'
    ? { outcome: 'invalid-selector', of: 'mask', name, message }
    : undefined
}

/**
 * Reads the value the capture preparation expression gave. Throws, quoting the value, when it's not an answer the page
 * gives.
 */
export function readCapturePrep(value: unknown): CapturePrep {
  const answer: Record<string, unknown> = typeof value === 'object' && value !== null ? { ...value } : {}
  const prep = readReady(answer) ?? readNotReady(answer) ?? readInvalidSelector(answer)

  if (prep !== undefined) {
    return prep
  }

  throw new Error(
    `Preparing the capture in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`,
  )
}
