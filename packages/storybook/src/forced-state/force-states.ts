import { checkedStatesOf, type ForcedState, forcedStateClassOf, forcedStates } from './forced-states.js'
import { type HookContext, hookMethod, hookSetter, runEffect } from './prototype-hooks.js'
import { type StyleSheetRewriter, styleSheetRewriterOf } from './style-sheet-rewrite.js'
import type { SheetScope } from './twin-selectors.js'

/**
 * What forcing states reaches in a page: its document, the constructors whose prototypes it hooks, and its console.
 */
export interface PageGlobals {
  /**
   * The page's document.
   */
  document: Document
  /**
   * What watches the document and shadow roots for added and changed styles.
   */
  MutationObserver: typeof MutationObserver
  /**
   * Whose `insertRule`, `replaceSync` and `replace` are hooked.
   */
  CSSStyleSheet: typeof CSSStyleSheet
  /**
   * Whose `insertRule` is hooked, when the browser has it.
   */
  CSSGroupingRule: typeof CSSGroupingRule | undefined
  /**
   * Whose `adoptedStyleSheets` setter is hooked.
   */
  Document: typeof Document
  /**
   * Whose `adoptedStyleSheets` setter is hooked, and what tells a shadow root's sheets from the document's.
   */
  ShadowRoot: typeof ShadowRoot
  /**
   * Whose `attachShadow` is hooked.
   */
  Element: typeof Element
  /**
   * Where cross-origin stylesheets are reported.
   */
  console: Pick<Console, 'warn'>
}

/**
 * A page's forced states: the active requests and what keeps the page rewritten while there are any.
 */
export interface PageRewriter {
  /**
   * Starts forcing the states, beside any already forced, and gives the function that ends this request.
   */
  force(states: ReadonlySet<ForcedState>): () => void
}

/**
 * Where stylesheets apply: the document or a shadow root.
 */
type StyleRoot = Document | ShadowRoot

/**
 * One page's requests, and what keeps it rewritten while there are any.
 */
interface PageState {
  /**
   * The page.
   */
  page: PageGlobals
  /**
   * What rewrites its sheets, and remembers which it did.
   */
  rewriter: StyleSheetRewriter
  /**
   * The active requests for each state.
   */
  counts: Map<ForcedState, number>
  /**
   * The states with an active request: the union of the requests.
   */
  states: ReadonlySet<ForcedState>
  /**
   * Whether the prototype hooks are installed. They're never uninstalled.
   */
  hooked: boolean
  /**
   * The closed shadow roots attached since the hooks were installed, active or not, held weakly.
   */
  closedRoots: Set<WeakRef<ShadowRoot>>
  /**
   * The observer of the document and shadow roots, while there is a request.
   */
  observer: MutationObserver | undefined
  /**
   * The shadow roots found or attached while there is a request, closed ones included.
   */
  roots: Set<ShadowRoot>
  /**
   * The state classes this rewriter added to each shadow host.
   */
  hostClasses: Map<Element, Set<string>>
  /**
   * The capturing `load` listener.
   */
  onLoad: (event: Event) => void
}

/**
 * What the observer watches in the document and each shadow root.
 */
const observedChanges: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['class'],
}

/**
 * Every state's class, which shadow hosts take from their ancestors.
 */
const stateClasses = forcedStates.map(forcedStateClassOf)

/**
 * The rewriter of this realm's page, made on the first `forceStates`.
 */
let realmRewriter: PageRewriter | undefined

/**
 * The rewriter of one page. Creating it touches nothing in the page.
 */
export function pageRewriterOf(page: PageGlobals): PageRewriter {
  const state: PageState = {
    page,
    rewriter: styleSheetRewriterOf((message) => page.console.warn(message)),
    counts: new Map(),
    states: new Set(),
    hooked: false,
    closedRoots: new Set(),
    observer: undefined,
    roots: new Set(),
    hostClasses: new Map(),
    onLoad: (event) => rewriteLoaded(state, event),
  }

  return { force: (states) => force(state, states) }
}

