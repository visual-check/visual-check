import { createContext, type ReactElement, useContext, version } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, expectTypeOf, it } from 'vitest'
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
function Button({ label, variant, size }: ButtonProps): ReactElement {
  return (
    <button type="button">
      {label} {variant} {size}
    </button>
  )
}

/**
 * The theme a provider above the grid gives.
 */
const Theme = createContext('none')

/**
 * Writes the theme it reads from context, so a test sees whether context reaches the cells.
 */
function Themed({ n }: { n: number }): ReactElement {
  return (
    <span>
      {useContext(Theme)} {n}
    </span>
  )
}

/**
 * The element's static markup, one tag per line.
 */
function markupOf(element: ReactElement): string {
  return renderToStaticMarkup(element).replaceAll('><', '>\n<')
}

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

describe('Combinations', () => {
  it('runs on React 18, the oldest React the port supports', () => {
    expect(version).toMatch(/^18\./)
  })

  it('draws the grid, a caption above each row and a cell for each combination', () => {
    const markup = markupOf(
      <Combinations
        component={Button}
        props={{ variant: ['solid', 'outline'], size: ['sm', 'lg'] }}
        args={{ label: 'Go' }}
      />,
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

  it('draws a header row naming each column, and each state cell with its class', () => {
    const markup = markupOf(
      <Combinations
        component={Button}
        props={{ size: ['sm', 'lg'] }}
        args={{ label: 'Go', variant: 'solid' }}
        states={['hover', 'focus-visible']}
      />,
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
  ] as const)('writes every style of the layout unchanged, in order, %s', (_, states) => {
    const input = {
      props: { variant: ['solid', 'outline'] as const },
      args: { label: 'Go', size: 'sm' as const },
      states,
    }
    const layout = gridLayoutOf<ButtonProps>({ ...input, cellWidth: 200 })
    const expected = [
      styleTextOf(layout.style),
      ...layout.headers.map((header) => styleTextOf(header.style)),
      ...layout.rows.flatMap((row) => [
        ...(row.caption ? [styleTextOf(row.caption.style)] : []),
        ...row.cells.map((cell) => styleTextOf(cell.style)),
      ]),
    ]

    expect(stylesOf(markupOf(<Combinations component={Button} {...input} cellWidth={200} />))).toStrictEqual(expected)
  })

  it('reaches every cell with the context of the tree around the grid', () => {
    const markup = markupOf(
      <Theme.Provider value="provided">
        <Combinations component={Themed} props={{ n: [1, 2, 3] }} />
      </Theme.Provider>,
    )

    expect([...markup.matchAll(/<span>(.*?)<\/span>/g)].map(([, text]) => text)).toStrictEqual([
      'provided 1',
      'provided 2',
      'provided 3',
    ])
  })

  it('writes the text a custom caption gives', () => {
    const markup = markupOf(
      <Combinations
        component={Button}
        props={{ size: ['sm', 'lg'] }}
        args={{ label: 'Go', variant: 'solid' }}
        caption={(props) => `size ${props.size}`}
      />,
    )

    expect(markup).toContain('>size sm</div>')
    expect(markup).toContain('>size lg</div>')
  })

  it('draws no caption when no prop varies', () => {
    const markup = markupOf(
      <Combinations component={Button} props={{ size: ['sm'] }} args={{ label: 'Go', variant: 'solid' }} />,
    )

    // The grid and the one row's cell, with no caption between them.
    expect(markup.match(/<div/g)).toHaveLength(2)
  })

  it("types the props' values from the component", () => {
    expectTypeOf<CombinationsProps<ButtonProps>['props']>().toEqualTypeOf<PropValues<ButtonProps>>()

    // @ts-expect-error 'huge' is not a size of the button.
    const huge = <Combinations component={Button} props={{ size: ['huge'] }} />
    // @ts-expect-error The button has no colour.
    const colour = <Combinations component={Button} props={{ colour: ['red'] }} />
    // @ts-expect-error 'visited' is not a forced state.
    const visited = <Combinations component={Button} props={{ size: ['sm'] }} states={['visited']} />

    expect([huge, colour, visited]).toHaveLength(3)
  })
})
