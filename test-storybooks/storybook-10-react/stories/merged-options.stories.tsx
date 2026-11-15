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
 * A plain bordered note, as the readiness stories show their results in, wide enough for the merged options' JSON.
 */
function Note({ children }: NoteProps) {
  return (
    <div
      style={{
        width: 560,
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
 * Writes the merged `parameters.visualCheck` as indented JSON. JSON has no functions, so each one is written as
 * `a function`.
 */
function jsonOf(parameter: unknown): string {
  return JSON.stringify(parameter, (_key, value: unknown) => (typeof value === 'function' ? 'a function' : value), 2)
}

/**
 * What the merged options show.
 */
interface MergedOptionsProps {
  /**
   * The story's merged `parameters.visualCheck`.
   */
  parameter: unknown
}

/**
 * Shows the story's merged `parameters.visualCheck` as JSON.
 */
function MergedOptions({ parameter }: MergedOptionsProps) {
  return (
    <Note>
      <pre style={{ margin: 0, fontSize: 14 }}>{jsonOf(parameter)}</pre>
    </Note>
  )
}

/**
 * The meta sets every option the story then changes. Each value is one no capture depends on: the viewport is the
 * config's default width, no mask matches anything, and the story turns `modes` and `element` back off.
 */
const meta = {
  title: 'Merged Options',
  parameters: {
    ...visualCheck({
      modes: ['narrow', 'wide'],
      viewport: { width: 1280 },
      tolerance: { pixels: 0 },
      masks: { 'never-a': { selector: '[data-never-a]' }, dropped: { selector: '[data-never-b]' } },
      element: '#storybook-root',
    }),
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Shows the options Storybook merged from the preview, the meta and the story, so its snapshot pins how each key
 * merges: `modes` is the story's list, so both modes are `null`; `viewport` and `tolerance` merge key by key; `masks`
 * merges by name, with `dropped` dropped; `element` is the story's `null`; `wait` is the preview's hook. Each merged
 * value is one no capture depends on: the viewport is the config's default 1280 × 720, no mask matches anything,
 * `element: null` is the full page, and no mode is listed.
 */
export const Default: Story = {
  parameters: {
    ...visualCheck({
      modes: [],
      viewport: { height: 720 },
      tolerance: { color: 0 },
      masks: { dropped: null, 'never-c': { selector: '[data-never-c]' } },
      element: null,
    }),
  },
  render: (_args, context) => <MergedOptions parameter={context.parameters.visualCheck} />,
}
