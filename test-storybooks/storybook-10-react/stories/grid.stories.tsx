import type { Meta, StoryObj } from '@storybook/react-vite'
import { forceStates } from '@visual-check/storybook'
import { Combinations } from '@visual-check/storybook/react'
import { createContext, createElement, useContext } from 'react'
import { expect, waitFor } from 'storybook/test'
import { visualCheck } from '../.storybook/visual-check.ts'
import {
  accentColor,
  type ChipProps,
  chipStyleOf,
  colors,
  forcedStatesPlay,
  type LateChipProps,
  lateBaseRule,
  lateChipClassOf,
  lateChipLabels,
  lateChipStyle,
  lateStylesPlay,
  longTitle,
  type StateChipProps,
  sheetOf,
  stateChipClassOf,
  stateChipStyles,
  styleElementOf,
  stylesOf,
} from './grid-parts.ts'

/**
 * The colour of an accent chip. The meta's decorator provides `accentColor`, green, so a red chip in a snapshot means
 * context didn't reach the grid's cells.
 */
const Accent = createContext('#dc2626')

/**
 * A rounded chip, whose accent colour comes from context.
 */
function Chip({ label, tone, size, title }: ChipProps) {
  const accent = useContext(Accent)

  return (
    <span title={title} style={chipStyleOf({ tone, size }, accent)}>
      {label}
    </span>
  )
}

/**
 * The meta's decorator provides the green accent around every story, so it reaches the grid's cells only through
 * React's own tree.
 */
