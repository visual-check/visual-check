import { isPlatformServer, NgComponentOutlet } from '@angular/common'
import {
  Directive,
  type InputSignalWithTransform,
  inject,
  type OnDestroy,
  type OutputRef,
  PLATFORM_ID,
  reflectComponentType,
  type Type,
} from '@angular/core'
import { forceStates } from '../forced-state/force-states.js'
import type { ForcedState } from '../forced-state/forced-states.js'
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
 * What a field of a cell's component takes as an input: a signal input's write type (`model()` included), nothing for
 * a function (a method, `computed`, another signal) or an output, else the field's own type (a decorator `@Input()`).
 */
type InputValueOf<Field> =
  Field extends InputSignalWithTransform<infer _Read, infer Write>
    ? Write
    : Field extends ((...args: never) => unknown) | OutputRef<unknown>
      ? never
      : Field

/**
 * The inputs a cell's component takes, by name: each of its public fields that can be an input, with the type it takes.
 */
type CellInputsOf<Component> = {
  [Name in keyof Component as [InputValueOf<Component[Name]>] extends [never] ? never : Name]: InputValueOf<
    Component[Name]
  >
}

/**
 * What `combinations()` takes: the component in every cell, and the grid's inputs, typed by the component's inputs. Its
 * types need TypeScript 5.4 or later, for `NoInfer`.
 *
 * @public
 */
export interface CombinationsInput<Component> extends GridInput<NoInfer<CellInputsOf<Component>>> {
  /**
   * The component each cell creates, with its row's props as inputs. Its inputs type `props`, `args` and `caption`.
   */
  component: Type<Component>
}

/**
 * What `combinations()` returns, for a story's render to return: the grid's template, the props it reads and the
 * module metadata it needs, as Storybook's Angular renderer takes them.
 *
 * @public
 */
export interface CombinationsStory {
  /**
   * The grid's template. It reads only `visualCheckGrid`, so it is the same for any grid of the same shape.
   */
  template: string
  /**
   * What the template reads.
   */
  props: {
    /**
     * The grid's component, each row's inputs, and every header's and caption's text, in document order.
     */
    visualCheckGrid: {
      /**
       * The component each cell creates.
       */
      component: Type<unknown>
      /**
       * Each row's inputs: `{ ...args, ...combination }`.
       */
      rows: object[]
      /**
       * Every header's text, then every caption's, in document order.
       */
      texts: string[]
    }
  }
  /**
   * What the template uses: `NgComponentOutlet`, which creates the cells, and with states the directive that forces
   * them.
   */
  moduleMetadata: {
    /**
     * The standalone directives the template uses.
     */
    imports: Type<unknown>[]
  }
}

/**
 * A style as an inline `style` attribute's text: `name:value`, joined by `;`, in the layout's order. Values come only
 * from the layout, so nothing needs escaping.
 */
function styleTextOf(style: GridStyle): string {
  return Object.entries(style)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
}

/**
 * The grid's template and the texts it reads.
 */
interface GridTemplate {
  /**
   * The grid's template, with no whitespace between elements.
   */
  template: string
  /**
   * Every header's and caption's text, in document order: what `visualCheckGrid.texts` holds.
   */
  texts: string[]
}

/**
 * The grid's template, drawing the same elements and styles as the React port, and the texts it reads. Headers' and
 * captions' text goes through interpolation, so it's written literally, never parsed as a template.
 */
function gridTemplateOf(layout: GridLayout<object>): GridTemplate {
  const texts: string[] = []
  const label = ({ text, style }: GridHeader | GridCaption) =>
    `<div style="${styleTextOf(style)}">{{ visualCheckGrid.texts[${texts.push(text) - 1}] }}</div>`
  const headers = layout.headers.map(label)
  const rows = layout.rows.flatMap((row, index) => [
    ...(row.caption ? [label(row.caption)] : []),
    ...row.cells.map(
      (cell) =>
        `<div${cell.stateClass === null ? '' : ` class="${cell.stateClass}"`} style="${styleTextOf(cell.style)}">` +
        `<ng-container *ngComponentOutlet="visualCheckGrid.component; inputs: visualCheckGrid.rows[${index}]" />` +
        '</div>',
    ),
  ])

  return {
    template: `<div ${gridAttribute}="" style="${styleTextOf(layout.style)}">${[...headers, ...rows].join('')}</div>`,
    texts,
  }
}

/**
 * A standalone directive, made for one grid, that matches the grid's own element and forces the states from when it's
 * created, before any cell, until Angular destroys it. It forces nothing while rendering on the server.
 */
function forcingDirectiveOf(states: readonly ForcedState[]): Type<OnDestroy> {
  return Directive({ selector: `div[${gridAttribute}]`, standalone: true })(
    class ForcedStates implements OnDestroy {
      /**
       * Stops forcing the states, or nothing on the server.
       */
      readonly #stop = isPlatformServer(inject(PLATFORM_ID)) ? undefined : forceStates(states)

      /**
       * Stops forcing the states when Angular destroys the grid.
       */
      ngOnDestroy(): void {
        this.#stop?.()
      }
    },
  )
}

/**
 * Checks that the component is an Angular component that takes every prop the grid sets, by the input's public name.
 *
 * @throws When the component is not an Angular component, or a name in `props` or `args` is none of its inputs.
 */
function checkInputs(component: Type<unknown>, input: GridInput<object>): void {
  const mirror = reflectComponentType(component)

  if (mirror === null) {
    throw new Error(`visual-check: ${component.name} is not an Angular component.`)
  }

  const inputs = new Set(mirror.inputs.map(({ templateName }) => templateName))

  for (const name of [...Object.keys(input.props), ...Object.keys(input.args ?? {})]) {
    if (!inputs.has(name)) {
      throw new Error(`visual-check: ${component.name} has no input "${name}".`)
    }
  }
}

/**
 * Renders one component in every combination of the props it lists, as captioned rows in one grid, returned as the
 * story's `template`, `props` and `moduleMetadata` for Storybook's Angular renderer:
 * `render: (args) => combinations({ component: Button, props: { size: ['sm', 'lg'] }, args })`. The cells are created
 * by `NgComponentOutlet` in the story's own view, so the injector reaches them, the story's `moduleMetadata` providers
 * and the app's included, and their inputs, signal inputs included, are set with `setInput`. A story may wrap
 * `template` in its own markup, spreading `props` and `moduleMetadata`. Nothing here depends on Storybook. It works
 * with Angular 18 and later, with Angular's JIT compiler loaded, as Storybook's Angular renderer has it.
 *
 * With `states`, a header row names the columns, each state cell carries its state's class, and stylesheets are
 * rewritten to force those states from when the grid's element is created, before any cell, until Angular destroys
 * it, and never while rendering on the server.
 *
 * @throws When the component is not an Angular component, a name in `props` or `args` is none of its inputs, a prop
 * lists no values, or `states` lists an unknown state or one twice.
 * @public
 */
export function combinations<Component>({ component, ...input }: CombinationsInput<Component>): CombinationsStory {
  checkInputs(component, input)

  const layout = gridLayoutOf<object>(input)
  const { template, texts } = gridTemplateOf(layout)

  return {
    template,
    props: { visualCheckGrid: { component, rows: layout.rows.map((row) => row.props), texts } },
    moduleMetadata: {
      imports:
        layout.states.length === 0 ? [NgComponentOutlet] : [NgComponentOutlet, forcingDirectiveOf(layout.states)],
    },
  }
}
