import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  type App,
  type Component,
  createSSRApp,
  defineComponent,
  getCurrentInstance,
  h,
  type InjectionKey,
  inject,
  type PropType,
  provide,
} from 'vue'
import { renderToString } from 'vue/server-renderer'
import { type GridStyle, gridLayoutOf, type PropValues } from '../grid-story/grid-layout.js'
import { Combinations, type CombinationsProps } from './combinations.js'

/**
 * What the test button takes.
 */
interface ButtonProps {
  /**
   * The button's text.
   */
  label: string
  /**
   * How the button is drawn.
   */
  variant: 'solid' | 'outline'
  /**
   * How big the button is.
   */
  size: 'sm' | 'lg'
}

/**
 * A button that writes every prop it gets.
 */
const Button = defineComponent({
  props: {
    label: { type: String, required: true },
    variant: { type: String as PropType<'solid' | 'outline'>, required: true },
    size: { type: String as PropType<'sm' | 'lg'>, required: true },
  },
  setup(props) {
    return () => h('button', { type: 'button' }, `${props.label} ${props.variant} ${props.size}`)
  },
})

/**
 * The theme a provider above the grid gives.
 */
const Theme: InjectionKey<string> = Symbol('theme')

/**
 * Writes the theme it injects, so a test sees whether `provide` reaches the cells.
 */
const Themed = defineComponent({
  props: { n: { type: Number, required: true } },
  setup(props) {
    const theme = inject(Theme, 'none')

    return () => h('span', `${theme} ${props.n}`)
  },
})

/**
 * The app's server-rendered markup, one tag per line. Only Vue's own spellings are rewritten to React's, so the React
 * port's snapshots apply verbatim: a style's trailing `;` is dropped, and the bare grid attribute gets an empty value.
 */
async function markupOf(app: App): Promise<string> {
  const markup = await renderToString(app)

  return markup
    .replaceAll(';"', '"')
    .replaceAll('data-visual-check-grid ', 'data-visual-check-grid="" ')
    .replaceAll('><', '>\n<')
}

/**
 * The markup of an app that renders only the grid for the props.
 */
function gridMarkupOf<C extends Component>(props: CombinationsProps<C>): Promise<string> {
  return markupOf(createSSRApp(() => h(Combinations, props)))
}

/**
 * Every `style` attribute's text in the markup, in document order.
 */
function stylesOf(markup: string): string[] {
  return [...markup.matchAll(/style="([^"]*)"/g)].map(([, style]) => style ?? '')
}

/**
 * The text Vue writes for a layout's style, once the trailing `;` is dropped: `name:value`, joined by `;`, in order.
 */
function styleTextOf(style: GridStyle): string {
  return Object.entries(style)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
}

/**
 * The text of every `<span>` in the markup, in document order.
 */
function spansOf(markup: string): (string | undefined)[] {
  return [...markup.matchAll(/<span>(.*?)<\/span>/g)].map(([, text]) => text)
}

