import { describe, expect, it } from 'vitest'
import { type GridInput, gridAttribute, gridLayoutOf } from './grid-layout.js'

/**
 * The captions of a layout's rows, in row order: each caption's text, or `null` for a row with none.
 */
function captionsOf(rows: { caption: { text: string } | null }[]): (string | null)[] {
  return rows.map((row) => row.caption?.text ?? null)
}

describe('gridLayoutOf', () => {
  describe('rows', () => {
    it('lists every combination in declaration order, the last prop changing fastest', () => {
      const layout = gridLayoutOf({ props: { a: [1, 2], b: ['x', 'y'] } })

      expect(layout.rows.map((row) => row.props)).toStrictEqual([
        { a: 1, b: 'x' },
        { a: 1, b: 'y' },
        { a: 2, b: 'x' },
        { a: 2, b: 'y' },
      ])
    })

    it('lists 12 rows for three props of 2, 3 and 2 values', () => {
      const layout = gridLayoutOf({ props: { a: [1, 2], b: ['x', 'y', 'z'], c: [true, false] } })

      expect(captionsOf(layout.rows)).toStrictEqual([
        'a: 1, b: x, c: true',
        'a: 1, b: x, c: false',
        'a: 1, b: y, c: true',
        'a: 1, b: y, c: false',
        'a: 1, b: z, c: true',
        'a: 1, b: z, c: false',
        'a: 2, b: x, c: true',
        'a: 2, b: x, c: false',
        'a: 2, b: y, c: true',
        'a: 2, b: y, c: false',
        'a: 2, b: z, c: true',
        'a: 2, b: z, c: false',
      ])
    })

    it('gives every row the args, a listed prop winning over the same key, and never captions the args', () => {
      const layout = gridLayoutOf<{ label: string; size: string; tone: string }>({
        props: { size: ['sm', 'lg'] },
        args: { label: 'Save', size: 'md', tone: 'calm' },
      })

      expect(layout.rows.map((row) => row.props)).toStrictEqual([
        { label: 'Save', size: 'sm', tone: 'calm' },
        { label: 'Save', size: 'lg', tone: 'calm' },
      ])
      expect(layout.rows.map((row) => Object.keys(row.props))).toStrictEqual([
        ['label', 'size', 'tone'],
        ['label', 'size', 'tone'],
      ])
      expect(captionsOf(layout.rows)).toStrictEqual(['size: sm', 'size: lg'])
    })

    it('applies a single-value prop to every row and leaves it out of the captions', () => {
      const layout = gridLayoutOf({ props: { tone: ['calm'], size: ['sm', 'lg'] } })

      expect(layout.rows.map((row) => row.props)).toStrictEqual([
        { tone: 'calm', size: 'sm' },
        { tone: 'calm', size: 'lg' },
      ])
      expect(captionsOf(layout.rows)).toStrictEqual(['size: sm', 'size: lg'])
    })

    it('draws one row without a caption when every prop has a single value', () => {
      const layout = gridLayoutOf({ props: { tone: ['calm'], size: ['sm'] } })

      expect(layout.rows).toHaveLength(1)
      expect(layout.rows[0]?.props).toStrictEqual({ tone: 'calm', size: 'sm' })
      expect(layout.rows[0]?.caption).toBeNull()
    })

    it('draws one row of the args without a caption when no prop is listed', () => {
      const layout = gridLayoutOf<{ label: string }>({ props: {}, args: { label: 'Save' } })

      expect(layout.rows).toHaveLength(1)
      expect(layout.rows[0]?.props).toStrictEqual({ label: 'Save' })
      expect(layout.rows[0]?.caption).toBeNull()
    })

    it('treats a prop whose list is undefined as not listed', () => {
      const input = { props: { size: ['sm', 'lg'], tone: undefined }, args: { tone: 'calm' } }
      const layout = gridLayoutOf(input as unknown as GridInput<{ size: string; tone: string }>)

      expect(layout.rows.map((row) => row.props)).toStrictEqual([
        { tone: 'calm', size: 'sm' },
        { tone: 'calm', size: 'lg' },
      ])
      expect(captionsOf(layout.rows)).toStrictEqual(['size: sm', 'size: lg'])
    })

    it('lets a prop listed as undefined win over the same key in args', () => {
      const layout = gridLayoutOf<{ label: string | undefined }>({
        props: { label: [undefined] },
        args: { label: 'Save' },
      })

      expect(layout.rows.map((row) => row.props)).toStrictEqual([{ label: undefined }])
    })

    it('throws when a prop lists no values', () => {
      expect(() => gridLayoutOf({ props: { variant: ['solid'], size: [] } })).toThrow(
        new Error('visual-check: the grid lists no values for the prop "size".'),
      )
    })
  })

  describe('captions', () => {
    it('names each varying prop as key: value, in declaration order', () => {
      const layout = gridLayoutOf({
        props: { variant: ['solid', 'outline'], size: ['sm', 'lg'], disabled: [false, true] },
      })

      expect(layout.rows[7]?.caption?.text).toBe('variant: outline, size: lg, disabled: true')
    })

    it('prints strings as they are and numbers, booleans, null and undefined through String()', () => {
      const values = ['say "hi"', 0, -1.5, Number.NaN, Number.POSITIVE_INFINITY, true, false, null, undefined]
      const layout = gridLayoutOf<{ value: unknown }>({ props: { value: values } })

      expect(captionsOf(layout.rows)).toStrictEqual([
        'value: say "hi"',
        'value: 0',
        'value: -1.5',
        'value: NaN',
        'value: Infinity',
        'value: true',
        'value: false',
        'value: null',
        'value: undefined',
      ])
    })

    it('prints any other value as an ellipsis', () => {
      const values = [{}, [1], () => 1, Symbol('s'), 10n, new Date(0)]
      const layout = gridLayoutOf<{ value: unknown }>({ props: { value: values } })

      expect(captionsOf(layout.rows)).toStrictEqual(Array.from(values, () => 'value: …'))
    })

    it('takes the text from caption, called once per row with only the varying props in declaration order', () => {
      const calls: object[] = []
      const layout = gridLayoutOf<{ label: string; tone: string; size: string; disabled: boolean }>({
        props: { size: ['sm', 'lg'], tone: ['calm'], disabled: [false, true] },
        args: { label: 'Save' },
        caption: (props) => {
          calls.push(props)

          return `${props.size}/${props.disabled}`
        },
      })

      expect(calls).toStrictEqual([
        { size: 'sm', disabled: false },
        { size: 'sm', disabled: true },
        { size: 'lg', disabled: false },
        { size: 'lg', disabled: true },
      ])
      expect(calls.map((props) => Object.keys(props))).toStrictEqual(Array.from(calls, () => ['size', 'disabled']))
      expect(captionsOf(layout.rows)).toStrictEqual(['sm/false', 'sm/true', 'lg/false', 'lg/true'])
    })

    it('never calls caption when no prop varies', () => {
      const calls: object[] = []
      const layout = gridLayoutOf({
        props: { size: ['sm'] },
        caption: (props) => {
          calls.push(props)

          return 'never'
        },
      })

      expect(calls).toStrictEqual([])
      expect(layout.rows[0]?.caption).toBeNull()
    })
  })

  describe('styles', () => {
    it("gives the grid max-content columns, gaps and a reset of what isn't inherited", () => {
      const layout = gridLayoutOf({ props: { size: ['sm', 'lg'] } })

      expect(layout.style).toStrictEqual({
        display: 'grid',
        'grid-template-columns': 'max-content',
        'column-gap': '16px',
        'row-gap': '0',
        width: 'max-content',
        margin: '0',
        padding: '0',
        border: 'none',
        background: 'none',
      })
      expect(Object.keys(layout.style)).toStrictEqual([
        'display',
        'grid-template-columns',
        'column-gap',
        'row-gap',
        'width',
        'margin',
        'padding',
        'border',
        'background',
      ])
    })

    it('gives the grid fixed columns with cellWidth', () => {
      const layout = gridLayoutOf({ props: { size: ['sm', 'lg'] }, cellWidth: 200 })

      expect(layout.style).toStrictEqual({
        display: 'grid',
        'grid-template-columns': '200px',
        'column-gap': '16px',
        'row-gap': '0',
        width: 'max-content',
        margin: '0',
        padding: '0',
        border: 'none',
        background: 'none',
      })
      expect(Object.keys(layout.style)).toStrictEqual([
        'display',
        'grid-template-columns',
        'column-gap',
        'row-gap',
        'width',
        'margin',
        'padding',
        'border',
        'background',
      ])
    })

    it('resets each caption, spacing the first row by 4px and every later row by 16px more', () => {
      const layout = gridLayoutOf({ props: { size: ['sm', 'md', 'lg'] } })
      const captionStyle = (margin: string) => ({
        all: 'initial',
        display: 'block',
        'grid-column': '1 / -1',
        margin,
        contain: 'inline-size',
        'font-family': 'monospace',
        'font-size': '11px',
        'line-height': '14px',
        color: '#737373',
        'overflow-wrap': 'anywhere',
      })

      expect(layout.rows.map((row) => row.caption?.style)).toStrictEqual([
        captionStyle('0 0 4px'),
        captionStyle('16px 0 4px'),
        captionStyle('16px 0 4px'),
      ])
      expect(Object.keys(layout.rows[0]?.caption?.style ?? {})).toStrictEqual(Object.keys(captionStyle('0')))
      expect(Object.keys(layout.rows[0]?.caption?.style ?? {})[0]).toBe('all')
    })

    it('gives each row one cell aligned to the start', () => {
      const layout = gridLayoutOf({ props: { size: ['sm', 'lg'] } })

      expect(layout.rows.map((row) => row.cells)).toStrictEqual([
        [{ style: { 'justify-self': 'start', 'align-self': 'start' } }],
        [{ style: { 'justify-self': 'start', 'align-self': 'start' } }],
      ])
    })

    it('makes each cell exactly cellWidth wide', () => {
      const layout = gridLayoutOf({ props: { size: ['sm'] }, cellWidth: 200 })

      expect(layout.rows.map((row) => row.cells)).toStrictEqual([
        [{ style: { 'justify-self': 'start', 'align-self': 'start', width: '200px' } }],
      ])
    })
  })
})

describe('gridAttribute', () => {
  it('is the attribute capture finds a grid by', () => {
    expect(gridAttribute).toBe('data-visual-check-grid')
  })
})
