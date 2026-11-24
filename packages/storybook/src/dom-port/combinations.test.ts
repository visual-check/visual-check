import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { type GridLayout, gridLayoutOf, type PropValues } from '../grid-story/grid-layout.js'
import { type CombinationsInput, combinations, gridElementOf } from './combinations.js'
import { fakeGridPage } from './grid-page.fixture.js'

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

const fake = fakeGridPage()

/**
 * A button that writes every prop it gets.
 */
function button({ label, variant, size }: ButtonProps): Node {
  return fake.element('button', `${label} ${variant} ${size}`, { type: 'button' })
}

/**
 * The grid the plain-DOM port draws in the fake page for the input, and its layout.
 */
function drawn<Props extends object>({
  render,
  ...input
}: CombinationsInput<Props>): { grid: HTMLElement; layout: GridLayout<Props> } {
  const layout = gridLayoutOf<Props>(input)

  return { grid: gridElementOf(fake.page, layout, render), layout }
}

/**
 * The grid's markup for the input, one tag per line.
 */
function markupOf<Props extends object>(input: CombinationsInput<Props>): string {
  return fake.markupOf(drawn(input).grid)
}

describe('combinations', () => {
  it('draws the grid, a caption above each row and a cell for each combination', () => {
    const markup = markupOf({
      render: button,
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

  it('draws a header row naming each column, and each state cell with its class', () => {
    const markup = markupOf({
      render: button,
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
  ] as const)('writes every style of the layout unchanged, in order, %s', (_, states) => {
    const { grid, layout } = drawn<ButtonProps>({
      render: button,
      props: { variant: ['solid', 'outline'] },
      args: { label: 'Go', size: 'sm' },
      states,
      cellWidth: 200,
    })
    const expected = [
      Object.entries(layout.style),
      ...layout.headers.map((header) => Object.entries(header.style)),
      ...layout.rows.flatMap((row) => [
        ...(row.caption ? [Object.entries(row.caption.style)] : []),
        ...row.cells.map((cell) => Object.entries(cell.style)),
      ]),
    ]

    expect([grid, ...grid.childNodes].map((node) => fake.styleCallsOf(node))).toStrictEqual(expected)
  })

  it("calls render once per cell, in document order, with its row's props", () => {
    const render = vi.fn(button)
    const { layout } = drawn<ButtonProps>({
      render,
      props: { size: ['sm', 'lg'] },
      args: { label: 'Go', variant: 'solid' },
      states: ['hover'],
    })

    expect(render.mock.calls).toStrictEqual(layout.rows.flatMap((row) => row.cells.map(() => [row.props])))
    expect(render).toHaveBeenCalledTimes(4)
  })

  it('puts the HTML render returns in the cell', () => {
    const markup = markupOf({ render: () => '<b>Go</b>', props: { size: ['sm', 'lg'] } })

    expect(markup.match(/<div style="justify-self:start;align-self:start">\n<b>Go<\/b>\n<\/div>/g)).toHaveLength(2)
  })

  it('appends the node render returns', () => {
    const nodes: Node[] = []
    const { grid } = drawn({
      render: (props: { size: string }) => {
        const node = fake.element('span', props.size)

        nodes.push(node)

        return node
      },
      props: { size: ['sm', 'lg'] },
    })

    expect(nodes.map((node) => node.parentNode)).toStrictEqual([grid.childNodes[1], grid.childNodes[3]])
  })

  it('throws when render returns the same node for two cells', () => {
    const node = fake.element('span', 'Go')

    expect(() => drawn({ render: () => node, props: { size: ['sm', 'lg'] } })).toThrow(
      "visual-check: the grid's render returned the same node for two cells. Return a new node each time it's called.",
    )
  })

  it('throws when render returns neither a node nor HTML', () => {
    expect(() => drawn({ render: () => ({}) as unknown as Node, props: { size: ['sm'] } })).toThrow(
      "visual-check: the grid's render returned neither a node nor HTML. Return a new node, or a string of HTML.",
    )
  })

  it('writes the text a custom caption gives', () => {
    const markup = markupOf({
      render: button,
      props: { size: ['sm', 'lg'] },
      args: { label: 'Go', variant: 'solid' },
      caption: (props) => `size ${props.size}`,
    })

    expect(markup).toContain('>size sm</div>')
    expect(markup).toContain('>size lg</div>')
  })

  it('draws no caption when no prop varies', () => {
    const markup = markupOf({ render: button, props: { size: ['sm'] }, args: { label: 'Go', variant: 'solid' } })

    // The grid and the one row's cell, with no caption between them.
    expect(markup.match(/<div/g)).toHaveLength(2)
  })

  it("throws the layout's error before calling render", () => {
    const render = vi.fn(button)

    expect(() => combinations({ render, props: { size: [] } })).toThrow('visual-check:')
    expect(render).not.toHaveBeenCalled()
  })

  it('throws without a DOM', () => {
    expect(() =>
      combinations({ render: button, props: { size: ['sm'] }, args: { label: 'Go', variant: 'solid' } }),
    ).toThrow("visual-check: combinations() needs a DOM. Call it in a story's render.")
  })

  it("types the props' values from render's parameter", () => {
    expectTypeOf<CombinationsInput<ButtonProps>['props']>().toEqualTypeOf<PropValues<ButtonProps>>()

    const inferred = () =>
      combinations({
        render: button,
        props: { size: ['sm'] },
        caption: (props) => {
          expectTypeOf(props).toEqualTypeOf<Partial<ButtonProps>>()

          return ''
        },
      })
    // @ts-expect-error 'huge' is not a size of the button.
    const huge = () => combinations({ render: button, props: { size: ['huge'] } })
    // @ts-expect-error The button has no colour.
    const colour = () => combinations({ render: button, props: { colour: ['red'] } })
    // @ts-expect-error 'visited' is not a forced state.
    const visited = () => combinations({ render: button, props: { size: ['sm'] }, states: ['visited'] })

    expect([inferred, huge, colour, visited]).toHaveLength(4)
  })
})
