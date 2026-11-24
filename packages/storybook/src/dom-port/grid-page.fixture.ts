import { type Mock, vi } from 'vitest'
import type { ForcedState } from '../forced-state/forced-states.js'
import type { GridPage } from './combinations.js'

/**
 * A fake DOM node: a type, a parent and children.
 */
class FakeNode {
  /**
   * The node's type, as `Node.nodeType` numbers it.
   */
  readonly nodeType: number
  /**
   * Its parent, or null at the top of a tree.
   */
  parentNode: FakeNode | null = null
  /**
   * Its children, in order.
   */
  childNodes: FakeNode[] = []

  /**
   * A node of the type.
   */
  constructor(nodeType: number) {
    this.nodeType = nodeType
  }

  /**
   * Whether the top of its tree is a document.
   */
  get isConnected(): boolean {
    let top: FakeNode = this

    while (top.parentNode !== null) {
      top = top.parentNode
    }

    return top instanceof FakeDocument
  }

  /**
   * Appends the nodes, in order, moving each from its old parent.
   */
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      detach(node)
      node.parentNode = this
      this.childNodes.push(node)
    }
  }

  /**
   * Whether the node is this one or below it.
   */
  contains(node: FakeNode | null): boolean {
    for (let current = node; current !== null; current = current.parentNode) {
      if (current === this) {
        return true
      }
    }

    return false
  }
}

/**
 * Takes the node out of its parent's children, if it has a parent.
 */
function detach(node: FakeNode): void {
  if (node.parentNode !== null) {
    node.parentNode.childNodes = node.parentNode.childNodes.filter((child) => child !== node)
    node.parentNode = null
  }
}

/**
 * A fake text node.
 */
class FakeText extends FakeNode {
  /**
   * Its text.
   */
  readonly data: string

  /**
   * A text node holding the text.
   */
  constructor(data: string) {
    super(3)
    this.data = data
  }
}

/**
 * A fake node holding HTML an `innerHTML` setter was given, serialized as is.
 */
class FakeHtml extends FakeNode {
  /**
   * Its markup.
   */
  readonly html: string

  /**
   * A node holding the markup.
   */
  constructor(html: string) {
    super(3)
    this.html = html
  }
}

/**
 * A fake element: its attributes in the order they were first set, and the style properties set on it.
 */
class FakeElement extends FakeNode {
  /**
   * Its tag name, lower case.
   */
  readonly localName: string
  /**
   * Its attributes, by name, in the order they were first set.
   */
  readonly attributes = new Map<string, string>()
  /**
   * Each `style.setProperty` call's name and value, in order.
   */
  readonly styleCalls: [string, string][] = []
  /**
   * Its inline style, which records each property set and writes the `style` attribute.
   */
  readonly style = {
    /**
     * Records the property and rewrites the `style` attribute with every property set so far, in order.
     */
    setProperty: (name: string, value: string): void => {
      this.styleCalls.push([name, value])
      this.attributes.set('style', this.styleCalls.map(([setName, setValue]) => `${setName}:${setValue}`).join(';'))
    },
  }

  /**
   * An element with the tag name.
   */
  constructor(localName: string) {
    super(1)
    this.localName = localName
  }

  /**
   * Writes its `class` attribute.
   */
  set className(value: string) {
    this.setAttribute('class', value)
  }

  /**
   * Replaces its children with one text node.
   */
  set textContent(text: string) {
    this.#replaceChildren(new FakeText(text))
  }

  /**
   * Replaces its children with the HTML.
   */
  set innerHTML(html: string) {
    this.#replaceChildren(new FakeHtml(html))
  }

  /**
   * Sets the attribute, keeping its place when it was set before.
   */
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  /**
   * Replaces its children with the node.
   */
  #replaceChildren(node: FakeNode): void {
    for (const child of this.childNodes) {
      child.parentNode = null
    }

    this.childNodes = []
    this.append(node)
  }
}

/**
 * A fake document, with a body.
 */
class FakeDocument extends FakeNode {
  /**
   * Its body.
   */
  readonly body = new FakeElement('body')

  /**
   * A document holding its body.
   */
  constructor() {
    super(9)
    this.append(this.body)
  }

  /**
   * A new element with the tag name.
   */
  createElement(localName: string): FakeElement {
    return new FakeElement(localName)
  }
}

