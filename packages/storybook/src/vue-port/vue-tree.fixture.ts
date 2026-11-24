import { type CreateAppFunction, createRenderer } from 'vue'

/**
 * A node of the fake tree: an element, a text or a comment.
 */
interface FakeVueNode {
  /**
   * The element's tag, or `#text` or `#comment`.
   */
  tag: string
  /**
   * The element's props, as Vue last patched them.
   */
  props: Record<string, unknown>
  /**
   * Its children, in order.
   */
  children: FakeVueNode[]
  /**
   * Its parent, or null when it's detached.
   */
  parent: FakeVueNode | null
  /**
   * The text of a text or comment node, or an element's text content.
   */
  text: string
}

/**
 * What a test mounts the grid with: an app maker and the root node to mount it into.
 */
export interface FakeVueTree {
  /**
   * Makes an app rendered into the fake tree.
   */
  createApp: CreateAppFunction<FakeVueNode>
  /**
   * The node to mount the app into.
   */
  root: FakeVueNode
}

/**
 * A new detached node.
 */
function nodeOf(tag: string, text = ''): FakeVueNode {
  return { tag, props: {}, children: [], parent: null, text }
}

/**
 * Takes the node out of its parent's children, if it has a parent.
 */
function detach(node: FakeVueNode): void {
  if (node.parent !== null) {
    node.parent.children = node.parent.children.filter((child) => child !== node)
    node.parent = null
  }
}

/**
 * How the log names a node: its tag, then `.<class>` when it has one.
 */
function logNameOf(node: FakeVueNode): string {
  const { class: className } = node.props

  return typeof className === 'string' && className !== '' ? `${node.tag}.${className}` : node.tag
}

/**
 * Vue's renderer into a tree of plain objects. Each node put into or taken out of the tree is logged, as
 * `insert <tag>[.<class>]` and `remove <tag>`, so a test sees when Vue changes the tree.
 */
export function fakeVueTree(log: string[]): FakeVueTree {
  const { createApp } = createRenderer<FakeVueNode, FakeVueNode>({
    createElement: (tag) => nodeOf(tag),
    createText: (text) => nodeOf('#text', text),
    createComment: (text) => nodeOf('#comment', text),
    setText: (node, text) => {
      node.text = text
    },
    setElementText: (element, text) => {
      element.children = []
      element.text = text
    },
    insert: (node, parent, anchor) => {
      detach(node)

      const at = anchor ? parent.children.indexOf(anchor) : -1

      parent.children.splice(at === -1 ? parent.children.length : at, 0, node)
      node.parent = parent
      log.push(`insert ${logNameOf(node)}`)
    },
    remove: (node) => {
      detach(node)
      log.push(`remove ${logNameOf(node)}`)
    },
    patchProp: (element, key, _previous, next) => {
      element.props[key] = next
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => {
      const siblings = node.parent?.children ?? []

      return siblings[siblings.indexOf(node) + 1] ?? null
    },
  })

  return { createApp, root: nodeOf('root') }
}
