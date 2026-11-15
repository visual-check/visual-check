import { elementsMatching, type FakeShadowRoot, fakePageDocument } from './remote-content.fixture.js'

/**
 * A stylesheet a fake window's `CSSStyleSheet` made.
 */
export interface FakeSheet {
  /**
   * The name of the window whose `CSSStyleSheet` made it.
   */
  madeBy: string
  /**
   * The text `replaceSync` gave it, empty until then.
   */
  text: string
}

/**
 * An element the capture preparation created in a fake document.
 */
export interface FakeCreatedElement {
  /**
   * The element's tag name.
   */
  localName: string
  /**
   * The element's attributes.
   */
  attributes: Record<string, string>
  /**
   * The element's inline style.
   */
  style: { cssText: string }
  /**
   * The element's children, in order.
   */
  children: FakeCreatedElement[]
}

/**
 * What `showPopover()` does on an element a fake document creates: it shows the popover, it throws, or the element has
 * no such method, as in a browser without popovers.
 */
type FakePopover = 'works' | 'throws' | 'missing'

/**
 * What a fake capture document holds. Each part has a default, given with it.
 */
interface FakeCaptureDocumentParts {
  /**
   * The name of the document's window, which marks the stylesheets it makes: `top` by default.
   */
  name?: string
  /**
   * Every element of the document, outside shadow roots, as `*` gives them: none by default.
   */
  elements?: object[]
  /**
   * The elements each selector matches, in order. A selector not listed matches as `elementsMatching` says.
   */
  matches?: Record<string, object[]>
  /**
   * The selectors that aren't valid CSS, which throw a `SyntaxError`: none by default.
   */
  invalid?: string[]
  /**
   * How far the document is scrolled, in CSS pixels: not at all by default.
   */
  scroll?: { x: number; y: number }
  /**
   * The size of the document's scrollable area, as its root element's `scrollWidth` and `scrollHeight` give it, in CSS
   * pixels: 800 × 600 by default.
   */
  size?: { width: number; height: number }
  /**
   * What `showPopover()` does on the elements the document creates: it shows the popover by default.
   */
  popover?: FakePopover
}

/**
 * A fake document for the capture preparation, and what the preparation did in it.
 */
export interface FakeCaptureDocument {
  /**
   * The document, to set as the page's `document` global or as a frame's `contentDocument`.
   */
  readonly document: FakeShadowRoot
  /**
   * The elements the document created, in order.
   */
  readonly created: FakeCreatedElement[]
  /**
   * What the preparation did to the document's elements, in order: `append <child> to <parent>` and
   * `showPopover <element>`.
   */
  readonly events: string[]
}

/**
 * The error a fake root throws for a selector that isn't valid CSS, as the browser says it.
 */
function invalidSelectorError(selector: string): Error {
  return new SyntaxError(`Failed to execute 'querySelectorAll' on 'Document': '${selector}' is not a valid selector.`)
}

/**
 * Builds a fake document for the capture preparation: the remote content search's fake document, with its elements and
 * scroll, given what the preparation uses too. That's the elements each selector matches, the window's
 * `CSSStyleSheet`, the root element with the size of the scrollable area, and the elements it creates, each recording
 * what's done to it.
 */
export function fakeCaptureDocument({
  name = 'top',
  elements = [],
  matches = {},
  invalid = [],
  scroll = { x: 0, y: 0 },
  size = { width: 800, height: 600 },
  popover = 'works',
}: FakeCaptureDocumentParts = {}): FakeCaptureDocument {
  const created: FakeCreatedElement[] = []
  const events: string[] = []
  const matching = (selector: string): object[] => {
    if (invalid.includes(selector)) {
      throw invalidSelectorError(selector)
    }

    return matches[selector] ?? elementsMatching(elements, selector)
  }
  const createElement = (localName: string): FakeCreatedElement => {
    const element: FakeCreatedElement = { localName, attributes: {}, style: { cssText: '' }, children: [] }
    const showPopover = (): void => {
      if (popover === 'throws') {
        throw new Error('NotSupportedError: not a popover.')
      }

      events.push(`showPopover ${localName}`)
    }

    Object.assign(element, {
      setAttribute: (attribute: string, value: string) => {
        element.attributes[attribute] = value
      },
      appendChild: (child: FakeCreatedElement) => {
        element.children.push(child)
        events.push(`append ${child.localName} to ${localName}`)
      },
      ...(popover === 'missing' ? {} : { showPopover }),
    })
    created.push(element)

    return element
  }
  const documentElement = {
    scrollWidth: size.width,
    scrollHeight: size.height,
    appendChild: (child: FakeCreatedElement) => {
      events.push(`append ${child.localName} to html`)
    },
  }
  const { document: pageDocument } = fakePageDocument({ elements, scroll })
  const document = Object.assign(pageDocument, {
    adoptedStyleSheets: [],
    documentElement,
    querySelector: (selector: string) => matching(selector)[0] ?? null,
    querySelectorAll: matching,
    createElement,
  })

  Object.assign(Reflect.get(document, 'defaultView'), {
    CSSStyleSheet: class {
      /**
       * The name of the window that made the sheet.
       */
      madeBy = name
      /**
       * The sheet's text.
       */
      text = ''

      /**
       * Replaces the sheet's text.
       */
      replaceSync(text: string): void {
        this.text = text
      }
    },
  })

  return { document, created, events }
}