/**
 * A fake `MutationObserver` the page made, as a test sees it.
 */
interface FakeMutationObserver {
  /**
   * Each `observe` call's target and options, in order.
   */
  readonly observed: { target: Node; options: unknown }[]
  /**
   * Whether `disconnect` was called.
   */
  readonly disconnected: boolean
  /**
   * Hands it the records, as a batch of mutations would, unless it was disconnected.
   */
  trigger(records: { removedNodes: Node[] }[]): void
}

/**
 * A fake page for the plain-DOM port and the helpers a test reads it with.
 */
export interface FakeGridPage {
  /**
   * What `gridElementOf` is given.
   */
  page: GridPage
  /**
   * The page's document.
   */
  document: FakeDocument
  /**
   * The page's `forceStates`, which gives `stop`.
   */
  forceStates: Mock<(states: readonly ForcedState[]) => () => void>
  /**
   * What each `forceStates` call gives, to end its request.
   */
  stop: Mock<() => void>
  /**
   * The observers created in the page.
   */
  observers: FakeMutationObserver[]
  /**
   * A new element of the page with the attributes, set in order, then the text.
   */
  element(localName: string, text?: string, attributes?: Readonly<Record<string, string>>): HTMLElement
  /**
   * The node's markup as `react-dom/server` writes it, one tag per line.
   */
  markupOf(node: Node): string
  /**
   * Each `style.setProperty` call on the element: its name and value, in order.
   */
  styleCallsOf(node: Node): [string, string][]
  /**
   * Detaches the node from its parent.
   */
  remove(node: Node): void
}

/**
 * A fake page whose document builds fake elements.
 */
export function fakeGridPage(): FakeGridPage {
  const document = new FakeDocument()
  const stop = vi.fn<() => void>()
  const forceStates = vi.fn<(states: readonly ForcedState[]) => () => void>(() => stop)
  const observers: FakeMutationObserver[] = []

  class PageMutationObserver implements FakeMutationObserver {
    /**
     * Each `observe` call's target and options, in order.
     */
    readonly observed: { target: Node; options: unknown }[] = []
    /**
     * Whether `disconnect` was called.
     */
    disconnected = false
    /**
     * What it hands records to.
     */
    readonly #callback: (records: { removedNodes: Node[] }[]) => void

    /**
     * An observer the page records, handing records to the callback.
     */
    constructor(callback: (records: { removedNodes: Node[] }[]) => void) {
      this.#callback = callback
      observers.push(this)
    }

    /**
     * Records the target and options.
     */
    observe(target: Node, options: unknown): void {
      this.observed.push({ target, options })
    }

    /**
     * Marks it disconnected, so it hands on no more records.
     */
    disconnect(): void {
      this.disconnected = true
    }

    /**
     * Hands it the records unless it was disconnected.
     */
    trigger(records: { removedNodes: Node[] }[]): void {
      if (!this.disconnected) {
        this.#callback(records)
      }
    }
  }

  return {
    page: { document, MutationObserver: PageMutationObserver, forceStates } as unknown as GridPage,
    document,
    forceStates,
    stop,
    observers,
    element: (localName, text, attributes = {}) => {
      const element = document.createElement(localName)

      for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value)
      }

      if (text !== undefined) {
        element.textContent = text
      }

      return element as unknown as HTMLElement
    },
    markupOf: (node) => markupOf(node as unknown as FakeNode).replaceAll('><', '>\n<'),
    styleCallsOf: (node) => (node as unknown as FakeElement).styleCalls,
    remove: (node) => {
      detach(node as unknown as FakeNode)
    },
  }
}

/**
 * The text with `&`, `<` and `>` escaped.
 */
function escapedText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * The node's markup as `react-dom/server` writes it: attributes in the order they were set, text escaped, HTML as is.
 */
function markupOf(node: FakeNode): string {
  if (node instanceof FakeText) {
    return escapedText(node.data)
  }

  if (node instanceof FakeHtml) {
    return node.html
  }

  if (!(node instanceof FakeElement)) {
    return node.childNodes.map(markupOf).join('')
  }

  const attributes = [...node.attributes].map(
    ([name, value]) => ` ${name}="${escapedText(value).replaceAll('"', '&quot;')}"`,
  )

  return `<${node.localName}${attributes.join('')}>${node.childNodes.map(markupOf).join('')}</${node.localName}>`
}
