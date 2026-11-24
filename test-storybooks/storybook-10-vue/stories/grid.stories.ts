import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { Combinations } from '@visual-check/storybook/vue'
import { defineComponent, h, type InjectionKey, inject, type PropType, provide } from 'vue'
import {
  accentColor,
  type ChipProps,
  chipStyleOf,
  everyCombinationPlay,
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
 * The colour of an accent chip. The meta's decorator provides `accentColor`, green, and a chip injects it with a red
 * default, so a red chip in a snapshot means `provide` didn't reach the grid's cells.
 */
const accentKey: InjectionKey<string> = Symbol('accent')

/**
 * The accent a chip injects when nothing provides one: red, so a red chip means `provide` missed its cell.
 */
const missingAccent = '#dc2626'

/**
 * A rounded chip, whose accent colour is injected.
 */
const Chip = defineComponent({
  props: {
    label: { type: String as PropType<ChipProps['label']>, required: true },
    tone: { type: String as PropType<ChipProps['tone']>, required: true },
    size: { type: String as PropType<ChipProps['size']>, required: true },
    title: { type: String as PropType<ChipProps['title']>, required: false },
  },
  setup(props) {
    const accent = inject(accentKey, missingAccent)

    return () => h('span', { title: props.title, style: chipStyleOf(props, accent) }, props.label)
  },
})

/**
 * The grid stories, drawn in Vue with `<Combinations>` from `@visual-check/storybook/vue`, with the same elements and
 * styles as `storybook-10-react`'s, so their snapshots are the React port's byte for byte. The meta's decorator
 * provides the green accent around every story, so it reaches the grid's cells only through Vue's own tree.
 */
const meta = {
  title: 'Grid',
  decorators: [
    (story) => {
      const Story = story()

      return defineComponent({
        setup() {
          provide(accentKey, accentColor)

          return () => h(Story)
        },
      })
    },
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Every combination of the chip's tone, size and title: 8 captioned rows, as the React story draws them. Every accent
 * chip is green, from the meta's decorator: `play` checks the computed background of each, which a red chip fails.
 */
export const EveryCombination: Story = {
  render: () => ({
    render: () =>
      h(Combinations, {
        component: Chip,
        props: { tone: ['neutral', 'accent'], size: ['sm', 'lg'], title: [undefined, longTitle] },
        args: { label: 'Save changes' },
      }),
  }),
  play: everyCombinationPlay,
}

/**
 * A chip styled only by `stateChipStyles`, so its states come from the page's stylesheet.
 */
const StateChip = defineComponent({
  props: {
    label: { type: String as PropType<StateChipProps['label']>, required: true },
    tone: { type: String as PropType<StateChipProps['tone']>, required: true },
  },
  setup(props) {
    return () => h('span', { class: stateChipClassOf(props.tone) }, props.label)
  },
})

/**
 * The grid forces `hover` and `focus-visible` inside the theme that colours a hovered chip's text, as the React story
 * does. `play` checks the headers and each cell's computed style.
 */
export const ForcedStates: Story = {
  render: () => ({
    render: () =>
      h('div', { class: 'forced-states-theme' }, [
        h('style', stateChipStyles),
        h(Combinations, {
          component: StateChip,
          props: { tone: ['default', 'quiet'] },
          args: { label: 'Save' },
          states: ['hover', 'focus-visible'],
        }),
      ]),
  }),
  play: forcedStatesPlay,
}

/**
 * A grey chip whose hover rule `LateStyles` adds once the grid is there.
 */
const LateChip = defineComponent({
  props: {
    variant: { type: String as PropType<LateChipProps['variant']>, required: true },
  },
  setup(props) {
    return () =>
      h('span', { class: lateChipClassOf(props.variant), style: lateChipStyle }, lateChipLabels[props.variant])
  },
})

/**
 * The grid forces `hover`, and `play` adds its chips' hover rules once the grid is in the page, so forcing must stay on
 * after the grid is mounted. The fragment puts the two `<style>` elements and the grid straight into the canvas, as the
 * React story's fragment does, and their data attributes are `"true"`, as React writes a boolean one.
 */
export const LateStyles: Story = {
  render: () => ({
    render: () => [
      h('style', { 'data-late-insert': 'true' }, lateBaseRule),
      h('style', { 'data-late-append': 'true' }),
      h(Combinations, { component: LateChip, props: { variant: ['inserted', 'appended'] }, states: ['hover'] }),
    ],
  }),
  play: lateStylesPlay,
}
