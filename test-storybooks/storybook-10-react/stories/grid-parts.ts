// What every port's grid stories share, with no framework: the chips' looks, their CSS, and the `play` checks. The
// React grid stories and the plain-DOM ones in other test Storybooks read it, so "the same grid" is literally the same.
import { expect, waitFor } from 'storybook/test'

/**
 * What a chip shows and how.
 *
 * @public
 */
export interface ChipProps {
  /**
   * The chip's text.
   */
  label: string
  /**
   * Its colours: grey, or the accent with white text.
   */
  tone: 'neutral' | 'accent'
  /**
   * Its padding and font size: small or large.
   */
  size: 'sm' | 'lg'
  /**
   * The tooltip, which the snapshot doesn't show.
   */
  title?: string | undefined
}

/**
 * The accent every grid story's chips are drawn with: green.
 *
 * @public
 */
export const accentColor = '#16a34a'

/**
 * Each size's padding and font size.
 */
const sizeStyles = {
  sm: { padding: '2px 8px', fontSize: '12px' },
  lg: { padding: '6px 14px', fontSize: '16px' },
} satisfies Record<ChipProps['size'], Record<string, string>>

/**
 * Each tone's text colour.
 */
const toneColors = { neutral: '#18181b', accent: '#ffffff' } satisfies Record<ChipProps['tone'], string>

/**
 * A neutral chip's background.
 */
const neutralBackground = '#e4e4e7'

/**
 * A rounded chip's inline style, in camelCase with every value a string.
 */
interface ChipStyle {
  /**
   * The size's padding.
   */
  padding: string
  /**
   * The size's font size, in pixels.
   */
  fontSize: string
  /**
   * Always `inline-block`.
   */
  display: string
  /**
   * Rounded to a pill.
   */
  borderRadius: string
  /**
   * The accent, or grey.
   */
  background: string
  /**
   * The tone's text colour.
   */
  color: string
  /**
   * Always `sans-serif`.
   */
  fontFamily: string
  /**
   * Always 20 px.
   */
  lineHeight: string
}

/**
 * A rounded chip's inline style, in camelCase with every value a string, so a plain-DOM story can assign it to an
 * element's `style` and React gives the same computed style.
 *
 * @public
 */
export function chipStyleOf({ tone, size }: Pick<ChipProps, 'tone' | 'size'>, accent: string): ChipStyle {
  return {
    ...sizeStyles[size],
    display: 'inline-block',
    borderRadius: '999px',
    background: tone === 'accent' ? accent : neutralBackground,
    color: toneColors[tone],
    fontFamily: 'sans-serif',
    lineHeight: '20px',
  }
}

/**
 * A title long enough that its row's caption wraps at the column's width, rather than widening the column.
 *
 * @public
 */
export const longTitle = 'A title only the tooltip shows, long enough that its caption wraps at the row width'

/**
 * The styles of `ForcedStates`. The theme's hover colour comes from an ancestor outside the grid, and the quiet tone's
 * background, declared after the hover rule at the same specificity, wins over it.
 *
 * @public
 */
export const stateChipStyles = `
.state-chip { display: inline-block; padding: 6px 14px; border: 1px solid #a1a1aa; border-radius: 999px; background: #ffffff; color: #18181b; font: 16px/20px sans-serif }
.state-chip:hover { background: #bfdbfe }
.forced-states-theme .state-chip:hover { color: #1d4ed8 }
.state-chip:focus-visible { outline: 3px solid #7c3aed; outline-offset: 2px }
.state-chip.state-chip--quiet { background: #e4e4e7 }
`

/**
 * What a state chip shows and how.
 *
 * @public
 */
export interface StateChipProps {
  /**
   * The chip's text.
   */
  label: string
  /**
   * Its background: white, or grey whatever its state.
   */
  tone: 'default' | 'quiet'
}

/**
 * The class of a state chip of the tone, which `stateChipStyles` styles.
 *
 * @public
 */
export function stateChipClassOf(tone: StateChipProps['tone']): string {
  return tone === 'quiet' ? 'state-chip state-chip--quiet' : 'state-chip'
}

/**
 * What a late chip shows.
 *
 * @public
 */
export interface LateChipProps {
  /**
   * How its hover rule arrives: inserted with `insertRule`, or appended as text to a `<style>`.
   */
  variant: 'inserted' | 'appended'
}

/**
 * The class of a late chip of the variant, which its hover rule selects.
 *
 * @public
 */
export function lateChipClassOf(variant: LateChipProps['variant']): string {
  return `late-chip--${variant}`
}

/**
 * A late chip's inline style. Its background comes from `lateBaseRule`.
 *
 * @public
 */