const meta = {
  title: 'Grid',
  decorators: [
    (Story) => (
      <Accent.Provider value={accentColor}>
        <Story />
      </Accent.Provider>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Every combination of the chip's tone, size and title: 8 captioned rows, such as `tone: accent, size: lg, title:
 * undefined`, 16 px apart. The captions of the long title wrap at the column's width. Every accent chip is green, from
 * the meta's decorator.
 */
export const EveryCombination: Story = {
  render: () => (
    <Combinations
      component={Chip}
      props={{ tone: ['neutral', 'accent'], size: ['sm', 'lg'], title: [undefined, longTitle] }}
      args={{ label: 'Save changes' }}
    />
  ),
}

/**
 * Its columns are 1400 px wide, wider than the 1280 px viewport, so the story is broken, `grid-too-wide`, whatever the
 * capture area: here the element is the grid itself. Its line says the grid is wider than the viewport. Its committed
 * baseline is the story with `cellWidth={1200}`.
 */
export const TooWide: Story = {
  parameters: { ...visualCheck({ element: '[data-visual-check-grid]' }) },
  render: () => (
    <Combinations
      component={Chip}
      props={{ tone: ['neutral', 'accent'] }}
      args={{ label: 'Save changes', size: 'sm' }}
      cellWidth={1400}
    />
  ),
}

/**
 * A chip styled only by `stateChipStyles`, so its states come from the page's stylesheet.
 */
function StateChip({ label, tone }: StateChipProps) {
  return <span className={stateChipClassOf(tone)}>{label}</span>
}

/**
 * The grid forces `hover` and `focus-visible`: a header row, `default`, `:hover` and `:focus-visible`, above 2
 * captioned rows of 3 columns. The default tone's hover cell is blue, with the blue text of the theme around the grid.
 * The quiet tone's stays grey, since its own rule wins at the same specificity, but takes the theme's text colour. Both
 * focus-visible cells have a purple outline. `play` checks the headers and each cell's computed style.
 */
export const ForcedStates: Story = {
  render: () => (
    <div className="forced-states-theme">
      <style>{stateChipStyles}</style>
      <Combinations
        component={StateChip}
        props={{ tone: ['default', 'quiet'] }}
        args={{ label: 'Save' }}
        states={['hover', 'focus-visible']}
      />
    </div>
  ),
  play: forcedStatesPlay,
}

/**
 * A grey chip whose hover rule `LateStyles` adds once the grid is there.
 */
function LateChip({ variant }: LateChipProps) {
  return (
    <span className={lateChipClassOf(variant)} style={lateChipStyle}>
      {lateChipLabels[variant]}
    </span>
  )
}

/**
 * The grid forces `hover`, and its chips' hover rules arrive after it appears: `play` inserts one with `insertRule`, as
 * CSS-in-JS does in production, and appends the other as a text node to a `<style>`, as it does in development. Both
 * are rewritten, so the inserted chip's hover cell turns green and the appended one's yellow, while the default cells
 * stay grey. `play` waits for those colours.
 */
export const LateStyles: Story = {
  render: () => (
    <>
      <style data-late-insert>{lateBaseRule}</style>
      <style data-late-append />
      <Combinations component={LateChip} props={{ variant: ['inserted', 'appended'] }} states={['hover']} />
    </>
  ),
  play: lateStylesPlay,
}

/**
 * The styles every shadow chip's part starts from.
 */
const shadowPartStyles =
  'display: inline-block; padding: 6px 14px; border: 0; border-radius: 999px; background: #e4e4e7; color: #18181b; font: 16px/20px sans-serif'

/**
 * The adopted sheet every `vc-adopted-chip` shares, made and filled by the first one.
 */
let adoptedChipSheet: CSSStyleSheet | undefined

/**
 * The sheet every `vc-adopted-chip` adopts, made and filled the first time.
 */
function adoptedChipSheetOf(): CSSStyleSheet {
  if (adoptedChipSheet === undefined) {
    adoptedChipSheet = new CSSStyleSheet()
    adoptedChipSheet.replaceSync(
      `button { ${shadowPartStyles} } button:hover { background: #bfdbfe } :host(:focus-within) button { outline: 3px solid #7c3aed }`,
    )
  }

  return adoptedChipSheet
}

/**
 * Defines the shadow chips once: `vc-adopted-chip`, whose open root adopts a constructed sheet with a hover rule and a
 * `:host(:focus-within)` rule; `vc-style-chip`, whose open root has a `<style>` with `span:hover` and
 * `span:focus-within`; and `vc-outer-chip`, whose open root holds a `vc-adopted-chip`.
 */
function defineShadowChips(): void {
  if (customElements.get('vc-adopted-chip') === undefined) {
    customElements.define(
      'vc-adopted-chip',
      class extends HTMLElement {
        constructor() {
          super()

          const root = this.attachShadow({ mode: 'open' })

          root.adoptedStyleSheets = [adoptedChipSheetOf()]
          root.innerHTML = '<button type="button">Adopted</button>'
        }
      },
    )
  }

  if (customElements.get('vc-style-chip') === undefined) {
    customElements.define(
      'vc-style-chip',
      class extends HTMLElement {
        constructor() {
          super()
          this.attachShadow({
            mode: 'open',
          }).innerHTML = `<style>span { ${shadowPartStyles} } span:hover { background: #bfdbfe } span:focus-within { outline: 3px solid #7c3aed }</style><span>Style</span>`
        }
      },
    )
  }

  if (customElements.get('vc-outer-chip') === undefined) {
    customElements.define(
      'vc-outer-chip',
      class extends HTMLElement {
        constructor() {
          super()
          this.attachShadow({ mode: 'open' }).innerHTML = '<vc-adopted-chip></vc-adopted-chip>'
        }
      },
    )
  }
}

/**
 * A constructed sheet the document adopts for `ShadowRoots`, with the document chip's styles.
 */
function documentChipSheet(): CSSStyleSheet {
  const sheet = new CSSStyleSheet()

  sheet.replaceSync(
    `.document-chip { ${shadowPartStyles} } .document-chip:hover { background: #bfdbfe } .document-chip:focus-within { outline: 3px solid #7c3aed }`,
  )

  return sheet
}

/**
 * Where a shadow chip's styles are: a shadow root's adopted sheet, a shadow root's `<style>`, the adopted sheet of a
 * shadow root nested in another, or the document's adopted sheet.
 */
const shadowChipKinds = ['adopted', 'style', 'nested', 'document'] as const

/**
 * What a shadow chip is.
 */
interface ShadowChipProps {
  /**
   * Where its styles are.
   */
  kind: (typeof shadowChipKinds)[number]
}

/**
 * Each kind's element.
 */
const shadowChipElements = {
  adopted: 'vc-adopted-chip',
  style: 'vc-style-chip',
  nested: 'vc-outer-chip',
  document: 'span',
} satisfies Record<ShadowChipProps['kind'], string>

/**
 * A chip of the kind, made with `createElement`.
 */
function ShadowChip({ kind }: ShadowChipProps) {
  return createElement(
    shadowChipElements[kind],
    kind === 'document' ? { className: 'document-chip' } : {},
    kind === 'document' ? 'Document' : undefined,
  )
}

/**
 * The element a shadow chip styles: the part inside its shadow root, through nested roots, or the chip itself.
 */
function styledPartOf(chip: Element): Element {
  const root = chip.shadowRoot

  if (root === null) {
    return chip
  }

  const part = root.querySelector('button, span, vc-adopted-chip')

  if (part === null) {
    throw new Error(`${chip.localName} has no part in its shadow root`)
  }

  return styledPartOf(part)
}

/**
 * The hosts of the kind, in column order.
 */
function hostsOf(canvasElement: HTMLElement, kind: ShadowChipProps['kind']): Element[] {
  return [...canvasElement.querySelectorAll(kind === 'document' ? '.document-chip' : shadowChipElements[kind])]
}

/**
 * The grid forces `hover` and `focus-within` on chips styled from shadow roots: one root's adopted sheet, one's
 * `<style>`, a root nested in another's, and a sheet the document adopts in `beforeEach`. In every row the hover cell
 * is blue and the focus-within cell has a purple outline, while the default cell has neither. Each host in a state
 * cell carries its state's class, the nested one included, since a shadow root's sheet sees only its host's classes.
 * `play` checks each.
 */
export const ShadowRoots: Story = {
  beforeEach: () => {
    defineShadowChips()

    const sheet = documentChipSheet()

    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]

    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((adopted) => adopted !== sheet)
    }
  },
  render: () => (
    <Combinations component={ShadowChip} props={{ kind: [...shadowChipKinds] }} states={['hover', 'focus-within']} />
  ),
  play: async ({ canvasElement }) => {
    const rows = shadowChipKinds.map((kind) =>
      stylesOf(hostsOf(canvasElement, kind).map(styledPartOf), ['background-color', 'outline-style']),
    )
    const nestedHosts = hostsOf(canvasElement, 'nested').flatMap((host) => [
      ...(host.shadowRoot?.querySelectorAll('vc-adopted-chip') ?? []),
    ])

    // One row per kind; columns default, hover, focus-within.
    await expect(rows).toEqual(
      shadowChipKinds.map(() => [
        [colors.grey, 'none'],
        [colors.blue, 'none'],
        [colors.grey, 'solid'],
      ]),
    )
    // The hosts of each shadow kind, the nested one's inner host included; columns default, hover, focus-within.
    await expect(
      [hostsOf(canvasElement, 'adopted'), hostsOf(canvasElement, 'style'), nestedHosts].map((hosts) =>
        hosts.map((host) => host.className),
      ),
    ).toEqual([
      ['', 'visual-check-hover', 'visual-check-focus-within'],
      ['', 'visual-check-hover', 'visual-check-focus-within'],
      ['', 'visual-check-hover', 'visual-check-focus-within'],
    ])
  },
}

