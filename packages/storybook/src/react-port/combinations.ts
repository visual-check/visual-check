import { type ComponentType, type CSSProperties, createElement, type ReactElement, useInsertionEffect } from 'react'
import { forceStates } from '../forced-state/force-states.js'
import { checkedStatesOf } from '../forced-state/forced-states.js'
import { type GridInput, type GridStyle, gridAttribute, gridLayoutOf } from '../grid-story/grid-layout.js'

/**
 * What `<Combinations>` takes: the component in every cell, and the grid's inputs, typed by its props. Its types need
 * TypeScript 5.4 or later, for `NoInfer`.
 *
 * @public
 */
export interface CombinationsProps<Props extends object> extends GridInput<NoInfer<Props>> {
  /**
   * The component each cell renders, with its row's props. Its props type `props`, `args` and `caption`.
   */
  component: ComponentType<Props>
}

/**
 * A layout's style as React takes it: each CSS property name camel-cased, in the same order.
 */
function reactStyleOf(style: GridStyle): CSSProperties {
  const entries = Object.entries(style).map(([name, value]) => [
    name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    value,
  ])

  // Safe: every name comes from the layout, which writes only standard CSS properties.
  return Object.fromEntries(entries) as CSSProperties
}

/**
 * Renders one component in every combination of the props it lists, as captioned rows in one grid. The cells are
 * children of the grid in React's own tree, with no portal and no second root, so the context around the grid reaches
 * them. Nothing here depends on Storybook. It works with React 18 and 19.
 *
 * With `states`, a header row names the columns, and each state cell carries its state's class. The page's stylesheets
 * are rewritten to force those states from when the grid appears until it unmounts.
 *
 * @throws When a prop lists no values, or `states` lists an unknown state or one twice.
 * @public
 */
export function Combinations<Props extends object>({ component, ...input }: CombinationsProps<Props>): ReactElement {
  const layout = gridLayoutOf<Props>(input)
  // A string, so the effect stays put across re-renders that list the same states.
  const statesKey = layout.states.join(' ')

  // Insertion effects run before the commit's DOM mutations, so the twins exist before the cells do, and never on the
  // server.
  useInsertionEffect(() => {
    if (statesKey === '') {
      return undefined
    }

    return forceStates(checkedStatesOf(statesKey.split(' '), 'the grid'))
  }, [statesKey])

  // Children passed one by one, not as an array: they are static, so they need no keys.
  return createElement(
    'div',
    { [gridAttribute]: '', style: reactStyleOf(layout.style) },
    ...layout.headers.map((header) => createElement('div', { style: reactStyleOf(header.style) }, header.text)),
    ...layout.rows.flatMap((row) => [
      ...(row.caption ? [createElement('div', { style: reactStyleOf(row.caption.style) }, row.caption.text)] : []),
      ...row.cells.map((cell) =>
        createElement(
          'div',
          { className: cell.stateClass ?? undefined, style: reactStyleOf(cell.style) },
          createElement(component, row.props),
        ),
      ),
    ]),
  )
}
