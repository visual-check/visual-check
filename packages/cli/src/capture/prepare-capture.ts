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
  /**
   * Whether to bring back the remote content the page shows. Without it, and without a host mask, no remote content
   * search runs.
   */
  findRemote: boolean
}

/**
 * Remote content the page shows, as the capture preparation gives it: one item per element and host.
 */
export interface PageRemoteContent {
  /**
   * The host it comes from, such as `images.example.com`, with its port when the URL has one.
   */
  host: string
  /**
   * The distance from the top document's left edge to the element's border box, in CSS pixels, not rounded.
   */
  x: number
  /**
   * The distance from the top document's top edge to the element's border box, in CSS pixels, not rounded.
   */
  y: number
  /**
   * The border box's width, in CSS pixels, over 0.
   */
  width: number
  /**
   * The border box's height, in CSS pixels, over 0.
   */
  height: number
}

/**
 * The grids the page shows, as the capture preparation measures them: the widest grid's border-box width and the
 * tallest grid's height, in CSS pixels, not rounded.
 */
export interface PageGrid {
  /**
   * The widest grid's border-box width, in CSS pixels, not rounded.
   */
  width: number
  /**
   * The tallest grid's border-box height, in CSS pixels, not rounded.
   */
  height: number
}

/**
 * The overflow of a story's page, as the capture preparation measures it: how far content the capture would cut reaches
 * past each side of the capture, in CSS pixels, each rounded up, 0 on a side where nothing counts.
 */
export interface PageOverflow {
  /**
   * How far the element reaches past the page's top edge, in CSS pixels.
   */
  top: number
  /**
   * How far content reaches past the capture's right edge, in CSS pixels: the full page's content past the viewport's
   * right edge, or the element's content past its border box's.
   */
  right: number
  /**
   * How far the element's content spills past its border box's bottom edge, in CSS pixels.
   */
  bottom: number
  /**
   * How far the element reaches past the page's left edge, in CSS pixels.
   */
  left: number
}

