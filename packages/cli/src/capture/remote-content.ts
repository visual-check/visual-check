import { pageRootsFunction } from './page-roots.js'

/**
 * The source of a function, evaluated in the page as part of the page script, that creates the remote content search.
 * It takes what the page script kept at document start: `shadowRoots`, the browser's own `setTimer` and `clearTimer`,
 * and `stateGlobal`, the name of the global it keeps its state under in every document. It gives a function that
 * takes a time limit in ms and finds the remote content the page shows: what comes from an origin other than the top
 * document's, Storybook's. Creating it reads nothing in the page.
 *
 * It looks at every element of the top document, of the shadow roots the page script recorded, closed ones included,
 * and of every open shadow root found by walking each root's elements. An element whose computed `visibility` is
 * `hidden` or `collapse` shows nothing, a frame's document included, but its `::before` or `::after` can set its own
 * back to `visible`. Elements clipped by an ancestor's `overflow` still count.
 *
 * - an `<img>`, by the source it shows, `currentSrc`, else its `src`, so a `<picture>` or `srcset` pick counts;
 * - an SVG `<image>`, by `href.baseVal`, else its `xlink:href` attribute, resolved against its base URL;
 * - a `<video>`, by its `poster`, when it has one;
 * - CSS images on the element and on its `::before` and `::after`: every `url()` in the computed `background-image`,
 *   `mask-image`, `-webkit-mask-image`, `border-image-source` and `content`, in `image-set()` too, and on the element
 *   in `list-style-image`. A pseudo-element's image takes its element's box. A `::before` or `::after` whose `content`
 *   is `none` or `normal` isn't generated, so it shows nothing, and neither is one of an SVG element or of a replaced
 *   or void HTML element, such as `<img>`, `<input>` or `<br>`, so those aren't read;
 * - an `<iframe>` or `<frame>`. When its document is reachable, as a same-origin or `srcdoc` one's is, it searches that
 *   document too, with the closed shadow roots the frame's own page script recorded, its open shadow roots and the
 *   frames in it. Boxes there are moved by the frame's content box, which clips them, as every outer frame's does.
 *   Such a frame is never a box of its own. When its document isn't reachable and its `src` is remote, its whole
 *   border box is remote content.
 *
 * A URL counts when it's `http:` or `https:` and its origin isn't the top document's. `data:`, `blob:`, `about:` and
 * any other URL never count. Fonts aren't looked at.
 *
 * A service worker, such as MSW's, can mock a remote image. Only in a document a service worker controls, it probes
 * each remote URL found there once, drawing the image on a 1 × 1 canvas of that document and reading it back. A
 * response the worker made itself isn't opaque, so it doesn't taint the canvas: the image doesn't count. One the
 * worker passed through from another origin without CORS is opaque and taints it, so reading throws: it counts. A
 * complete `<img>` without `crossorigin` is drawn as it is. Anything else is loaded by a fresh `Image` of that
 * document's window, without CORS, and one that fails to load counts. A frame is never probed.
 *
 * It answers `{ outcome: 'found', items }`, one item per element and host, each with the `host` and `hostname` as
 * `URL` gives them, and the element's border box in CSS pixels of the top document: `x`, `y`, `width` and `height`,
 * with the page's scroll, not rounded. A box with no area, once clipped, is left out. When the time limit passes while
 * it probes, it answers `{ outcome: 'timed-out' }`. It never throws: an element whose box, computed style or frame
 * document can't be read is skipped, and anything else that throws, such as a `setTimer` that can't set the timer,
 * gives what was found that needed no probe.
 */