describe('Combinations', () => {
  it('draws the grid, a caption above each row and a cell for each combination', async () => {
    const markup = await gridMarkupOf({
      component: Button,
      props: { variant: ['solid', 'outline'], size: ['sm', 'lg'] },
      args: { label: 'Go' },
    })

    expect(markup).toMatchInlineSnapshot(`
      "<div data-visual-check-grid="" style="display:grid;grid-template-columns:max-content;column-gap:16px;row-gap:0;width:max-content;margin:0;padding:0;border:none;background:none">
      <div style="all:initial;display:block;grid-column:1 / -1;margin:0 0 4px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">variant: solid, size: sm</div>
      <div style="justify-self:start;align-self:start">
      <button type="button">Go solid sm</button>
      </div>
      <div style="all:initial;display:block;grid-column:1 / -1;margin:16px 0 4px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">variant: solid, size: lg</div>
      <div style="justify-self:start;align-self:start">
      <button type="button">Go solid lg</button>
      </div>
      <div style="all:initial;display:block;grid-column:1 / -1;margin:16px 0 4px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">variant: outline, size: sm</div>
      <div style="justify-self:start;align-self:start">
      <button type="button">Go outline sm</button>
      </div>
      <div style="all:initial;display:block;grid-column:1 / -1;margin:16px 0 4px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">variant: outline, size: lg</div>
      <div style="justify-self:start;align-self:start">
      <button type="button">Go outline lg</button>
      </div>
      </div>"
    `)
  })

  it('draws a header row naming each column, and each state cell with its class', async () => {
    const markup = await gridMarkupOf({
      component: Button,
      props: { size: ['sm', 'lg'] },
      args: { label: 'Go', variant: 'solid' },
      states: ['hover', 'focus-visible'],
    })

    expect(markup).toMatchInlineSnapshot(`
      "<div data-visual-check-grid="" style="display:grid;grid-template-columns:max-content max-content max-content;column-gap:16px;row-gap:0;width:max-content;margin:0;padding:0;border:none;background:none">
      <div style="all:initial;display:block;margin:0 0 16px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">default</div>
      <div style="all:initial;display:block;margin:0 0 16px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">:hover</div>
      <div style="all:initial;display:block;margin:0 0 16px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">:focus-visible</div>
      <div style="all:initial;display:block;grid-column:1 / -1;margin:0 0 4px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">size: sm</div>
      <div style="justify-self:start;align-self:start">
      <button type="button">Go solid sm</button>
      </div>
      <div class="visual-check-hover" style="justify-self:start;align-self:start">
      <button type="button">Go solid sm</button>
      </div>
      <div class="visual-check-focus-visible" style="justify-self:start;align-self:start">
      <button type="button">Go solid sm</button>
      </div>
      <div style="all:initial;display:block;grid-column:1 / -1;margin:16px 0 4px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">size: lg</div>
      <div style="justify-self:start;align-self:start">
      <button type="button">Go solid lg</button>
      </div>
      <div class="visual-check-hover" style="justify-self:start;align-self:start">
      <button type="button">Go solid lg</button>
      </div>
      <div class="visual-check-focus-visible" style="justify-self:start;align-self:start">
      <button type="button">Go solid lg</button>
      </div>
      </div>"
    `)
  })

  it.each([
    ['without states', []],
    ['with states', ['hover', 'focus-visible']],
  ] as const)('writes every style of the layout unchanged, in order, %s', async (_, states) => {
    const input = {
      props: { variant: ['solid', 'outline'] as const },
      args: { label: 'Go', size: 'sm' as const },
      states,
      cellWidth: 200,
    }
    const layout = gridLayoutOf<ButtonProps>(input)
    const expected = [
      styleTextOf(layout.style),
      ...layout.headers.map((header) => styleTextOf(header.style)),
      ...layout.rows.flatMap((row) => [
        ...(row.caption ? [styleTextOf(row.caption.style)] : []),
        ...row.cells.map((cell) => styleTextOf(cell.style)),
      ]),
    ]

    expect(stylesOf(await gridMarkupOf({ component: Button, ...input }))).toStrictEqual(expected)
  })

  it('reaches every cell with what a parent component provides', async () => {
    const Parent = defineComponent({
      setup() {
        provide(Theme, 'provided')

        return () => h(Combinations, { component: Themed, props: { n: [1, 2, 3] } })
      },
    })

    expect(spansOf(await markupOf(createSSRApp(Parent)))).toStrictEqual(['provided 1', 'provided 2', 'provided 3'])
  })

  it('reaches every cell with what the app provides', async () => {
    const app = createSSRApp(() => h(Combinations, { component: Themed, props: { n: [1, 2] } }))

    app.provide(Theme, 'app')

    expect(spansOf(await markupOf(app))).toStrictEqual(['app 1', 'app 2'])
  })

  it("passes each cell its row's props, a fresh object per cell", async () => {
    const received: unknown[] = []
    const cell = defineComponent({
      setup() {
        // The exact object passed to `h()` for this cell, where Vue's own per-instance copy can't hide sharing.
        received.push(getCurrentInstance()?.vnode.props)

        return () => h('span')
      },
    })

    await gridMarkupOf({ component: cell, props: { size: ['sm', 'lg'] }, args: { label: 'Go' }, states: ['hover'] })

    expect(received).toStrictEqual([
      { label: 'Go', size: 'sm' },
      { label: 'Go', size: 'sm' },
      { label: 'Go', size: 'lg' },
      { label: 'Go', size: 'lg' },
    ])
    expect(new Set(received).size).toBe(4)
  })

  it('writes the text a custom caption gives', async () => {
    const markup = await gridMarkupOf({
      component: Button,
      props: { size: ['sm', 'lg'] },
      args: { label: 'Go', variant: 'solid' },
      caption: (props: Partial<ButtonProps>) => `size ${props.size}`,
    })

    expect(markup).toContain('>size sm</div>')
    expect(markup).toContain('>size lg</div>')
  })

  it('draws no caption when no prop varies', async () => {
    const markup = await gridMarkupOf({
      component: Button,
      props: { size: ['sm'] },
      args: { label: 'Go', variant: 'solid' },
    })

    // The grid and the one row's cell, with no caption between them.
    expect(markup.match(/<div/g)).toHaveLength(2)
  })

  it('drops attributes passed besides the inputs', async () => {
    const markup = await markupOf(
      createSSRApp(() =>
        h(Combinations, {
          component: Button,
          props: { size: ['sm'] },
          args: { label: 'Go', variant: 'solid' },
          class: 'extra',
          id: 'extra',
          style: { color: 'red' },
        }),
      ),
    )

    expect(markup).not.toContain('extra')
    expect(markup).not.toContain('color:red')
  })

  it("rejects with the layout's error, and never sets up the cell component", async () => {
    const setup = vi.fn(() => () => h('span'))
    const Cell = defineComponent({ props: { size: String }, setup })

    await expect(gridMarkupOf({ component: Cell, props: { size: [] } })).rejects.toThrow(/^visual-check: /)
    expect(setup).not.toHaveBeenCalled()
  })

  it("types the props' values from the component", () => {
    expectTypeOf<CombinationsProps<typeof Button>['props']>().toEqualTypeOf<PropValues<ButtonProps>>()

    const inferred = () =>
      new Combinations({
        component: Button,
        props: { size: ['sm'] },
        args: { label: 'Go', variant: 'solid' },
        caption: (props) => {
          // Vue's `$props` are readonly.
          expectTypeOf(props).toEqualTypeOf<Partial<Readonly<ButtonProps>>>()

          return ''
        },
      })
    const functional = () =>
      new Combinations({
        component: (props: { n: number }) => h('span', props.n),
        props: { n: [1, 2] },
        caption: (props) => {
          expectTypeOf(props).toEqualTypeOf<Partial<{ n: number }>>()

          return ''
        },
      })
    // @ts-expect-error 'huge' is not a size of the button.
    const huge = () => new Combinations({ component: Button, props: { size: ['huge'] } })
    // @ts-expect-error The button has no colour.
    const colour = () => new Combinations({ component: Button, props: { colour: ['red'] } })
    // @ts-expect-error 'visited' is not a forced state.
    const visited = () => new Combinations({ component: Button, props: { size: ['sm'] }, states: ['visited'] })
    // `h()` can't infer the component's props, so it takes any values. Templates and TSX check them through the
    // construct signature, as above.
    const rendered = () => h(Combinations, { component: Button, props: { size: ['sm'] } })

    expect([inferred, functional, huge, colour, visited, rendered]).toHaveLength(6)
  })
})