export const lateChipStyle = {
  display: 'inline-block',
  padding: '6px 14px',
  borderRadius: '999px',
  font: '16px/20px sans-serif',
} as const

/**
 * The text of a late chip of each variant.
 *
 * @public
 */
export const lateChipLabels: Readonly<Record<LateChipProps['variant'], string>> = {
  inserted: 'Inserted',
  appended: 'Appended',
}

/**
 * The rule that makes every late chip grey before its hover rule arrives.
 *
 * @public
 */
export const lateBaseRule = '[class^="late-chip--"] { background: #e4e4e7 }'

/**
 * The chips' colours, as computed styles give them.
 *
 * @public
 */
export const colors = {
  white: 'rgb(255, 255, 255)',
  grey: 'rgb(228, 228, 231)',
  ink: 'rgb(24, 24, 27)',
  blue: 'rgb(191, 219, 254)',
  blueInk: 'rgb(29, 78, 216)',
  purple: 'rgb(124, 58, 237)',
  green: 'rgb(187, 247, 208)',
  yellow: 'rgb(253, 230, 138)',
  accent: 'rgb(22, 163, 74)',
} as const

/**
 * The values of the computed properties of each element, in document order: one row per element.
 *
 * @public
 */
export function stylesOf(elements: Element[], properties: string[]): string[][] {
  return elements.map((element) => {
    const style = getComputedStyle(element)

    return properties.map((property) => style.getPropertyValue(property))
  })
}

/**
 * The story's `<style>` the selector matches.
 *
 * @public
 * @throws When the story renders none.
 */
export function styleElementOf(canvasElement: HTMLElement, selector: string): HTMLStyleElement {
  const element = canvasElement.querySelector<HTMLStyleElement>(selector)

  if (element === null) {
    throw new Error(`No <style> matches ${selector}`)
  }

  return element
}

/**
 * The sheet of a `<style>` in the document.
 *
 * @public
 * @throws When it has none.
 */
export function sheetOf(element: HTMLStyleElement): CSSStyleSheet {
  if (element.sheet === null) {
    throw new Error('The <style> has no sheet')
  }

  return element.sheet
}

/**
 * What the shared `play` checks read of a story's context, which every renderer's context has.
 *
 * @public
 */
export interface GridPlayContext {
  /**
   * The queries bound to the story's canvas.
   */
  canvas: {
    /**
     * Every element whose text is the given one.
     */
    getAllByText(text: string): HTMLElement[]
    /**
     * The one element whose text is the given one.
     */
    getByText(text: string): HTMLElement
  }
  /**
   * The element the story renders into.
   */
  canvasElement: HTMLElement
}

/**
 * The `play` of `ForcedStates`: checks the headers and each cell's computed style.
 *
 * @public
 */
export async function forcedStatesPlay({ canvas }: GridPlayContext): Promise<void> {
  const cells = stylesOf(canvas.getAllByText('Save'), ['background-color', 'color', 'outline-style', 'outline-color'])

  for (const header of ['default', ':hover', ':focus-visible']) {
    await expect(canvas.getByText(header)).toBeVisible()
  }

  // Rows of the default tone, then the quiet one; columns default, hover, focus-visible. An outline that is `none`
  // takes the text's colour.
  await expect(cells).toEqual([
    [colors.white, colors.ink, 'none', colors.ink],
    [colors.blue, colors.blueInk, 'none', colors.blueInk],
    [colors.white, colors.ink, 'solid', colors.purple],
    [colors.grey, colors.ink, 'none', colors.ink],
    [colors.grey, colors.blueInk, 'none', colors.blueInk],
    [colors.grey, colors.ink, 'solid', colors.purple],
  ])
}

/**
 * The `play` of `LateStyles`: adds each chip's hover rule once the grid is there, one with `insertRule` and one as a
 * text node appended to a `<style>`, then waits for the hover cells' colours.
 *
 * @public
 */
export async function lateStylesPlay({ canvas, canvasElement }: GridPlayContext): Promise<void> {
  const insertSheet = sheetOf(styleElementOf(canvasElement, 'style[data-late-insert]'))
  const appendElement = styleElementOf(canvasElement, 'style[data-late-append]')

  insertSheet.insertRule(`.${lateChipClassOf('inserted')}:hover { background: #bbf7d0 }`, insertSheet.cssRules.length)
  appendElement.append(document.createTextNode(`.${lateChipClassOf('appended')}:hover { background: #fde68a }`))

  await waitFor(() =>
    expect(
      stylesOf([...canvas.getAllByText('Inserted'), ...canvas.getAllByText('Appended')], ['background-color']),
    ).toEqual([[colors.grey], [colors.green], [colors.grey], [colors.yellow]]),
  )
}
