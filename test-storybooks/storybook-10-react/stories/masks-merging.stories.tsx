import type { Meta, StoryObj } from '@storybook/react-vite'
import { visualCheck } from '../.storybook/visual-check.ts'

/**
 * The three labelled boxes, `a`, `b` and `c`, each by the data attribute its mask's selector matches.
 */
const boxes = [
  { label: 'a', attribute: 'data-a', background: '#fef3c7' },
  { label: 'b', attribute: 'data-b', background: '#dcfce7' },
  { label: 'c', attribute: 'data-c', background: '#e0e7ff' },
]

/**
 * Three boxes in a row, `a`, `b` and `c`, each 96 × 64 px with its label.
 */
function ThreeBoxes() {
  return (
    <div style={{ display: 'flex', gap: 16, padding: 24, fontFamily: 'sans-serif', fontSize: 16 }}>
      {boxes.map((box) => (
        <div
          key={box.label}
          {...{ [box.attribute]: true }}
          style={{ boxSizing: 'border-box', width: 96, height: 64, padding: 8, background: box.background }}
        >
          {box.label}
        </div>
      ))}
    </div>
  )
}

/**
 * The meta sets masks `a` and `b`, which every story here inherits and changes by name.
 */
const meta = {
  title: 'Masks Merging',
  parameters: {
    ...visualCheck({ masks: { a: { selector: '[data-a]' }, b: { selector: '[data-b]' } } }),
  },
  render: () => <ThreeBoxes />,
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Storybook merges `masks` by name: the story drops `b` with `null` and adds `c`, so `a` and `c` are masked and `b`
 * shows.
 */
export const MergedByName: Story = {
  parameters: { ...visualCheck({ masks: { b: null, c: { selector: '[data-c]' } } }) },
}

/**
 * `masks: null` drops every mask, the meta's and the preview's, so all three boxes show.
 */
export const AllDropped: Story = {
  parameters: { ...visualCheck({ masks: null }) },
}
