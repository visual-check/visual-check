import type { Meta, StoryObj } from '@storybook/react-vite'
import { forceStates } from '@visual-check/storybook'
import { expect } from 'storybook/test'

/**
 * The story's styles: a grey chip that turns blue on hover, and a field whose focus-within gives it a purple outline.
 */
const styles = `
.outside-chip { display: inline-block; padding: 6px 14px; border-radius: 999px; background: #e4e4e7; color: #18181b; font: 16px/20px sans-serif }
.outside-chip:hover { background: #bfdbfe }
.field { display: inline-block; padding: 8px; border: 1px solid #a1a1aa; border-radius: 6px }
.field:focus-within { outline: 3px solid #7c3aed; outline-offset: 2px }
.field input { width: 180px; font: 16px/20px sans-serif }
`

/**
 * What a chip shows.
 */
interface ChipProps {
  /**
   * The chip's text.
   */
  label: string
}

/**
 * A grey chip that turns blue on hover.
 */
function Chip({ label }: ChipProps) {
  return <span className="outside-chip">{label}</span>
}

const meta = {
  title: 'Forced States',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * `forceStates` forces `hover` and `focus-within` outside a grid, from the story's `beforeEach`, whose cleanup stops
 * it. The `visual-check-hover` class sits on a `<section>` two levels above the first chip, not on its parent, and the
 * chip is blue. The field inside `visual-check-focus-within` has its purple outline, though nothing has focus. The
 * control chip outside both stays grey. `play` checks all three through their computed styles.
 */
export const OutsideAGrid: Story = {
  beforeEach: () => forceStates(['hover', 'focus-within']),
  render: () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', padding: 16 }}>
      <style>{styles}</style>
      <section className="visual-check-hover">
        <div>
          <Chip label="Forced hover" />
        </div>
      </section>
      <div className="visual-check-focus-within">
        <label className="field" data-testid="field">
          <input aria-label="Name" defaultValue="Forced focus-within" />
        </label>
      </div>
      <Chip label="Control" />
    </div>
  ),
  play: async ({ canvas }) => {
    const forced = getComputedStyle(canvas.getByText('Forced hover'))
    const field = getComputedStyle(canvas.getByTestId('field'))
    const control = getComputedStyle(canvas.getByText('Control'))

    await expect(forced.backgroundColor).toBe('rgb(191, 219, 254)')
    await expect(field.outlineStyle).toBe('solid')
    await expect(field.outlineColor).toBe('rgb(124, 58, 237)')
    await expect(control.backgroundColor).toBe('rgb(228, 228, 231)')
  },
}
