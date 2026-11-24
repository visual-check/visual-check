import { type Mock, vi } from 'vitest'
import type { PageGlobals } from './force-states.js'
import { FakeCSSGroupingRule, FakeCSSStyleSheet, type FakeStyleSheetOptions } from './style-sheet.fixture.js'

/**
 * A capturing or bubbling listener a fake node holds.
 */
interface FakeListener {
  /**
   * The event type.
   */
  type: string
  /**
   * Whether it listens in the capture phase.
   */
  capture: boolean
  /**
   * What the event is handed to.
   */
  listener: (event: { target: FakeNode }) => void
}

/**
 * A record a fake mutation observer delivers.
 */
export interface FakeMutationRecord {
  /**
   * What changed: children, text or an attribute.
   */
  type: 'childList' | 'characterData' | 'attributes'
  /**
   * The node that changed.
   */
  target: FakeNode
  /**
   * The nodes added to `target`, for `childList`.
   */
  addedNodes: FakeNode[]
}

/**
 * A fake DOM node: a parent, children and listeners.
 */
class FakeNode {
  /**
   * Its parent, or null at the top of a tree.
   */
  parentNode: FakeNode | null = null
  /**
   * Its children, in order.
   */
  readonly childNodes: FakeNode[] = []
  /**
   * Its event listeners.
   */
  readonly listeners: FakeListener[] = []

  /**
   * Adds a listener, unless the same one is there already.
   */
  addEventListener(type: string, listener: FakeListener['listener'], capture = false): void {
    if (this.#indexOf(type, listener, capture) === -1) {
      this.listeners.push({ type, listener, capture })
    }
  }

  /**
   * Removes a listener.
   */
  removeEventListener(type: string, listener: FakeListener['listener'], capture = false): void {
    const index = this.#indexOf(type, listener, capture)

    if (index !== -1) {
      this.listeners.splice(index, 1)
    }
  }

  /**
   * The top of its tree: the document, a shadow root, or the top of a detached tree.
   */
  getRootNode(): FakeNode {
    return this.parentNode === null ? this : this.parentNode.getRootNode()
  }

  /**
   * Every element below it, in tree order, not crossing into shadow roots.
   */
  querySelectorAll(_selector: '*'): FakeElement[] {
    return this.childNodes.flatMap((child) =>
      child instanceof FakeElement ? [child, ...child.querySelectorAll('*')] : [],
    )
  }

  /**
   * The position of a listener, or -1.
   */
  #indexOf(type: string, listener: FakeListener['listener'], capture: boolean): number {
    return this.listeners.findIndex(
      (held) => held.type === type && held.listener === listener && held.capture === capture,
    )
  }
}

/**
 * A fake element. `sheet` is set on `<style>` and `<link>` elements.
 */
export class FakeElement extends FakeNode {
  /**
   * Its tag name, upper case.
   */
  readonly tagName: string
  /**
   * Its classes.
   */
  readonly classList = new FakeClassList()
  /**
   * Its open shadow root.
   */
  shadowRoot: FakeRoot | null = null
  /**
   * Its stylesheet, for a `<style>` or a loaded `<link>`.
   */
  sheet: FakeCSSStyleSheet | null = null

  /**
   * An element with the tag name.
   */
  constructor(tagName: string) {
    super()
    this.tagName = tagName.toUpperCase()
  }

  /**
   * Whether it's in the document, through shadow hosts.
   */
  get isConnected(): boolean {
    const root = this.getRootNode()

    return root instanceof FakeRoot && (root.host === null || root.host.isConnected)
  }
}

/**
 * A fake document or shadow root: `host` is null for the document.
 */
export class FakeRoot extends FakeNode {
  /**
   * The shadow host, or null for the document.
   */
  readonly host: FakeElement | null
  /**
   * The sheets assigned to `adoptedStyleSheets`, which an accessor on each page's prototypes reads and sets.
   */
  adopted: FakeCSSStyleSheet[] = []

  /**
   * A document, or a shadow root of the host.
   */
  constructor(host: FakeElement | null) {
    super()
    this.host = host
  }