/**
 * Forces states on this page, the way a grid's state columns do. Every stylesheet rule that uses one of the states gets a
 * twin selector, at the same specificity, that matches under the state's class: `visual-check-hover`, `visual-check-active`,
 * `visual-check-focus`, `visual-check-focus-visible` or `visual-check-focus-within`. Put the class on any ancestor of what
 * should show the state. It reaches `<style>` and `<link>` sheets, adopted sheets and shadow roots' sheets, and keeps
 * rewriting styles added or changed later, CSS-in-JS rules included, until the returned function is called. That makes
 * it fit a story's `beforeEach`. Rewritten rules stay rewritten, and without the classes nothing in the page changes. The
 * browser's default styles, states inside `:not()` and cross-origin stylesheets without CORS, which log a warning,
 * aren't forced. A sheet pushed onto `adoptedStyleSheets`, rather than assigned, is rewritten on the next change to the
 * DOM, so one pushed with no change after it may be missed. Without a DOM, it does nothing. Adapted from Storybook's
 * pseudo-states addon (MIT).
 *
 * @throws When a state isn't one visual-check forces, or is listed twice.
 * @public
 */
export function forceStates(states: readonly ForcedState[]): () => void {
  const checked = checkedStatesOf(states, 'forceStates')

  if (typeof globalThis.document === 'undefined' || checked.length === 0) {
    return () => undefined
  }

  realmRewriter ??= pageRewriterOf(globalThis)

  return realmRewriter.force(new Set(checked))
}

/**
 * Counts the request in, starting or growing the rewrite when it adds states, and gives its idempotent stop.
 */
function force(state: PageState, states: ReadonlySet<ForcedState>): () => void {
  const grows = [...states].some((forced) => !state.states.has(forced))
  let stopped = false

  count(state, states, 1)

  if (grows) {
    start(state)
  }

  return () => {
    if (!stopped) {
      stopped = true
      stop(state, states)
    }
  }
}

/**
 * Counts the request out, and deactivates once no state is left.
 */
function stop(state: PageState, states: ReadonlySet<ForcedState>): void {
  count(state, states, -1)

  if (state.states.size === 0) {
    deactivate(state)
  }
}

/**
 * Adds `change` to each state's count, and recomputes the union.
 */
function count(state: PageState, states: ReadonlySet<ForcedState>, change: number): void {
  for (const forced of states) {
    state.counts.set(forced, (state.counts.get(forced) ?? 0) + change)
  }

  state.states = new Set(forcedStates.filter((forced) => (state.counts.get(forced) ?? 0) > 0))
}

/**
 * Activates the rewriter on the first request, then does a full pass.
 */
function start(state: PageState): void {
  if (!isActive(state)) {
    installHooks(state)
    state.observer = new state.page.MutationObserver((records) => rewriteMutated(state, records))
    watch(state, state.page.document)
    addClosedRoots(state)
  }

  rewriteAll(state)
}

/**
 * Whether there is a request.
 */
function isActive(state: PageState): boolean {
  return state.observer !== undefined
}

/**
 * Registers the closed roots attached while inactive that are still alive, and forgets the dead ones.
 */
function addClosedRoots(state: PageState): void {
  for (const reference of state.closedRoots) {
    const root = reference.deref()

    if (root === undefined) {
      state.closedRoots.delete(reference)
    } else {
      state.roots.add(root)
      watch(state, root)
    }
  }
}

/**
 * Stops watching and takes the classes off hosts. Twins stay, inert without the classes, and hooks stay, inert.
 */
function deactivate(state: PageState): void {
  state.observer?.disconnect()
  state.observer = undefined

  for (const root of [state.page.document, ...state.roots]) {
    root.removeEventListener('load', state.onLoad, true)
  }

  for (const [host, classes] of state.hostClasses) {
    host.classList.remove(...classes)
  }

  state.hostClasses.clear()
  state.roots.clear()
}

/**
 * Observes the root and listens for its `load`s.
 */
function watch(state: PageState, root: StyleRoot): void {
  state.observer?.observe(root, observedChanges)
  root.addEventListener('load', state.onLoad, true)
}

/**
 * Rewrites the document, every open shadow root and every root already known, with those nested in them, then tags the
 * hosts.
 */
function rewriteAll(state: PageState): void {
  const known = [...state.roots].flatMap((root) => [root, ...shadowRootsIn(root.querySelectorAll('*'))])

  rewriteRoot(state, state.page.document)

  for (const root of [...shadowRootsIn(state.page.document.querySelectorAll('*')), ...known]) {
    addRoot(state, root)
  }

  tagHosts(state)
}

/**
 * Rewrites each root that changed once, the shadow roots added with new elements, and every known root's adopted
 * sheets, which a push onto `adoptedStyleSheets` changes without the setter, then tags the hosts.
 */
