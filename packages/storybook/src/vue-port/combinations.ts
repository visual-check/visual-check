import {
  type AllowedComponentProps,
  type Component,
  type ComponentPublicInstance,
  defineComponent,
  h,
  type VNodeProps,
} from 'vue'
import { type GridInput, gridAttribute, gridLayoutOf } from '../grid-story/grid-layout.js'

/**
 * The props a cell's component takes: a component's own props, without the ones Vue adds to every component, or a
 * functional component's parameter.
 */
type CellPropsOf<C> = C extends new (
  ...args: never
) => { $props: infer P }
  ? Omit<P, keyof VNodeProps | keyof AllowedComponentProps>
  : C extends (props: infer P, ...args: never) => unknown
    ? P
    : Record<string, unknown>

/**
 * What `<Combinations>` takes: the component in every cell, and the grid's inputs, props typed by the component.
 *
 * @public
 */
export interface CombinationsProps<C extends Component> extends GridInput<CellPropsOf<C>> {
  /**
   * The component each cell renders, with its row's props. Its props type `props`, `args` and `caption`.
   */
  component: C
}

/**
 * Renders one component in every combination of the props it lists, as captioned rows in one grid. The cells are
 * children of the grid in Vue's own tree, with no second app and no Teleport, so what is provided around the grid, and
 * by the app, reaches them. Nothing here depends on Storybook. It works with Vue 3.
 *
 * With `states`, a header row names the columns, and each state cell carries its state's class.
 *
 * @throws When a prop lists no values, or `states` lists an unknown state or one twice.
 * @public
 */
export const Combinations = defineComponent({
  // biome-ignore lint/style/useVueMultiWordComponentNames: same name as the React port's <Combinations>
  name: 'Combinations',
  // The grid's element takes no attribute besides its own, as in every other port.
  inheritAttrs: false,
  props: ['component', 'props', 'args', 'cellWidth', 'states', 'caption'],
  setup(props) {
    return () => {
      // Safe enough: templates and TSX check the props through the construct signature below, and `h()` callers are
      // trusted. At runtime the values are taken as `GridInput`, and `gridLayoutOf` validates what matters.
      const { component, ...input } = props as unknown as CombinationsProps<Component>
      const layout = gridLayoutOf<object>(input)

      return h('div', { [gridAttribute]: '', style: layout.style }, [
        ...layout.headers.map((header) => h('div', { style: header.style }, header.text)),
        ...layout.rows.flatMap((row) => [
          ...(row.caption ? [h('div', { style: row.caption.style }, row.caption.text)] : []),
          ...row.cells.map((cell) =>
            h('div', { ...(cell.stateClass === null ? {} : { class: cell.stateClass }), style: cell.style }, [
              // A copy per cell: Vue normalizes `class` and `style` on the props object in place.
              h(component, { ...row.props }),
            ]),
          ),
        ]),
      ])
    }
  },
}) as unknown as new <C extends Component>(
  props: CombinationsProps<C>,
) => ComponentPublicInstance<CombinationsProps<C>>