  /**
   * The sheets of its `<style>` and `<link>` elements, in tree order.
   */
  get styleSheets(): FakeCSSStyleSheet[] {
    return this.querySelectorAll('*').flatMap((element) => (element.sheet === null ? [] : [element.sheet]))
  }
}

/**
 * A fake `DOMTokenList`. Changing it delivers no mutation record: `toggleClass` does.
 */
class FakeClassList {
  /**
   * The classes.
   */
  readonly #names = new Set<string>()

  /**
   * Adds classes.
   */
  add(...names: string[]): void {
    for (const name of names) {
      this.#names.add(name)
    }
  }

  /**
   * Removes classes.
   */
  remove(...names: string[]): void {
    for (const name of names) {
      this.#names.delete(name)
    }
  }

  /**
   * Whether it has the class.
   */
  contains(name: string): boolean {
    return this.#names.has(name)
  }

  /**
   * The classes, in the order they were added.
   */
  [Symbol.iterator](): Iterator<string> {
    return this.#names.values()
  }
}

/**
 * A fake `MutationObserver`: it records what it observes, and hands it the records `trigger` is given.
 */
class FakeMutationObserver {
  /**
   * The nodes it observes, with their options.
   */
  readonly observed: { target: FakeNode; options: unknown }[] = []
  /**
   * Whether `disconnect` was called.
   */
  disconnected = false
  /**
   * What it hands records to.
   */
  readonly #callback: (records: FakeMutationRecord[]) => void

  /**
   * An observer that hands records to the callback.
   */
  constructor(callback: (records: FakeMutationRecord[]) => void) {
    this.#callback = callback
  }

  /**
   * Starts observing the node.
   */
  observe(target: FakeNode, options: unknown): void {
    this.observed.push({ target, options })
  }

  /**
   * Stops observing everything.
   */
  disconnect(): void {
    this.disconnected = true
    this.observed.length = 0
  }

  /**
   * Hands it the records, as a batch of mutations would.
   */
  trigger(records: FakeMutationRecord[]): void {
    this.#callback(records)
  }
}

/**
 * A fake page and the helpers that change it the way a story would. Each helper delivers its one record as a batch of
 * its own, so how a batch of several records is handled isn't covered.
 */
export interface FakePage {
  /**
   * What `pageRewriterOf` is given.
   */
  globals: PageGlobals
  /**
   * The document.
   */
  document: FakeRoot
  /**
   * The observers created in the page.
   */
  observers: FakeMutationObserver[]
  /**
   * The page's `console.warn`.
   */
  warn: Mock<(message: string) => void>
  /**
   * The page's `CSSStyleSheet`.
   */
  CSSStyleSheet: typeof FakeCSSStyleSheet
  /**
   * The page's `CSSGroupingRule`.
   */
  CSSGroupingRule: typeof FakeCSSGroupingRule
  /**
   * A new element of the page.
   */
  element(tagName: string, className?: string): FakeElement
  /**
   * A new `<style>` holding the rules.
   */
  style(rules: CSSRule[]): FakeElement
  /**
   * A new constructed sheet holding the rules.
   */
  sheet(rules: CSSRule[], options?: FakeStyleSheetOptions): FakeCSSStyleSheet
  /**
   * A new element with a shadow root of the mode, and the root.
   */
  host(mode?: 'open' | 'closed', className?: string): { host: FakeElement; root: FakeRoot }
  /**
   * Appends the children to the parent and delivers the `childList` record.
   */
  append(parent: FakeNode, ...children: FakeNode[]): void
  /**
   * Adds or removes a class and delivers the `attributes` record.
   */
  toggleClass(element: FakeElement, className: string, present: boolean): void
  /**
   * Gives the element its sheet and dispatches `load` on it, through the capturing listeners of its tree.
   */
  load(element: FakeElement, sheet: FakeCSSStyleSheet): void
  /**
   * Delivers a record to each connected observer that observes its target's tree.
   */
  deliver(record: FakeMutationRecord): void
}

/**
 * A fake page whose prototypes belong to it alone, so hooks one test installs never reach another.
 */