/**
 * The source of a function, evaluated in the page as part of the page script, that creates the capture preparation.
 * It takes what the page script kept at document start: `shadowRoots`, `findRemoteContent`, the remote content search,
 * and `stateGlobal`, the name of the global it keeps its state under in every document. It gives a function that takes
 * a request, `{ element, masks, maskColor, findRemote }`, and a time limit in ms, and prepares the page for its capture.
 * Creating it reads nothing in the page. It reads the page's scroll once.
 *
 * 0. Measures the grids: every element of the top document with `data-visual-check-grid`, the attribute
 *    `@visual-check/storybook`'s grid puts on its element, by its border box. It keeps the widest grid's width and the
 *    tallest grid's height, in CSS pixels, not rounded. A grid whose box can't be read, or isn't finite, is left out.
 * 1. Measures the element, when `element` isn't `null`: the first match of the selector in the top document. A
 *    selector that throws gives `{ outcome: 'invalid-selector', of: 'element', message }`. No match gives
 *    `{ outcome: 'element-missing', found: 'nothing' }`. Its box is the border box, with the page's scroll, out to
 *    whole pixels and cut at the page's edge: the left and top edges rounded down and kept at 0 or more, the right and
 *    bottom edges kept within the document's scrollable area, read from its root element's `scrollWidth` and
 *    `scrollHeight`, and rounded up. When that size can't be read, the right and bottom edges aren't cut. A box of zero
 *    width or height, before or after that, or one that can't be read, gives `found: 'zero-size'`. Then it measures
 *    the overflow, content the capture would cut, as how far it reaches past each side, in CSS pixels. For the full
 *    page, that's the right side only: the root element's `scrollWidth` less its `clientWidth`, unless the root
 *    element or `body` has a computed `overflow-x` of `hidden` or `clip`, as the page cuts that itself. The capture
 *    takes the content's full height, and content left of the page's edge can't be scrolled to. For the element, the
 *    left and top sides are how far its border box, with the page's scroll, reaches past the page's left and top
 *    edges, where its box is cut. The right side is how far its content spills past its border box's right edge,
 *    only when its computed `overflow-x` is `visible`: the content's right edge is its border box's left edge, with
 *    the page's scroll, plus its `clientLeft` and its `scrollWidth`. Both edges are kept within the document's
 *    scrollable area when its size can be read. The bottom side is the same with `overflow-y`, `clientTop` and
 *    `scrollHeight`. Chrome's `scrollWidth` and `scrollHeight` of an element that doesn't clip cover descendants
 *    spilling right or down, transformed or absolutely positioned ones included, but not `position: fixed` ones, the
 *    top layer or a `box-shadow`, and scrollable overflow never reaches left or up, so content spilling left or up
 *    from an element isn't measured. A side counts when it's at least one whole CSS pixel, as Chrome rounds
 *    `scrollWidth` and `clientWidth` to whole pixels, and is rounded up. A side whose values can't be read, or aren't
 *    finite, doesn't count, nor does the full page's when the root element's or `body`'s style can't be read. When the
 *    element is missing or a selector is invalid, there's no overflow.
 * 2. Finds the masks' boxes. A selector mask covers each element of the top document that matches it and has an
 *    area, by its border box, with the page's scroll, not rounded. A selector that throws gives
 *    `{ outcome: 'invalid-selector', of: 'mask', name, message }`. Then the remote content search runs once, with the
 *    same time limit, only when there's a host mask or `findRemote` is true: host masks and `findRemote` share it.
 *    For a host mask, each item whose `host` or `hostname` is the mask's host, in lowercase, gives its box, and a
 *    search that timed out gives `{ outcome: 'timed-out' }`. With no host mask, a search that timed out or rejected
 *    leaves the remote content unknown and fails nothing.
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
 * It answers `{ outcome: 'ready', box }`, where `box` is the element's box, or `null` for the full page. When
 * `findRemote` is true and the search answered, it adds `remote`, the remote content found, maybe none: each item's
 * `host`, with its port when the URL has one, and its box, `x`, `y`, `width` and `height`, in CSS pixels of the top
 * document, as the search gives them. Without `remote`, the remote content is unknown. When the top document shows a
 * grid, it adds `grid`, the widest grid's width and the tallest grid's height. When at least one side of the overflow
 * counts, it adds `overflow`, `{ top, right, bottom, left }`, 0 on a side that doesn't. When the element is missing, a
 * selector is invalid or the search for a host mask timed out, it paints nothing and hides no caret. It never throws. A
 * mask must never fail open: when finding the masks' boxes or painting them throws, as when the search for a host mask
 * rejects or an element can't be created, it answers `{ outcome: 'paint-failed', message }` and hides no caret, with
 * what it painted so far left in the page. A mask element whose box can't be read covers nothing, and a host that can't
 * be shown as a popover takes the highest `z-index`, as said above. Hiding the caret is best effort: a root that can't
 * adopt the sheet is left out, and it still answers `ready`.
 */