export const remoteContentFunction = `(context) => {
  const { shadowRoots, setTimer, clearTimer, stateGlobal } = context
  const { elementsOf, rootsOf, read, isObject, scrollOf, recordedRootsOf } = (${pageRootsFunction})()
  // What the deadline gives once the time limit passes.
  const timedOut = Symbol('timed out')

  // The namespace of SVG elements, such as <image>.
  const svgNamespace = 'http://www.w3.org/2000/svg'

  // The computed properties that can hold an image. A pseudo-element's content is read first, to tell whether it's
  // generated, and list-style-image applies to a list item only.
  const boxImageProperties = ['background-image', 'mask-image', '-webkit-mask-image', 'border-image-source']
  const elementImageProperties = [...boxImageProperties, 'content', 'list-style-image']

  // The ::before and ::after, and the content values that don't generate them.
  const pseudoElements = ['::before', '::after']
  const notGenerated = ['none', 'normal']

  // The HTML elements that never generate a ::before or ::after: replaced and void ones. SVG elements never do either.
  const withoutPseudoElements = new Set([
    'img', 'video', 'iframe', 'frame', 'input', 'canvas', 'br', 'hr', 'embed', 'object', 'audio', 'select', 'textarea',
  ])

  // Every url() in a computed value, unescaped. Chromium gives each as url("…"), in image-set() too.
  const urlsIn = (value) => {
    if (typeof value !== 'string' || !value.includes('url(')) {
      return []
    }
    return Array.from(value.matchAll(/url\\(\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^"'()\\s]+))\\s*\\)/g), (match) =>
      (match[1] ?? match[2]).replace(/\\\\(.)/g, '$1'),
    )
  }

  // The URL of a source when it's remote: http: or https:, from another origin than the top document's.
  const remoteUrlOf = (source, base, origin) => {
    if (typeof source !== 'string' || source === '') {
      return undefined
    }
    try {
      const url = new URL(source, base)
      const web = url.protocol === 'http:' || url.protocol === 'https:'
      return web && url.origin !== origin ? url : undefined
    } catch {
      return undefined
    }
  }

  // The images an element shows itself, each as its source, the base URL it resolves against, and the element when
  // it's an <img> a probe can draw as it is.
  const ownSourcesOf = (element) => {
    const localName = element.localName
    if (localName === 'img') {
      const drawable = !element.hasAttribute('crossorigin') && element.complete === true && element.naturalWidth > 0
      return [{ source: element.currentSrc || element.src, image: drawable ? element : undefined }]
    }
    if (localName === 'image' && element.namespaceURI === svgNamespace) {
      return [{ source: element.href.baseVal || element.getAttribute('xlink:href'), base: element.baseURI }]
    }
    if (localName === 'video') {
      return [{ source: element.poster }]
    }
    return []
  }

  // Whether a computed style shows its box: visibility hidden or collapse hides it.
  const isVisible = (style) => style.getPropertyValue('visibility') === 'visible'

  // The images in these properties of a computed style.
  const imagesIn = (style, properties) =>
    properties.flatMap((property) => urlsIn(style.getPropertyValue(property))).map((source) => ({ source }))

  // The CSS images on an element's ::before and ::after that are generated and visible. A visible one counts on a
  // hidden element too, as it can set its own visibility back.
  const pseudoSourcesOf = (element, view) => {
    if (element.namespaceURI === svgNamespace || withoutPseudoElements.has(element.localName)) {
      return []
    }
    return pseudoElements.flatMap((pseudoElement) => {
      const style = view.getComputedStyle(element, pseudoElement)
      const content = style.getPropertyValue('content')
      if (notGenerated.includes(content) || !isVisible(style)) {
        return []
      }
      return [...urlsIn(content).map((source) => ({ source })), ...imagesIn(style, boxImageProperties)]
    })
  }

  // Whether drawing a loaded image on a 1 × 1 canvas of the document taints it. A probe that fails counts as tainting,
  // so the image counts as remote.
  const taints = (probed, image) => {
    try {
      const canvas = probed.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const canvasContext = canvas.getContext('2d')
      canvasContext.drawImage(image, 0, 0, 1, 1)
      canvasContext.getImageData(0, 0, 1, 1)
      return false
    } catch {
      return true
    }
  }

  // Loads an image with a fresh Image of the document's window, without CORS, and promises whether it taints a canvas.
  // One that fails to load counts as tainting.
  const loadTaints = (probed, view, url) =>
    new Promise((resolve) => {
      try {
        const image = new view.Image()
        image.addEventListener('load', () => resolve(taints(probed, image)), { once: true })
        image.addEventListener('error', () => resolve(true), { once: true })
        image.src = url
      } catch {
        resolve(true)
      }
    })

  // How a document probes the remote URLs found in it, each once, or undefined when no service worker controls it, as
  // only then can a response be mocked.
  const proberOf = (probed, view) => {
    if (!isObject(read(() => view.navigator.serviceWorker.controller, null))) {
      return undefined
    }
    const probes = new Map()
    return (url, image) => {
      if (!probes.has(url)) {
        probes.set(url, image === undefined ? loadTaints(probed, view, url) : Promise.resolve(taints(probed, image)))
      }
      return probes.get(url)
    }
  }

  // A rect moved by where its document sits in the top document's viewport and clipped, or undefined when no area is
  // left.
  const placed = (rect, place) => {
    const left = rect.left + place.x
    const top = rect.top + place.y
    const box = {
      left: Math.max(left, place.clip.left),
      top: Math.max(top, place.clip.top),
      right: Math.min(left + rect.width, place.clip.right),
      bottom: Math.min(top + rect.height, place.clip.bottom),
    }
    return box.right > box.left && box.bottom > box.top ? box : undefined
  }

  // Where a frame's document sits: its content box, in the top document's viewport, which clips it with every outer
  // frame's.
  const placeInside = (frame, rect, style, place) => {
    const padding = (side) => Number.parseFloat(style.getPropertyValue('padding-' + side)) || 0
    const x = place.x + rect.left + frame.clientLeft + padding('left')
    const y = place.y + rect.top + frame.clientTop + padding('top')
    const width = frame.clientWidth - padding('left') - padding('right')
    const height = frame.clientHeight - padding('top') - padding('bottom')
    const clip = {
      left: Math.max(x, place.clip.left),
      top: Math.max(y, place.clip.top),
      right: Math.min(x + width, place.clip.right),
      bottom: Math.min(y + height, place.clip.bottom),
    }
    return { x, y, clip }
  }

  // Searches an element, adding the remote URLs it shows to search.found, then the document of a reachable frame.
  // Throws when the element can't be read, so it's skipped.
  const searchElement = (element, view, place, probe, search) => {
    const rect = element.getBoundingClientRect()
    const box = placed(rect, place)
    if (box === undefined) {
      return
    }
    const style = view.getComputedStyle(element, null)
    const visible = isVisible(style)
    const sources = visible ? [...ownSourcesOf(element), ...imagesIn(style, elementImageProperties)] : []
    sources.push(...pseudoSourcesOf(element, view))
    // A hidden frame shows nothing, its document included.
    const isFrame = visible && (element.localName === 'iframe' || element.localName === 'frame')
    const frameDocument = isFrame ? element.contentDocument : undefined
    const inside = isObject(frameDocument) ? placeInside(element, rect, style, place) : undefined
    if (isFrame && inside === undefined) {
      sources.push({ source: element.src, frame: true })
    }
    for (const { source, base, image, frame } of sources) {
      const url = remoteUrlOf(source, base, search.origin)
      if (url !== undefined) {
        const remote = frame === true || probe === undefined ? true : probe(url.href, image)
        search.found.push({ element, box, url, remote })
      }
    }
    if (inside !== undefined) {
      searchDocument(frameDocument, recordedRootsOf(element, stateGlobal), inside, search)
    }
  }

  // Searches every element of a document's roots, and the frames in it.
  const searchDocument = (searched, recordedRoots, place, search) => {
    const view = read(() => searched.defaultView, undefined)
    if (!isObject(view)) {
      return
    }
    const probe = proberOf(searched, view)
    for (const root of rootsOf(searched, recordedRoots)) {
      for (const element of elementsOf(root, '*')) {
        try {
          searchElement(element, view, place, probe, search)
        } catch {}
      }
    }
  }

  // The items for the remote URLs found, one per element and host, in CSS pixels of the top document.
  const itemsOf = (found, remote, topView) => {
    const scrollX = scrollOf(topView, 'scrollX')
    const scrollY = scrollOf(topView, 'scrollY')
    const hostsByElement = new Map()
    const items = []
    found.forEach(({ element, box, url }, index) => {
      const hosts = hostsByElement.get(element) ?? new Set()
      hostsByElement.set(element, hosts)
      if (remote[index] && !hosts.has(url.host)) {
        hosts.add(url.host)
        items.push({
          host: url.host,
          hostname: url.hostname,
          x: box.left + scrollX,
          y: box.top + scrollY,
          width: box.right - box.left,
          height: box.bottom - box.top,
        })
      }
    })
    return items
  }

  return async (timeoutMs) => {
    let timer
    let expire
    let topView
    const deadline = new Promise((resolve) => {
      expire = resolve
    })
    const search = { origin: undefined, found: [] }
    try {
      timer = setTimer(() => expire(timedOut), timeoutMs)
      topView = read(() => document.defaultView, undefined)
      search.origin = read(() => topView.location.origin, undefined)
      const everywhere = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
      searchDocument(document, shadowRoots, { x: 0, y: 0, clip: everywhere }, search)
      const remote = await Promise.race([Promise.all(search.found.map((candidate) => candidate.remote)), deadline])
      if (remote === timedOut) {
        return { outcome: 'timed-out' }
      }
      return { outcome: 'found', items: itemsOf(search.found, remote, topView) }
    } catch {
      // Something unexpected threw, such as setTimer: it gives what was found that needed no probe.
      const certain = search.found.map((candidate) => candidate.remote === true)
      return { outcome: 'found', items: itemsOf(search.found, certain, topView) }
    } finally {
      try {
        clearTimer(timer)
      } catch {}
    }
  }
}`
