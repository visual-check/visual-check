// Angular's JIT compiler, before any other Angular module: Angular's packages, the test components and the story's
// template compile at run time, as in Storybook.
import '@angular/compiler'
import { NgComponentOutlet } from '@angular/common'
import {
  Component,
  computed,
  EventEmitter,
  InjectionToken,
  Input,
  inject,
  input,
  model,
  output,
  VERSION,
} from '@angular/core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { type GridStyle, gridLayoutOf, type PropValues } from '../grid-story/grid-layout.js'
import { markupOf, withSignalInputs } from './angular-app.fixture.js'
import { type CombinationsInput, combinations } from './combinations.js'

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
 * A button that writes every signal input it gets.
 */
const Button = Component({
  selector: 'vc-button',
  standalone: true,
  template: '<button type="button">{{ label() }} {{ variant() }} {{ size() }}</button>',
})(
  withSignalInputs(
    class Button {
      /**
       * The button's text.
       */
      label = input.required<string>()
      /**
       * How the button is drawn.
       */
      variant = input.required<'solid' | 'outline'>()
      /**
       * How big the button is.
       */
      size = input.required<'sm' | 'lg'>()
    },
    { label: true, variant: true, size: true },
  ),
)

/**
 * The theme a provider above the grid gives.
 */
const Theme = new InjectionToken<string>('theme')

/**
 * Writes the theme it injects, so a test sees whether a provider reaches the cells.
 */
const Themed = Component({
  selector: 'vc-themed',
  standalone: true,
  template: '<span>{{ theme }} {{ n() }}</span>',
})(
  withSignalInputs(
    class Themed {
      /**
       * The theme provided above the cell, or `none`.
       */
      theme = inject(Theme, { optional: true }) ?? 'none'
      /**
       * The cell's number.
       */
      n = input.required<number>()
    },
    { n: true },
  ),
)

/**
 * A parent component that provides the theme to what it holds.
 */
const ThemeProvider = Component({
  selector: 'vc-theme',
  standalone: true,
  template: '<ng-content />',
  providers: [{ provide: Theme, useValue: 'provided' }],
})(class ThemeProvider {})

/**
 * A component with a decorator input, as written before signal inputs.
 */
class LegacyInputs {
  /**
   * The text it writes.
   */
  label = ''
}

Input()(LegacyInputs.prototype, 'label')

/**
 * Writes its decorator input.
 */
const Legacy = Component({ selector: 'vc-legacy', standalone: true, template: '<i>{{ label }}</i>' })(LegacyInputs)

/**
 * Every `style` attribute's text in the markup, in document order.
 */
function stylesOf(markup: string): string[] {
  return [...markup.matchAll(/style="([^"]*)"/g)].map(([, style]) => style ?? '')
}

/**
 * The text React writes for a layout's style: `name:value`, joined by `;`, in order.
 */
function styleTextOf(style: GridStyle): string {
  return Object.entries(style)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
}

/**
 * The text of every element with the tag in the markup, in document order.
 */
function textsOf(markup: string, tag: string): (string | undefined)[] {
  return [...markup.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'g'))].map(([, text]) => text)
}