/**
 * The styles of `BesidePseudoStates`, in a `<style>` both rewriters process.
 */
const pairChipStyles = `
.pair-chip { display: inline-block; padding: 6px 14px; border-radius: 999px; background: #e4e4e7; color: #18181b; font: 16px/20px sans-serif }
.pair-chip:hover { background: #fde68a }
.pair-chip:focus-visible { outline: 3px solid #7c3aed }
`

/**
 * What a pair chip shows.
 */
interface PairChipProps {
  /**
   * The chip's text.
   */
  label: string
}

/**
 * A grey chip that turns yellow on hover.
 */
function PairChip({ label }: PairChipProps) {
  return <span className="pair-chip">{label}</span>
}

/**
 * The rule of `BesidePseudoStates`'s stylesheet whose first selector, once rewritten, is the given one.
 */
function pairRuleOf(canvasElement: HTMLElement, firstSelector: string): CSSStyleRule {
  const rules = [...sheetOf(styleElementOf(canvasElement, 'style[data-pair-styles]')).cssRules]
  const rule = rules.find(
    (candidate): candidate is CSSStyleRule =>
      candidate instanceof CSSStyleRule && candidate.selectorText.startsWith(`${firstSelector},`),
  )

  if (rule === undefined) {
    throw new Error(`No rewritten rule starts with ${firstSelector}`)
  }

  return rule
}

