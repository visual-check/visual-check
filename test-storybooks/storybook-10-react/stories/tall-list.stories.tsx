import type { Meta, StoryObj } from '@storybook/react-vite'

/**
 * How many rows the list has: enough to make the story about three times as tall as the default 720 px viewport.
 */
const rowCount = 40

/**
 * The row numbers, from 1.
 */
const rows = Array.from({ length: rowCount }, (_, index) => index + 1)

/**
 * A numbered list of rows in alternating colours, taller than the viewport, so only a full-page capture shows its end.
 */
function TallList() {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', fontFamily: 'sans-serif', fontSize: 16 }}>
      {rows.map((row) => (
        <li
          key={row}
          style={{
            height: 56,
            padding: '0 16px',
            lineHeight: '56px',
            background: row % 2 === 1 ? '#e0f2fe' : '#fef3c7',
          }}
        >
          Row {row} of {rowCount}
        </li>
      ))}
    </ol>
  )
}

const meta = {
  title: 'Tall list',
  component: TallList,
} satisfies Meta<typeof TallList>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
