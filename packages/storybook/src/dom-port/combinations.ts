import {
  type GridCaption,
  type GridHeader,
  type GridInput,
  type GridLayout,
  type GridStyle,
  gridAttribute,
  gridLayoutOf,
} from '../grid-story/grid-layout.js'

/**
 * What `combinations()` takes: how to render each cell, and the grid's inputs, typed by its props. Its types need
 * TypeScript 5.4 or later, for `NoInfer`.
 *
 * @public
 */
export interface CombinationsInput<Props extends object> extends GridInput<NoInfer<Props>> {
  /**
   * Renders one cell with its row's props: a new node, or a string of HTML, which the cell holds. It's called once per
   * cell, in document order. Its parameter types `props`, `args` and `caption`.
   */
  render: (props: Props) => Node | string
}

/**
 * What the plain-DOM port reaches in the page.
 */
export interface GridPage {
  /**
   * The document the grid's elements are created in.
   */
  document: Document
}

/**
 * Sets the style on the element one property at a time, in the layout's order.
 */
function styled(element: HTMLElement, style: GridStyle): void {
  for (const [name, value] of Object.entries(style)) {
    element.style.setProperty(name, value)
  }
}

/**
 * A header's or a caption's `div`: its style, then its text.
 */
function labelOf(document: Document, { text, style }: GridHeader | GridCaption): HTMLElement {
  const label = document.createElement('div')

  styled(label, style)
  label.textContent = text

  return label
}

/**
 * Whether the value is a node, of this page or of another realm: an object with a numeric `nodeType`.
 */
function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { nodeType?: unknown }).nodeType === 'number'
}

/**
 * Puts what `render` returned in the cell: HTML as its markup, a node as its child.
 *
 * @throws When the content is neither a node nor a string, or is a node another cell already holds.
 */
function fill(cell: HTMLElement, content: unknown, rendered: Set<Node>): void {
  if (typeof content === 'string') {
    cell.innerHTML = content

    return
  }

  if (!isNode(content)) {
    throw new Error(
      "visual-check: the grid's render returned neither a node nor HTML. Return a new node, or a string of HTML.",
    )
  }

  if (rendered.has(content)) {
    throw new Error(
      "visual-check: the grid's render returned the same node for two cells. Return a new node each time it's called.",
    )
  }

  rendered.add(content)
  cell.append(content)
}

/**
 * The grid's element for the layout, in the page's document: the same elements and styles as the React port draws,
 * with no whitespace between them. Each element gets its attributes first, then its style, one property at a time in
 * the layout's order, then its children.
 *
 * @throws When `render` returns neither a node nor HTML, or the same node for two cells.
 */
export function gridElementOf<Props extends object>(
  page: GridPage,
  layout: GridLayout<Props>,
  render: (props: Props) => Node | string,
): HTMLElement {
  const { document } = page
  const grid = document.createElement('div')
  const rendered = new Set<Node>()

  grid.setAttribute(gridAttribute, '')
  styled(grid, layout.style)

  for (const header of layout.headers) {
    grid.append(labelOf(document, header))
  }

  for (const row of layout.rows) {
    if (row.caption !== null) {
      grid.append(labelOf(document, row.caption))
    }

    for (const cell of row.cells) {
      const element = document.createElement('div')

      if (cell.stateClass !== null) {
        element.className = cell.stateClass
      }

      styled(element, cell.style)
      fill(element, render(row.props), rendered)
      grid.append(element)
    }
  }

  return grid
}

/**
 * Renders every combination of the props it lists, as captioned rows in one grid, and returns the grid's `<div>` for
 * the story to return or place. It draws the same elements and styles as the React port, so one grid gives the same
 * images through either. Nothing here depends on Storybook. It works with Storybook's html and web-components
 * renderers. Call it in the story's render, so each render makes its own grid.
 *
 * With `states`, a header row names the columns, and each state cell carries its state's class.
 *
 * @throws When a prop lists no values, or `states` lists an unknown state or one twice; when there is no DOM; when
 * `render` returns neither a node nor HTML, or the same node for two cells.
 * @public
 */
export function combinations<Props extends object>({ render, ...input }: CombinationsInput<Props>): HTMLElement {
  const layout = gridLayoutOf<Props>(input)

  if (typeof globalThis.document === 'undefined') {
    throw new Error("visual-check: combinations() needs a DOM. Call it in a story's render.")
  }

  return gridElementOf({ document: globalThis.document }, layout, render)
}
