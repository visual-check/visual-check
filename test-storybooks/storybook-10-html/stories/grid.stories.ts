import type { Meta, StoryObj } from '@storybook/html-vite'
import { combinations } from '@visual-check/storybook'
import {
  accentColor,
  type ChipProps,
  chipStyleOf,
  forcedStatesPlay,
  type LateChipProps,
  lateBaseRule,
  lateChipClassOf,
  lateChipLabels,
  lateChipStyle,
  lateStylesPlay,
  longTitle,
  type StateChipProps,
  stateChipClassOf,
  stateChipStyles,
} from '../../storybook-10-react/stories/grid-parts.ts'

/**
 * The grid stories, drawn in plain DOM with the same elements and styles as `storybook-10-react`'s, so their snapshots
 * are the React port's byte for byte.
 */
const meta = {
  title: 'Grid',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * A rounded chip in the green accent, with a tooltip only when it has a title.
 */
function chip({ label, tone, size, title }: ChipProps): HTMLElement {
  const span = document.createElement('span')

  if (title !== undefined) {
    span.title = title
  }

  Object.assign(span.style, chipStyleOf({ tone, size }, accentColor))
  span.textContent = label

  return span
}

/**
 * Every combination of the chip's tone, size and title: 8 captioned rows, as the React story draws them.
 */
export const EveryCombination: Story = {
  render: () =>
    combinations({
      render: chip,
      props: { tone: ['neutral', 'accent'], size: ['sm', 'lg'], title: [undefined, longTitle] },
      args: { label: 'Save changes' },
    }),
}

/**
 * A chip styled only by `stateChipStyles`, so its states come from the page's stylesheet.
 */
function stateChip({ label, tone }: StateChipProps): HTMLElement {
  const span = document.createElement('span')

  span.className = stateChipClassOf(tone)
  span.textContent = label

  return span
}

/**
 * The grid forces `hover` and `focus-visible` inside the theme that colours a hovered chip's text, as the React story
 * does. `play` checks the headers and each cell's computed style.
 */
export const ForcedStates: Story = {
  render: () => {
    const theme = document.createElement('div')
    const style = document.createElement('style')

    theme.className = 'forced-states-theme'
    style.textContent = stateChipStyles
    theme.append(
      style,
      combinations({
        render: stateChip,
        props: { tone: ['default', 'quiet'] },
        args: { label: 'Save' },
        states: ['hover', 'focus-visible'],
      }),
    )

    return theme
  },
  play: forcedStatesPlay,
}

/**
 * A grey chip whose hover rule `LateStyles` adds once the grid is there.
 */
function lateChip({ variant }: LateChipProps): HTMLElement {
  const span = document.createElement('span')

  span.className = lateChipClassOf(variant)
  Object.assign(span.style, lateChipStyle)
  span.textContent = lateChipLabels[variant]

  return span
}

/**
 * The grid forces `hover`, and `play` adds its chips' hover rules once the grid is in the page, so forcing must stay on
 * after the grid is drawn. The fragment puts the two `<style>` elements and the grid straight into the canvas, as the
 * React story's fragment does, and their data attributes are `"true"`, as React writes a boolean one.
 */
export const LateStyles: Story = {
  render: () => {
    const fragment = document.createDocumentFragment()
    const insertStyle = document.createElement('style')
    const appendStyle = document.createElement('style')

    insertStyle.dataset.lateInsert = 'true'
    insertStyle.textContent = lateBaseRule
    appendStyle.dataset.lateAppend = 'true'
    fragment.append(
      insertStyle,
      appendStyle,
      combinations({ render: lateChip, props: { variant: ['inserted', 'appended'] }, states: ['hover'] }),
    )

    return fragment
  },
  play: lateStylesPlay,
}
