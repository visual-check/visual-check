import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useEffect, useState } from 'react'
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
 * A plain bordered note, the box each wait story shows its result in.
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
 * A note whose paragraph says no wait hook ran, until a hook sets its text.
 */
function WaitTarget() {
  return (
    <Note>
      <p data-wait-target style={{ margin: 0 }}>
        wait didn't run
      </p>
    </Note>
  )
}

/**
 * How long the late content takes to show, in milliseconds.
 */
const lateContentDelay = 1500

/**
 * How long the `wait` of `AwaitsLateContent` looks for the late content before it gives up, in milliseconds: well past
 * its delay, and within visual-check's default `readyTimeout` of 10 s.
 */
const lateContentTimeout = 5000

/**
 * A note that says `Loading`, then `Late content` once a timer has run for 1500 ms.
 */
function LateContent() {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), lateContentDelay)

    return () => clearTimeout(timer)
  }, [])

  return <Note>{loaded ? 'Late content' : 'Loading'}</Note>
}

/**
 * Sets the text of the story's `[data-wait-target]` element, when it has one.
 */
function writeWaitTarget(canvasElement: HTMLElement, text: string): void {
  const target = canvasElement.querySelector('[data-wait-target]')

  if (target !== null) {
    target.textContent = text
  }
}

const meta = {
  title: 'Wait',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Sets no `wait` of its own, so it inherits the preview's, which writes `preview wait ran` into the note.
 */
export const InheritsPreviewWait: Story = {
  render: () => <WaitTarget />,
}

/**
 * Its own `wait` replaces the preview's and writes `story wait ran` into the note.
 */
export const OwnWait: Story = {
  parameters: {
    ...visualCheck({
      wait: ({ canvasElement }) => {
        writeWaitTarget(canvasElement, 'story wait ran')
      },
    }),
  },
  render: () => <WaitTarget />,
}

/**
 * `wait: null` turns the preview's hook off, so the note still says `wait didn't run`.
 */
export const WaitTurnedOff: Story = {
  parameters: { ...visualCheck({ wait: null }) },
  render: () => <WaitTarget />,
}

/**
 * The note shows `Late content` 1500 ms after it renders, long after Storybook reports the story finished. Its `wait`
 * finds that text through `canvas`, which visual-check builds from `storybook/test` as `play` gets it, so the snapshot
 * shows `Late content`.
 */
export const AwaitsLateContent: Story = {
  parameters: {
    ...visualCheck({
      wait: async ({ canvas }) => {
        await canvas.findByText('Late content', undefined, { timeout: lateContentTimeout })
      },
    }),
  },
  render: () => <LateContent />,
}

/**
 * Its `wait` throws, so the story is broken, `wait-threw`, and its line says what it threw. Its committed baseline is
 * the story with a `wait` that does nothing.
 */
export const Throws: Story = {
  parameters: {
    ...visualCheck({
      wait: () => {
        throw new Error('visual-check: wait threw')
      },
    }),
  },
  render: () => <Note>the wait hook throws</Note>,
}