export const prepareCaptureFunction = `(context) => {
  const { shadowRoots, findRemoteContent, stateGlobal } = context
  const { elementsOf, rootsOf, read, isObject, scrollOf, recordedRootsOf } = (${pageRootsFunction})()

  // The tag name of the element that holds the painted masks. An unknown name with a hyphen gives an HTMLElement.
  const masksTagName = 'visual-check-masks'

  // The attribute @visual-check/storybook's grid puts on its element, gridAttribute there. The CLI can't import that
  // package, so it's repeated here.
  const gridSelector = '[data-visual-check-grid]'

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

  // The widest grid's border-box width and the tallest grid's height, in CSS pixels, or undefined when the top document
  // shows no grid whose box can be read.
  const gridOf = () => {
    let grid
    for (const element of read(() => Array.from(document.querySelectorAll(gridSelector)), [])) {
      const rect = read(() => element.getBoundingClientRect(), undefined)
      const sides = read(() => [rect.width, rect.height], [])
      if (sides.length === 2 && sides.every((side) => Number.isFinite(side) && side >= 0)) {
        const [width, height] = sides
        grid =
          grid === undefined
            ? { width, height }
            : { width: Math.max(grid.width, width), height: Math.max(grid.height, height) }
      }
    }
    return grid
  }

  // The size of the top document's scrollable area, or undefined when it can't be read.
  const documentSizeOf = () => {
    const width = read(() => document.documentElement.scrollWidth, undefined)
    const height = read(() => document.documentElement.scrollHeight, undefined)
    const valid = (side) => typeof side === 'number' && Number.isFinite(side) && side >= 0
    return valid(width) && valid(height) ? { width, height } : undefined
  }

  // A number a getter reads, or undefined when it can't be read or isn't a finite number.
  const numberOf = (getter) => {
    const value = read(getter, undefined)
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }

  // The computed value of a CSS property of an element of the top document, or undefined when it can't be read.
  const computedOf = (element, property) => {
    const value = read(() => document.defaultView.getComputedStyle(element).getPropertyValue(property), undefined)
    return typeof value === 'string' ? value : undefined
  }

  // How far content reaches past a side of the capture, in CSS pixels: rounded up when it's at least one whole pixel,
  // and 0 when it's less or unknown, as Chrome rounds scrollWidth and clientWidth to whole pixels.
  const excessOf = (excess) =>
    typeof excess === 'number' && Number.isFinite(excess) && excess >= 1 ? Math.ceil(excess) : 0

  // The overflow on each side, or undefined when no side counts.
  const overflowOf = ({ top, right, bottom, left }) => {
    const overflow = { top: excessOf(top), right: excessOf(right), bottom: excessOf(bottom), left: excessOf(left) }
    return Object.values(overflow).some((side) => side > 0) ? overflow : undefined
  }

  // The full page's overflow: how far its content reaches past the viewport's right edge, or undefined when nothing
  // does, the root element or body clips it with overflow-x hidden or clip, or that can't be read.
  const pageOverflowOf = () => {
    const root = read(() => document.documentElement, undefined)
    const body = read(() => document.body, undefined)
    const clips = (element) => {
      const value = computedOf(element, 'overflow-x')
      return value === undefined || value === 'hidden' || value === 'clip'
    }
    if (!isObject(root) || [root, body].filter(isObject).some(clips)) {
      return undefined
    }
    const scrollWidth = numberOf(() => root.scrollWidth)
    const clientWidth = numberOf(() => root.clientWidth)
    if (scrollWidth === undefined || clientWidth === undefined) {
      return undefined
    }
    return overflowOf({ top: 0, right: scrollWidth - clientWidth, bottom: 0, left: 0 })
  }

  // How far an element's content spills past its border box's far edge along an axis, from its border box's near and
  // far edges in document coordinates, or undefined when the element clips it on that axis or it can't be read. Both
  // ends are kept within the document's scrollable area, limit, when it's known.
  const spillOf = (element, axis, near, far, limit) => {
    if (computedOf(element, axis === 'x' ? 'overflow-x' : 'overflow-y') !== 'visible') {
      return undefined
    }
    const border = numberOf(() => (axis === 'x' ? element.clientLeft : element.clientTop))
    const content = numberOf(() => (axis === 'x' ? element.scrollWidth : element.scrollHeight))
    if (border === undefined || content === undefined) {
      return undefined
    }
    const within = (end) => (limit === undefined ? end : Math.min(end, limit))
    return within(near + border + content) - within(far)
  }

  // An element's overflow, from its border box in document coordinates, or undefined when no side counts.
  const elementOverflowOf = (element, box, size) =>
    overflowOf({
      top: -box.top,
      right: spillOf(element, 'x', box.left, box.right, size === undefined ? undefined : size.width),
      bottom: spillOf(element, 'y', box.top, box.bottom, size === undefined ? undefined : size.height),
      left: -box.left,
    })

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

  // The box of the element the selector matches first, out to whole pixels, with its overflow when a side counts, or
  // why there's none.
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
    const size = documentSizeOf()
    const x = Math.max(0, Math.floor(box.left))
    const y = Math.max(0, Math.floor(box.top))
    const right = Math.ceil(size === undefined ? box.right : Math.min(box.right, size.width))
    const bottom = Math.ceil(size === undefined ? box.bottom : Math.min(box.bottom, size.height))
    const width = right - x
    const height = bottom - y
    if (width <= 0 || height <= 0) {
      return { outcome: 'element-missing', found: 'zero-size' }
    }
    return { box: { x, y, width, height }, overflow: elementOverflowOf(element, box, size) }
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

  // Runs the remote content search once, when a host mask or the request needs it, or gives undefined when neither
  // does. A search that rejects fails the host masks, as a mask must never fail open, and with no host mask leaves the
  // remote content unknown.
  const searchOnce = async (hostMasks, findRemote, timeoutMs) => {
    if (hostMasks.length === 0 && !findRemote) {
      return undefined
    }
    try {
      return await findRemoteContent(timeoutMs)
    } catch (error) {
      if (hostMasks.length > 0) {
        throw error
      }
      return undefined
    }
  }

  // The boxes of the remote content the host masks cover, or why there are none.
  const hostBoxesOf = (hostMasks, search) => {
    if (hostMasks.length === 0) {
      return { boxes: [] }
    }
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

  // The remote content a search found, each item by its host and box, or undefined when it's unknown: no search ran,
  // it rejected or it timed out.
  const remoteOf = (search) => {
    if (search === undefined || search.outcome !== 'found') {
      return undefined
    }
    return search.items.map((item) => ({
      host: item.host,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    }))
  }

  // The boxes of every mask, selector masks first, with the remote content found when the request asks for it, or why
  // there are none.
  const maskBoxesOf = async (masks, scroll, findRemote, timeoutMs) => {
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
    const hostMasks = masks.filter((mask) => typeof mask.host === 'string')
    const search = await searchOnce(hostMasks, findRemote, timeoutMs)
    const found = hostBoxesOf(hostMasks, search)
    if (found.outcome !== undefined) {
      return found
    }
    return { boxes: [...boxes, ...found.boxes], remote: findRemote ? remoteOf(search) : undefined }
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

  // Finds the masks' boxes and paints them, giving the remote content found when that's done, or why it couldn't be.
  // A mask unpainted would leave its content in the capture, so anything thrown here fails the preparation.
  const paintMasks = async (masks, maskColor, scroll, findRemote, timeoutMs) => {
    try {
      const found = await maskBoxesOf(masks, scroll, findRemote, timeoutMs)
      if (found.outcome !== undefined) {
        return found
      }
      paint(found.boxes, maskColor)
      return { remote: found.remote }
    } catch (error) {
      return { outcome: 'paint-failed', message: messageOf(error) }
    }
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
          hideCaretIn(frameDocument, recordedRootsOf(frame, stateGlobal))
        }
      }
    }
  }

  return async (request, timeoutMs) => {
    const { element, masks, maskColor, findRemote } = request
    const scroll = pageScrollOf()
    const grid = gridOf()
    const measured = element === null ? { box: null, overflow: pageOverflowOf() } : elementBoxOf(element, scroll)
    if (measured.outcome !== undefined) {
      return measured
    }
    const painted = await paintMasks(masks, maskColor, scroll, findRemote, timeoutMs)
    if (painted.outcome !== undefined) {
      return painted
    }
    try {
      hideCaretIn(document, shadowRoots)
    } catch {}
    const ready = { outcome: 'ready', box: measured.box }
    return {
      ...ready,
      ...(painted.remote === undefined ? {} : { remote: painted.remote }),
      ...(grid === undefined ? {} : { grid }),
      ...(measured.overflow === undefined ? {} : { overflow: measured.overflow }),
    }
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
      /**
       * The remote content the page shows, when the request asked for it and the search answered. Without it, the
       * remote content is unknown.
       */
      remote?: PageRemoteContent[]
      /**
       * The grids the page shows, when it shows any: the widest grid's width and the tallest grid's height.
       */
      grid?: PageGrid
      /**
       * The content the capture would cut, when at least one side counts: how far it reaches past each side.
       */
      overflow?: PageOverflow
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
  | {
      /**
       * Finding the masks' boxes or painting them threw, so the capture would show what they cover.
       */
      outcome: 'paint-failed'
      /**
       * What was thrown.
       */
      message: string
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
 * Whether a value is an item of the remote content the page gives: a `host` that isn't empty, finite `x` and `y`, and
 * finite `width` and `height` over 0.
 */
function isRemoteItem(value: unknown): value is PageRemoteContent {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const { host, x, y, width, height }: Record<string, unknown> = { ...value }
  const sides = [x, y, width, height]

  if (typeof host !== 'string' || host === '' || !sides.every((side) => Number.isFinite(side))) {
    return false
  }

  return Number(width) > 0 && Number(height) > 0
}

/**
 * Reads the remote content the page gives with an answer that's ready, keeping each item's host and box only. Gives
 * `{ remote: undefined }` when there's none, and `undefined` when it's not a list of items the page gives.
 */
function readRemote(value: unknown): { remote: PageRemoteContent[] | undefined } | undefined {
  if (value === undefined) {
    return { remote: undefined }
  }

  if (!Array.isArray(value) || !value.every(isRemoteItem)) {
    return undefined
  }

  return { remote: value.map(({ host, x, y, width, height }) => ({ host, x, y, width, height })) }
}

/**
 * Reads the grids the page gives with an answer that's ready, keeping their width and height only. Gives
 * `{ grid: undefined }` when there's none, and `undefined` when it's not finite sides of 0 or more.
 */
function readGrid(value: unknown): { grid: PageGrid | undefined } | undefined {
  if (value === undefined) {
    return { grid: undefined }
  }

  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const { width, height }: Record<string, unknown> = { ...value }

  if (typeof width !== 'number' || typeof height !== 'number') {
    return undefined
  }

  return [width, height].every((side) => Number.isFinite(side) && side >= 0) ? { grid: { width, height } } : undefined
}

/**
 * Reads the overflow the page gives with an answer that's ready, keeping its four sides only. Gives
 * `{ overflow: undefined }` when there's none, and `undefined` when it's not four finite sides of 0 or more.
 */
function readOverflow(value: unknown): { overflow: PageOverflow | undefined } | undefined {
  if (value === undefined) {
    return { overflow: undefined }
  }

  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const { top, right, bottom, left }: Record<string, unknown> = { ...value }

  if (typeof top !== 'number' || typeof right !== 'number' || typeof bottom !== 'number' || typeof left !== 'number') {
    return undefined
  }

  return [top, right, bottom, left].every((side) => Number.isFinite(side) && side >= 0)
    ? { overflow: { top, right, bottom, left } }
    : undefined
}

/**
 * Reads an answer of the page that's ready, with the element's box or none, and the remote content, the grids and the
 * overflow when it gives them. Gives `undefined` for any other answer.
 */
function readReady(answer: Record<string, unknown>): CapturePrep | undefined {
  const { box } = answer
  const read = readRemote(answer.remote)
  const readGrids = readGrid(answer.grid)
  const readOverflows = readOverflow(answer.overflow)

  if (answer.outcome !== 'ready' || read === undefined || readGrids === undefined || readOverflows === undefined) {
    return undefined
  }

  if (box !== null && !isCaptureBox(box)) {
    return undefined
  }

  const ready: Extract<CapturePrep, { outcome: 'ready' }> = {
    outcome: 'ready',
    box: box === null ? null : { x: box.x, y: box.y, width: box.width, height: box.height },
  }

  return {
    ...ready,
    ...(read.remote === undefined ? {} : { remote: read.remote }),
    ...(readGrids.grid === undefined ? {} : { grid: readGrids.grid }),
    ...(readOverflows.overflow === undefined ? {} : { overflow: readOverflows.overflow }),
  }
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
 * Reads an answer of the page that says a selector isn't valid CSS or the masks couldn't be painted. Gives `undefined`
 * for any other answer.
 */
function readFailure(answer: Record<string, unknown>): CapturePrep | undefined {
  const { message, name } = answer

  if (answer.outcome === 'paint-failed' && typeof message === 'string') {
    return { outcome: 'paint-failed', message }
  }

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
  const prep = readReady(answer) ?? readNotReady(answer) ?? readFailure(answer)

  if (prep !== undefined) {
    return prep
  }

  throw new Error(
    `Preparing the capture in the page gave an answer visual-check doesn't know: ${JSON.stringify(value)}.`,
  )
}
