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
 * A plain bordered note, the box each options story shows its text in.
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

declare global {
  /**
   * `true` when the end-to-end check's invalid-options case asks `InvalidWhenAsked` for invalid options, through a
   * script the check's server adds to every story page before Storybook imports any stories file.
   */
  var __visualCheckE2eInvalidOptions: boolean | undefined
}

const meta = {
  title: 'Options',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * `disable: true` on the story alone, in a file that isn't disabled, leaves it out: visual-check never captures it,
 * prints a line for it or counts it.
 */
export const DisabledOnItsOwn: Story = {
  parameters: { ...visualCheck({ disable: true }) },
  render: () => <Note>this story is left out</Note>,
}

/**
 * Valid, and passes, unless the end-to-end check asks for invalid options: then its hand-written
 * `parameters.visualCheck` sets `tolerance.pixels` to `'120%'`, past `'100%'`, so `test` exits 2 naming the story and
 * the key before any capture.
 */
export const InvalidWhenAsked: Story = {
  parameters:
    globalThis.__visualCheckE2eInvalidOptions === true ? { visualCheck: { tolerance: { pixels: '120%' } } } : {},
  render: () => <Note>valid unless the end-to-end check asks</Note>,
}