function rewriteMutated(state: PageState, records: MutationRecord[]): void {
  const changed = new Set(records.map((record) => record.target.getRootNode()))
  const added = new Set(records.flatMap((record) => elementsIn(state.page, record.addedNodes)))

  for (const root of changed) {
    if (isStyleRoot(state.page, root)) {
      rewriteRoot(state, root)
    }
  }

  for (const root of shadowRootsIn(added)) {
    addRoot(state, root)
  }

  for (const root of [state.page.document, ...state.roots]) {
    rewriteSheets(state, root, root.adoptedStyleSheets ?? [])
  }

  tagHosts(state)
}

/**
 * Rewrites the sheet of a `<link>` or `<style>` that loaded, or whose `@import`s did.
 */
function rewriteLoaded(state: PageState, event: Event): void {
  const target = event.target as Partial<LinkStyle> & Node
  const sheet = target.sheet

  if (sheet === null || sheet === undefined) {
    return
  }

  state.rewriter.forgetSheet(sheet)
  state.rewriter.rewriteSheet(sheet, scopeOf(state.page, target.getRootNode()), state.states)
}

/**
 * The elements among the nodes, and every element below them.
 */
function elementsIn(page: PageGlobals, nodes: NodeList): Element[] {
  return Array.from(nodes).flatMap((node) =>
    node instanceof page.Element ? [node, ...Array.from(node.querySelectorAll('*'))] : [],
  )
}

/**
 * The open shadow roots of the elements, and those nested in them.
 */
function shadowRootsIn(elements: Iterable<Element>): ShadowRoot[] {
  return [...elements].flatMap((element) =>
    element.shadowRoot === null ? [] : [element.shadowRoot, ...shadowRootsIn(element.shadowRoot.querySelectorAll('*'))],
  )
}

/**
 * Registers a shadow root, watching it the first time, and rewrites its sheets.
 */
function addRoot(state: PageState, root: ShadowRoot): void {
  if (!state.roots.has(root)) {
    state.roots.add(root)
    watch(state, root)
  }

  rewriteRoot(state, root)
}

/**
 * Rewrites a root's `<style>`, `<link>` and adopted sheets in its scope.
 */
function rewriteRoot(state: PageState, root: StyleRoot): void {
  rewriteSheets(state, root, [...Array.from(root.styleSheets), ...(root.adoptedStyleSheets ?? [])])
}

/**
 * Rewrites the sheets in the root's scope.
 */
function rewriteSheets(state: PageState, root: StyleRoot, sheets: CSSStyleSheet[]): void {
  const scope = scopeOf(state.page, root)

  for (const sheet of sheets) {
    state.rewriter.rewriteSheet(sheet, scope, state.states)
  }
}

/**
 * Whether a node is where stylesheets apply: a document or a shadow root.
 */
function isStyleRoot(page: PageGlobals, node: Node): node is StyleRoot {
  return node instanceof page.Document || node instanceof page.ShadowRoot
}

/**
 * The scope of the sheets in a root.
 */
function scopeOf(page: PageGlobals, root: Node): SheetScope {
  return root instanceof page.ShadowRoot ? 'shadow-root' : 'document'
}

/**
 * Gives each connected host the state classes of its composed ancestors, and takes off those it no longer gets. A
 * disconnected host's root is kept: a custom element often attaches a closed root before it's inserted.
 */
function tagHosts(state: PageState): void {
  for (const root of state.roots) {
    tagHost(state, root.host)
  }
}

/**
 * Gives a connected host the state classes of its composed ancestors, and takes off those it no longer gets.
 */
function tagHost(state: PageState, host: Element): void {
  if (host.isConnected) {
    setHostClasses(state, host, inheritedClassesOf(state, host))
  }
}

/**
 * The state classes of the element's composed ancestors, through shadow hosts, leaving out those this rewriter added.
 */
function inheritedClassesOf(state: PageState, element: Element): Set<string> {
  const classes = new Set<string>()

  for (let node = composedParentOf(state.page, element); node !== null; node = composedParentOf(state.page, node)) {
    for (const className of ownStateClassesOf(state, node)) {
      classes.add(className)
    }
  }

  return classes
}

/**
 * The node's parent, or its host when the parent is a shadow root.
 */
function composedParentOf(page: PageGlobals, node: Node): Node | null {
  const parent = node.parentNode

  return parent instanceof page.ShadowRoot ? parent.host : parent
}

/**
 * The state classes an element has that this rewriter didn't add.
 */
function ownStateClassesOf(state: PageState, node: Node): string[] {
  if (!(node instanceof state.page.Element)) {
    return []
  }

  const added = state.hostClasses.get(node)

  return stateClasses.filter((className) => node.classList.contains(className) && !added?.has(className))
}