export function fakePage(): FakePage {
  const observers: FakeMutationObserver[] = []
  const warn = vi.fn<(message: string) => void>()

  class PageElement extends FakeElement {
    /**
     * Gives it a shadow root, exposed as `shadowRoot` when open.
     */
    attachShadow(init: { mode: 'open' | 'closed' }): FakeRoot {
      const root = new PageShadowRoot(this)

      if (init.mode === 'open') {
        this.shadowRoot = root
      }

      return root
    }
  }

  class PageShadowRoot extends FakeRoot {}

  class PageDocument extends FakeRoot {}

  class PageStyleSheet extends FakeCSSStyleSheet {}

  class PageGroupingRule extends FakeCSSGroupingRule {}

  class PageMutationObserver extends FakeMutationObserver {
    /**
     * An observer the page records.
     */
    constructor(callback: (records: FakeMutationRecord[]) => void) {
      super(callback)
      observers.push(this)
    }
  }

  defineAdoptedStyleSheets(PageShadowRoot.prototype)
  defineAdoptedStyleSheets(PageDocument.prototype)

  const document = new PageDocument(null)
  const page: FakePage = {
    globals: {
      document,
      MutationObserver: PageMutationObserver,
      CSSStyleSheet: PageStyleSheet,
      CSSGroupingRule: PageGroupingRule,
      Document: PageDocument,
      ShadowRoot: PageShadowRoot,
      Element: PageElement,
      console: { warn },
    } as unknown as PageGlobals,
    document,
    observers,
    warn,
    CSSStyleSheet: PageStyleSheet,
    CSSGroupingRule: PageGroupingRule,
    element: (tagName, className) => elementOf(new PageElement(tagName), className),
    style: (rules) => {
      const style = new PageElement('style')

      style.sheet = new PageStyleSheet(rules, { ownerNode: style })

      return style
    },
    sheet: (rules, options) => new PageStyleSheet(rules, options),
    host: (mode = 'open', className) => {
      const host = new PageElement('div')

      elementOf(host, className)

      return { host, root: host.attachShadow({ mode }) }
    },
    append: (parent, ...children) => {
      for (const child of children) {
        child.parentNode = parent
        parent.childNodes.push(child)
      }

      page.deliver({ type: 'childList', target: parent, addedNodes: children })
    },
    toggleClass: (element, className, present) => {
      if (present) {
        element.classList.add(className)
      } else {
        element.classList.remove(className)
      }

      page.deliver({ type: 'attributes', target: element, addedNodes: [] })
    },
    load: (element, sheet) => {
      element.sheet = sheet
      dispatchLoad(element)
    },
    deliver: (record) => {
      for (const observer of observers.filter((candidate) => observes(candidate, record.target))) {
        observer.trigger([record])
      }
    },
  }

  return page
}

/**
 * The element, with the class when one is given.
 */
function elementOf(element: FakeElement, className: string | undefined): FakeElement {
  if (className !== undefined) {
    element.classList.add(className)
  }

  return element
}

/**
 * Defines `adoptedStyleSheets` on the prototype as an accessor, the way browsers do.
 */
function defineAdoptedStyleSheets(prototype: FakeRoot): void {
  Object.defineProperty(prototype, 'adoptedStyleSheets', {
    configurable: true,
    get(this: FakeRoot) {
      return this.adopted
    },
    set(this: FakeRoot, sheets: FakeCSSStyleSheet[]) {
      this.adopted = [...sheets]
    },
  })
}

/**
 * Whether the observer observes the node's tree: one of the nodes it observes is the node or an ancestor of it.
 */
function observes(observer: FakeMutationObserver, node: FakeNode): boolean {
  return ancestorsOf(node).some((ancestor) => observer.observed.some((observed) => observed.target === ancestor))
}

/**
 * The node and its ancestors in its tree, from the top down.
 */
function ancestorsOf(node: FakeNode): FakeNode[] {
  return node.parentNode === null ? [node] : [...ancestorsOf(node.parentNode), node]
}

/**
 * Dispatches `load` on the element: to the capturing listeners of its ancestors, then its own.
 */
function dispatchLoad(element: FakeElement): void {
  const event = { type: 'load', target: element }

  for (const node of ancestorsOf(element)) {
    for (const held of [...node.listeners]) {
      if (held.type === 'load' && (held.capture || node === element)) {
        held.listener(event)
      }
    }
  }
}