describe('combinations', () => {
  it('runs on Angular 18, the oldest Angular the port supports', () => {
    expect(VERSION.major).toBe('18')
  })

  it('returns the template, props and module metadata as plain values', () => {
    const story = combinations({
      component: Button,
      props: { size: ['sm', 'lg'] },
      args: { label: 'Go', variant: 'solid' },
      states: ['hover'],
    })

    expect(story.template.replaceAll('><', '>\n<')).toMatchInlineSnapshot(`
      "<div data-visual-check-grid="" style="display:grid;grid-template-columns:max-content max-content;column-gap:16px;row-gap:0;width:max-content;margin:0;padding:0;border:none;background:none">
      <div style="all:initial;display:block;margin:0 0 16px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">{{ visualCheckGrid.texts[0] }}</div>
      <div style="all:initial;display:block;margin:0 0 16px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">{{ visualCheckGrid.texts[1] }}</div>
      <div style="all:initial;display:block;grid-column:1 / -1;margin:0 0 4px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">{{ visualCheckGrid.texts[2] }}</div>
      <div style="justify-self:start;align-self:start">
      <ng-container *ngComponentOutlet="visualCheckGrid.component; inputs: visualCheckGrid.rows[0]" />
      </div>
      <div class="visual-check-hover" style="justify-self:start;align-self:start">
      <ng-container *ngComponentOutlet="visualCheckGrid.component; inputs: visualCheckGrid.rows[0]" />
      </div>
      <div style="all:initial;display:block;grid-column:1 / -1;margin:16px 0 4px;contain:inline-size;font-family:monospace;font-size:11px;line-height:14px;color:#737373;overflow-wrap:anywhere">{{ visualCheckGrid.texts[3] }}</div>
      <div style="justify-self:start;align-self:start">
      <ng-container *ngComponentOutlet="visualCheckGrid.component; inputs: visualCheckGrid.rows[1]" />
      </div>
      <div class="visual-check-hover" style="justify-self:start;align-self:start">
      <ng-container *ngComponentOutlet="visualCheckGrid.component; inputs: visualCheckGrid.rows[1]" />
      </div>
      </div>"
    `)
    expect(story.props).toStrictEqual({
      visualCheckGrid: {
        component: Button,
        rows: [
          { label: 'Go', variant: 'solid', size: 'sm' },
          { label: 'Go', variant: 'solid', size: 'lg' },
        ],
        texts: ['default', ':hover', 'size: sm', 'size: lg'],
      },
    })
    expect(story.moduleMetadata).toStrictEqual({ imports: [NgComponentOutlet] })
  })

  it('draws the grid, a caption above each row and a cell for each combination', async () => {
    const markup = await markupOf(
      combinations({
        component: Button,
        props: { variant: ['solid', 'outline'], size: ['sm', 'lg'] },
        args: { label: 'Go' },
      }),
    )

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
    const markup = await markupOf(
      combinations({
        component: Button,
        props: { size: ['sm', 'lg'] },
        args: { label: 'Go', variant: 'solid' },
        states: ['hover', 'focus-visible'],
      }),
    )

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

    expect(stylesOf(await markupOf(combinations({ component: Button, ...input })))).toStrictEqual(expected)
  })

  it("sets each cell's signal inputs from its row's props", async () => {
    const markup = await markupOf(
      combinations({ component: Button, props: { size: ['sm', 'lg'] }, args: { label: 'Go', variant: 'outline' } }),
    )

    expect(textsOf(markup, 'button')).toStrictEqual(['Go outline sm', 'Go outline lg'])
  })

  it("sets each cell's decorator inputs from its row's props", async () => {
    const markup = await markupOf(combinations({ component: Legacy, props: { label: ['a', 'b'] } }))

    expect(textsOf(markup, 'i')).toStrictEqual(['a', 'b'])
  })

  it('reaches every cell with what a parent component provides', async () => {
    const markup = await markupOf(combinations({ component: Themed, props: { n: [1, 2, 3] } }), {
      wrap: (template) => `<vc-theme>${template}</vc-theme>`,
      imports: [ThemeProvider],
    })

    expect(textsOf(markup, 'span')).toStrictEqual(['provided 1', 'provided 2', 'provided 3'])
  })

  it("reaches every cell with what the story's module metadata provides", async () => {
    const markup = await markupOf(combinations({ component: Themed, props: { n: [1, 2] } }), {
      providers: [{ provide: Theme, useValue: 'story' }],
    })

    expect(textsOf(markup, 'span')).toStrictEqual(['story 1', 'story 2'])
  })

  it('reaches every cell with what the app provides', async () => {
    const markup = await markupOf(combinations({ component: Themed, props: { n: [1, 2] } }), {
      appProviders: [{ provide: Theme, useValue: 'app' }],
    })

    expect(textsOf(markup, 'span')).toStrictEqual(['app 1', 'app 2'])
  })

  it('writes caption and header text literally, never as a template', async () => {
    const markup = await markupOf(
      combinations({
        component: Button,
        props: { size: ['sm', 'lg'] },
        args: { label: 'Go', variant: 'solid' },
        caption: (props) => `{{ x }} <b>&</b> {y} ${props.size}`,
      }),
    )

    expect(markup).toContain('>{{ x }} &lt;b&gt;&amp;&lt;/b&gt; {y} sm</div>')
    expect(markup).toContain('>{{ x }} &lt;b&gt;&amp;&lt;/b&gt; {y} lg</div>')
  })

  it('writes the text a custom caption gives', async () => {
    const markup = await markupOf(
      combinations({
        component: Button,
        props: { size: ['sm', 'lg'] },
        args: { label: 'Go', variant: 'solid' },
        caption: (props) => `size ${props.size}`,
      }),
    )

    expect(markup).toContain('>size sm</div>')
    expect(markup).toContain('>size lg</div>')
  })

  it('draws no caption when no prop varies', async () => {
    const markup = await markupOf(
      combinations({ component: Button, props: { size: ['sm'] }, args: { label: 'Go', variant: 'solid' } }),
    )

    // The grid and the one row's cell, with no caption between them.
    expect(markup.match(/<div/g)).toHaveLength(2)
  })

  it('gives the same template and module metadata for grids of the same shape', () => {
    const first = combinations({ component: Button, props: { size: ['sm', 'lg'] }, args: { label: 'Go' } })
    const second = combinations({ component: Button, props: { variant: ['solid', 'outline'] }, args: { size: 'lg' } })

    expect(second.template).toBe(first.template)
    expect(second.moduleMetadata).toStrictEqual(first.moduleMetadata)
    expect(second.props).not.toStrictEqual(first.props)
  })

  it("throws the layout's error synchronously", () => {
    expect(() => combinations({ component: Button, props: { size: [] } })).toThrow(/^visual-check: /)
  })

  it('throws for a prop or an arg the component has no input for', () => {
    // Unsafe on purpose: an untyped caller, or a story's args, can name a field that isn't an input.
    const props = { colour: ['red'] } as PropValues<ButtonProps>
    const args = { theme: 'dark' }

    expect(() => combinations({ component: Button, props })).toThrow('visual-check: Button has no input "colour".')
    expect(() => combinations({ component: Themed, props: { n: [1] }, args })).toThrow(
      'visual-check: Themed has no input "theme".',
    )
  })

  it('throws for a class that is not an Angular component', () => {
    /**
     * A plain class, with no component decorator.
     */
    class Plain {
      /**
       * A field, not an input.
       */
      label = ''
    }

    expect(() => combinations({ component: Plain, props: { label: ['a'] } })).toThrow(
      'visual-check: Plain is not an Angular component.',
    )
  })

  it("types the props from the component's inputs", () => {
    expectTypeOf<CombinationsInput<InstanceType<typeof Button>>['props']>().toEqualTypeOf<PropValues<ButtonProps>>()

    const inferred = () =>
      combinations({
        component: Button,
        props: { size: ['sm'] },
        args: { label: 'Go', variant: 'solid' },
        caption: (props) => {
          expectTypeOf(props).toEqualTypeOf<Partial<ButtonProps>>()

          return ''
        },
      })
    // @ts-expect-error 'huge' is not a size of the button.
    const huge = () => combinations({ component: Button, props: { size: ['huge'] } })
    // @ts-expect-error The button has no colour.
    const colour = () => combinations({ component: Button, props: { colour: ['red'] } })
    // @ts-expect-error 'visited' is not a forced state.
    const visited = () => combinations({ component: Button, props: { size: ['sm'] }, states: ['visited'] })
    // @ts-expect-error The label is a string.
    const label = () => combinations({ component: Button, props: {}, args: { label: 1 } })

    expect([inferred, huge, colour, visited, label]).toHaveLength(5)
  })

  it('types outputs, computed signals and methods as no props', () => {
    /**
     * A component with every kind of member that isn't an input.
     */
    class Members {
      /**
       * An output.
       */
      clicked = output<string>()
      /**
       * An output written with a decorator.
       */
      changed = new EventEmitter<string>()
      /**
       * A computed signal.
       */
      double = computed(() => 2)
      /**
       * A method.
       */
      reset(): void {}
    }

    expectTypeOf<keyof CombinationsInput<Members>['props']>().toEqualTypeOf<never>()
  })

  it('types each kind of input by the value it takes', () => {
    /**
     * A component with every kind of input.
     */
    class Inputs {
      /**
       * An optional signal input.
       */
      optional = input<string>()
      /**
       * A two-way input.
       */
      count = model<number>(0)
      /**
       * A signal input that takes a string and holds a number.
       */
      width = input(0, { transform: (value: string) => Number(value) })
      /**
       * A decorator input.
       */
      label = ''
    }

    expectTypeOf<CombinationsInput<Inputs>['props']>().toEqualTypeOf<
      PropValues<{ optional: string | undefined; count: number; width: string; label: string }>
    >()
  })
})