/**
 * Adds the wanted classes the host lacks, and removes those this rewriter added that are no longer wanted.
 */
function setHostClasses(state: PageState, host: Element, wanted: Set<string>): void {
  const added = state.hostClasses.get(host) ?? new Set<string>()

  for (const className of wanted) {
    if (!host.classList.contains(className)) {
      host.classList.add(className)
      added.add(className)
    }
  }

  for (const className of [...added].filter((name) => !wanted.has(name))) {
    host.classList.remove(className)
    added.delete(className)
  }

  if (added.size > 0) {
    state.hostClasses.set(host, added)
  } else {
    state.hostClasses.delete(host)
  }
}

/**
 * Hooks the prototypes once, chaining with any earlier hook: `attachShadow`, the `adoptedStyleSheets` setters,
 * `insertRule`, `replaceSync` and `replace`.
 */
function installHooks(state: PageState): void {
  if (state.hooked) {
    return
  }

  const { page } = state
  const context: HookContext = { isActive: () => isActive(state), warn: (message) => page.console.warn(message) }

  state.hooked = true
  hookMethod<Element, ShadowRoot>(
    page.Element.prototype,
    'attachShadow',
    { ...context, isActive: () => true },
    (host, root) => attached(state, host, root),
  )
  hookSetter<StyleRoot>(page.Document.prototype, 'adoptedStyleSheets', context, (root) => adoptRoot(state, root))
  hookSetter<StyleRoot>(page.ShadowRoot.prototype, 'adoptedStyleSheets', context, (root) => adoptRoot(state, root))
  hookMethod<CSSStyleSheet, number>(page.CSSStyleSheet.prototype, 'insertRule', context, (sheet, index) =>
    rewriteInserted(state, sheet, sheet.cssRules[index]),
  )
  hookMethod<CSSGroupingRule, number>(page.CSSGroupingRule?.prototype, 'insertRule', context, (rule, index) =>
    rewriteInserted(state, rule.parentStyleSheet, rule.cssRules[index]),
  )
  hookMethod<CSSStyleSheet, unknown>(page.CSSStyleSheet.prototype, 'replaceSync', context, (sheet) =>
    rewriteReplaced(state, sheet),
  )
  hookMethod<CSSStyleSheet, Promise<unknown>>(page.CSSStyleSheet.prototype, 'replace', context, (sheet, replaced) => {
    replaced.then(
      () => runEffect(context, 'replace', () => rewriteReplaced(state, sheet)),
      () => undefined,
    )
  })
}

/**
 * Records a closed root, active or not, and while active registers any new root and tags its host.
 */
function attached(state: PageState, host: Element, root: ShadowRoot): void {
  if (host.shadowRoot !== root) {
    state.closedRoots.add(new WeakRef(root))
  }

  if (isActive(state)) {
    adoptRoot(state, root)
  }
}

/**
 * Rewrites a root a hook saw, registering it when it's a shadow root, and tags its host.
 */
function adoptRoot(state: PageState, root: StyleRoot): void {
  if (root instanceof state.page.ShadowRoot) {
    addRoot(state, root)
    tagHost(state, root.host)
  } else {
    rewriteRoot(state, root)
  }
}

/**
 * Rewrites an inserted rule in each scope its sheet applies in. A sheet with none, constructed and not yet adopted, is
 * left for when it is.
 */
function rewriteInserted(state: PageState, sheet: CSSStyleSheet | null, rule: CSSRule | undefined): void {
  if (sheet === null || rule === undefined) {
    return
  }

  for (const scope of scopesOf(state, sheet)) {
    state.rewriter.rewriteRule(rule, scope, state.states)
  }
}

/**
 * Walks a sheet whose rules were replaced again, in each scope it applies in.
 */
function rewriteReplaced(state: PageState, sheet: CSSStyleSheet): void {
  state.rewriter.forgetSheet(sheet)

  for (const scope of scopesOf(state, sheet)) {
    state.rewriter.rewriteSheet(sheet, scope, state.states)
  }
}

/**
 * The scopes a sheet applies in: its owner's root's, or those it was rewritten in.
 */
function scopesOf(state: PageState, sheet: CSSStyleSheet): SheetScope[] {
  if (sheet.ownerNode !== null) {
    return [scopeOf(state.page, sheet.ownerNode.getRootNode())]
  }

  return [...state.rewriter.scopesOf(sheet)]
}
