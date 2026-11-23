import type { Meta, StoryObj } from '@storybook/react-vite'
import { Combinations } from '@visual-check/storybook/react'
import { type CSSProperties, createContext, useContext } from 'react'
import { visualCheck } from '../.storybook/visual-check.ts'

/**
 * The colour of an accent chip. The meta's decorator provides green, so a red chip in a snapshot means context didn't
 * reach the grid's cells.
 */
const Accent = createContext('#dc2626')

/**
 * What a chip shows and how.
 */
interface ChipProps {
  /**
   * The chip's text.
   */
  label: string
  /**
   * Its colours: grey, or the accent from context with white text.
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
 * Each size's padding and font size.
 */
const sizeStyles = {
  sm: { padding: '2px 8px', fontSize: 12 },
  lg: { padding: '6px 14px', fontSize: 16 },
} satisfies Record<ChipProps['size'], CSSProperties>

/**
 * Each tone's text colour.
 */
const toneColors = { neutral: '#18181b', accent: '#ffffff' } satisfies Record<ChipProps['tone'], string>

/**
 * A neutral chip's background.
 */
const neutralBackground = '#e4e4e7'

/**
 * A rounded chip, whose accent colour comes from context.
 */
function Chip({ label, tone, size, title }: ChipProps) {
  const accent = useContext(Accent)

  return (
    <span
      title={title}
      style={{
        ...sizeStyles[size],
        display: 'inline-block',
        borderRadius: 999,
        background: tone === 'accent' ? accent : neutralBackground,
        color: toneColors[tone],
        fontFamily: 'sans-serif',
        lineHeight: '20px',
      }}
    >
      {label}
    </span>
  )
}

/**
 * A title long enough that its row's caption wraps at the column's width, rather than widening the column.
 */
const longTitle = 'A title only the tooltip shows, long enough that its caption wraps at the row width'

/**
 * The meta's decorator provides the green accent around every story, so it reaches the grid's cells only through
 * React's own tree.
 */
const meta = {
  title: 'Grid',
  decorators: [
    (Story) => (
      <Accent.Provider value="#16a34a">
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
