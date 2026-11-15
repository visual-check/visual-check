/**
 * The source of a function, evaluated in the page as part of the page script, that gives two helpers for the steps
 * that look through a document's elements, never throwing:
 *
 * - `elementsOf(root, selector)` gives the elements of a root that match the selector, or none when the root can't be
 *   queried;
 * - `rootsOf(document, recordedRoots)` gives the document, the shadow roots the page script recorded, closed ones
 *   included, and every open shadow root found by walking each root's elements, nested ones too, each once.
 */
export const pageRootsFunction = `() => {
  const elementsOf = (root, selector) => {
    try {
      return Array.from(root.querySelectorAll(selector))
    } catch {
      return []
    }
  }

  const openShadowRootOf = (element) => {
    try {
      const root = element.shadowRoot
      return typeof root === 'object' && root !== null ? root : undefined
    } catch {
      return undefined
    }
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

  return { elementsOf, rootsOf }
}`