/**
 * How often each of the wanted selectors appears in the rule's selector list.
 */
function countsOf(rule: CSSStyleRule, wanted: string[]): number[] {
  const selectors = rule.selectorText.split(', ')

  return wanted.map((selector) => selectors.filter((candidate) => candidate === selector).length)
}

/**
 * The grid forces `hover` beside Storybook's pseudo-states addon, which rewrites the same `<style>` once the story has
 * rendered. The chip outside the grid has the addon's own class, `pseudo-hover`, rather than `parameters.pseudo`, which
 * would update the globals and render again. `play` checks our hover cell. The `wait` hook, which runs after the
 * addon's rewrite, checks that the addon's chip and our cell are both yellow, and that the hover rule has the addon's
 * two twins and ours once each. Then it forces `focus-visible`, in the reverse order, and checks that the focus-visible
 * rule the addon already replaced gains our twin in place, keeping the addon's. No cell is focus-visible, so the
 * snapshot is the same as in plain Storybook.
 */
export const BesidePseudoStates: Story = {
  parameters: {
    ...visualCheck({
      wait: async ({ canvas, canvasElement }) => {
        await waitFor(() => expect(getComputedStyle(canvas.getByText('Addon')).backgroundColor).toBe(colors.yellow))
        await expect(stylesOf(canvas.getAllByText('Pair'), ['background-color'])).toEqual([
          [colors.grey],
          [colors.yellow],
        ])
        await expect(
          countsOf(pairRuleOf(canvasElement, '.pair-chip:hover'), [
            '.pair-chip.pseudo-hover',
            '.pseudo-hover-all .pair-chip',
            '.pair-chip:is(.visual-check-hover *)',
          ]),
        ).toEqual([1, 1, 1])

        const before = pairRuleOf(canvasElement, '.pair-chip:focus-visible')
        const stop = forceStates(['focus-visible'])
        const after = pairRuleOf(canvasElement, '.pair-chip:focus-visible')

        stop()

        await expect(after).toBe(before)
        await expect(
          countsOf(after, [
            '.pair-chip.pseudo-focus-visible',
            '.pseudo-focus-visible-all .pair-chip',
            '.pair-chip:is(.visual-check-focus-visible *)',
          ]),
        ).toEqual([1, 1, 1])
      },
    }),
  },
  render: () => (
    <div style={{ display: 'flex', gap: 32, alignItems: 'start' }}>
      <style data-pair-styles>{pairChipStyles}</style>
      <span className="pair-chip pseudo-hover">Addon</span>
      <Combinations component={PairChip} props={{ label: ['Pair'] }} states={['hover']} />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(stylesOf(canvas.getAllByText('Pair'), ['background-color'])).toEqual([[colors.grey], [colors.yellow]])
  },
}
