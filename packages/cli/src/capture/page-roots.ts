/**
 * The source of a function, evaluated in the page as part of the page script, that gives the helpers for the steps
 * that look through a document's elements, never throwing:
 *
 * - `elementsOf(root, selector)` gives the elements of a root that match the selector, or none when the root can't be
 *   queried;
 * - `rootsOf(document, recordedRoots)` gives the document, the shadow roots the page script recorded, closed ones
 *   included, and every open shadow root found by walking each root's elements, nested ones too, each once;
 * - `read(getter, fallback)` gives what the getter reads in the page, or the fallback when it throws;
 * - `isObject(value)` says whether a value is an object, not `null`;
 * - `scrollOf(view, axis)` gives how far a window is scrolled along `scrollX` or `scrollY`, or 0 when that can't be
 *   read or isn't a finite number;
 * - `recordedRootsOf(frame, stateGlobal)` gives the shadow roots a frame's own page script recorded, closed ones
 *   included, from the `shadowRoots` of the state it keeps under `stateGlobal` in the frame's window, or none when
 *   they can't be read or aren't a list.
 */
export const pageRootsFunction = `() => {
  const read = (getter, fallback) => {
    try {
      return getter()
    } catch {
      return fallback
    }
  }

  const isObject = (value) => typeof value === 'object' && value !== null

  const scrollOf = (view, axis) => {
    const scroll = read(() => view[axis], 0)
    return Number.isFinite(scroll) ? scroll : 0
  }

  const elementsOf = (root, selector) => {
    try {
      return Array.from(root.querySelectorAll(selector))
    } catch {
      return []
    }
  }

  const openShadowRootOf = (element) => {
    const root = read(() => element.shadowRoot, undefined)
    return isObject(root) ? root : undefined
  }

  const rootsOf = (rootDocument, recordedRoots) => {
    const roots = new Set([rootDocument, ...recordedRoots])
    // A Set's iteration visits the roots added during it, so the open roots inside open roots are walked too.
    for (const root of roots) {
      for (const element of elementsOf(root, '*')) {
        const openRoot = openShadowRootOf(element)
        if (openRoot !== undefined) {
          roots.add(openRoot)
        }
      }
    }
    return roots
  }

  const recordedRootsOf = (frame, stateGlobal) => {
    const recorded = read(() => frame.contentWindow[stateGlobal].shadowRoots, undefined)
    return Array.isArray(recorded) ? recorded : []
  }

  return { elementsOf, rootsOf, read, isObject, scrollOf, recordedRootsOf }
}`
