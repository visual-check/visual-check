/**
 * The attribute the grid's element carries, empty, which capture finds a grid by.
 *
 * @public
 */
export const gridAttribute = 'data-visual-check-grid'

/**
 * The values to try for each prop of a component, by prop name. Every combination of them is a row.
 *
 * @public
 */
export type PropValues<Props> = { readonly [Name in keyof Props]?: readonly Props[Name][] }

/**
 * What every port of the grid takes besides the component: the same in React, Vue, Angular and plain DOM.
 *
 * @public
 */
export interface GridInput<Props> {
  /**
   * The values to try for each prop. Rows follow the key order (declaration order), the last prop changing fastest. A
   * prop varies when it lists two or more values, even if they repeat; a prop with a single value applies to every
   * row. A prop whose list is `undefined` counts as not listed. Every prop the component requires has to come from
   * here or from `args`.
   */
  props: PropValues<Props>
  /**
   * The props every row shares. A prop listed in `props` wins over the same key here. Args never appear in a caption.
   * Every prop the component requires has to come from here or from `props`: a story usually passes its own args.
   */
  args?: Partial<Props> | undefined
  /**
   * The width of every column in CSS pixels, each cell exactly that wide. Without it, a column is as wide as its widest
   * cell.
   */
  cellWidth?: number | undefined
  /**
   * Replaces a caption's default text. It gets only the row's varying props, in declaration order, and isn't called
   * for a row with no varying prop.
   */
  caption?: ((props: Partial<Props>) => string) | undefined
}

/**
 * An element's inline styles: CSS property names as CSS writes them, to values. The order matters: `all` first.
 *
 * @public
 */
export type GridStyle = Readonly<Record<string, string>>

/**
 * The caption above a row: a line that names the row's varying props.
 *
 * @public
 */
export interface GridCaption {
  /**
   * The caption's text.
   */
  text: string
  /**
   * The caption element's inline styles.
   */
  style: GridStyle
}

/**
 * A cell of a row: the element that holds one render of the component.
 *
 * @public
 */
export interface GridCell {
  /**
   * The cell element's inline styles.
   */
  style: GridStyle
}

/**
 * A row of the grid: one combination of the listed props.
 *
 * @public
 */
export interface GridRow<Props> {
  /**
   * The props of the row's component: `{ ...args, ...combination }`. They are complete only when `args` and `props`
   * together hold every prop the component requires.
   */
  props: Props
  /**
   * The row's caption, or `null` for a row with no varying prop.
   */
  caption: GridCaption | null
  /**
   * One cell per column, in column order: only the default state's for now.
   */
  cells: GridCell[]
}

/**
 * Everything a port draws: the grid element's styles and its rows.
 *
 * @public
 */
export interface GridLayout<Props> {
  /**
   * The grid element's inline styles.
   */
  style: GridStyle
  /**
   * The rows, in combination order.
   */
  rows: GridRow<Props>[]
}

/**
 * The gap between two columns, in CSS pixels.
 */
const columnGap = 16

/**
 * The space above every row's caption but the first, in CSS pixels.
 */
const rowGap = 16

/**
 * The space between a caption and its row's cells, in CSS pixels.
 */
const captionGap = 4

/**
 * A combination of listed props: one value for each prop, by prop name.
 */
type Combination = Record<string, unknown>

/**
 * Every combination of the listed values, in the entries' order, the last prop changing fastest.
 *
 * @throws When a prop lists no values.
 */
function combinationsOf(entries: [string, readonly unknown[]][]): Combination[] {
  return entries.reduce<Combination[]>(
    (rows, [name, values]) => {
      if (values.length === 0) {
        throw new Error(`visual-check: the grid lists no values for the prop "${name}".`)
      }

      return rows.flatMap((row) => values.map((value) => ({ ...row, [name]: value })))
    },
    [{}],
  )
}

/**
 * How a value reads in a default caption: strings as they are, numbers, booleans, `null` and `undefined` through
 * `String()`, anything else an ellipsis.
 */
function captionValueOf(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return String(value)
  }

  return '…'
}

/**
 * A caption's text: `caption`'s result when given, else `key: value` for each varying prop, joined by `, `.
 */
function captionTextOf(varying: Combination, caption: ((props: Combination) => string) | undefined): string {
  if (caption) {
    return caption(varying)
  }

  return Object.entries(varying)
    .map(([name, value]) => `${name}: ${captionValueOf(value)}`)
    .join(', ')
}

/**
 * The grid element's styles: one column per entry, as wide as its widest cell or `cellWidth`. Only properties that
 * aren't inherited, so cells inherit from the page.
 */
function gridStyleOf(columns: number, cellWidth: number | undefined): GridStyle {
  const column = cellWidth === undefined ? 'max-content' : `${cellWidth}px`

  return {
    display: 'grid',
    'grid-template-columns': Array.from({ length: columns }, () => column).join(' '),
    'column-gap': `${columnGap}px`,
    'row-gap': '0',
    width: 'max-content',
    margin: '0',
    padding: '0',
    border: 'none',
    background: 'none',
  }
}

/**
 * A caption element's styles: reset, spanning every column, its text never widening a column.
 */
function captionStyleOf(rowIndex: number): GridStyle {
  const top = rowIndex === 0 ? '0' : `${rowGap}px`

  return {
    all: 'initial',
    display: 'block',
    'grid-column': '1 / -1',
    margin: `${top} 0 ${captionGap}px`,
    contain: 'inline-size',
    'font-family': 'monospace',
    'font-size': '11px',
    'line-height': '14px',
    color: '#737373',
    'overflow-wrap': 'anywhere',
  }
}

/**
 * A cell element's styles: aligned to the start, and exactly `cellWidth` wide when given.
 */
function cellStyleOf(cellWidth: number | undefined): GridStyle {
  const alignment = { 'justify-self': 'start', 'align-self': 'start' }

  if (cellWidth === undefined) {
    return alignment
  }

  return { ...alignment, width: `${cellWidth}px` }
}

/**
 * Works out a grid: its rows (every combination of the listed props), each caption's text and every element's inline
 * styles. Each port only turns the layout into elements.
 *
 * @throws When a prop lists no values.
 * @public
 */
export function gridLayoutOf<Props extends object>(input: GridInput<Props>): GridLayout<Props> {
  const entries = Object.entries(input.props).filter(
    (entry): entry is [string, readonly unknown[]] => entry[1] !== undefined,
  )
  const varyingNames = entries.filter(([, values]) => values.length > 1).map(([name]) => name)
  // Safe: `caption` only ever gets values taken from `props`, which are `PropValues<Props>`.
  const caption = input.caption as ((props: Combination) => string) | undefined
  const rows = combinationsOf(entries).map((combination, rowIndex): GridRow<Props> => {
    const varying = Object.fromEntries(varyingNames.map((name) => [name, combination[name]]))

    return {
      // The contract, not the types, makes this whole: `args` and `props` together hold every prop the component
      // requires. One cast here spares every port its own.
      props: { ...input.args, ...combination } as Props,
      caption:
        varyingNames.length === 0 ? null : { text: captionTextOf(varying, caption), style: captionStyleOf(rowIndex) },
      cells: [{ style: cellStyleOf(input.cellWidth) }],
    }
  })

  return { style: gridStyleOf(1, input.cellWidth), rows }
}
