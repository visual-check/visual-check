import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { visualCheck } from '../.storybook/visual-check.ts'

/**
 * What a note shows.
 */
interface NoteProps {
  /**
   * The note's text.
   */
  children: ReactNode
}

/**
 * A plain bordered note, the box each disabled story shows its text in.
 */
function Note({ children }: NoteProps) {
  return (
    <div
      style={{
        width: 400,
        padding: 16,
        border: '1px solid #a1a1aa',
        borderRadius: 6,
        background: '#f4f4f5',
        fontFamily: 'sans-serif',
        fontSize: 16,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  )
}

/**
 * `disable: true` on the meta leaves every story of the file out, unless the story brings itself back.
 */
const meta = {
  title: 'Disabled',
  parameters: { ...visualCheck({ disable: true }) },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Inherits the meta's `disable: true`, so visual-check never captures it, prints a line for it or counts it.
 */
export const Skipped: Story = {
  render: () => <Note>this story is left out</Note>,
}

/**
 * `disable: false` brings it back from its disabled file, so it's captured and passes.
 */
export const BroughtBack: Story = {
  parameters: { ...visualCheck({ disable: false }) },
  render: () => <Note>brought back from a disabled file</Note>,
}
